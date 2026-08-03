import { Router } from 'express';
import { authenticate, requireCustomerFullAccount } from '../middleware/auth.js';
import { walletController } from '../controllers/wallet.controller.js';

const router = Router();

router.get('/me', authenticate, ...requireCustomerFullAccount, (req, res, next) => walletController.getMine(req, res).catch(next));

export default router;
