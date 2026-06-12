import { validate } from '../utils/validation.js';
import { toPublicJson } from '../utils/serialize.js';
import { checkoutGuestService } from '../services/checkout-guest.service.js';
import { z } from 'zod';

const guestSessionSchema = z.object({
  email: z.string().email(),
  firstName: z.string().max(120).optional(),
  lastName: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
});

export async function createGuestSession(req, res, next) {
  try {
    const body = await validate(guestSessionSchema, req.body ?? {});
    const data = await checkoutGuestService.createGuestSession(body);
    res.status(200).json({ success: true, data: toPublicJson(data) });
  } catch (e) {
    next(e);
  }
}
