import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma.js';
import { ApiError, ApiResponse, asyncHandler } from '../utils/helpers.js';

// ─────────────────────────────────────────────────────────────
// STATUS LIFECYCLE
//
//   draft  →  pending_approval  →  approved  →  open  →  delivered
//                              ↘  rejected                  ↓
//                                                         partial
//                                                           ↓
//                                                         closed
//                                              (any) →  cancelled
// ─────────────────────────────────────────────────────────────

const PO_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'rejected',
  'open',
  'partial',
  'delivered',
  'closed',
  'cancelled',
] as const;

type POStatus = (typeof PO_STATUSES)[number];

/** Allowed forward transitions per status */
const ALLOWED_TRANSITIONS: Record<POStatus, POStatus[]> = {
  draft: ['pending_approval', 'approved', 'cancelled'],
  pending_approval: ['approved', 'rejected', 'cancelled'],
  approved: ['open', 'cancelled'],
  rejected: ['draft', 'cancelled'],
  open: ['partial', 'delivered', 'closed', 'cancelled'],
  partial: ['delivered', 'closed', 'cancelled'],
  delivered: ['closed', 'cancelled'],
  closed: [],
  cancelled: [],
};

// ─── Schemas ──────────────────────────────────────────────────

/** Inline vendor payload – used when vendorId is absent */
const inlineVendorSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  gstin: z.string().optional(),
  bankName: z.string().optional(),
  accountName: z.string().optional(),
  accountNumber: z.string().optional(),
  routingNumber: z.string().optional(),
});

const lineItemSchema = z.object({
  description: z.string().min(1),
  qty: z.coerce.number().positive(),
  unitPrice: z.coerce.number().positive(),
  total: z.coerce.number().positive(),
});

const createPOSchema = z.object({
  poNumber: z.string().min(1),
  /** Pass vendorId (UUID) OR vendor object – one of the two is required */
  vendorId: z.string().uuid().optional(),
  vendor: inlineVendorSchema.optional(),
  approvedAmount: z.coerce.number().positive(),
  taxRate: z.coerce.number().optional().default(0),
  taxAmount: z.coerce.number().optional().default(0),
  currency: z.string().default('USD'),
  description: z.string().optional(),
  lineItems: z.array(lineItemSchema).optional(),
  deliveryDate: z.string().optional(),
  /**
   * Initial status.
   * Defaults to "draft". Use "pending_approval" to submit straight away.
   */
  status: z
    .enum(PO_STATUSES)
    .optional()
    .default('draft'),
}).refine(
  (d) => d.vendorId !== undefined || d.vendor !== undefined,
  { message: 'Provide either vendorId or a vendor object to create one automatically.' }
);

const updatePOSchema = z.object({
  poNumber: z.string().min(1).optional(),
  approvedAmount: z.coerce.number().positive().optional(),
  taxRate: z.coerce.number().optional(),
  taxAmount: z.coerce.number().optional(),
  currency: z.string().optional(),
  description: z.string().optional(),
  deliveryDate: z.string().optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(PO_STATUSES),
  reason: z.string().optional(),  // required for rejection
  actor: z.string().optional().default('system'),
});

// ─── Internal Helpers ─────────────────────────────────────────

/**
 * Resolve or auto-create a vendor.
 * Priority: vendorId → email lookup → name lookup → create new
 */
async function resolveOrCreateVendor(
  vendorId?: string,
  vendorPayload?: z.infer<typeof inlineVendorSchema>
): Promise<{ vendor: any; wasCreated: boolean }> {
  // 1. Explicit UUID provided – just verify it exists
  if (vendorId) {
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new ApiError(404, `Vendor with id ${vendorId} not found`);
    return { vendor, wasCreated: false };
  }

  // 2. Inline vendor payload
  const vp = vendorPayload!; // refine() guarantees at least one is present

  // 2a. Try to find by email
  if (vp.email) {
    const existing = await prisma.vendor.findUnique({ where: { email: vp.email } });
    if (existing) return { vendor: existing, wasCreated: false };
  }

  // 2b. Try to find by name (case-insensitive)
  const existingByName = await prisma.vendor.findFirst({
    where: { name: { equals: vp.name, mode: 'insensitive' } },
  });
  if (existingByName) return { vendor: existingByName, wasCreated: false };

  // 2c. Auto-create the vendor
  const newVendor = await prisma.vendor.create({
    data: {
      name: vp.name,
      email: vp.email,
      phone: vp.phone,
      address: vp.address,
      bankName: vp.bankName,
      accountName: vp.accountName,
      accountNumber: vp.accountNumber,
      routingNumber: vp.routingNumber,
      isVerified: false,
    },
  });

  return { vendor: newVendor, wasCreated: true };
}

/** Write an audit record for a PO event */
async function auditPO(
  poId: string,
  eventType: string,
  metadata: Record<string, unknown>,
  actor = 'system'
) {
  await prisma.auditLog.create({
    data: {
      entityType: 'purchase_order',
      entityId: poId,
      purchaseOrderId: poId,
      eventType,
      actor,
      metadata: metadata as any,
    },
  });
}

// ─── Get All POs ──────────────────────────────────────────────
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
        lineItems: true,
        _count: { select: { invoices: true, payments: true } },
      },
    }),
    prisma.purchaseOrder.count({ where }),
  ]);

  return res.json(
    new ApiResponse(200, 'Purchase orders fetched', {
      pos,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
    })
  );
});

// ─── Get PO By ID ─────────────────────────────────────────────
export const getPOById = asyncHandler(async (req: Request, res: Response) => {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: req.params['id'] as string },
    include: {
      vendor: true,
      lineItems: true,
      invoices: { orderBy: { createdAt: 'desc' } },
      payments: { orderBy: { createdAt: 'desc' } },
      auditLogs: { orderBy: { createdAt: 'desc' }, take: 20 },
    },
  });

  if (!po) throw new ApiError(404, 'Purchase order not found');

  return res.json(new ApiResponse(200, 'PO fetched', po));
});

// ─── Get PO By Number (n8n uses this) ────────────────────────
export const getPOByNumber = asyncHandler(async (req: Request, res: Response) => {
  const po = await prisma.purchaseOrder.findFirst({
    where: { poNumber: { equals: req.params['poNumber'] as string, mode: 'insensitive' } },
    include: {
      vendor: true,
      lineItems: true,
    },
  });

  if (!po) throw new ApiError(404, 'Purchase order not found');

  return res.json(new ApiResponse(200, 'PO fetched', po));
});

// ─── Create PO ────────────────────────────────────────────────
/**
 * POST /api/v1/purchase-orders
 *
 * Body options:
 *   Option A – existing vendor:
 *     { poNumber, vendorId, approvedAmount, ... }
 *
 *   Option B – auto-create vendor:
 *     { poNumber, vendor: { name, email, ... }, approvedAmount, ... }
 *
 * Status flow starts at "draft" (default) or "pending_approval".
 * After creation the vendor's PO list is automatically in sync via
 * the vendorId FK (no extra work needed on the vendor bot side).
 */
export const createPO = asyncHandler(async (req: Request, res: Response) => {
  const data = createPOSchema.parse(req.body);
  console.log('🚀 ~ createPO ~ data:', data);

  // ── 1. Resolve / auto-create vendor ───────────────────────
  const { vendor, wasCreated: vendorWasCreated } = await resolveOrCreateVendor(
    data.vendorId,
    data.vendor
  );

  if (vendorWasCreated) {
    await prisma.auditLog.create({
      data: {
        entityType: 'vendor',
        entityId: vendor.id,
        eventType: 'vendor_auto_created_by_po',
        actor: 'system',
        metadata: { vendorName: vendor.name, vendorEmail: vendor.email },
      },
    });
  }

  // ── 2. Create PO ──────────────────────────────────────────
  const po = await prisma.purchaseOrder.create({
    data: {
      poNumber: data.poNumber,
      vendor: { connect: { id: vendor.id } },
      approvedAmount: data.approvedAmount,
      remainingAmount: data.approvedAmount,
      taxRate: data.taxRate ,
      taxAmount: data.taxAmount,
      currency: data.currency,
      description: data.description,
      status: data.status ?? 'draft',
      deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : null,
      lineItems: data.lineItems?.length
        ? {
          create: data.lineItems.map((li) => ({
            description: li.description,
            qty: li.qty,
            unitPrice: li.unitPrice,
            total: li.total,
          })),
        }
        : undefined,
    },
    include: {
      vendor: { select: { id: true, name: true, email: true, isVerified: true } },
      lineItems: true,
    },
  });

  // ── 3. Audit log ──────────────────────────────────────────
  await auditPO(po.id, 'po_created', {
    poNumber: po.poNumber,
    approvedAmount: po.approvedAmount,
    taxRate: (po as any).taxRate,
    taxAmount: (po as any).taxAmount,
    status: po.status,
    vendorId: vendor.id,
    vendorName: vendor.name,
    vendorAutoCreated: vendorWasCreated,
  });

  // ── 4. Vendor-bot sync metadata ───────────────────────────
  // The vendor record now has this PO linked via vendorId FK.
  // Any bot/service querying vendor with its purchaseOrders relation
  // will automatically see this PO.  We surface it in the response.
  const vendorSync = await prisma.vendor.findUnique({
    where: { id: vendor.id },
    include: {
      _count: { select: { purchaseOrders: true, invoices: true } },
    },
  });

  return res.status(201).json(
    new ApiResponse(201, 'Purchase order created', {
      po,
      vendorAutoCreated: vendorWasCreated,
      vendorSync: {
        vendorId: vendor.id,
        vendorName: vendor.name,
        totalPOs: vendorSync?._count.purchaseOrders ?? 1,
        totalInvoices: vendorSync?._count.invoices ?? 0,
      },
    })
  );
});

// ─── Update PO (fields only, no status) ──────────────────────
export const updatePO = asyncHandler(async (req: Request, res: Response) => {
  const data = updatePOSchema.parse(req.body);

  const existing = await prisma.purchaseOrder.findUnique({ where: { id: req.params['id'] as string } });
  if (!existing) throw new ApiError(404, 'Purchase order not found');

  if (['closed', 'cancelled'].includes(existing.status)) {
    throw new ApiError(400, `Cannot edit a PO in '${existing.status}' status`);
  }

  const po = await prisma.purchaseOrder.update({
    where: { id: req.params['id'] as string },
    data: {
      ...data,
      deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : undefined,
    } as any,
    include: {
      vendor: { select: { id: true, name: true, email: true } },
      lineItems: true,
    },
  });

  await auditPO(po.id, 'po_updated', data as Record<string, unknown>);

  return res.json(new ApiResponse(200, 'PO updated', po));
});

// ─── Update PO Status ─────────────────────────────────────────
/**
 * PATCH /api/v1/purchase-orders/:id/status
 *
 * Body: { status: POStatus, reason?: string, actor?: string }
 *
 * Validates the transition is allowed before persisting.
 * Rejection requires a `reason` field.
 */
export const updatePOStatus = asyncHandler(async (req: Request, res: Response) => {
  const { status: newStatus, reason, actor } = updateStatusSchema.parse(req.body);

  const existing = await prisma.purchaseOrder.findUnique({ where: { id: req.params['id'] as string } });
  if (!existing) throw new ApiError(404, 'Purchase order not found');

  const currentStatus = existing.status as POStatus;

  // Guard: closed / cancelled POs are terminal
  if (!ALLOWED_TRANSITIONS[currentStatus]?.includes(newStatus)) {
    throw new ApiError(
      400,
      `Status transition '${currentStatus}' → '${newStatus}' is not allowed. ` +
      `Allowed next statuses: [${ALLOWED_TRANSITIONS[currentStatus]?.join(', ') || 'none'}]`
    );
  }

  // Rejection must include a reason
  if (newStatus === 'rejected' && !reason) {
    throw new ApiError(400, "A 'reason' is required when rejecting a PO");
  }

  const po = await prisma.purchaseOrder.update({
    where: { id: req.params['id'] as string },
    data: { status: newStatus },
    include: {
      vendor: { select: { id: true, name: true, email: true } },
      lineItems: true,
    },
  });

  await auditPO(po.id, `po_status_${newStatus}`, {
    previousStatus: currentStatus,
    newStatus,
    reason: reason ?? null,
    actor: actor ?? 'system',
  }, actor);

  return res.json(new ApiResponse(200, `PO status updated to '${newStatus}'`, po));
});

// ─── Approve PO (shortcut) ────────────────────────────────────
export const approvePO = asyncHandler(async (req: Request, res: Response) => {
  const { actor } = z.object({ actor: z.string().optional() }).parse(req.body);

  const existing = await prisma.purchaseOrder.findUnique({ where: { id: req.params['id'] as string } });
  if (!existing) throw new ApiError(404, 'Purchase order not found');
  if (!['pending_approval', 'draft'].includes(existing.status)) {
    throw new ApiError(400, `PO must be in 'pending_approval' or 'draft' to approve. Current: '${existing.status}'`);
  }

  const po = await prisma.purchaseOrder.update({
    where: { id: req.params['id'] as string },
    data: { status: 'approved' },
    include: { vendor: true, lineItems: true },
  });

  await auditPO(po.id, 'po_approved', {
    previousStatus: existing.status,
    newStatus: 'approved',
    actor: actor ?? 'admin',
  }, actor ?? 'admin');

  return res.json(new ApiResponse(200, 'PO approved', po));
});

// ─── Reject PO (shortcut) ─────────────────────────────────────
export const rejectPO = asyncHandler(async (req: Request, res: Response) => {
  const { reason, actor } = z.object({
    reason: z.string().min(1),
    actor: z.string().optional(),
  }).parse(req.body);

  const existing = await prisma.purchaseOrder.findUnique({ where: { id: req.params['id'] as string } });
  if (!existing) throw new ApiError(404, 'Purchase order not found');
  if (existing.status !== 'pending_approval') {
    throw new ApiError(400, `PO must be in 'pending_approval' to reject. Current: '${existing.status}'`);
  }

  const po = await prisma.purchaseOrder.update({
    where: { id: req.params['id'] as string },
    data: { status: 'rejected' },
    include: { vendor: true, lineItems: true },
  });

  await auditPO(po.id, 'po_rejected', {
    previousStatus: 'pending_approval',
    newStatus: 'rejected',
    reason,
    actor: actor ?? 'admin',
  }, actor ?? 'admin');

  return res.json(new ApiResponse(200, 'PO rejected', po));
});

// ─── Submit PO for Approval ───────────────────────────────────
export const submitPOForApproval = asyncHandler(async (req: Request, res: Response) => {
  const { actor } = z.object({ actor: z.string().optional() }).parse(req.body);

  const existing = await prisma.purchaseOrder.findUnique({ where: { id: req.params['id'] as string } });
  if (!existing) throw new ApiError(404, 'Purchase order not found');

  if (!(['draft', 'rejected'] as string[]).includes(existing.status)) {
    throw new ApiError(
      400,
      `PO must be in 'draft' or 'rejected' status to submit for approval. Current: '${existing.status}'`
    );
  }

  const po = await prisma.purchaseOrder.update({
    where: { id: req.params['id'] as string },
    data: { status: 'pending_approval' },
    include: { vendor: true, lineItems: true },
  });

  await auditPO(po.id, 'po_submitted_for_approval', {
    previousStatus: existing.status,
    newStatus: 'pending_approval',
    actor: actor ?? 'system',
  }, actor);

  return res.json(new ApiResponse(200, 'PO submitted for approval', po));
});

// ─── Vendor-Bot Sync Endpoint ─────────────────────────────────
/**
 * GET /api/v1/purchase-orders/vendor-sync/:vendorId
 *
 * Returns all POs for a vendor plus vendor meta.
 * Used by n8n / vendor bots to confirm sync state.
 */
export const getVendorPOSync = asyncHandler(async (req: Request, res: Response) => {
  const vendor = await prisma.vendor.findUnique({
    where: { id: req.params['vendorId'] as string },
    include: {
      purchaseOrders: {
        orderBy: { createdAt: 'desc' },
        include: { lineItems: true, _count: { select: { invoices: true, payments: true } } },
      },
      _count: { select: { purchaseOrders: true, invoices: true } },
    },
  });

  if (!vendor) throw new ApiError(404, 'Vendor not found');

  const summary = {
    draft: 0,
    pending_approval: 0,
    approved: 0,
    rejected: 0,
    open: 0,
    partial: 0,
    delivered: 0,
    closed: 0,
    cancelled: 0,
  } as Record<string, number>;

  for (const po of vendor.purchaseOrders) {
    summary[po.status] = (summary[po.status] ?? 0) + 1;
  }

  return res.json(
    new ApiResponse(200, 'Vendor-PO sync data', {
      vendor: {
        id: vendor.id,
        name: vendor.name,
        email: vendor.email,
        isVerified: vendor.isVerified,
        totalPOs: vendor._count.purchaseOrders,
        totalInvoices: vendor._count.invoices,
      },
      statusSummary: summary,
      purchaseOrders: vendor.purchaseOrders,
    })
  );
});

// ─── Delete PO ────────────────────────────────────────────────
export const deletePO = asyncHandler(async (req: Request, res: Response) => {
  const existing = await prisma.purchaseOrder.findUnique({ where: { id: req.params['id'] as string } });
  if (!existing) throw new ApiError(404, 'Purchase order not found');

  if (!(['draft', 'cancelled', 'rejected'] as string[]).includes(existing.status)) {
    throw new ApiError(
      400,
      `Only draft, rejected, or cancelled POs can be deleted. Current status: '${existing.status}'`
    );
  }

  const invoiceCount = await prisma.invoice.count({
    where: { matchedPoId: req.params['id'] as string },
  });

  if (invoiceCount > 0) {
    throw new ApiError(400, `Cannot delete PO — ${invoiceCount} invoice(s) are linked to it`);
  }

  await prisma.purchaseOrder.delete({ where: { id: req.params['id'] as string } });

  return res.json(new ApiResponse(200, 'PO deleted', null));
});
