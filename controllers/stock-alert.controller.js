import { stockAlertService } from '../services/stock-alert.service.js';
import { validate } from '../utils/validation.js';
import { z } from 'zod';
import { toPublicJson } from '../utils/serialize.js';

const subscribeSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().optional().nullable(),
});

export class StockAlertController {
  async list(req, res) {
    const rows = await stockAlertService.listForUser(req.user.id);
    res.status(200).json({ success: true, data: toPublicJson(rows) });
  }

  async subscribe(req, res) {
    const body = await validate(subscribeSchema, req.body);
    const data = await stockAlertService.subscribe(req.user.id, body.productId, body.variantId ?? null);
    res.status(200).json({ success: true, data });
  }
}

export const stockAlertController = new StockAlertController();
