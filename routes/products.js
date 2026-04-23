import { Router } from 'express';
import { productController } from '../controllers/product.controller.js';
import { productUploadController } from '../controllers/product-upload.controller.js';
import { categoryController } from '../controllers/category.controller.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { requireConsoleModule } from '../middleware/admin-console.js';
import { productImageUpload } from '../utils/product-upload.js';

const router = Router();

router.get('/', (req, res, next) => productController.getAllProducts(req, res).catch(next));

router.get(
  '/admin',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('products'),
  (req, res, next) => productController.getAllProductsAdmin(req, res).catch(next)
);
router.get(
  '/admin/:id',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('products'),
  (req, res, next) => productController.getProductByIdAdmin(req, res).catch(next)
);

router.get(
  '/categories/tree',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('categories'),
  (req, res, next) => categoryController.getTree(req, res).catch(next)
);
router.get('/categories', (req, res, next) => productController.getAllCategories(req, res).catch(next));
router.post(
  '/categories',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('categories'),
  (req, res, next) => categoryController.create(req, res).catch(next)
);
router.put(
  '/categories/:id',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('categories'),
  (req, res, next) => categoryController.update(req, res).catch(next)
);
router.patch(
  '/categories/:id/status',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('categories'),
  (req, res, next) => categoryController.patchStatus(req, res).catch(next)
);
router.delete(
  '/categories/:id',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('categories'),
  (req, res, next) => categoryController.remove(req, res).catch(next)
);

router.get('/:id', (req, res, next) => productController.getProductById(req, res).catch(next));

router.post('/upload-image', authenticate, authorize('ADMIN', 'ADMIN_TEAM'), requireConsoleModule('products'), (req, res, next) => {
  productImageUpload.single('image')(req, res, (err) => {
    if (err) return next(err);
    productUploadController.uploadProductImage(req, res);
  });
});

router.post(
  '/',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('products'),
  (req, res, next) => productController.createProduct(req, res).catch(next)
);
router.put(
  '/:id',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('products'),
  (req, res, next) => productController.updateProduct(req, res).catch(next)
);
router.delete(
  '/:id',
  authenticate,
  authorize('ADMIN', 'ADMIN_TEAM'),
  requireConsoleModule('products'),
  (req, res, next) => productController.deleteProduct(req, res).catch(next)
);

export default router;
