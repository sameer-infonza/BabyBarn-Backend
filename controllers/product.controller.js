import { productService } from '../services/product.service.js';
import { categoryService } from '../services/category.service.js';
import { validate } from '../utils/validation.js';
import { createProductSchema, updateProductSchema } from '../schemas/index.js';
import { toPublicJson } from '../utils/serialize.js';

export class ProductController {
  async getAllProducts(req, res) {
    const page = parseInt(String(req.query.page), 10) || 1;
    const limit = parseInt(String(req.query.limit), 10) || 20;
    const categoryId = req.query.categoryId ? String(req.query.categoryId) : undefined;

    const result = await productService.getAllProducts(page, limit, categoryId, { admin: false });

    res.status(200).json({
      success: true,
      data: toPublicJson(result),
    });
  }

  async getAllProductsAdmin(req, res) {
    const page = parseInt(String(req.query.page), 10) || 1;
    const limit = parseInt(String(req.query.limit), 10) || 20;
    const categoryId = req.query.categoryId ? String(req.query.categoryId) : undefined;
    const search = req.query.search ? String(req.query.search) : undefined;
    const sizeAgeGroup = req.query.sizeAgeGroup ? String(req.query.sizeAgeGroup) : undefined;
    const status = req.query.status ? String(req.query.status) : undefined;

    const listFilters = { search, sizeAgeGroup, status };

    const [result, stats] = await Promise.all([
      productService.getAllProducts(page, limit, categoryId, { admin: true, listFilters }),
      productService.getAdminProductStats(),
    ]);

    res.status(200).json({
      success: true,
      data: toPublicJson({ ...result, stats }),
    });
  }

  async getProductById(req, res) {
    const { id } = req.params;
    const product = await productService.getProductById(id, { admin: false });

    res.status(200).json({
      success: true,
      data: toPublicJson(product),
    });
  }

  async getProductByIdAdmin(req, res) {
    const { id } = req.params;
    const product = await productService.getProductById(id, { admin: true });

    res.status(200).json({
      success: true,
      data: toPublicJson(product),
    });
  }

  async createProduct(req, res) {
    const data = await validate(createProductSchema, req.body);
    const product = await productService.createProduct(data);

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: toPublicJson(product),
    });
  }

  async updateProduct(req, res) {
    const { id } = req.params;
    const data = await validate(updateProductSchema, req.body);
    const product = await productService.updateProduct(id, data);

    res.status(200).json({
      success: true,
      message: 'Product updated successfully',
      data: toPublicJson(product),
    });
  }

  async deleteProduct(req, res) {
    const { id } = req.params;
    await productService.deleteProduct(id);

    res.status(200).json({
      success: true,
      message: 'Product deleted successfully',
    });
  }

  async getAllCategories(req, res) {
    const categories = await categoryService.getAllCategoriesPublic();

    res.status(200).json({
      success: true,
      data: toPublicJson(categories),
    });
  }
}

export const productController = new ProductController();
