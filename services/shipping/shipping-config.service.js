import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

let cache = { at: 0, providers: null, methodsByProviderId: null };
const TTL_MS = 45_000;

export function invalidateShippingConfigCache() {
  cache = { at: 0, providers: null, methodsByProviderId: null };
}

export async function loadShippingConfig() {
  const now = Date.now();
  if (cache.providers && now - cache.at < TTL_MS) {
    return { providers: cache.providers, methodsByProviderId: cache.methodsByProviderId };
  }
  const providers = await prisma.shippingProvider.findMany({
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: { services: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
  });
  const methodsByProviderId = new Map();
  for (const p of providers) {
    methodsByProviderId.set(p.id, p.services);
  }
  cache = { at: now, providers, methodsByProviderId };
  return { providers, methodsByProviderId };
}

export async function getDefaultProviderSlug() {
  const { providers } = await loadShippingConfig();
  const def = providers.find((p) => p.enabled && p.isDefault);
  if (def) return def.slug;
  const first = providers.find((p) => p.enabled);
  return first?.slug || 'ups';
}

export async function getProviderBySlug(slug) {
  const { providers } = await loadShippingConfig();
  return providers.find((p) => p.slug === slug) || null;
}

export async function getEnabledServiceCodes(providerId, surface) {
  const { methodsByProviderId } = await loadShippingConfig();
  const list = methodsByProviderId.get(providerId) || [];
  return list.filter((m) => {
    if (!m.enabled) return false;
    if (surface === 'checkout') return m.visibleAtCheckout;
    if (surface === 'admin') return m.visibleInAdmin;
    return true;
  });
}

export async function appendShippingLog(entry) {
  try {
    await prisma.shippingProviderLog.create({
      data: {
        providerSlug: entry.providerSlug,
        level: entry.level || 'INFO',
        action: entry.action,
        orderPublicId: entry.orderPublicId || null,
        message: String(entry.message || '').slice(0, 20000),
        details: entry.details ?? undefined,
      },
    });
  } catch (e) {
    console.error('[shipping-log]', e);
  }
}
