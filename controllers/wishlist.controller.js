import { wishlistService } from '../services/wishlist.service.js';
import { validate } from '../utils/validation.js';
import { z } from 'zod';
import { toPublicJson } from '../utils/serialize.js';

const syncSchema = z.object({
  items: z.array(
    z.object({
      productId: z.string().min(1),
      variantId: z.string().optional().nullable(),
    })
  ),
});

export class WishlistController {
  async list(req, res) {
    const data = await wishlistService.listForUser(req.user.id);
    res.status(200).json({ success: true, data: toPublicJson(data) });
  }

  async sync(req, res) {
    const body = await validate(syncSchema, req.body);
    const data = await wishlistService.syncForUser(req.user.id, body.items);
    res.status(200).json({ success: true, data: toPublicJson(data) });
  }

  async toggle(req, res) {
    const { productId, variantId } = req.body;
    const data = await wishlistService.toggle(req.user.id, productId, variantId ?? null);
    res.status(200).json({ success: true, data });
  }
}

export const wishlistController = new WishlistController();
