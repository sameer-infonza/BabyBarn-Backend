/**
 * Phase 2 API smoke checks. Requires API on PORT (default 5000).
 * Usage: node scripts/phase2-smoke.mjs
 */
import { PrismaClient } from '@prisma/client';
import { generateToken } from '../utils/jwt.js';

const BASE = process.env.API_BASE || 'http://localhost:5000/api';
const prisma = new PrismaClient();

let passed = 0;
let failed = 0;

function ok(name) {
  passed += 1;
  console.log(`  OK  ${name}`);
}

function fail(name, detail) {
  failed += 1;
  console.error(`  FAIL ${name}: ${detail}`);
}

async function request(path, { method = 'GET', body, token, expectStatus } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  let json = null;
  const text = await res.text();
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (expectStatus != null && res.status !== expectStatus) {
    throw new Error(`expected ${expectStatus}, got ${res.status}: ${text.slice(0, 200)}`);
  }
  return { status: res.status, json };
}

async function main() {
  console.log(`Phase 2 smoke → ${BASE}\n`);

  try {
    const { status, json } = await request('/public/business-settings');
    if (status === 200 && json?.data?.accessMembershipPriceUsd != null) {
      ok(`GET /public/business-settings ($${json.data.accessMembershipPriceUsd})`);
    } else {
      fail('public/business-settings', `status=${status}`);
    }
  } catch (e) {
    fail('public/business-settings', e.message);
  }

  try {
    const { status } = await request('/membership/savings', { expectStatus: 401 });
    if (status === 401) ok('GET /membership/savings requires auth');
    else fail('membership/savings auth', `status=${status}`);
  } catch (e) {
    fail('membership/savings auth', e.message);
  }

  const demo = await prisma.user.findUnique({
    where: { email: 'demo@babyburn.local' },
    select: { publicId: true, email: true },
  });
  if (!demo) {
    fail('demo user', 'demo@babyburn.local not found — run node scripts/seed.js');
  } else {
    const token = generateToken({ id: demo.publicId, email: demo.email, role: 'CUSTOMER' });

    try {
      const { status, json } = await request('/membership/savings', { token, expectStatus: 200 });
      if (status === 200 && json?.data && 'savingsTotal' in json.data) {
        ok(`GET /membership/savings (total=${json.data.savingsTotal})`);
      } else {
        fail('membership/savings', JSON.stringify(json).slice(0, 120));
      }
    } catch (e) {
      fail('membership/savings', e.message);
    }

    try {
      const { status, json } = await request('/membership/payments/history', { token, expectStatus: 200 });
      if (status === 200 && Array.isArray(json?.data?.payments)) {
        ok(`GET /membership/payments/history (${json.data.payments.length} rows)`);
      } else {
        fail('membership/payments/history', JSON.stringify(json).slice(0, 120));
      }
    } catch (e) {
      fail('membership/payments/history', e.message);
    }

    try {
      await request('/membership/registration', {
        method: 'POST',
        token,
        body: { babyName: '' },
        expectStatus: 400,
      });
      ok('POST /membership/registration rejects empty babyName');
    } catch (e) {
      fail('membership/registration validation', e.message);
    }

    try {
      await request('/payments/checkout/membership', {
        method: 'POST',
        token,
        body: {},
        expectStatus: 400,
      });
      ok('POST /payments/checkout/membership rejects missing registration');
    } catch (e) {
      fail('membership checkout gate', e.message);
    }
  }

  const admin = await prisma.user.findFirst({
    where: { role: { name: 'ADMIN' } },
    select: { publicId: true, email: true },
  });
  if (admin) {
    const adminToken = generateToken({ id: admin.publicId, email: admin.email, role: 'ADMIN' });
    try {
      const { status, json } = await request('/admin/finance/stats', { token: adminToken });
      if (status === 200 && json?.data && 'membershipRevenueInOrders' in json.data) {
        ok('GET /admin/finance/stats includes membership revenue');
      } else {
        fail('admin/finance/stats', `status=${status} ${JSON.stringify(json).slice(0, 120)}`);
      }
    } catch (e) {
      fail('admin/finance/stats', e.message);
    }
  } else {
    fail('admin user', 'no ADMIN user in DB');
  }

  try {
    const { isRefurbishedEnabled } = await import('../config/feature-flags.js');
    if (!isRefurbishedEnabled()) ok('REFURBISHED_ENABLED is false in backend');
    else fail('REFURBISHED flag', 'expected disabled');
  } catch (e) {
    fail('feature-flags', e.message);
  }

  if (demo) {
    const token = generateToken({ id: demo.publicId, email: demo.email, role: 'CUSTOMER' });
    try {
      const { status } = await request('/orders?page=1&limit=5', { token, expectStatus: 200 });
      if (status === 200) ok('GET /orders (customer dashboard)');
      else fail('GET /orders', `status=${status}`);
    } catch (e) {
      fail('GET /orders', e.message);
    }

    try {
      const { completeMembershipPayment } = await import('../services/membership.service.js');
      const sessionId = `smoke_${Date.now()}`;
      const before = await prisma.user.findUnique({
        where: { publicId: demo.publicId },
        select: { accessMemberUntil: true, accessNumber: true },
      });
      const mockSession = {
        id: sessionId,
        amount_total: 4900,
        metadata: { userPublicId: demo.publicId, flow: 'membership' },
      };
      await completeMembershipPayment(mockSession);
      await completeMembershipPayment(mockSession);
      const payCount = await prisma.membershipPayment.count({ where: { stripeSessionId: sessionId } });
      if (payCount === 1) ok('completeMembershipPayment is idempotent per session');
      else fail('membership idempotency', `expected 1 payment, got ${payCount}`);
      await prisma.membershipPayment.deleteMany({ where: { stripeSessionId: sessionId } });
      await prisma.user.update({
        where: { publicId: demo.publicId },
        data: {
          accessMemberUntil: before?.accessMemberUntil ?? null,
          accessNumber: before?.accessNumber ?? null,
        },
      });
    } catch (e) {
      fail('membership webhook simulation', e.message);
    }
  }

  if (admin) {
    try {
      const adminToken = generateToken({ id: admin.publicId, email: admin.email, role: 'ADMIN' });
      const { status, json } = await request('/admin/team', { token: adminToken });
      if (status === 200 && Array.isArray(json?.data?.members)) {
        const ids = json.data.members.map((m) => m.publicId || m.id).filter(Boolean);
        const unique = new Set(ids);
        if (ids.length === unique.size) ok(`GET /admin/team (${ids.length} members, unique keys)`);
        else fail('admin/team', 'duplicate member ids in response');
      } else {
        fail('admin/team', `status=${status}`);
      }
    } catch (e) {
      fail('admin/team', e.message);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
