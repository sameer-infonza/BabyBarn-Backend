import { Router } from 'express';
import { productController } from '../controllers/product.controller.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = Router();

router.get('/', (req, res, next) => productController.getAllProducts(req, res).catch(next));
router.get('/categories', (req, res, next) =>
  productController.getAllCategories(req, res).catch(next)
);
router.get('/:id', (req, res, next) => productController.getProductById(req, res).catch(next));

router.post('/', authenticate, authorize('ADMIN', 'ADMIN_TEAM'), (req, res, next) =>
  productController.createProduct(req, res).catch(next)
);
router.put('/:id', authenticate, authorize('ADMIN', 'ADMIN_TEAM'), (req, res, next) =>
  productController.updateProduct(req, res).catch(next)
);
router.delete('/:id', authenticate, authorize('ADMIN', 'ADMIN_TEAM'), (req, res, next) =>
  productController.deleteProduct(req, res).catch(next)
);

router.post('/categories', authenticate, authorize('ADMIN', 'ADMIN_TEAM'), (req, res, next) =>
  productController.createCategory(req, res).catch(next)
);

export default router;
