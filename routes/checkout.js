import { Router } from 'express';
import { createGuestSession } from '../controllers/checkout-guest.controller.js';

const router = Router();

router.post('/guest-session', createGuestSession);

export default router;
