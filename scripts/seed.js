import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

const DEFAULT_ROLES = [
  'ADMIN',
  'ADMIN_TEAM',
  'CUSTOMER',
  'VENDOR',
  'SUPPORT',
  'MANAGER',
];

async function seedRoles() {
  for (const roleName of DEFAULT_ROLES) {
    await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });
  }
}

/**
 * Ensures one ADMIN user exists (idempotent: does not change password if user already exists).
 * Configure with SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD (required in production to create).
 */
async function seedSuperAdmin() {
  if (process.env.SKIP_SUPER_ADMIN_SEED === 'true') {
    console.log('Super admin seed skipped (SKIP_SUPER_ADMIN_SEED=true).');
    return;
  }

  const email = (process.env.SUPER_ADMIN_EMAIL || 'admin@babyburn.local').trim().toLowerCase();

  const adminRole = await prisma.role.findUnique({ where: { name: 'ADMIN' } });
  if (!adminRole) {
    throw new Error('ADMIN role missing; seed roles first.');
  }

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    if (existing.roleId !== adminRole.id) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { roleId: adminRole.id },
      });
      console.log(`Super admin: assigned ADMIN role to existing user ${email}.`);
    } else {
      console.log(`Super admin: ${email} already exists (password unchanged).`);
    }
    return;
  }

  let password = process.env.SUPER_ADMIN_PASSWORD;

  if (!password && process.env.NODE_ENV === 'production') {
    console.warn(
      'Super admin: SUPER_ADMIN_PASSWORD not set; skipping user creation in production. Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD to create.'
    );
    return;
  }

  if (!password) {
    password = 'ChangeMe123!';
    console.warn(
      'Super admin: SUPER_ADMIN_PASSWORD not set; using dev-only default "ChangeMe123!". Change it after first login.'
    );
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      firstName: process.env.SUPER_ADMIN_FIRST_NAME?.trim() || 'Super',
      lastName: process.env.SUPER_ADMIN_LAST_NAME?.trim() || 'Admin',
      roleId: adminRole.id,
    },
  });

  console.log(`Super admin created: ${email}`);
}

async function main() {
  await seedRoles();
  console.log(`Seeded ${DEFAULT_ROLES.length} roles.`);
  await seedSuperAdmin();
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
