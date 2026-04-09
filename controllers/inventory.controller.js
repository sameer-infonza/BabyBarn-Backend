import { inventoryService } from '../services/inventory.service.js';
import { validate } from '../utils/validation.js';
import { inventoryAdjustSchema, inventoryProductTypeSchema } from '../schemas/index.js';
import { toPublicJson } from '../utils/serialize.js';

export class InventoryController {
  async getStats(req, res) {
    const stats = await inventoryService.getStats();
    res.status(200).json({ success: true, data: toPublicJson(stats) });
  }

  async list(req, res) {
    const page = parseInt(String(req.query.page), 10) || 1;
    const limit = parseInt(String(req.query.limit), 10) || 24;
    const search = req.query.search ? String(req.query.search) : undefined;
    const stockStatus = req.query.stockStatus ? String(req.query.stockStatus) : undefined;
    const productType = req.query.productType ? String(req.query.productType) : undefined;

    const result = await inventoryService.list({
      page,
      limit,
      search,
      stockStatus,
      productType,
    });

    res.status(200).json({
      success: true,
      data: toPublicJson(result),
    });
  }

  async adjust(req, res) {
    const body = await validate(inventoryAdjustSchema, req.body);
    const userPublicId = req.user?.id;
    if (!userPublicId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const result = await inventoryService.adjustStock({
      productPublicId: body.productId,
      variantPublicId: body.variantId,
      delta: body.delta,
      reason: body.reason ?? undefined,
      userPublicId,
    });

    res.status(200).json({
      success: true,
      message: 'Inventory updated',
      data: toPublicJson(result),
    });
  }

  async updateProductType(req, res) {
    const { id } = req.params;
    const body = await validate(inventoryProductTypeSchema, req.body);
    const product = await inventoryService.updateProductType(id, body.productType);
    res.status(200).json({
      success: true,
      data: toPublicJson(product),
    });
  }

  async history(req, res) {
    const page = parseInt(String(req.query.page), 10) || 1;
    const limit = parseInt(String(req.query.limit), 10) || 20;
    const result = await inventoryService.listHistory({ page, limit });
    res.status(200).json({
      success: true,
      data: toPublicJson(result),
    });
  }
}

export const inventoryController = new InventoryController();
