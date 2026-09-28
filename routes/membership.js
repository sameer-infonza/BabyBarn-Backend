import { Router } from 'express';
import { authenticate, requireCustomerFullAccount } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../utils/jwt.js';
import {
  getEligibility,
  getPaymentHistory,
  getSavings,
  saveRegistration,
} from '../controllers/membership.controller.js';
import {
  createMemberShareCode,
  getMemberShareHistory,
  getMemberShareSummary,
  resolveSharedMembership,
  revokeMemberShareCode,
  setMemberShareCodeActive,
} from '../services/membership-sharing.service.js';

const router = Router();

router.post('/registration', authenticate, ...requireCustomerFullAccount, saveRegistration);
router.get('/eligibility', authenticate, ...requireCustomerFullAccount, getEligibility);
router.get('/payments/history', authenticate, ...requireCustomerFullAccount, getPaymentHistory);
router.get('/savings', authenticate, ...requireCustomerFullAccount, getSavings);
router.get('/share', authenticate, ...requireCustomerFullAccount, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { publicId: req.user.id },
      select: { id: true },
    });
    if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    res.status(200).json({ success: true, data: await getMemberShareSummary(user.id) });
  } catch (e) {
    next(e);
  }
});
router.get('/share/history', authenticate, ...requireCustomerFullAccount, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { publicId: req.user.id },
      select: { id: true },
    });
    if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    res.status(200).json({ success: true, data: await getMemberShareHistory(user.id) });
  } catch (e) {
    next(e);
  }
});
router.post('/share/codes', authenticate, ...requireCustomerFullAccount, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { publicId: req.user.id },
      select: { id: true },
    });
    if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    res.status(201).json({ success: true, data: await createMemberShareCode(user.id, req.body || {}) });
  } catch (e) {
    next(e);
  }
});
router.post('/share/codes/:id/active', authenticate, ...requireCustomerFullAccount, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { publicId: req.user.id },
      select: { id: true },
    });
    if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const active = req.body?.active !== false;
    res.status(200).json({ success: true, data: await setMemberShareCodeActive(user.id, req.params.id, active) });
  } catch (e) {
    next(e);
  }
});
router.post('/share/codes/:id/revoke', authenticate, ...requireCustomerFullAccount, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { publicId: req.user.id },
      select: { id: true },
    });
    if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    res.status(200).json({ success: true, data: await revokeMemberShareCode(user.id, req.params.id) });
  } catch (e) {
    next(e);
  }
});
router.post('/share/preview', async (req, res, next) => {
  try {
    let buyerUserId;
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      try {
        const decoded = verifyToken(token);
        const user = await prisma.user.findUnique({
          where: { publicId: decoded.id },
          select: { id: true },
        });
        buyerUserId = user?.id;
      } catch {
        buyerUserId = undefined;
      }
    }
    const data = await resolveSharedMembership(req.body?.code, buyerUserId);
    res.status(200).json({
      success: true,
      data: { ownerName: data.ownerName, status: data.status, expiresAt: data.expiresAt, accessNumber: data.accessNumber },
    });
  } catch (e) {
    next(e);
  }
});

export default router;
