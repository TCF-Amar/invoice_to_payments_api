import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma.js';
import { ApiError, ApiResponse, asyncHandler } from '../utils/helpers.js';
import { findOrCreateVendor } from './vendor.controller.js';

// ─── Schemas ──────────────────────────────────────────
const createPOSchema = z.object({
  poNumber: z.string().min(1),
  vendorId: z.string().optional().or(z.literal('')),
  matchedPoId: z.string().optional().or(z.literal('')),
  vendorName: z.string().optional().nullable(),
  vendorEmail: z.string().email().optional().or(z.literal('')).nullable(),
  subtotal: z.coerce.number().optional().default(0),
  taxRate: z.coerce.number().optional().default(0),
  taxAmount: z.coerce.number().optional().nullable(),
  tax: z.coerce.number().optional().nullable(),
  approvedAmount: z.coerce.number().optional().nullable(),
  approvedTotal: z.coerce.number().optional().nullable(),
  currency: z.string().default('USD'),
  description: z.string().optional().nullable(),
  lineItems: z.array(z.any()).optional(),
  deliveryDate: z.string().optional().nullable(),
  status: z.enum(['open', 'delivered', 'partial', 'closed', 'cancelled', 'draft', 'pending_approval', 'approved', 'rejected']).optional(),
});

const updatePOSchema = createPOSchema.partial();

// ─── Get All POs ──────────────────────────────────────
export const getAllPOs = asyncHandler(async (req: Request, res: Response) => {
  const { status, vendorId, page = '1', limit = '10' } = req.query;

  const where: any = {};
  if (status) where.status = status as string;
  if (vendorId) where.vendorId = vendorId as string;

  const [pos, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
      orderBy: { createdAt: 'desc' },
      include: {
        vendor: { select: { id: true, name: true, email: true } },
        _count: { select: { invoices: true, payments: true } }
      }
    }),
    prisma.purchaseOrder.count({ where })
  ]);

  return res.json(new ApiResponse(200, 'Purchase orders fetched', {
    pos, total,
    page: Number(page),
    totalPages: Math.ceil(total / Number(limit))
  }));
});

// ─── Get PO By ID ─────────────────────────────────────
export const getPOById = asyncHandler(async (req: Request, res: Response) => {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: req.params.id as string },
    include: {
      vendor: true,
      invoices: { orderBy: { createdAt: 'desc' } },
      payments: { orderBy: { createdAt: 'desc' } }
    }
  });

  if (!po) throw new ApiError(404, 'Purchase order not found');

  return res.json(new ApiResponse(200, 'PO fetched', po));
});

// ─── Get PO By Number (n8n use karta hai) ─────────────
export const getPOByNumber = asyncHandler(async (req: Request, res: Response) => {
  const po = await prisma.purchaseOrder.findFirst({
    where: { poNumber: { equals: req.params.poNumber as string, mode: 'insensitive' } },
    include: { vendor: true }
  });

  if (!po) throw new ApiError(404, 'Purchase order not found');

  return res.json(new ApiResponse(200, 'PO fetched', po));
});

// ─── Create PO ────────────────────────────────────────
export const createPO = asyncHandler(async (req: Request, res: Response) => {
  const data = createPOSchema.parse(req.body);

  // Use the helper to resolve the vendor
  const vendor = await findOrCreateVendor({
    id: data.vendorId,
    name: data.vendorName, 
    email: data.vendorEmail
  });

  if (!vendor) {
    throw new ApiError(400, 'Vendor information missing (neither valid vendorId nor vendorName provided)');
  }

  // Resolve final values
  const finalApprovedAmount = data.approvedTotal || data.approvedAmount || 0;
  const finalTaxAmount = data.taxAmount || data.tax || 0;

  if (finalApprovedAmount <= 0 && data.status !== 'draft') {
    throw new ApiError(400, 'Approved total amount must be positive for non-draft POs');
  }

  // Create PO with explicit field mapping to avoid Prisma validation errors from extra fields
  const po = await prisma.purchaseOrder.create({
    data: {
      poNumber: data.poNumber,
      vendorId: vendor.id,
      subtotal: data.subtotal,
      taxRate: data.taxRate,
      taxAmount: finalTaxAmount,
      approvedAmount: finalApprovedAmount,
      remainingAmount: finalApprovedAmount,
      currency: data.currency || 'USD',
      description: data.description || null,
      status: data.status || 'open',
      deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : null,
      lineItems: data.lineItems ? { create: data.lineItems } : undefined,
    },
    include: { vendor: true }
  });

  // Audit log
  await prisma.auditLog.create({
    data: {
      entityType: 'purchase_order',
      entityId: po.id,
      eventType: 'po_created',
      actor: 'system',
      purchaseOrderId: po.id,
      metadata: { ...data, poId: po.id } as any
    }
  });

  return res.status(201).json(new ApiResponse(201, 'Purchase order created', po));
});

// ─── Update PO ────────────────────────────────────────
export const updatePO = asyncHandler(async (req: Request, res: Response) => {
  const data = updatePOSchema.parse(req.body);

  // Resolve aliased values if provided
  const finalApprovedAmount = data.approvedTotal || data.approvedAmount;
  const finalTaxAmount = data.taxAmount || data.tax;

  // Handle lineItems sync if provided
  if (data.lineItems) {
    await prisma.pOLineItem.deleteMany({
      where: { purchaseOrderId: req.params.id as string }
    });
  }

  const po = await prisma.purchaseOrder.update({
    where: { id: req.params.id as string },
    data: {
      poNumber: data.poNumber,
      vendorId: data.vendorId,
      subtotal: data.subtotal,
      taxRate: data.taxRate,
      taxAmount: finalTaxAmount,
      approvedAmount: finalApprovedAmount,
      currency: data.currency,
      description: data.description,
      status: data.status,
      deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : undefined,
      lineItems: data.lineItems ? { create: data.lineItems } : undefined,
    },
    include: { vendor: true, lineItems: true }
  });

  await prisma.auditLog.create({
    data: {
      entityType: 'purchase_order',
      entityId: po.id,
      eventType: 'po_updated',
      purchaseOrderId: po.id,
      metadata: data as any
    }
  });

  return res.json(new ApiResponse(200, 'PO updated', po));
});

// ─── Update PO Status ─────────────────────────────────
export const updatePOStatus = asyncHandler(async (req: Request, res: Response) => {
  const { status } = z.object({
    status: z.enum(['open', 'delivered', 'partial', 'closed', 'cancelled', 'draft', 'pending_approval', 'approved', 'rejected'])
  }).parse(req.body);

  const existing = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id as string } });
  if (!existing) throw new ApiError(404, 'Purchase Order not found');

  const po = await prisma.purchaseOrder.update({
    where: { id: req.params.id as string },
    data: { status }
  });

  await prisma.auditLog.create({
    data: {
      entityType: 'purchase_order',
      entityId: po.id,
      eventType: 'po_status_updated',
      purchaseOrderId: po.id,
      metadata: { oldStatus: existing.status, newStatus: status }
    }
  });

  return res.json(new ApiResponse(200, 'PO status updated', po));
});

// ─── Delete PO ────────────────────────────────────────
export const deletePO = asyncHandler(async (req: Request, res: Response) => {
  const invoiceCount = await prisma.invoice.count({
    where: { matchedPoId: req.params.id as string }
  });

  if (invoiceCount > 0) {
    throw new ApiError(400, `Cannot delete PO — ${invoiceCount} invoices linked`);
  }

  await prisma.purchaseOrder.delete({ where: { id: req.params.id as string } });

  return res.json(new ApiResponse(200, 'PO deleted', null));
});
