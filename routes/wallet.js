import { Router } from 'express';
import { authenticate, requireFullAccount } from '../middleware/auth.js';
import { walletController } from '../controllers/wallet.controller.js';

const router = Router();

router.get('/me', authenticate, requireFullAccount, (req, res, next) => walletController.getMine(req, res).catch(next));

export default router;
