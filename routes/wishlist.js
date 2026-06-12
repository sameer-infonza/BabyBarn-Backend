import { Router } from 'express';
import { authenticate, requireFullAccount } from '../middleware/auth.js';
import { wishlistController } from '../controllers/wishlist.controller.js';

const router = Router();

router.get('/', authenticate, requireFullAccount, (req, res, next) => wishlistController.list(req, res).catch(next));
router.put('/sync', authenticate, requireFullAccount, (req, res, next) => wishlistController.sync(req, res).catch(next));
router.post('/toggle', authenticate, requireFullAccount, (req, res, next) => wishlistController.toggle(req, res).catch(next));

export default router;
