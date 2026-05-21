import { Router } from 'express';
import { getPublicBusinessSettings } from '../services/membership.service.js';

const router = Router();

router.get('/business-settings', async (req, res, next) => {
  try {
    const data = await getPublicBusinessSettings();
    res.status(200).json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

export default router;
