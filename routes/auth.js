import { Router } from 'express';
import { authController } from '../controllers/auth.controller.js';
import { authenticate, requireFullAccount } from '../middleware/auth.js';
import { avatarImageUpload } from '../utils/product-upload.js';

const router = Router();

router.post('/register', (req, res, next) => authController.register(req, res).catch(next));
router.post('/login', (req, res, next) => authController.login(req, res).catch(next));
router.post('/refresh-token', (req, res, next) => authController.refreshToken(req, res).catch(next));
router.post('/forgot-password', (req, res, next) =>
  authController.forgotPassword(req, res).catch(next)
);
router.post('/reset-password', (req, res, next) =>
  authController.resetPasswordWithToken(req, res).catch(next)
);
router.get('/verify-email', (req, res, next) =>
  authController.verifyEmail(req, res).catch(next)
);
router.post('/resend-verification', (req, res, next) =>
  authController.resendVerification(req, res).catch(next)
);
router.get('/me', authenticate, requireFullAccount, (req, res, next) =>
  authController.getProfile(req, res).catch(next)
);
router.patch('/me', authenticate, requireFullAccount, (req, res, next) =>
  authController.updateProfile(req, res).catch(next)
);
router.post('/me/avatar', authenticate, requireFullAccount, (req, res, next) => {
  avatarImageUpload.single('image')(req, res, (err) => {
    if (err) return next(err);
    authController.uploadAvatar(req, res).catch(next);
  });
});
router.post('/change-password', authenticate, requireFullAccount, (req, res, next) =>
  authController.changePassword(req, res).catch(next)
);
router.get('/addresses', authenticate, requireFullAccount, (req, res, next) =>
  authController.listAddresses(req, res).catch(next)
);
router.post('/addresses', authenticate, requireFullAccount, (req, res, next) =>
  authController.createAddress(req, res).catch(next)
);
router.patch('/addresses/:addressId', authenticate, requireFullAccount, (req, res, next) =>
  authController.updateAddress(req, res).catch(next)
);
router.delete('/addresses/:addressId', authenticate, requireFullAccount, (req, res, next) =>
  authController.deleteAddress(req, res).catch(next)
);

export default router;
