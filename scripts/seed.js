import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const DEFAULT_ROLES = [
  'ADMIN',
  'ADMIN_TEAM',
  'CUSTOMER',
  'VENDOR',
  'SUPPORT',
  'MANAGER',
];

const SEED_USERS = [
  {
    key: 'DEFAULT_ADMIN',
    email: 'admin@babyburn.local',
    password: 'ChangeMe_Admin_123!',
    firstName: 'System',
    lastName: 'Admin',
    role: 'ADMIN',
    enabledInProduction: true,
  },
  {
    key: 'DEMO_USER',
    email: 'demo@babyburn.local',
    password: 'ChangeMe_User_123!',
    firstName: 'Demo',
    lastName: 'User',
    role: 'CUSTOMER',
    enabledInProduction: false,
  },
];

async function seedRoles() {
  let created = 0;
  let skipped = 0;

  for (const roleName of DEFAULT_ROLES) {
    const existing = await prisma.role.findUnique({ where: { name: roleName } });
    if (existing) {
      skipped += 1;
      console.log(`[SKIP] role already exists: ${roleName}`);
      continue;
    }

    await prisma.role.create({ data: { name: roleName } });
    created += 1;
    console.log(`[CREATE] role: ${roleName}`);
  }

  return { created, skipped };
}

/**
 * Idempotent user seeding:
 * - create only when missing
 * - never update existing records
 * - credentials are defined only in this script (not in env/config)
 */
async function seedUsers() {
  let created = 0;
  let skipped = 0;
  const isProduction = process.env.NODE_ENV === 'production';

  for (const seedUser of SEED_USERS) {
    if (isProduction && !seedUser.enabledInProduction) {
      skipped += 1;
      console.log(`[SKIP] ${seedUser.key} disabled in production`);
      continue;
    }

    const email = seedUser.email.trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      skipped += 1;
      console.log(`[SKIP] user already exists: ${email}`);
      continue;
    }

    const role = await prisma.role.findUnique({ where: { name: seedUser.role } });
    if (!role) {
      throw new Error(`Missing role "${seedUser.role}" for ${seedUser.key}`);
    }

    const hashedPassword = await bcrypt.hash(seedUser.password, 10);
    await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        firstName: seedUser.firstName,
        lastName: seedUser.lastName,
        roleId: role.id,
      },
    });

    created += 1;
    console.log(`[CREATE] user: ${email} (${seedUser.role})`);
  }

  return { created, skipped };
}

async function main() {
  const roles = await seedRoles();
  const users = await seedUsers();

  console.log('\nSeed summary');
  console.log(`Roles -> created: ${roles.created}, skipped: ${roles.skipped}`);
  console.log(`Users -> created: ${users.created}, skipped: ${users.skipped}`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
