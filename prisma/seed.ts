import prisma from '../src/utils/prisma';

async function main() {
  console.log('Seeding database...');

  // ─── Cleanup ────────────────────────────────────────
  console.log('Cleaning up existing data...');
  await prisma.auditLog.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.invoiceLineItem.deleteMany();
  await prisma.pOLineItem.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.vendorAlias.deleteMany();
  await prisma.vendor.deleteMany();
  console.log('Cleanup complete.');

  // ─── Vendors ────────────────────────────────────────
  const vendor1 = await prisma.vendor.upsert({
    where: { email: 'billing@acme.com' },
    update: {},
    create: {
      name:          'Acme Supplies Ltd.',
      email:         'billing@acme.com',
      phone:         '+1-555-0101',
      address:       '123 Main St, NY 10001',
      bankName:      'Chase Bank N.A.',
      accountName:   'Acme Supplies Ltd.',
      accountNumber: '7845123690',
      routingNumber: '021000021',
      isVerified:    true,
    }
  });

  const vendor2 = await prisma.vendor.upsert({
    where: { email: 'accounts@nexustech.com' },
    update: {},
    create: {
      name:       'Nexus Tech Distributors',
      email:      'accounts@nexustech.com',
      phone:      '+1-512-444-7890',
      address:    '789 Innovation Blvd, Austin TX 78701',
      isVerified: true,
    }
  });

  const vendor3 = await prisma.vendor.upsert({
    where: { email: 'invoices@apexindustrial.com' },
    update: {},
    create: {
      name:       'Apex Industrial Supplies',
      email:      'invoices@apexindustrial.com',
      phone:      '+1-313-555-9900',
      address:    '321 Industrial Park, Detroit MI 48201',
      isVerified: false, // unverified — for testing
    }
  });

  // ─── Purchase Orders ─────────────────────────────────
  const po1 = await prisma.purchaseOrder.upsert({
    where: { poNumber: 'PO-445' },
    update: {},
    create: {
      poNumber:        'PO-445',
      vendorId:        vendor1.id,
      approvedAmount:  10000,
      remainingAmount: 7390,
      currency:        'USD',
      description:     'Office supplies Q3 2024',
      status:          'delivered',
    }
  });

  const po2 = await prisma.purchaseOrder.upsert({
    where: { poNumber: 'PO-612' },
    update: {},
    create: {
      poNumber:        'PO-612',
      vendorId:        vendor2.id,
      approvedAmount:  9000,
      remainingAmount: 9000,
      currency:        'USD',
      description:     'IT Equipment Q4 2024',
      status:          'open',
    }
  });

  const po3 = await prisma.purchaseOrder.upsert({
    where: { poNumber: 'PO-891' },
    update: {},
    create: {
      poNumber:        'PO-891',
      vendorId:        vendor3.id,
      approvedAmount:  15000,
      remainingAmount: 15000,
      currency:        'USD',
      description:     'Industrial parts Q2 2024',
      status:          'open',
    }
  });

  console.log('✅ Seeded vendors:', vendor1.name, vendor2.name, vendor3.name);
  console.log('✅ Seeded POs:', po1.poNumber, po2.poNumber, po3.poNumber);
  console.log('Seeding complete!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
