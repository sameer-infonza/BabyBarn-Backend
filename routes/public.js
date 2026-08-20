import { Router } from 'express';
import { getPublicBusinessSettings } from '../services/membership.service.js';
import { listPublicHomepageCarousel } from '../services/homepage-carousel.service.js';

const router = Router();

router.get('/business-settings', async (req, res, next) => {
  try {
    const data = await getPublicBusinessSettings();
    res.status(200).json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

router.get('/homepage-carousel', async (req, res, next) => {
  try {
    const data = await listPublicHomepageCarousel();
    res.status(200).json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

export default router;
