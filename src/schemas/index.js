import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string(),
});

export const resetPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const confirmPasswordSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
  token: z.string(),
});

export const createProductSchema = z.object({
  name: z.string().min(1, 'Product name is required'),
  slug: z.string().min(1, 'Slug is required'),
  description: z.string().optional(),
  price: z.number().min(0, 'Price must be positive'),
  stock: z.number().int().min(0, 'Stock must be non-negative'),
  categoryId: z.string(),
  sku: z.string().min(1, 'SKU is required'),
  imageUrl: z.string().optional(),
});

export const updateProductSchema = createProductSchema.partial();

export const createOrderSchema = z.object({
  items: z.array(
    z.object({
      productId: z.string(),
      quantity: z.number().int().min(1, 'Quantity must be at least 1'),
    })
  ),
});

export const createCategorySchema = z.object({
  name: z.string().min(1, 'Category name is required'),
  slug: z.string().min(1, 'Slug is required'),
  description: z.string().optional(),
});
