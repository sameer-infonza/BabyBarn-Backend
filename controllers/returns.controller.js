import { validate } from '../utils/validation.js';
import {
  returnRequestCreateSchema,
  returnStatusUpdateSchema,
  returnEligibilityReviewSchema,
  refurbInspectionCreateSchema,
  returnLabelGenerateSchema,
  RETURN_STATUS_VALUES,
} from '../schemas/index.js';
import { returnsService } from '../services/returns.service.js';
import { refurbishmentService } from '../services/refurbishment.service.js';
import { toPublicJson } from '../utils/serialize.js';
import { z } from 'zod';

export class ReturnsController {
  async listAll(req, res) {
    const type = req.query.type ? String(req.query.type) : undefined;
    const status = req.query.status ? String(req.query.status) : undefined;
    const data = await returnsService.listAll({ type, status });
    res.status(200).json({ success: true, data: toPublicJson(data) });
  }

  async listMine(req, res) {
    const data = await returnsService.listForUser(req.user.id);
    res.status(200).json({ success: true, data: toPublicJson(data) });
  }

  async getMineById(req, res) {
    const data = await returnsService.getForUser(req.user.id, req.params.id);
    res.status(200).json({ success: true, data: toPublicJson(data) });
  }

  async getAdminById(req, res) {
    const data = await returnsService.getById(req.params.id);
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

  async reviewEligibility(req, res) {
    const body = await validate(returnEligibilityReviewSchema, req.body);
    const actor = { id: req.user?.id, email: req.user?.email };
    const data = await returnsService.reviewEligibility(req.params.id, body, actor);
    res.status(200).json({ success: true, data: toPublicJson(data) });
  }

  async generateReturnLabel(req, res) {
    const body = await validate(returnLabelGenerateSchema, req.body ?? {});
    const actor = { id: req.user?.id, email: req.user?.email };
    const data = await returnsService.generateReturnLabel(req.params.id, body, actor);
    res.status(200).json({ success: true, data: toPublicJson(data) });
  }

  async syncReturnTracking(req, res) {
    const data = await returnsService.syncReturnTracking(req.params.id);
    res.status(200).json({ success: true, data: toPublicJson(data) });
  }

  async createInspection(req, res) {
    const body = await validate(refurbInspectionCreateSchema, req.body);
    const actor = { id: req.user?.id, email: req.user?.email };
    const data = await returnsService.createInspectionRecord(req.params.id, body, actor);
    res.status(201).json({ success: true, data: toPublicJson(data) });
  }

  async getRefurbJobByReturn(req, res) {
    const data = await refurbishmentService.getByReturnPublicId(req.params.returnId);
    res.status(200).json({ success: true, data: toPublicJson(data) });
  }

  async listRefurbJobs(req, res) {
    const page = parseInt(String(req.query.page), 10) || 1;
    const status = req.query.status ? String(req.query.status) : undefined;
    const data = await refurbishmentService.listJobs({ page, status });
    res.status(200).json({ success: true, data: toPublicJson(data) });
  }

  async updateRefurbJobStatus(req, res) {
    const body = await validate(
      z.object({
        status: z.enum([
          'RECEIVED',
          'INSPECTION',
          'CLEANING',
          'IRONING',
          'REPAIR',
          'IN_PROGRESS',
          'QA_APPROVED',
          'LISTED',
          'CANCELLED',
        ]),
        notes: z.string().optional(),
        grade: z.enum(['A', 'B', 'C']).optional(),
      }),
      req.body
    );
    const actor = { id: req.user?.id, email: req.user?.email };
    const data = await refurbishmentService.updateStatus(req.params.jobId, body.status, actor, {
      notes: body.notes,
      grade: body.grade,
    });
    res.status(200).json({ success: true, data: toPublicJson(data) });
  }

  async bulkMarkReceived(req, res) {
    const body = await validate(
      z.object({ returnPublicIds: z.array(z.string().min(1)).min(1).max(100) }),
      req.body
    );
    const actor = { id: req.user?.id, email: req.user?.email };
    const data = await returnsService.bulkMarkReceived(body.returnPublicIds, actor);
    res.status(200).json({ success: true, data: toPublicJson(data) });
  }

  uploadPhoto(req, res) {
    const file = req.file;
    if (!file) {
      return res.status(400).json({
        success: false,
        message: 'No image file received (use field name "image").',
      });
    }

    const relative = `/uploads/returns/${file.filename}`;
    res.status(201).json({
      success: true,
      data: { url: relative, path: relative },
    });
  }
}

export const returnsController = new ReturnsController();
