import { PrismaClient } from '@prisma/client';
import { invalidateShippingConfigCache, appendShippingLog } from './shipping/shipping-config.service.js';
import { encryptCredentialsJson, hasMasterKey } from './shipping/credentials-crypto.js';
import { UpsClient } from './providers/ups.client.js';

const prisma = new PrismaClient();

function sanitizePlatform(row) {
  if (!row) {
    return {
      pickupAddressJson: null,
      defaultPackageJson: null,
      autoLabelGeneration: false,
      manualShippingAllowed: true,
    };
  }
  return {
    pickupAddressJson: row.pickupAddressJson ?? null,
    defaultPackageJson: row.defaultPackageJson ?? null,
    autoLabelGeneration: Boolean(row.autoLabelGeneration),
    manualShippingAllowed: Boolean(row.manualShippingAllowed),
  };
}

function sanitizeProvider(p) {
  return {
    publicId: p.publicId,
    slug: p.slug,
    displayName: p.displayName,
    enabled: p.enabled,
    isDefault: p.isDefault,
    sortOrder: p.sortOrder,
    metadata: p.metadata,
    hasStoredCredentials: Boolean(p.credentialsEncrypted),
    services: (p.services || []).map((s) => ({
      publicId: s.publicId,
      code: s.code,
      displayName: s.displayName,
      enabled: s.enabled,
      visibleAtCheckout: s.visibleAtCheckout,
      visibleInAdmin: s.visibleInAdmin,
      sortOrder: s.sortOrder,
      rules: s.rules,
    })),
  };
}

export async function adminGetShippingConfig() {
  const [providers, platform] = await Promise.all([
    prisma.shippingProvider.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: { services: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
    }),
    prisma.shippingSettings.findUnique({ where: { id: 1 } }),
  ]);
  return {
    providers: providers.map(sanitizeProvider),
    encryptionAvailable: hasMasterKey(),
    platform: sanitizePlatform(platform),
  };
}

export async function adminPutShippingPlatform(patch) {
  const p = patch && typeof patch === 'object' ? patch : {};
  await prisma.shippingSettings.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      pickupAddressJson: p.pickupAddressJson ?? undefined,
      defaultPackageJson: p.defaultPackageJson ?? undefined,
      autoLabelGeneration: Boolean(p.autoLabelGeneration),
      manualShippingAllowed: p.manualShippingAllowed !== false,
    },
    update: {
      ...(p.pickupAddressJson !== undefined ? { pickupAddressJson: p.pickupAddressJson } : {}),
      ...(p.defaultPackageJson !== undefined ? { defaultPackageJson: p.defaultPackageJson } : {}),
      ...(typeof p.autoLabelGeneration === 'boolean' ? { autoLabelGeneration: p.autoLabelGeneration } : {}),
      ...(typeof p.manualShippingAllowed === 'boolean' ? { manualShippingAllowed: p.manualShippingAllowed } : {}),
    },
  });
  await appendShippingLog({
    providerSlug: 'system',
    action: 'config',
    message: 'Shipping platform settings (pickup / defaults) updated',
  });
  return adminGetShippingConfig();
}

export async function adminPutShippingProviders(updates) {
  const list = Array.isArray(updates) ? updates : [];
  await prisma.$transaction(async (tx) => {
    for (const u of list) {
      const slug = String(u.slug || '').trim();
      if (!slug) continue;
      const data = {};
      if (typeof u.enabled === 'boolean') data.enabled = u.enabled;
      if (typeof u.displayName === 'string' && u.displayName.trim()) data.displayName = u.displayName.trim();
      if (typeof u.sortOrder === 'number') data.sortOrder = u.sortOrder;
      if (u.isDefault === true) {
        await tx.shippingProvider.updateMany({ data: { isDefault: false } });
        data.isDefault = true;
      }
      if (u.credentials && typeof u.credentials === 'object' && slug === 'ups') {
        if (!hasMasterKey()) {
          throw new Error('SHIPPING_CREDENTIALS_MASTER_KEY is required to store UPS credentials in the database');
        }
        const enc = encryptCredentialsJson(u.credentials);
        data.credentialsEncrypted = enc;
      }
      if (Object.keys(data).length === 0) continue;
      await tx.shippingProvider.updateMany({ where: { slug }, data });
    }
  });
  invalidateShippingConfigCache();
  await appendShippingLog({
    providerSlug: 'system',
    action: 'config',
    message: 'Shipping provider config updated',
    details: { count: list.length },
  });
  return adminGetShippingConfig();
}

export async function adminPatchShippingService(publicId, patch) {
  const id = String(publicId || '').trim();
  const row = await prisma.shippingServiceMethod.findUnique({ where: { publicId: id } });
  if (!row) return null;
  const data = {};
  if (typeof patch.displayName === 'string') data.displayName = patch.displayName.trim();
  if (typeof patch.enabled === 'boolean') data.enabled = patch.enabled;
  if (typeof patch.visibleAtCheckout === 'boolean') data.visibleAtCheckout = patch.visibleAtCheckout;
  if (typeof patch.visibleInAdmin === 'boolean') data.visibleInAdmin = patch.visibleInAdmin;
  if (typeof patch.sortOrder === 'number') data.sortOrder = patch.sortOrder;
  const updated = await prisma.shippingServiceMethod.update({
    where: { id: row.id },
    data,
    include: { provider: true },
  });
  invalidateShippingConfigCache();
  return updated;
}

export async function adminCreateShippingService(payload) {
  const slug = String(payload.providerSlug || '').trim();
  const provider = await prisma.shippingProvider.findUnique({ where: { slug } });
  if (!provider) throw new Error('Unknown provider slug');
  const created = await prisma.shippingServiceMethod.create({
    data: {
      providerId: provider.id,
      code: String(payload.code || '').trim(),
      displayName: String(payload.displayName || '').trim(),
      enabled: payload.enabled !== false,
      visibleAtCheckout: payload.visibleAtCheckout !== false,
      visibleInAdmin: payload.visibleInAdmin !== false,
      sortOrder: typeof payload.sortOrder === 'number' ? payload.sortOrder : 100,
      rules: payload.rules ?? undefined,
    },
    include: { provider: true },
  });
  invalidateShippingConfigCache();
  return created;
}

export async function adminDeleteShippingService(publicId) {
  const row = await prisma.shippingServiceMethod.findUnique({ where: { publicId: String(publicId) } });
  if (!row) return false;
  if (row.code === '*') throw new Error('Cannot delete wildcard pass-through service row');
  await prisma.shippingServiceMethod.delete({ where: { id: row.id } });
  invalidateShippingConfigCache();
  return true;
}

export async function adminListShippingLogs(limit = 50) {
  const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return prisma.shippingProviderLog.findMany({
    orderBy: { createdAt: 'desc' },
    take,
  });
}

export async function adminTestUpsConnection(overrides = {}) {
  const client = new UpsClient({
    clientId: overrides.clientId,
    clientSecret: overrides.clientSecret,
    accountNumber: overrides.accountNumber,
    baseUrl: overrides.baseUrl,
  });
  if (!client.hasCredentials()) {
    return { ok: false, message: 'Missing UPS client id, secret, or account number' };
  }
  const from = {
    name: 'Test',
    street1: process.env.SHIP_FROM_STREET1 || '123 Test St',
    city: process.env.SHIP_FROM_CITY || 'Atlanta',
    state: process.env.SHIP_FROM_STATE || 'GA',
    zip: process.env.SHIP_FROM_ZIP || '30301',
    country: 'US',
  };
  const to = {
    name: 'Receiver',
    street1: '1600 Amphitheatre Pkwy',
    city: 'Mountain View',
    state: 'CA',
    zip: '94043',
    country: 'US',
  };
  const parcel = {
    length: '10',
    width: '8',
    height: '4',
    weight: '1',
    distance_unit: 'in',
    mass_unit: 'lb',
  };
  try {
    const data = await client.shopRate({ from, to, parcel });
    const rates = UpsClient.parseShopRates(data);
    await appendShippingLog({
      providerSlug: 'ups',
      action: 'config',
      message: `UPS test connection OK; ${rates.length} rated services`,
    });
    return { ok: true, rateCount: rates.length, cheapest: rates[0] || null };
  } catch (e) {
    await appendShippingLog({
      providerSlug: 'ups',
      level: 'ERROR',
      action: 'config',
      message: e?.message || String(e),
      details: { code: e?.code },
    });
    return { ok: false, message: e?.message || String(e), code: e?.code };
  }
}
