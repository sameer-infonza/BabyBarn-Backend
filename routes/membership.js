import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  getEligibility,
  getPaymentHistory,
  getSavings,
  saveRegistration,
} from '../controllers/membership.controller.js';

const router = Router();

router.post('/registration', authenticate, saveRegistration);
router.get('/eligibility', authenticate, getEligibility);
router.get('/payments/history', authenticate, getPaymentHistory);
router.get('/savings', authenticate, getSavings);

export default router;
