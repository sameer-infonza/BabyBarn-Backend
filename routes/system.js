import { Router } from 'express';
import { config } from '../config/env.js';
import { primaryLanIpv4 } from '../lib/lan-host.js';
import { AppError } from '../utils/error-handler.js';

const router = Router();

/** Dev helper: LAN URLs so a phone on the same WiFi can reach local Next apps + API. */
router.get('/lan-info', (req, res) => {
  if (config.nodeEnv === 'production') {
    throw new AppError(404, 'Not found');
  }
  const host = primaryLanIpv4();
  const adminPort = parseInt(process.env.ADMIN_DEV_PORT || '3001', 10);
  const storePort = parseInt(process.env.STORE_DEV_PORT || '3000', 10);
  const apiPort = config.port;

  res.status(200).json({
    success: true,
    data: {
      lanHost: host,
      apiBaseUrl: host ? `http://${host}:${apiPort}/api` : null,
      adminUrl: host ? `http://${host}:${adminPort}` : null,
      adminScanUrl: host ? `http://${host}:${adminPort}/admin/inventory/pos` : null,
      adminPosUrl: host ? `http://${host}:${adminPort}/admin/inventory/pos` : null,
      storeUrl: host ? `http://${host}:${storePort}` : null,
      hint: host
        ? 'Open adminScanUrl on your phone (same WiFi). Bluetooth scanners pair to the phone as a keyboard — no extra app setup.'
        : 'Connect this PC to WiFi and restart the API to discover a LAN address.',
    },
  });
});

export default router;
