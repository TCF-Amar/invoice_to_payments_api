import prisma from '../src/utils/prisma.js';

async function main() {
  console.log('🚀 Starting deep seed...');

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

  // ─── Vendors ────────────────────────────────────────
  console.log('🏢 Creating vendors...');
  const vendorData = [
    { name: 'Acme Supplies Ltd.', email: 'billing@acme.com', isVerified: true },
    { name: 'Nexus Tech Distributors', email: 'accounts@nexustech.com', isVerified: true },
    { name: 'Apex Industrial Supplies', email: 'invoices@apexindustrial.com', isVerified: false },
    { name: 'Global Logistics Inc.', email: 'finance@globallogistics.com', isVerified: true },
    { name: 'Office Depot Solutions', email: 'orders@officedepot.com', isVerified: true },
  ];

  const vendors = [];
  for (const v of vendorData) {
    const created = await prisma.vendor.create({ data: v });
    vendors.push(created);
  }

  // ─── Purchase Orders (10 minimum) ───────────────────
  console.log('📦 Creating 12 Purchase Orders...');
  const pos = [];
  const poStatuses = ['open', 'delivered', 'closed'];

  for (let i = 1; i <= 12; i++) {
    const vendor = vendors[Math.floor(Math.random() * vendors.length)];
    const amount = Math.floor(Math.random() * 15000) + 1000;
    
    const po = await prisma.purchaseOrder.create({
      data: {
        poNumber: `PO-${100 + i}`,
        vendorId: vendor.id,
        approvedAmount: amount,
        remainingAmount: amount,
        currency: 'USD',
        description: `Bulk procurement for project ${String.fromCharCode(65 + (i % 26))}`,
        status: poStatuses[i % 3],
        lineItems: {
          create: [
            { description: 'Item Alpha', qty: 5, unitPrice: amount / 10, total: amount / 2 },
            { description: 'Item Beta', qty: 2, unitPrice: amount / 4, total: amount / 2 },
          ]
        }
      }
    });
    pos.push(po);
  }

  // ─── Invoices (50 minimum) ──────────────────────────
  console.log('📄 Creating 55 Invoices...');
  const invoiceStatuses = ['received', 'approved', 'rejected', 'paid', 'payment_processing'];

  for (let i = 1; i <= 55; i++) {
    const vendor = vendors[Math.floor(Math.random() * vendors.length)];
    const status = invoiceStatuses[i % 5];
    const amount = Math.floor(Math.random() * 5000) + 100;
    
    // Link to a PO for roughly 60% of invoices
    const shouldLinkPO = Math.random() > 0.4;
    const po = shouldLinkPO ? pos[Math.floor(Math.random() * pos.length)] : null;

    await prisma.invoice.create({
      data: {
        invoiceNumber: `INV-${2000 + i}`,
        vendorId: vendor.id,
        matchedPoId: po?.id,
        poNumber: po?.poNumber,
        invoiceDate: new Date(Date.now() - Math.floor(Math.random() * 10000000000)),
        totalAmount: amount,
        amountPaid: status === 'paid' ? amount : 0,
        amountDue: status === 'paid' ? 0 : amount,
        status: status,
        lineItems: {
          create: [
            { description: `Service/Product Line ${i}`, qty: 1, unitPrice: amount, total: amount },
          ]
        }
      }
    });
  }

  console.log('✨ Seed complete!');
  console.log(`Created: ${vendors.length} Vendors, ${pos.length} POs, 55 Invoices`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
