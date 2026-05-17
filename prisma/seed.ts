import prisma from '../src/utils/prisma.js';
import bcrypt from 'bcryptjs';

async function main() {
  console.log('🚀 Starting User Seeding...');

  // Create Admin User
  const adminPassword = 'adminpassword';
  const adminSalt = await bcrypt.genSalt(10);
  const hashedAdminPassword = await bcrypt.hash(adminPassword, adminSalt);

  console.log('👤 Seeding Admin User...');
  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      password: hashedAdminPassword,
      name: 'Admin User',
      role: 'admin',
    },
  });

  // Create Normal/Simple User
  const userPassword = 'userpassword';
  const userSalt = await bcrypt.genSalt(10);
  const hashedUserPassword = await bcrypt.hash(userPassword, userSalt);

  console.log('👤 Seeding Normal User...');
  const normalUser = await prisma.user.upsert({
    where: { email: 'user@example.com' },
    update: {},
    create: {
      email: 'user@example.com',
      password: hashedUserPassword,
      name: 'Normal User',
      role: 'user',
    },
  });

  console.log('✨ Seed complete!');
  console.log(`Created/Ensured Admin: ${admin.email}`);
  console.log(`Created/Ensured Normal User: ${normalUser.email}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
