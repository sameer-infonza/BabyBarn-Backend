import { prisma } from '../lib/prisma.js';
import { shippingService } from '../services/shipping.service.js';
import { validate } from '../utils/validation.js';
import {
  shippingRatesSchema,
  shippingShipmentSchema,
  shippingLabelSchema,
} from '../schemas/index.js';
import { toPublicJson } from '../utils/serialize.js';

export class ShippingController {
  async debugRateCheck(req, res) {
    const body = await validate(shippingRatesSchema, req.body ?? {});

    const run = async (country) => {
      try {
        const data = await shippingService.getRates({
          ...body,
          useDummyAddress: true,
          dummyCountry: country,
          preferProviderOnly: true,
        });
        return {
          country,
          ok: true,
          rateCount: Array.isArray(data?.rates) ? data.rates.length : 0,
          cheapest: data?.rates?.[0] || null,
          providers: [...new Set((data?.rates || []).map((rate) => String(rate?.provider || '')).filter(Boolean))],
          diagnostics: data?.diagnostics || null,
        };
      } catch (error) {
        return {
          country,
          ok: false,
          rateCount: 0,
          error: {
            code: error?.code || 'RATE_CHECK_FAILED',
            message: error?.message || 'Rate check failed',
            details: error?.details || null,
          },
        };
      }
    };

    const [us, ca] = await Promise.all([run('US'), run('CA')]);
    const usProviders = new Set((us?.providers || []).map((provider) => String(provider || '')));
    const caProviders = new Set((ca?.providers || []).map((provider) => String(provider || '')));
    const providerIntersection = [...usProviders].filter((p) => caProviders.has(p));
    const warnings = [];
    if (!us.ok || !ca.ok) {
      warnings.push('One or more country checks failed; verify UPS credentials and account activation.');
    }
    if (us.ok && ca.ok && providerIntersection.length === 0) {
      warnings.push('No shared carriers between US and CA in current account/mode.');
    }

    const checks = [
      'Address fields: city/state/zip/country normalized',
      'UPS account and domestic rating coverage',
      'Test vs live mode parity',
      'Parcel units and values (lb/in or kg/cm)',
      'Origin address completeness',
      'Selected rate freshness (reject stale selectedRateId on checkout)',
    ];

    res.status(200).json({
      success: true,
      data: toPublicJson({
        mode: String(process.env.UPS_CLIENT_ID || '').trim() ? 'ups_configured' : 'ups_missing',
        comparison: { us, ca },
        checks,
        warnings,
      }),
    });
  }

  async getRates(req, res) {
    const body = await validate(shippingRatesSchema, req.body ?? {});
    const data = await shippingService.getRates({ ...body, preferProviderOnly: true });
    res.status(200).json({ success: true, data: toPublicJson(data) });
  }

  async createShipment(req, res) {
    const body = await validate(shippingShipmentSchema, req.body ?? {});
    const data = await shippingService.createShipment(body);
    res.status(201).json({ success: true, data: toPublicJson(data) });
  }

  async generateLabel(req, res) {
    const body = await validate(shippingLabelSchema, req.body ?? {});
    const label = await shippingService.generateLabel(body);
    if (body.orderId && label.trackingNumber) {
      await prisma.order.updateMany({
        where: { publicId: body.orderId },
        data: {
          trackingNumber: label.trackingNumber,
          shippingCarrier: label.shippingCarrier || undefined,
          shippingLabelUrl: label.shippingLabelUrl || undefined,
          shippingTransactionId: label.transactionId || undefined,
          status: 'SHIPPED',
        },
      });
    }
    res.status(201).json({ success: true, data: toPublicJson(label) });
  }

  async track(req, res) {
    const carrier = String(req.params.carrier || '').trim();
    const trackingNumber = String(req.params.trackingNumber || '').trim();
    const data = await shippingService.trackShipment(carrier, trackingNumber);
    res.status(200).json({ success: true, data: toPublicJson(data) });
  }

  async shippoWebhook(req, res) {
    void req;
    res.status(410).json({
      success: false,
      code: 'SHIPPO_WEBHOOK_RETIRED',
      message: 'Shippo webhooks are disabled. Use UPS tracking sync and admin order updates.',
    });
  }
}

export const shippingController = new ShippingController();
