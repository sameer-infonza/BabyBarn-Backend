import { validate } from '../utils/validation.js';
import { createOrderSchema } from '../schemas/index.js';
import { toPublicJson } from '../utils/serialize.js';
import {
  createMembershipCheckoutSession,
  createOrderCheckoutSession,
  getCheckoutSessionSummary,
  processStripeWebhook,
} from '../services/payment.service.js';

export async function stripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  try {
    await processStripeWebhook(req.body, sig);
    res.json({ received: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).send(`Webhook Error: ${msg}`);
  }
}

export async function membershipCheckout(req, res, next) {
  try {
    const userPublicId = req.user?.id;
    if (!userPublicId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const returnTo = req.body && typeof req.body.returnTo === 'string' ? req.body.returnTo : undefined;
    const data = await createMembershipCheckoutSession(userPublicId, { returnTo });
    res.status(200).json({ success: true, data: toPublicJson(data) });
  } catch (e) {
    next(e);
  }
}

export async function orderCheckout(req, res, next) {
  try {
    const userPublicId = req.user?.id;
    if (!userPublicId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const body = await validate(createOrderSchema, req.body);
    const data = await createOrderCheckoutSession(userPublicId, body.items, {
      shippingAddress: body.shippingAddress,
      billingAddress: body.billingAddress,
      parcels: body.parcels,
      selectedRateId: body.selectedRateId,
      selectedRate: body.selectedRate,
      storeCreditToApply: body.storeCreditToApply,
    });
    res.status(200).json({ success: true, data: toPublicJson(data) });
  } catch (e) {
    next(e);
  }
}

export async function checkoutSessionSummary(req, res, next) {
  try {
    const userPublicId = req.user?.id;
    if (!userPublicId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const sessionId = String(req.query.session_id || '').trim();
    const data = await getCheckoutSessionSummary(userPublicId, sessionId);
    res.status(200).json({ success: true, data: toPublicJson(data) });
  } catch (e) {
    next(e);
  }
}
