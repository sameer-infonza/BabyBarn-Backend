import { Router } from 'express';
import { authenticate, requireFullAccount } from '../middleware/auth.js';
import {
  getEligibility,
  getPaymentHistory,
  getSavings,
  saveRegistration,
} from '../controllers/membership.controller.js';

const router = Router();

router.post('/registration', authenticate, requireFullAccount, saveRegistration);
router.get('/eligibility', authenticate, requireFullAccount, getEligibility);
router.get('/payments/history', authenticate, requireFullAccount, getPaymentHistory);
router.get('/savings', authenticate, requireFullAccount, getSavings);

export default router;
