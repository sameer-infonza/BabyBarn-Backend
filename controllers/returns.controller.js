import { validate } from '../utils/validation.js';
import { returnRequestCreateSchema, returnStatusUpdateSchema } from '../schemas/index.js';
import { returnsService } from '../services/returns.service.js';
import { toPublicJson } from '../utils/serialize.js';

export class ReturnsController {
  async listAll(req, res) {
    const data = await returnsService.listAll();
    res.status(200).json({ success: true, data: toPublicJson(data) });
  }

  async listMine(req, res) {
    const data = await returnsService.listForUser(req.user.id);
    res.status(200).json({ success: true, data: toPublicJson(data) });
  }

  async create(req, res) {
    const body = await validate(returnRequestCreateSchema, req.body);
    const data = await returnsService.createForUser(req.user.id, body);
    res.status(201).json({ success: true, data: toPublicJson(data) });
  }

  async updateStatus(req, res) {
    const body = await validate(returnStatusUpdateSchema, req.body);
    const actor = { id: req.user?.id, email: req.user?.email };
    const data = await returnsService.updateStatus(req.params.id, body, actor);
    res.status(200).json({ success: true, data: toPublicJson(data) });
  }
}

export const returnsController = new ReturnsController();
