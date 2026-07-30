/**
 * Smoke-test portal-scoped dual accounts against local API.
 * Run: node scripts/verify-portal-scope.mjs
 */
const BASE = process.env.API_BASE || 'http://127.0.0.1:5000/api';
const email = `dual.portal.${Date.now()}@example.com`;
const customerPass = 'Customer1!pass';
const staffPass = 'StaffMember1!';

async function req(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log('Using email', email);

  // 1. Register customer
  const reg = await req('POST', '/auth/register', {
    email,
    password: customerPass,
    firstName: 'Dual',
    lastName: 'Customer',
  });
  assert(reg.status === 201, `register failed: ${reg.status} ${JSON.stringify(reg.json)}`);
  console.log('OK register customer');

  // Mark verified so login works (raw SQL via admin is hard; use prisma script instead)
  // We'll login expecting EMAIL_NOT_VERIFIED first, then verify via DB in a follow-up.

  const loginCustUnverified = await req('POST', '/auth/login', {
    email,
    password: customerPass,
    portal: 'customer',
  });
  assert(
    loginCustUnverified.status === 403 && loginCustUnverified.json?.code === 'EMAIL_NOT_VERIFIED',
    `expected EMAIL_NOT_VERIFIED got ${loginCustUnverified.status} ${JSON.stringify(loginCustUnverified.json)}`
  );
  console.log('OK customer login blocked until verify');

  // Wrong portal before staff exists — should be invalid credentials (no staff row)
  const wrongBefore = await req('POST', '/auth/login', {
    email,
    password: customerPass,
    portal: 'admin',
  });
  assert(
    wrongBefore.status === 403 && wrongBefore.json?.code === 'WRONG_PORTAL_CUSTOMER',
    `expected WRONG_PORTAL_CUSTOMER got ${wrongBefore.status} ${JSON.stringify(wrongBefore.json)}`
  );
  console.log('OK admin login denied for customer-only email');

  // Create staff with same email via prisma (no admin token in smoke)
  const { PrismaClient } = await import('@prisma/client');
  const bcrypt = (await import('bcryptjs')).default;
  const prisma = new PrismaClient();
  try {
    await prisma.user.updateMany({
      where: { email, portalScope: 'CUSTOMER' },
      data: { emailVerifiedAt: new Date() },
    });
    const teamRole = await prisma.role.findUnique({ where: { name: 'ADMIN_TEAM' } });
    assert(teamRole, 'ADMIN_TEAM role missing');
    const hashed = await bcrypt.hash(staffPass, 10);
    await prisma.user.create({
      data: {
        email,
        password: hashed,
        firstName: 'Dual',
        lastName: 'Staff',
        roleId: teamRole.id,
        portalScope: 'STAFF',
        adminModules: ['orders'],
        emailVerifiedAt: new Date(),
        isActive: true,
      },
    });
    console.log('OK created STAFF row with same email');
  } finally {
    await prisma.$disconnect();
  }

  // Customer login with customer password
  const custOk = await req('POST', '/auth/login', {
    email,
    password: customerPass,
    portal: 'customer',
  });
  assert(custOk.status === 200, `customer login failed: ${JSON.stringify(custOk.json)}`);
  assert(custOk.json?.data?.user?.portalScope === 'CUSTOMER', 'customer portalScope missing');
  console.log('OK customer portal login');

  // Staff login with staff password
  const staffOk = await req('POST', '/auth/login', {
    email,
    password: staffPass,
    portal: 'admin',
  });
  assert(staffOk.status === 200, `staff login failed: ${JSON.stringify(staffOk.json)}`);
  assert(staffOk.json?.data?.user?.portalScope === 'STAFF', 'staff portalScope missing');
  console.log('OK admin portal login');

  // Cross-password should fail (separate accounts)
  const cross1 = await req('POST', '/auth/login', {
    email,
    password: staffPass,
    portal: 'customer',
  });
  assert(cross1.status === 401, `expected 401 for staff pass on customer portal, got ${cross1.status}`);
  console.log('OK staff password rejected on customer portal');

  const cross2 = await req('POST', '/auth/login', {
    email,
    password: customerPass,
    portal: 'admin',
  });
  assert(cross2.status === 401, `expected 401 for customer pass on admin portal, got ${cross2.status}`);
  console.log('OK customer password rejected on admin portal');

  // Register again should fail (customer already exists)
  const regDup = await req('POST', '/auth/register', {
    email,
    password: customerPass,
    firstName: 'X',
  });
  assert(regDup.status === 400, `expected register conflict got ${regDup.status}`);
  console.log('OK second customer register blocked');

  console.log('\nAll portal-scope checks passed.');
}

main().catch((err) => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
