import { Request, Response } from 'express';
import prisma from '../utils/prisma.js';
import { ApiResponse, asyncHandler } from '../utils/helpers.js';

/**
 * Get Dashboard Overview Statistics
 * Aggregates counts and totals for Invoices, POs, and Vendors.
 */
export const getDashboardStats = asyncHandler(async (req: Request, res: Response) => {
  // 1. Invoice Stats
  const invoiceStats = await prisma.invoice.groupBy({
    by: ['status'],
    _count: { _all: true },
    _sum: { totalAmount: true }
  });

  const formattedInvoices = {
    pending: { count: 0, amount: 0 },
    paid: { count: 0, amount: 0 },
    rejected: { count: 0, amount: 0 },
    total: { count: 0, amount: 0 }
  };

  invoiceStats.forEach(stat => {
    const amount = Number(stat._sum.totalAmount || 0);
    const count = stat._count._all;

    formattedInvoices.total.count += count;
    formattedInvoices.total.amount += amount;

    if (['received', 'processing', 'validated', 'approved', 'review_pending'].includes(stat.status)) {
      formattedInvoices.pending.count += count;
      formattedInvoices.pending.amount += amount;
    } else if (stat.status === 'paid') {
      formattedInvoices.paid.count += count;
      formattedInvoices.paid.amount += amount;
    } else if (stat.status === 'rejected') {
      formattedInvoices.rejected.count += count;
      formattedInvoices.rejected.amount += amount;
    }
  });

  // 2. Purchase Order Stats
  const poStats = await prisma.purchaseOrder.aggregate({
    _count: { _all: true },
    _sum: { approvedAmount: true, remainingAmount: true }
  });

  // 3. Vendor Stats
  const vendorCount = await prisma.vendor.count();

  // 4. Ticket Stats
  const ticketStats = await prisma.ticket.groupBy({
    by: ['status'],
    _count: { _all: true }
  });

  const formattedTickets = {
    open: ticketStats.find(s => s.status === 'open')?._count._all || 0,
    closed: ticketStats.find(s => s.status === 'closed')?._count._all || 0,
    total: ticketStats.reduce((acc, s) => acc + s._count._all, 0)
  };

  return res.json(new ApiResponse(200, 'Dashboard stats fetched', {
    invoices: formattedInvoices,
    purchaseOrders: {
      count: poStats._count._all,
      totalApproved: Number(poStats._sum.approvedAmount || 0),
      totalRemaining: Number(poStats._sum.remainingAmount || 0)
    },
    vendors: {
      count: vendorCount
    },
    tickets: formattedTickets
  }));
});

/**
 * Get Recent Activity
 * Returns the latest invoices and tickets.
 */
export const getRecentActivity = asyncHandler(async (req: Request, res: Response) => {
  const [invoices, tickets] = await Promise.all([
    prisma.invoice.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: { vendor: { select: { name: true } } }
    }),
    prisma.ticket.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: { vendor: { select: { name: true } } }
    })
  ]);

  return res.json(new ApiResponse(200, 'Recent activity fetched', {
    recentInvoices: invoices,
    recentTickets: tickets
  }));
});

/**
 * Get Invoice Trends
 * Provides monthly totals for the last 6 months for "Paid" vs "Pending" invoices.
 */
export const getInvoiceTrends = asyncHandler(async (req: Request, res: Response) => {
  // Get date 6 months ago
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
  sixMonthsAgo.setDate(1);
  sixMonthsAgo.setHours(0, 0, 0, 0);

  const invoices = await prisma.invoice.findMany({
    where: {
      createdAt: { gte: sixMonthsAgo }
    },
    select: {
      status: true,
      totalAmount: true,
      createdAt: true
    }
  });

  // Initialize months map
  const monthsMap: Record<string, { month: string, paid: number, pending: number }> = {};
  for (let i = 0; i < 6; i++) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
    const label = d.toLocaleString('default', { month: 'short', year: '2-digit' });
    monthsMap[key] = { month: label, paid: 0, pending: 0 };
  }

  invoices.forEach(inv => {
    const date = new Date(inv.createdAt);
    const key = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
    
    if (monthsMap[key]) {
      const amount = Number(inv.totalAmount || 0);
      if (inv.status === 'paid') {
        monthsMap[key].paid += amount;
      } else if (inv.status !== 'rejected') {
        monthsMap[key].pending += amount;
      }
    }
  });

  // Convert to array and sort by date
  const trends = Object.keys(monthsMap)
    .sort()
    .map(key => monthsMap[key]);

  return res.json(new ApiResponse(200, 'Invoice trends fetched', trends));
});
