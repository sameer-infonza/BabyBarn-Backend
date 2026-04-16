import { z } from 'zod';

const passwordComplexityMessage =
  'Password must be at least 8 characters and include uppercase, lowercase, number, and special character';
const passwordSchema = z
  .string()
  .min(8, passwordComplexityMessage)
  .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).+$/, passwordComplexityMessage);

export const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: passwordSchema,
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
  password: passwordSchema,
  token: z.string(),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Verification token is required'),
});

export const updateProfileSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  phone: z.string().min(6).max(30).optional().nullable(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: passwordSchema,
});

export const addressCreateSchema = z.object({
  fullName: z.string().min(1, 'Full name is required'),
  addressLine1: z.string().min(1, 'Address line 1 is required'),
  addressLine2: z.string().optional().nullable(),
  city: z.string().min(1, 'City is required'),
  state: z.string().min(1, 'State is required'),
  zipCode: z.string().min(1, 'ZIP code is required'),
  country: z.string().min(1, 'Country is required'),
  phoneNumber: z.string().min(6).max(30),
  isDefault: z.boolean().optional(),
});

export const addressUpdateSchema = addressCreateSchema.partial();

const variantInputSchema = z.object({
  combination: z.record(z.string(), z.string()),
  sku: z.string().min(1),
  stock: z.number().int().min(0),
  priceOverride: z.number().min(0).nullable().optional(),
  imageUrl: z.string().min(1).nullable().optional(),
});

const variantAxisSchema = z.object({
  name: z.string().min(1),
  values: z.array(z.string()),
});

const createProductBodySchema = z.object({
  name: z.string().min(1, 'Product name is required'),
  slug: z.string().min(1).optional(),
  description: z.union([z.string(), z.null()]).optional(),
  price: z.number().min(0, 'Price must be positive'),
  stock: z.number().int().min(0, 'Stock must be non-negative'),
  categoryId: z.string().min(1, 'Category is required'),
  sku: z.string().min(1).optional(),
  imageUrl: z.union([z.string(), z.null()]).optional(),
  memberPrice: z.number().min(0).nullable().optional(),
  compareAtPrice: z.number().min(0).nullable().optional(),
  unitPriceAmount: z.number().min(0).nullable().optional(),
  unitPriceReference: z.union([z.string(), z.null()]).optional(),
  fabric: z.union([z.string(), z.null()]).optional(),
  care: z.union([z.string(), z.null()]).optional(),
  sizeAgeGroup: z.union([z.string(), z.null()]).optional(),
  vendor: z.union([z.string(), z.null()]).optional(),
  tags: z.union([z.string(), z.null()]).optional(),
  isDraft: z.boolean().optional().default(false),
  isActiveListing: z.boolean().optional().default(true),
  inventoryModel: z.enum(['simple', 'variant_matrix']).optional().default('simple'),
  gallery: z.union([z.array(z.unknown()), z.null()]).optional(),
  variantAxes: z.array(variantAxisSchema).optional().default([]),
  variants: z.array(variantInputSchema).optional().default([]),
  productType: z.enum(['NEW', 'REFURBISHED']).optional().default('NEW'),
});

export const createProductSchema = createProductBodySchema.superRefine((data, ctx) => {
  if (data.inventoryModel === 'variant_matrix' && !data.isDraft && data.variants.length < 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'At least one variant is required for variant products',
      path: ['variants'],
    });
  }
});

/** Partial updates: `.partial()` must run on `ZodObject`, not on `ZodEffects` from `.superRefine()`. */
export const updateProductSchema = createProductBodySchema.partial();

export const createOrderSchema = z.object({
  items: z.array(
    z.object({
      productId: z.string(),
      quantity: z.number().int().min(1, 'Quantity must be at least 1'),
      variantId: z.string().min(1).optional(),
    })
  ),
});

export const createCategorySchema = z.object({
  name: z.string().min(1, 'Category name is required'),
  slug: z.string().min(1).optional(),
  description: z.string().optional(),
  parentPublicId: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

export const updateCategorySchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  parentPublicId: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

export const categoryStatusSchema = z.object({
  isActive: z.boolean(),
});

export const inventoryAdjustSchema = z.object({
  productId: z.string().min(1),
  /** When set, adjusts stock for this variant SKU only (required for products with variants). */
  variantId: z.string().min(1).optional(),
  delta: z.number().int().refine((n) => n !== 0, { message: 'delta cannot be 0' }),
  reason: z.union([z.string().max(500), z.null()]).optional(),
});

export const inventoryProductTypeSchema = z.object({
  productType: z.enum(['NEW', 'REFURBISHED']),
});
