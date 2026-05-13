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

  // ─── Purchase Orders (20) ───────────────────────────
  console.log('📦 Creating 20 Purchase Orders...');
  const pos = [];
  const poStatuses = ['open', 'delivered', 'closed'];

  for (let i = 1; i <= 20; i++) {
    const vendor = vendors[i % 10];
    const amount = Math.floor(Math.random() * 20000) + 5000;
    
    const po = await prisma.purchaseOrder.create({
      data: {
        poNumber: `PO-${500 + i}`,
        vendorId: vendor.id,
        approvedAmount: amount,
        remainingAmount: amount,
        currency: 'USD',
        description: `Quarterly supplies for Unit ${i}`,
        status: poStatuses[i % 3],
        lineItems: {
          create: [
            { description: 'Component A', qty: 10, unitPrice: amount / 20, total: amount / 2 },
            { description: 'Service B', qty: 1, unitPrice: amount / 2, total: amount / 2 },
          ]
        }
      }
    });
    pos.push(po);
  }

  // ─── Invoices (50) ──────────────────────────────────
  console.log('📄 Creating 50 Invoices...');
  const invoiceStatuses = ['received', 'approved', 'rejected', 'paid', ];

  for (let i = 1; i <= 50; i++) {
    const vendor = vendors[i % 10];
    const status = invoiceStatuses[i % 5];
    const amount = Math.floor(Math.random() * 8000) + 500;
    
    // Link to PO for 70% of invoices
    const po = (i % 3 !== 0) ? pos[Math.floor(Math.random() * pos.length)] : null;

    await prisma.invoice.create({
      data: {
        invoiceNumber: `INV-${3000 + i}`,
        vendorId: vendor.id,
        matchedPoId: po?.id,
        poNumber: po?.poNumber,
        invoiceDate: new Date(Date.now() - Math.floor(Math.random() * 15552000000)), // up to 6 months ago
        totalAmount: amount,
        amountPaid: status === 'paid' ? amount : 0,
        amountDue: status === 'paid' ? 0 : amount,
        status: status,
        lineItems: {
          create: [
            { description: `Line item for Invoice ${i}`, qty: 1, unitPrice: amount, total: amount },
          ]
        }
      }
    });
  }

  console.log('✨ Seed complete!');
  console.log(`Created: ${vendors.length} Vendors, ${pos.length} POs, 50 Invoices`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
