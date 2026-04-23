import { walletService } from '../services/wallet.service.js';
import { toPublicJson } from '../utils/serialize.js';

export class WalletController {
  async getMine(req, res) {
    const data = await walletService.getWallet(req.user.id);
    res.status(200).json({ success: true, data: toPublicJson(data) });
  }
}

export const walletController = new WalletController();
