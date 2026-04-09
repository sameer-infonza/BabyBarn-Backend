import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import multer from 'multer';

const UPLOAD_ROOT = path.join(process.cwd(), 'uploads');
const PRODUCTS_DIR = path.join(UPLOAD_ROOT, 'products');

export function ensureUploadDirs() {
  fs.mkdirSync(PRODUCTS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    ensureUploadDirs();
    cb(null, PRODUCTS_DIR);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
    const name = `${Date.now()}-${randomBytes(8).toString('hex')}${safeExt}`;
    cb(null, name);
  },
});

function fileFilter(_req, file, cb) {
  const ok = /^image\/(jpeg|png|webp)$/i.test(file.mimetype);
  if (ok) cb(null, true);
  else cb(new Error('Only JPEG, PNG, or WebP images are allowed'));
}

export const productImageUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter,
});

export { UPLOAD_ROOT, PRODUCTS_DIR };
