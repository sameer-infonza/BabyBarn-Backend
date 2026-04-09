import { Router } from 'express';
import { authController } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.post('/register', (req, res, next) => authController.register(req, res).catch(next));
router.post('/login', (req, res, next) => authController.login(req, res).catch(next));
router.post('/forgot-password', (req, res, next) =>
  authController.forgotPassword(req, res).catch(next)
);
router.post('/reset-password', (req, res, next) =>
  authController.resetPasswordWithToken(req, res).catch(next)
);
router.get('/me', authenticate, (req, res, next) => authController.getProfile(req, res).catch(next));

export default router;
