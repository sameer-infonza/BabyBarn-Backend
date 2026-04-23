import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { checkoutSessionSummary, membershipCheckout, orderCheckout } from '../controllers/payment.controller.js';

const router = Router();

router.post('/checkout/membership', authenticate, (req, res, next) =>
  membershipCheckout(req, res, next)
);
router.post('/checkout/order', authenticate, (req, res, next) => orderCheckout(req, res, next));
router.get('/checkout/summary', authenticate, (req, res, next) => checkoutSessionSummary(req, res, next));

export default router;
