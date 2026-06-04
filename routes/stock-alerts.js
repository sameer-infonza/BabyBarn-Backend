import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { stockAlertController } from '../controllers/stock-alert.controller.js';

const router = Router();

router.get('/', authenticate, (req, res, next) => stockAlertController.list(req, res).catch(next));
router.post('/subscribe', authenticate, (req, res, next) => stockAlertController.subscribe(req, res).catch(next));

export default router;
