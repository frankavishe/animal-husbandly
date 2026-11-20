/* Seeds Tanzania regions/districts and the initial administrator. Idempotent. */
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { normalizeTzPhone } from '../src/common/utils/phone';
import { TZ_REGIONS } from './data/tz-regions';

const prisma = new PrismaClient();

async function seedRegions(): Promise<void> {
  for (const r of TZ_REGIONS) {
    const region = await prisma.region.upsert({
      where: { code: r.code },
      update: { name: r.name },
      create: { code: r.code, name: r.name },
    });
    for (const name of r.districts) {
      await prisma.district.upsert({
        where: { regionId_name: { regionId: region.id, name } },
        update: {},
        create: { name, regionId: region.id },
      });
    }
  }
  console.log(`Seeded ${TZ_REGIONS.length} regions.`);
}

async function seedAdmin(): Promise<void> {
  const { ADMIN_FULL_NAME, ADMIN_EMAIL, ADMIN_PHONE, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_PASSWORD || (!ADMIN_EMAIL && !ADMIN_PHONE)) {
    console.warn('ADMIN_PASSWORD and ADMIN_EMAIL/ADMIN_PHONE not set — skipping admin seed.');
    return;
  }
  const email = ADMIN_EMAIL ? ADMIN_EMAIL.trim().toLowerCase() : null;
  const phone = ADMIN_PHONE ? normalizeTzPhone(ADMIN_PHONE) : null;
  if (ADMIN_PHONE && !phone) throw new Error('ADMIN_PHONE is not a valid Tanzanian mobile number');

  const existing = await prisma.user.findFirst({
    where: { OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] },
  });
  if (existing) {
    if (existing.role !== Role.ADMIN) {
      await prisma.user.update({ where: { id: existing.id }, data: { role: Role.ADMIN } });
    }
    console.log('Admin already exists.');
    return;
  }
  const rounds = Number(process.env.BCRYPT_ROUNDS ?? 10);
  await prisma.user.create({
    data: {
      fullName: ADMIN_FULL_NAME?.trim() || 'Platform Admin',
      email,
      phone,
      passwordHash: await bcrypt.hash(ADMIN_PASSWORD, rounds),
      role: Role.ADMIN,
    },
  });
  console.log('Seeded admin user.');
}

async function main(): Promise<void> {
  await seedRegions();
  await seedAdmin();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
