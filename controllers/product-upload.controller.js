import path from 'path';
import { config } from '../config/env.js';

export class ProductUploadController {
  /**
   * POST multipart field name: `image` (single file).
   * Returns absolute public URL for use in `imageUrl` / `gallery`.
   */
  uploadProductImage(req, res) {
    const file = req.file;
    if (!file) {
      return res.status(400).json({
        success: false,
        message: 'No image file received (use field name "image").',
      });
    }

    const relative = `/uploads/products/${file.filename}`;
    const url = `${config.publicBaseUrl}${relative}`;

    res.status(201).json({
      success: true,
      data: { url, path: relative },
    });
  }
}

export const productUploadController = new ProductUploadController();
