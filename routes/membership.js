import { Router } from 'express';
import { authenticate, requireCustomerFullAccount } from '../middleware/auth.js';
import {
  getEligibility,
  getPaymentHistory,
  getSavings,
  saveRegistration,
} from '../controllers/membership.controller.js';

const router = Router();

router.post('/registration', authenticate, ...requireCustomerFullAccount, saveRegistration);
router.get('/eligibility', authenticate, ...requireCustomerFullAccount, getEligibility);
router.get('/payments/history', authenticate, ...requireCustomerFullAccount, getPaymentHistory);
router.get('/savings', authenticate, ...requireCustomerFullAccount, getSavings);

export default router;
