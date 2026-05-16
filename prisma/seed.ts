import prisma from '../src/utils/prisma.js';

async function main() {
  console.log('🚀 Starting deep seed (Stripe branch)...');

  // ─── Cleanup ────────────────────────────────────────
  console.log('🧹 Cleaning up existing data...');
  await prisma.auditLog.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.invoiceLineItem.deleteMany();
  await prisma.pOLineItem.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.vendorAlias.deleteMany();
  await prisma.vendor.deleteMany();

  // ─── Vendors (10) ───────────────────────────────────
  console.log('🏢 Creating 10 vendors...');
  const vendors = [];
  const vendorNames = [
    'Acme Supplies Ltd.', 'Nexus Tech Distributors', 'Apex Industrial', 'Global Logistics',
    'Office Depot', 'Horizon Softwares', 'BlueSky Energy', 'IronBound Manufacturing',
    'Swift Courier Services', 'Pioneer Chemicals'
  ];

  for (let i = 0; i < 10; i++) {
    const v = await prisma.vendor.create({
      data: {
        name: vendorNames[i],
        email: `accounts@${vendorNames[i].toLowerCase().replace(/ /g, '')}.com`,
        phone: `+1-555-000${i}`,
        isVerified: i % 3 !== 0,
      }
    });
    vendors.push(v);
  }

  // ─── Purchase Orders (40) ───────────────────────────
  console.log('📦 Creating 40 Purchase Orders (4 per vendor)...');
  const pos = [];
  const poStatuses = ['open', 'delivered', 'closed'];

  for (let i = 1; i <= 40; i++) {
    const vendor = vendors[(i - 1) % 10]; // Cycle through 10 vendors
    const amount = Math.floor(Math.random() * 20000) + 5000;
    
    const po = await prisma.purchaseOrder.create({
      data: {
        poNumber: `PO-${500 + i}`,
        vendorId: vendor.id,
        approvedAmount: amount,
        remainingAmount: amount,
        currency: 'USD',
        description: `Project ${String.fromCharCode(65 + (i % 26))} - Phase ${Math.ceil(i / 10)}`,
        status: poStatuses[i % 3],
        lineItems: {
          create: [
            { description: 'Equipment Supply', qty: 5, unitPrice: amount / 10, total: amount / 2 },
            { description: 'Installation Services', qty: 1, unitPrice: amount / 2, total: amount / 2 },
          ]
        }
      }
    });
    pos.push(po);
  }

  console.log('✨ Seed complete!');
  console.log(`Created: ${vendors.length} Vendors, ${pos.length} POs`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
