import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');
  const adminRole = await prisma.role.upsert({ where: { name: 'ADMIN' }, update: {}, create: { name: 'ADMIN', description: 'Administrator' } });
  const userRole = await prisma.role.upsert({ where: { name: 'USER' }, update: {}, create: { name: 'USER', description: 'End user' } });

  // permissions
  const pRead = await prisma.permission.upsert({ where: { key: 'READ' }, update: {}, create: { key: 'READ', name: 'Read' } });
  const pWrite = await prisma.permission.upsert({ where: { key: 'WRITE' }, update: {}, create: { key: 'WRITE', name: 'Write' } });

  // Attach permissions to ADMIN
  await prisma.rolePermission.createMany({ data: [ { roleId: adminRole.id, permissionId: pRead.id }, { roleId: adminRole.id, permissionId: pWrite.id } ], skipDuplicates: true });

  // Create admin user
  const admin = await prisma.user.upsert({ where: { email: 'admin@example.com' }, update: {}, create: { email: 'admin@example.com', name: 'Admin', password: '$2a$10$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' } });

  // assign role
  await prisma.userRole.createMany({ data: [{ userId: admin.id, roleId: adminRole.id }], skipDuplicates: true });

  console.log('Seeding complete');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
