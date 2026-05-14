import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma.js';
import { ApiError, ApiResponse, asyncHandler } from '../utils/helpers.js';

// ─── Schemas ──────────────────────────────────────────
const createInvoiceSchema = z.object({
  invoiceNumber: z.string().min(1),
  poNumber: z.string().optional().or(z.literal('')),
  vendorId: z.string().optional().or(z.literal('')),
  matchedPoId: z.string().optional().or(z.literal('')),
  vendorName: z.string().optional().nullable(),
  vendorEmail: z.string().email().optional().or(z.literal('')).nullable(),
  vendorPhone: z.string().optional().nullable(),
  vendorAddress: z.string().optional().nullable(),
  billToCompany: z.string().optional().nullable(),
  billToEmail: z.string().optional().nullable(),
  billToAddress: z.string().optional().nullable(),
  shipToCompany: z.string().optional().nullable(),
  shipToAddress: z.string().optional().nullable(),
  shipToPhone: z.string().optional().nullable(),
  invoiceDate: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  paymentTerms: z.string().optional().nullable(),
  currency: z.string().optional().nullable(),
  subtotal: z.coerce.number().optional().nullable(),
  discount: z.coerce.number().optional().nullable(),
  taxRate: z.coerce.number().optional().nullable(),
  taxAmount: z.coerce.number().optional().nullable(),
  shipping: z.coerce.number().optional().nullable(),
  totalAmount: z.coerce.number(),
  amountDue: z.coerce.number().optional().nullable(),
  lineItems: z.array(z.any()).optional().nullable(),
  bankName: z.string().optional().nullable(),
  accountName: z.string().optional().nullable(),
  accountNumber: z.string().optional().nullable(),
  routingNumber: z.string().optional().nullable(),
  paymentMethod: z.string().optional().nullable(),
  aiConfidence: z.coerce.number().optional().nullable(),
  notes: z.string().optional().nullable(),
  driveFileId: z.string().optional().nullable(),
});

const updateStatusSchema = z.object({
  status: z.enum(['received', 'processing', 'validated', 'approved', 'review_pending', 'rejected', 'payment_processing', 'paid', 'cancelled']),
  flags: z.array(z.string()).optional(),
  rejectionReason: z.string().optional(),
});

// ─── Get All Invoices ─────────────────────────────────
export const getAllInvoices = asyncHandler(async (req: Request, res: Response) => {
  const { status, vendorId } = req.query;

  const where: any = {};
  if (status) where.status = status as string;
  if (vendorId) where.vendorId = vendorId as string;

  const invoices = await prisma.invoice.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      vendor: { select: { id: true, name: true, email: true } },
      matchedPo: { select: { id: true, poNumber: true, approvedAmount: true, remainingAmount: true, status: true } },
      payments: { select: { id: true, amountPaid: true, status: true, paidAt: true } }
    }
  });

  return res.json(new ApiResponse(200, 'Invoices fetched', { invoices, total: invoices.length }));
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

// ─── Get Invoice By Number (n8n use ) ────────
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

// ─── Get Approved Unpaid (Daily cron n8n use )
export const getApprovedUnpaid = asyncHandler(async (req: Request, res: Response) => {
  const where = {
    status: 'approved',
    payments: {
      none: { status: { in: ['paid', 'completed'] } }
    }
  };

  const invoices = await prisma.invoice.findMany({
    where,
    include: {
      vendor: { select: { id: true, name: true, email: true } },
      matchedPo: { select: { id: true, poNumber: true, remainingAmount: true } },
      payments: true
    },
    orderBy: { updatedAt: 'asc' }
  });

  return res.json(new ApiResponse(200, 'Approved unpaid invoices', {
    invoices,
    total: invoices.length
  }));
});

// ─── Check Duplicate (n8n use ) ─────────────
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

  // 1. Resolve Existing Vendor ONLY (Do NOT create)
  let finalVendorId = data.vendorId;

  if (finalVendorId) {
    const v = await prisma.vendor.findUnique({ where: { id: finalVendorId } });
    if (!v) finalVendorId = undefined;
  }

  if (!finalVendorId && (data.vendorEmail || data.vendorName)) {
    const v = await prisma.vendor.findFirst({
      where: {
        OR: [
          data.vendorEmail ? { email: data.vendorEmail } : {},
          data.vendorName ? { name: { equals: data.vendorName, mode: 'insensitive' } } : {}
        ].filter(cond => Object.keys(cond).length > 0) as any
      }
    });
    if (v) finalVendorId = v.id;
  }

  // 2. Resolve PO (Auto-match by poNumber if matchedPoId is missing)
  let finalPoId = data.matchedPoId;
  if (!finalPoId && data.poNumber) {
    const po = await prisma.purchaseOrder.findFirst({
      where: { poNumber: { equals: data.poNumber, mode: 'insensitive' } }
    });
    if (po) finalPoId = po.id;
  }

  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber: data.invoiceNumber,
      poNumber:      data.poNumber,
      vendorId:      finalVendorId ?? undefined,
      matchedPoId:   finalPoId ?? undefined,
      billToCompany: data.billToCompany ?? undefined,
      billToEmail:   data.billToEmail ?? undefined,
      billToAddress: data.billToAddress ?? undefined,
      shipToCompany: data.shipToCompany ?? undefined,
      shipToAddress: data.shipToAddress ?? undefined,
      shipToPhone:   data.shipToPhone ?? undefined,
      invoiceDate:   data.invoiceDate ? new Date(data.invoiceDate) : null,
      dueDate:       data.dueDate ? new Date(data.dueDate) : null,
      paymentTerms:  data.paymentTerms ?? undefined,
      currency:      data.currency || 'USD',
      subtotal:      data.subtotal ?? 0,
      discount:      data.discount ?? 0,
      taxRate:       data.taxRate ?? 0,
      taxAmount:     data.taxAmount ?? 0,
      shipping:      data.shipping ?? 0,
      totalAmount:   data.totalAmount,
      amountDue:     data.amountDue ?? 0,
      bankName:      data.bankName ?? undefined,
      accountName:   data.accountName ?? undefined,
      accountNumber: data.accountNumber ?? undefined,
      routingNumber: data.routingNumber ?? undefined,
      paymentMethod: data.paymentMethod ?? undefined,
      aiConfidence:  data.aiConfidence ?? undefined,
      notes:         data.notes ?? undefined,
      driveFileId:   data.driveFileId ?? undefined,
      lineItems:     data.lineItems ? { create: data.lineItems } : undefined,
      status:        'received',
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

  // Handle lineItems sync if provided
  if (data.lineItems) {
    await prisma.invoiceLineItem.deleteMany({
      where: { invoiceId: req.params.id as string }
    });
  }

  const invoice = await prisma.invoice.update({
    where: { id: req.params.id as string },
    data: {
      invoiceNumber: data.invoiceNumber,
      poNumber:      data.poNumber,
      vendorId:      data.vendorId ?? undefined,
      matchedPoId:   data.matchedPoId ?? undefined,
      billToCompany: data.billToCompany ?? undefined,
      billToEmail:   data.billToEmail ?? undefined,
      billToAddress: data.billToAddress ?? undefined,
      shipToCompany: data.shipToCompany ?? undefined,
      shipToAddress: data.shipToAddress ?? undefined,
      shipToPhone:   data.shipToPhone ?? undefined,
      invoiceDate:   data.invoiceDate ? new Date(data.invoiceDate) : undefined,
      dueDate:       data.dueDate ? new Date(data.dueDate) : undefined,
      paymentTerms:  data.paymentTerms ?? undefined,
      currency:      data.currency ?? undefined,
      subtotal:      data.subtotal ?? undefined,
      discount:      data.discount ?? undefined,
      taxRate:       data.taxRate ?? undefined,
      taxAmount:     data.taxAmount ?? undefined,
      shipping:      data.shipping ?? undefined,
      totalAmount:   data.totalAmount,
      amountDue:     data.amountDue ?? undefined,
      bankName:      data.bankName ?? undefined,
      accountName:   data.accountName ?? undefined,
      accountNumber: data.accountNumber ?? undefined,
      routingNumber: data.routingNumber ?? undefined,
      paymentMethod: data.paymentMethod ?? undefined,
      aiConfidence:  data.aiConfidence ?? undefined,
      notes:         data.notes ?? undefined,
      driveFileId:   data.driveFileId ?? undefined,
      lineItems:     data.lineItems ? { create: data.lineItems } : undefined,
    },
    include: { vendor: true, lineItems: true, matchedPo: true }
  });

  return res.json(new ApiResponse(200, 'Invoice updated', invoice));
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
