import { z } from 'zod';
import { AGE_AXIS_NAME, isAgeAxisKey, isCanonicalAge } from '../lib/age-groups.js';

/** Age (and Color) are the only buyable variant axes. "Size" and other free-form keys are rejected. */
function isAllowedAxisKey(key) {
  if (typeof key !== 'string') return false;
  const k = key.trim().toLowerCase();
  return isAgeAxisKey(key) || k === 'color' || k === 'colour';
}

/** Reject non-canonical Age values and disallowed (e.g. Size) variant axes. */
function validateVariantAgeValues(variants, ctx) {
  if (!Array.isArray(variants)) return;
  variants.forEach((variant, index) => {
    const combo = variant?.combination;
    if (!combo || typeof combo !== 'object') return;
    for (const key of Object.keys(combo)) {
      if (!isAllowedAxisKey(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unsupported variant attribute "${key}". Only Age (and Color) are allowed.`,
          path: ['variants', index, 'combination', key],
        });
      }
    }
    const ageValue = combo[AGE_AXIS_NAME];
    if (ageValue == null || ageValue === '') return;
    if (!isCanonicalAge(ageValue)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid age "${ageValue}". Use one of the standard age groups.`,
        path: ['variants', index, 'combination', AGE_AXIS_NAME],
      });
    }
  });
}

/** Reject disallowed variant axis names (e.g. "Size") at the axis-definition level. */
function validateVariantAxisNames(variantAxes, ctx) {
  if (!Array.isArray(variantAxes)) return;
  variantAxes.forEach((axis, index) => {
    if (axis?.name && !isAllowedAxisKey(axis.name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unsupported variant attribute "${axis.name}". Only Age (and Color) are allowed.`,
        path: ['variantAxes', index, 'name'],
      });
    }
  });
}

const phoneInvalidMessage = 'Enter a valid phone number (at least 10 digits)';
/** Accepts formatted phone strings; requires a plausible number of digits. */
const requiredPhoneSchema = z
  .string()
  .min(6)
  .max(30)
  .refine((v) => v.replace(/\D+/g, '').length >= 10, phoneInvalidMessage);
const optionalPhoneSchema = z
  .string()
  .max(30)
  .refine((v) => v.trim() === '' || v.replace(/\D+/g, '').length >= 10, phoneInvalidMessage);

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

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
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

export const profileChildSchema = z.object({
  id: z.string().max(64).optional(),
  name: z.string().max(60).optional().nullable(),
  birthday: z.string().max(20).optional().nullable(),
  stage: z.string().max(40).optional().nullable(),
});

export const notificationPrefsSchema = z.object({
  returnReminders: z.boolean().optional(),
  restockAlerts: z.boolean().optional(),
  accessDrops: z.boolean().optional(),
  lowStockAlerts: z.boolean().optional(),
  newOrders: z.boolean().optional(),
  returnRequests: z.boolean().optional(),
  teamDigest: z.boolean().optional(),
  accessRenewals: z.boolean().optional(),
});

export const updateProfileSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  phone: optionalPhoneSchema.optional().nullable(),
  dateOfBirth: z.string().max(40).optional().nullable(),
  avatarUrl: z.string().max(2048).optional().nullable(),
  children: z.array(profileChildSchema).max(12).optional(),
  notificationPrefs: notificationPrefsSchema.optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: passwordSchema,
});

export const changeEmailSchema = z.object({
  newEmail: z.string().email('Invalid email address'),
  currentPassword: z.string().min(1, 'Current password is required'),
});

export const pauseAccountSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
});

export const addressCreateSchema = z.object({
  fullName: z.string().min(1, 'Full name is required'),
  addressLine1: z.string().min(1, 'Address line 1 is required'),
  addressLine2: z.string().optional().nullable(),
  city: z.string().min(1, 'City is required'),
  state: z.string().min(1, 'State is required'),
  zipCode: z.string().min(1, 'ZIP code is required'),
  country: z.string().min(1, 'Country is required'),
  phoneNumber: requiredPhoneSchema,
  isDefault: z.boolean().optional(),
});

export const addressUpdateSchema = addressCreateSchema.partial();

const variantInputSchema = z.object({
  combination: z.record(z.string(), z.string()),
  sku: z.string().min(1),
  stock: z.number().int().min(0),
  priceOverride: z.number().min(0).nullable().optional(),
  memberPriceOverride: z.number().min(0).nullable().optional(),
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
  shortDescription: z.union([z.string(), z.null()]).optional(),
  price: z.number().min(0, 'Price must be positive'),
  stock: z.number().int().min(0, 'Stock must be non-negative'),
  categoryId: z.string().min(1).optional(),
  sku: z.string().min(1).optional(),
  imageUrl: z.union([z.string(), z.null()]).optional(),
  memberPrice: z.number().min(0).nullable().optional(),
  compareAtPrice: z.number().min(0).nullable().optional(),
  unitPriceAmount: z.number().min(0).nullable().optional(),
  unitPriceReference: z.union([z.string(), z.null()]).optional(),
  fabric: z.union([z.string(), z.null()]).optional(),
  feel: z.union([z.string(), z.null()]).optional(),
  fit: z.union([z.string(), z.null()]).optional(),
  care: z.union([z.string(), z.null()]).optional(),
  reorderPoint: z.number().int().min(1).nullable().optional(),
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
  validateVariantAgeValues(data.variants, ctx);
  validateVariantAxisNames(data.variantAxes, ctx);
});

export const refurbFromSourceSchema = z.object({
  sourceProductId: z.string().min(1, 'Source product is required'),
  sourceVariantId: z.string().min(1).optional(),
  initialStock: z.number().int().min(0).max(99).optional().default(1),
  conditionGrade: z.enum(['A', 'B', 'C']).nullable().optional(),
  createAsDraft: z.boolean().optional().default(false),
});

export const refurbStandaloneCreateSchema = createProductBodySchema
  .omit({ productType: true })
  .superRefine((data, ctx) => {
    if (data.inventoryModel === 'variant_matrix' && !data.isDraft && data.variants.length < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one variant is required for variant products',
        path: ['variants'],
      });
    }
    validateVariantAgeValues(data.variants, ctx);
    validateVariantAxisNames(data.variantAxes, ctx);
  });

/** Partial updates: `.partial()` must run on `ZodObject`, not on `ZodEffects` from `.superRefine()`. */
export const updateProductSchema = createProductBodySchema
  .partial()
  .superRefine((data, ctx) => {
    validateVariantAgeValues(data.variants, ctx);
    validateVariantAxisNames(data.variantAxes, ctx);
  });

const checkoutAddressPayloadSchema = z.object({
  fullName: z.string().optional(),
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional().nullable(),
  city: z.string().optional(),
  state: z.string().optional(),
  zipCode: z.string().optional(),
  country: z.string().optional(),
  phoneNumber: z.string().optional(),
});

const checkoutParcelSchema = z.object({
  length: z.union([z.number().positive(), z.string().min(1)]),
  width: z.union([z.number().positive(), z.string().min(1)]),
  height: z.union([z.number().positive(), z.string().min(1)]),
  weight: z.union([z.number().positive(), z.string().min(1)]),
  distance_unit: z.enum(['in', 'cm', 'ft', 'm', 'mm', 'yd']).optional(),
  mass_unit: z.enum(['lb', 'oz', 'g', 'kg']).optional(),
});

const checkoutSelectedRateSchema = z.object({
  rateId: z.string().min(1).optional().nullable(),
  provider: z.string().optional().nullable(),
  serviceLevel: z.string().optional().nullable(),
  serviceToken: z.string().optional().nullable(),
  amount: z.number().min(0).optional().nullable(),
  currency: z.string().optional().nullable(),
  estimatedDays: z.number().int().nonnegative().optional().nullable(),
});

export const createOrderSchema = z.object({
  items: z.array(
    z.object({
      productId: z.string(),
      quantity: z.number().int().min(1, 'Quantity must be at least 1'),
      variantId: z.string().min(1).optional(),
    })
  ).min(1),
  shippingAddress: checkoutAddressPayloadSchema.optional(),
  billingAddress: checkoutAddressPayloadSchema.optional(),
  parcels: z.array(checkoutParcelSchema).optional(),
  selectedRateId: z.string().min(1).optional(),
  selectedRate: checkoutSelectedRateSchema.optional(),
  storeCreditToApply: z.number().min(0).optional(),
  saveCard: z.boolean().optional(),
  includeAccessMembership: z.boolean().optional(),
  babyName: z.string().trim().min(1).max(120).optional(),
  /** Reuse in-progress checkout (CheckoutIntent publicId; legacy clients may still send orderId). */
  orderId: z.string().min(1).optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().trim().max(40).optional(),
});

export const checkoutQuoteSchema = z.object({
  items: z.array(
    z.object({
      productId: z.string().min(1),
      quantity: z.number().int().min(1),
      variantId: z.string().min(1).optional().nullable(),
    })
  ).min(1),
  shippingAddress: checkoutAddressPayloadSchema.optional(),
  parcels: z.array(checkoutParcelSchema).optional(),
  selectedRateId: z.string().min(1).optional(),
  storeCreditToApply: z.number().min(0).optional(),
  includeAccessMembership: z.boolean().optional(),
  babyName: z.string().trim().min(1).max(120).optional(),
});

export const trackingUpdateSchema = z.object({
  trackingNumber: z.string().min(1),
  shippingCarrier: z.string().min(1).optional(),
  /** Carrier label PDF URL or print link (UPS, etc.). */
  shippingLabelUrl: z.string().max(2000).optional().nullable(),
});

export const orderStatusUpdateSchema = z.object({
  status: z.enum([
    'PENDING',
    'PROCESSING',
    'CONFIRMED',
    'SHIPPED',
    'DELIVERED',
    'CANCELLED',
    'RETURNED',
    'REFUNDED',
  ]),
});

export const cancelOrderRequestSchema = z.object({
  reason: z.string().max(500).optional().nullable(),
  /** When set, only these order line publicIds are cancelled (partial cancel). */
  itemIds: z.array(z.string().min(1)).max(100).optional(),
});

/** Public guest cancel — same rules as authenticated cancel, verified by tracking token or order+email. */
export const guestCancelOrderSchema = z
  .object({
    token: z.string().min(1).optional(),
    orderNumber: z.string().min(1).optional(),
    email: z.string().email().optional(),
    reason: z.string().max(500).optional().nullable(),
    itemIds: z
      .preprocess(
        (val) =>
          Array.isArray(val)
            ? val.filter((id) => typeof id === 'string' && String(id).trim().length > 0)
            : val,
        z.array(z.string().min(1)).max(100).optional()
      )
      .optional(),
  })
  .refine((body) => Boolean(body.token) || (Boolean(body.orderNumber) && Boolean(body.email)), {
    message: 'Provide a tracking token or both order number and email',
    path: ['orderNumber'],
  });

export const orderCancellationReviewSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().max(1000).optional().nullable(),
});

/** Admin PATCH /orders/:id/shipping — at least one field. */
export const adminShippingUpdateSchema = z
  .object({
    trackingNumber: z.string().min(1).optional(),
    shippingCarrier: z.string().min(1).optional(),
    shippingLabelUrl: z.string().max(2000).optional().nullable(),
    manualShippingNotes: z.string().max(4000).optional().nullable(),
  })
  .refine(
    (d) =>
      Boolean(d.trackingNumber?.trim()) ||
      Boolean(d.shippingCarrier?.trim()) ||
      d.shippingLabelUrl !== undefined ||
      d.manualShippingNotes !== undefined,
    { message: 'Provide at least one shipping field to update' }
  );

export const adminShippingOptionsSchema = z.object({
  carrier: z.string().min(1).optional(),
  parcels: z.array(checkoutParcelSchema).optional(),
  providerSlug: z.string().min(1).optional(),
});

const selectedRateSnapshotSchema = z.object({
  rateId: z.string().min(1).optional().nullable(),
  provider: z.string().optional().nullable(),
  serviceLevel: z.string().optional().nullable(),
  serviceToken: z.string().optional().nullable(),
  amount: z.number().min(0).optional().nullable(),
  currency: z.string().optional().nullable(),
  estimatedDays: z.number().int().nonnegative().optional().nullable(),
});

export const adminGenerateLabelSchema = z.object({
  rateId: z.string().min(1).optional(),
  labelFileType: z.enum(['PDF_4x6', 'PDF_A4', 'PNG', 'ZPLII']).optional(),
  shipmentId: z.string().min(1).optional(),
  selectedRate: selectedRateSnapshotSchema.optional(),
  parcels: z.array(checkoutParcelSchema).optional(),
});

export const adminBulkUpsLabelsSchema = z.object({
  orderPublicIds: z.array(z.string().min(1)).min(1).max(50),
});

export const orderFulfillmentActionSchema = z.object({
  action: z.enum(['accept', 'pickup_ready', 'mark_shipped', 'mark_delivered', 'reject_unpaid']),
});

export const orderBulkFulfillmentSchema = z.object({
  orderPublicIds: z.array(z.string().min(1)).min(1).max(100),
  action: z.enum(['accept', 'pickup_ready', 'mark_shipped']),
});

export const pickupListCreateSchema = z.object({
  title: z.string().max(200).optional(),
  orderPublicIds: z.array(z.string().min(1)).min(1).max(200),
});

export const orderItemPickSchema = z.object({
  pickedQuantity: z.number().int().min(0),
});

const refurbQuestionnaireSchema = z.object({
  isCleanAndWashable: z.enum(['yes', 'no']),
  stains: z.enum(['no_stains', 'minor_removable', 'permanent']),
  tearsHoles: z.enum(['no', 'yes']),
  fastenersBroken: z.enum(['no', 'yes']),
  heavilyWorn: z.enum(['no', 'yes']),
  odors: z.enum(['no', 'yes']),
  stillUsable: z.enum(['yes', 'no']),
});

const refurbPhotoUrlsSchema = z.object({
  front: z.string().min(1).optional(),
  back: z.string().min(1).optional(),
  defect: z.string().min(1).optional(),
});

const refurbPhotoUrlsWithPathsSchema = refurbPhotoUrlsSchema
  .refine(
    (urls) => Boolean(urls.front?.trim() && urls.back?.trim()),
    { message: 'Front and back photos are required' }
  )
  .refine(
    (urls) => [urls.front, urls.back, urls.defect].filter(Boolean).every((p) => String(p).startsWith('/uploads/returns/')),
    { message: 'Invalid photo upload paths' }
  );

export const STANDARD_RETURN_REASONS = [
  'Wrong Size',
  'Doesn\'t Fit',
  'Changed Mind',
  'Wrong Item Received',
  'Damaged Product',
  'Defective Product',
  'Other',
];

const standardPhotoUrlsSchema = z
  .array(z.string().min(1))
  .max(5)
  .optional()
  .refine(
    (arr) => !arr || arr.every((p) => p.startsWith('/uploads/returns/')),
    { message: 'Invalid photo upload paths' }
  );

const refurbReturnItemSchema = z.object({
  orderItemId: z.string().min(1),
  quantity: z.number().int().min(1).max(99).optional().default(1),
  questionnaire: refurbQuestionnaireSchema,
  photoUrls: refurbPhotoUrlsWithPathsSchema,
});

export const returnRequestCreateSchema = z
  .object({
    orderId: z.string().min(1),
    orderItemId: z.string().min(1).optional(),
    orderItemIds: z.array(z.string().min(1)).min(1).max(50).optional(),
    refurbItems: z.array(refurbReturnItemSchema).min(1).max(50).optional(),
    type: z.enum(['STANDARD', 'REFURBISHMENT']).optional().default('STANDARD'),
    reason: z.string().min(3).max(1000),
    notes: z.string().max(2000).optional(),
    quantity: z.number().int().min(1).max(99).optional(),
    quantities: z.record(z.string().min(1), z.number().int().min(1).max(99)).optional(),
    questionnaire: refurbQuestionnaireSchema.optional(),
    photoUrls: z.union([refurbPhotoUrlsSchema, standardPhotoUrlsSchema]).optional(),
  })
  .refine(
    (body) => Boolean(body.orderItemId) || (body.orderItemIds?.length ?? 0) > 0 || (body.refurbItems?.length ?? 0) > 0,
    {
      message: 'At least one order item is required',
      path: ['orderItemIds'],
    }
  )
  .refine(
    (body) =>
      body.type !== 'REFURBISHMENT' ||
      (body.refurbItems?.length ?? 0) > 0 ||
      Boolean(body.orderItemId) ||
      (body.orderItemIds?.length ?? 0) > 0,
    {
      message: 'At least one order item is required',
      path: ['refurbItems'],
    }
  )
  .refine(
    (body) =>
      body.type !== 'REFURBISHMENT' ||
      (body.refurbItems?.length ?? 0) > 0 ||
      (Boolean(body.questionnaire) && Boolean(body.photoUrls)),
    {
      message: 'Questionnaire and photos are required for refurbishment returns',
      path: ['questionnaire'],
    }
  )
  .refine(
    (body) => {
      if (body.type !== 'REFURBISHMENT') return true;
      if ((body.refurbItems?.length ?? 0) > 0) return true;
      return Boolean(body.photoUrls?.front?.trim() && body.photoUrls?.back?.trim());
    },
    { message: 'Front and back photos are required', path: ['photoUrls'] }
  )
  .refine(
    (body) => {
      if (body.type !== 'REFURBISHMENT') return true;
      if ((body.refurbItems?.length ?? 0) > 0) return true;
      const urls = body.photoUrls;
      if (!urls) return false;
      const paths = [urls.front, urls.back, urls.defect].filter(Boolean);
      return paths.every((p) => typeof p === 'string' && p.startsWith('/uploads/returns/'));
    },
    { message: 'Invalid photo upload paths', path: ['photoUrls'] }
  );

export const RETURN_STATUS_VALUES = [
  'REQUESTED',
  'ELIGIBILITY_REVIEW',
  'ELIGIBILITY_REJECTED',
  'APPROVED',
  'LABEL_GENERATED',
  'IN_TRANSIT',
  'RECEIVED',
  'UNDER_INSPECTION',
  'INSPECTION_APPROVED',
  'INSPECTION_REJECTED',
  'REJECTED',
  'CANCELLED',
];

export const returnStatusUpdateSchema = z.object({
  status: z.enum(RETURN_STATUS_VALUES).optional(),
  notes: z.string().max(2000).optional().nullable(),
  rejectionReason: z.string().max(500).optional().nullable(),
  inspectionChecklist: z
    .object({
      correctProduct: z.boolean().optional(),
      unused: z.boolean().optional(),
      tagsAttached: z.boolean().optional(),
      packagingAvailable: z.boolean().optional(),
      noStains: z.boolean().optional(),
      noDamage: z.boolean().optional(),
      noMissingAccessories: z.boolean().optional(),
    })
    .optional()
    .nullable(),
  manualCarrier: z.string().max(50).optional().nullable(),
  manualTrackingNumber: z.string().max(120).optional().nullable(),
  manualShippedAt: z.string().datetime().optional().nullable(),
});

export const guestReturnTrackSchema = z.object({
  returnId: z.string().min(1),
  email: z.string().email(),
});

export const returnPackageRequestCreateSchema = z.object({
  orderId: z.string().min(1),
  returnRequestId: z.string().min(1).optional(),
  reason: z.string().min(3).max(500),
  comments: z.string().max(2000).optional(),
});

const emptyStringToUndefined = (val) =>
  typeof val === 'string' && val.trim() === '' ? undefined : val;

export const returnPackageRequestUpdateSchema = z.object({
  status: z.enum(['REQUESTED', 'APPROVED', 'REJECTED', 'SENT']),
  adminNotes: z.string().max(2000).optional().nullable(),
  dispatchDate: z.preprocess(emptyStringToUndefined, z.string().datetime().optional().nullable()),
  uspsTrackingNumber: z.preprocess(emptyStringToUndefined, z.string().max(120).optional().nullable()),
  expectedDeliveryDate: z.preprocess(emptyStringToUndefined, z.string().datetime().optional().nullable()),
});

export const refurbUspsShipmentSchema = z.object({
  trackingNumber: z.string().min(3).max(120),
  note: z.string().max(500).optional().nullable(),
  shippedAt: z.string().datetime().optional().nullable(),
  photoUrl: z.preprocess(
    emptyStringToUndefined,
    z
      .string()
      .max(500)
      .refine((v) => v.startsWith('/uploads/returns/'), 'Invalid photo path')
      .optional()
      .nullable()
  ),
});

export const returnCancelSchema = z.object({
  reason: z.string().max(500).optional().nullable(),
});

export const returnEligibilityReviewSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  notes: z.string().max(2000).optional().nullable(),
});

export const refurbInspectionCreateSchema = z.object({
  grade: z.enum(['A', 'B', 'C']).optional(),
  notes: z.string().max(5000).optional().nullable(),
  photoUrls: z.record(z.string()).optional(),
  tasksCompleted: z
    .object({
      wash: z.boolean().optional(),
      iron: z.boolean().optional(),
      repair: z.boolean().optional(),
    })
    .optional(),
  target: z.enum(['return', 'job']).optional().default('return'),
});

export const guestReturnCreateSchema = z
  .object({
    token: z.string().min(1).optional(),
    orderNumber: z.string().min(1).optional(),
    email: z.string().email().optional(),
    orderItemId: z.string().min(1).optional(),
    orderItemIds: z.preprocess(
      (val) =>
        Array.isArray(val)
          ? val.filter((id) => typeof id === 'string' && String(id).trim().length > 0)
          : val,
      z.array(z.string().min(1)).min(1).max(50).optional()
    ),
    reason: z.string().min(3).max(1000),
  })
  .refine((body) => Boolean(body.token) || (Boolean(body.orderNumber) && Boolean(body.email)), {
    message: 'Provide a tracking token or both order number and email',
    path: ['orderNumber'],
  })
  .refine((body) => Boolean(body.orderItemId) || (body.orderItemIds?.length ?? 0) > 0, {
    message: 'At least one order item is required',
    path: ['orderItemIds'],
  });

export const returnLabelGenerateSchema = z.object({
  rateId: z.string().min(1).optional(),
  shipmentId: z.string().optional(),
  labelFileType: z.string().optional(),
  selectedRate: z.record(z.unknown()).optional(),
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

const shipAddressSchema = z.object({
  fullName: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  addressLine1: z.string().min(1).optional(),
  addressLine2: z.string().optional().nullable(),
  city: z.string().min(1),
  state: z.string().min(1),
  zipCode: z.string().min(1).optional(),
  zip: z.string().min(1).optional(),
  country: z.string().min(2),
  phoneNumber: z.string().min(6).max(30).optional().nullable(),
  email: z.string().email().optional().nullable(),
});

const parcelSchema = z.object({
  length: z.union([z.number().positive(), z.string().min(1)]),
  width: z.union([z.number().positive(), z.string().min(1)]),
  height: z.union([z.number().positive(), z.string().min(1)]),
  weight: z.union([z.number().positive(), z.string().min(1)]),
  distance_unit: z.enum(['in', 'cm', 'ft', 'm', 'mm', 'yd']).optional(),
  mass_unit: z.enum(['lb', 'oz', 'g', 'kg']).optional(),
});

export const shippingRatesSchema = z.object({
  shippingAddress: shipAddressSchema.optional(),
  toAddress: shipAddressSchema.optional(),
  fromAddress: shipAddressSchema.optional(),
  parcels: z.array(parcelSchema).optional(),
  useDummyAddress: z.boolean().optional(),
  useDummyFromAddress: z.boolean().optional(),
  dummyCountry: z.enum(['US', 'CA']).optional(),
}).refine((d) => d.useDummyAddress || Boolean(d.shippingAddress || d.toAddress), {
  message: 'Provide shippingAddress/toAddress or set useDummyAddress=true',
});

export const shippingShipmentSchema = z.object({
  shippingAddress: shipAddressSchema.optional(),
  toAddress: shipAddressSchema.optional(),
  fromAddress: shipAddressSchema.optional(),
  parcels: z.array(parcelSchema).min(1),
  metadata: z.string().max(500).optional().nullable(),
}).refine((d) => Boolean(d.shippingAddress || d.toAddress), {
  message: 'shippingAddress or toAddress is required',
});

export const shippingLabelSchema = z.object({
  rateId: z.string().min(1),
  labelFileType: z.enum(['PDF_4x6', 'PDF_A4', 'PNG', 'ZPLII']).optional(),
  orderId: z.string().min(1).optional(),
});

const membershipShippingSchema = z.object({
  fullName: z.string().min(1).optional(),
  addressLine1: z.string().min(1),
  addressLine2: z.string().optional().nullable(),
  city: z.string().min(1),
  state: z.string().min(1),
  zipCode: z.string().min(1),
  country: z.string().min(1).default('US'),
  phoneNumber: z.string().min(6).max(30).optional().nullable(),
});

export const membershipRegistrationSchema = z.object({
  babyName: z.string().min(1, 'Baby name is required'),
  shippingAddress: membershipShippingSchema,
});

export const membershipCheckoutSchema = z.object({
  returnTo: z.string().max(500).optional(),
  intent: z.enum(['purchase', 'renew']).optional(),
  babyName: z.string().min(1).optional(),
  shippingAddress: membershipShippingSchema.optional(),
});
