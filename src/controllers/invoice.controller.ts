import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma.js';
import { ApiError, ApiResponse, asyncHandler } from '../utils/helpers.js';
import Stripe from 'stripe';

// ─── Schemas ──────────────────────────────────────────
const createInvoiceSchema = z.object({
  invoiceNumber: z.string().min(1),
  poNumber: z.string().optional(),
  vendorId: z.string().uuid().optional(),
  matchedPoId: z.string().uuid().optional(),
  vendorName: z.string().optional(),
  vendorEmail: z.string().email().optional(),
  vendorPhone: z.string().optional(),
  vendorAddress: z.string().optional(),
  billToCompany: z.string().optional(),
  billToEmail: z.string().optional(),
  billToAddress: z.string().optional(),
  shipToCompany: z.string().optional(),
  shipToAddress: z.string().optional(),
  shipToPhone: z.string().optional(),
  invoiceDate: z.string().optional(),
  dueDate: z.string().optional(),
  paymentTerms: z.string().optional(),
  currency: z.string().optional(),
  subtotal: z.number().optional(),
  discount: z.number().optional(),
  taxRate: z.number().optional(),
  taxAmount: z.number().optional(),
  shipping: z.number().optional(),
  totalAmount: z.number(),
  amountDue: z.number().optional(),
  lineItems: z.array(z.any()).optional(),
  bankName: z.string().optional(),
  accountName: z.string().optional(),
  accountNumber: z.string().optional(),
  routingNumber: z.string().optional(),
  paymentMethod: z.string().optional(),
  aiConfidence: z.number().optional(),
  notes: z.string().optional(),
  driveFileId: z.string().optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(['received', 'processing', 'validated', 'approved', 'review_pending', 'rejected', 'payment_processing', 'paid', 'cancelled']),
  flags: z.array(z.string()).optional(),
  rejectionReason: z.string().optional(),
});

// ─── Get All Invoices ─────────────────────────────────
export const getAllInvoices = asyncHandler(async (req: Request, res: Response) => {
  const { status, vendorId, page = '1', limit = '10' } = req.query;

  const where: any = {};
  if (status) where.status = status as string;
  if (vendorId) where.vendorId = vendorId as string;

  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
      orderBy: { createdAt: 'desc' },
      include: {
        vendor: { select: { id: true, name: true, email: true } },
        matchedPo: { select: { id: true, poNumber: true, approvedAmount: true, remainingAmount: true, status: true } },
        payments: { select: { id: true, amountPaid: true, status: true, paidAt: true } }
      }
    }),
    prisma.invoice.count({ where })
  ]);

  return res.json(new ApiResponse(200, 'Invoices fetched', {
    invoices, total,
    page: Number(page),
    totalPages: Math.ceil(total / Number(limit))
  }));
});

// ─── Get Invoice By ID ────────────────────────────────
export const getInvoiceById = asyncHandler(async (req: Request, res: Response) => {
  const invoice = await prisma.invoice.findUnique({
    where: { id: req.params.id as string },
    include: {
      vendor: true,
      matchedPo: true,
      payments: true,
      auditLogs: { orderBy: { createdAt: 'desc' } }
    }
  });

  if (!invoice) throw new ApiError(404, 'Invoice not found');

  return res.json(new ApiResponse(200, 'Invoice fetched', invoice));
});

// ─── Get Invoice By Number (n8n use karta hai) ────────
export const getInvoiceByNumber = asyncHandler(async (req: Request, res: Response) => {
  const invoice = await prisma.invoice.findFirst({
    where: { invoiceNumber: { equals: req.params.invoiceNumber as string, mode: 'insensitive' } },
    include: {
      vendor: true,
      matchedPo: true,
      payments: true,
      auditLogs: { orderBy: { createdAt: 'desc' } }
    }
  });

  if (!invoice) throw new ApiError(404, 'Invoice not found');

  return res.json(new ApiResponse(200, 'Invoice fetched', invoice));
});

// ─── Get Approved Unpaid (Daily cron n8n use karta hai)
export const getApprovedUnpaid = asyncHandler(async (req: Request, res: Response) => {
  const { page = '1', limit = '10' } = req.query;

  const where = {
    status: 'approved',
    payments: {
      none: { status: { in: ['paid', 'completed'] } }
    }
  };

  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
      include: {
        vendor: { select: { id: true, name: true, email: true } },
        matchedPo: { select: { id: true, poNumber: true, remainingAmount: true } },
        payments: true
      },
      orderBy: { updatedAt: 'asc' }
    }),
    prisma.invoice.count({ where })
  ]);

  return res.json(new ApiResponse(200, 'Approved unpaid invoices', {
    invoices,
    total,
    page: Number(page),
    totalPages: Math.ceil(total / Number(limit))
  }));
});

// ─── Check Duplicate (n8n use karta hai) ─────────────
export const checkDuplicate = asyncHandler(async (req: Request, res: Response) => {
  const existing = await prisma.invoice.findFirst({
    where: { invoiceNumber: req.params.invoiceNumber as string }
  });

  return res.json(new ApiResponse(200, 'Duplicate check', {
    isDuplicate: !!existing,
    existing: existing ?? null
  }));
});

// ─── Create Invoice (n8n → after AI extraction) ───────
export const createInvoice = asyncHandler(async (req: Request, res: Response) => {
  const data = createInvoiceSchema.parse(req.body);

  // Duplicate check
  const existing = await prisma.invoice.findFirst({
    where: { invoiceNumber: data.invoiceNumber }
  });
  if (existing) throw new ApiError(409, `Invoice ${data.invoiceNumber} already exists`);

  const invoice = await prisma.invoice.create({
    data: {
      ...data,
      invoiceDate: data.invoiceDate ? new Date(data.invoiceDate) : null,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      lineItems: data.lineItems ? { create: data.lineItems } : undefined,
      status: 'received',
    },
    include: {
      vendor: true,
      matchedPo: true,
      payments: true,
    }
  });

  // Audit log
  await prisma.auditLog.create({
    data: {
      entityType: 'invoice',
      entityId: invoice.id,
      eventType: 'invoice_created',
      actor: 'system',
      invoiceId: invoice.id,
      metadata: { ...data, _httpStatus: 201 } as any
    }
  });

  return res.status(201).json(new ApiResponse(201, 'Invoice created', invoice));
});

// ─── Update Invoice Status (n8n verdict ke baad) ──────
export const updateInvoiceStatus = asyncHandler(async (req: Request, res: Response) => {
  const { status, flags, rejectionReason } = updateStatusSchema.parse(req.body);

  const invoice = await prisma.invoice.update({
    where: { id: req.params.id as string },
    data: {
      status,
      flags: flags ?? [],
      rejectionReason: rejectionReason ?? null,
    }
  });

  // Update PO status if invoice approved
  if (status === 'approved' && invoice.matchedPoId) {
    await prisma.purchaseOrder.update({
      where: { id: invoice.matchedPoId },
      data: { status: 'delivered' }
    });
  }

  await prisma.auditLog.create({
    data: {
      entityType: 'invoice',
      entityId: invoice.id,
      eventType: `invoice_${status}`,
      actor: 'n8n',
      invoiceId: invoice.id,
      metadata: { status, flags, rejectionReason } as any
    }
  });

  return res.json(new ApiResponse(200, `Invoice status updated to ${status}`, invoice));
});

// ─── Update Invoice (general) ─────────────────────────
export const updateInvoice = asyncHandler(async (req: Request, res: Response) => {
  const data = createInvoiceSchema.partial().parse(req.body);

  const invoice = await prisma.invoice.update({
    where: { id: req.params.id as string },
    data: {
      ...data,
      invoiceDate: data.invoiceDate ? new Date(data.invoiceDate) : undefined,
      dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
    } as any
  });

  return res.json(new ApiResponse(200, 'Invoice updated', invoice));
});

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

// ─── Automation Helpers (n8n use karta hai) ───────────

// 1. Create Payment Intent
export const createPaymentIntent = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { amount, currency } = req.body;

  // 1. Create Stripe Payment Intent
  const intent = await stripe.paymentIntents.create({
    amount: Math.round(Number(amount) * 100), // Convert to cents
    currency: currency || 'usd',
    metadata: { invoiceId: id }
  });

  // 2. Create Payment record in DB
  const payment = await prisma.payment.create({
    data: {
      invoiceId: id,
      amountPaid: amount,
      currency: currency || 'USD',
      status: 'processing',
      stripeId: intent.id
    }
  });

  return res.json(new ApiResponse(200, 'Stripe Payment Intent created', {
    paymentId: payment.id,
    paymentIntentId: intent.id,
    clientSecret: intent.client_secret
  }));
});

// 2. Mark Payment Pending
export const markPaymentPending = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  await prisma.invoice.update({
    where: { id },
    data: { status: 'payment_processing' }
  });
  return res.json(new ApiResponse(200, 'Invoice status updated to processing', null));
});

// 3. Mark Failed
export const markFailed = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { failureReason } = req.body;

  await prisma.invoice.update({
    where: { id },
    data: { status: 'approved', rejectionReason: failureReason }
  });

  return res.json(new ApiResponse(200, 'Invoice reverted to approved', null));
});

// 4. Stripe Payment Success (Called by webhook)
export const stripePaymentSuccess = asyncHandler(async (req: Request, res: Response) => {
  const { stripePaymentIntentId, amountReceived } = req.body;

  const payment = await prisma.payment.findFirst({
    where: { stripeId: stripePaymentIntentId }
  });

  if (payment) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'paid', paidAt: new Date() }
    });

    if (payment.invoiceId) {
      const invoice = await prisma.invoice.findUnique({ where: { id: payment.invoiceId } });
      if (invoice) {
        const newTotalPaid = Number(invoice.amountPaid) + (amountReceived / 100);
        await prisma.invoice.update({
          where: { id: payment.invoiceId },
          data: {
            status: 'paid',
            amountPaid: newTotalPaid,
            amountDue: Math.max(0, Number(invoice.totalAmount) - newTotalPaid)
          }
        });
      }
    }
  }

  return res.json(new ApiResponse(200, 'Payment success recorded', null));
});

// ─── Delete Invoice ───────────────────────────────────
export const deleteInvoice = asyncHandler(async (req: Request, res: Response) => {
  const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id as string } });
  if (!invoice) throw new ApiError(404, 'Invoice not found');

  if (['paid', 'payment_processing'].includes(invoice.status)) {
    throw new ApiError(400, 'Cannot delete invoice with payment in progress');
  }

  await prisma.invoice.delete({ where: { id: req.params.id as string } });

  return res.json(new ApiResponse(200, 'Invoice deleted', null));
});
