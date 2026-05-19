import { Request, Response } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma.js';

import { ApiError, ApiResponse, asyncHandler } from '../utils/helpers.js';

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
  const { page = '1', limit = '100' } = req.query;

  const where = {
    status: 'approved',
    payments: {
      none: { status: { in: ['processing', 'pending'] } }
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

// ─── Generate Upload Link (Trigger n8n) ───────────
const generateUploadLinkSchema = z.object({
  vendorEmail: z.string().email(),
  poNumber: z.string().min(1),
  expiresIn: z.enum(['1h', '24h', '7d']).default('24h'),
  vendorName: z.string().optional(),
  vendorId: z.string().uuid().optional(),
});

export const generateUploadLink = asyncHandler(async (req: Request, res: Response) => {
  const data = generateUploadLinkSchema.parse(req.body);

  const n8nWebhookUrl = `${process.env['N8N__WEBHOOK_URL']}/send-invoice-link`;
  if (!n8nWebhookUrl) {
    throw new ApiError(500, 'N8N upload link webhook URL is not configured');
  }

  const secret = process.env['API_SECRET'] || 'super-secret-key';

  // 1. Generate JWT token
  const payload = {
    vendorEmail: data.vendorEmail,
    poNumber: data.poNumber,
    vendorId: data.vendorId,
    purpose: 'invoice_upload'
  };

  const token = jwt.sign(payload, secret, { expiresIn: data.expiresIn as any });

  // Decode to get exact exp timestamp for the response
  const decoded = jwt.decode(token) as { iat: number, exp: number };
  const createdAt = new Date(decoded.iat * 1000);
  const expiresAt = new Date(decoded.exp * 1000);

  // 2. Construct the upload link
  const frontendUrl = process.env['FRONTEND_URL'] || 'http://localhost:5173';
  const uploadUrl = `${frontendUrl}/upload-invoice?token=${token}`;

  // 3. Call n8n webhook (non-blocking)
  let n8nResponse: any = { success: false };
  let n8nError = null;

  try {
    const response = await fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...data,
        token,
        uploadUrl,
        expiresAt: expiresAt.toISOString(),
        createdAt: createdAt.toISOString(),
        source: 'api',
      }),
    });

    try {
      n8nResponse = await response.json();
    } catch (e) {
      n8nResponse = { success: response.ok, status: response.status };
    }

    if (!response.ok) {
      n8nError = `N8N responded with status ${response.status}`;
    }
  } catch (error: any) {
    console.error('N8N Connection Error:', error);
    n8nError = error.message;
  }

  // 4. Log to audit
  if (data.vendorId) {
    await prisma.auditLog.create({
      data: {
        entityType: 'vendor',
        entityId: data.vendorId,
        eventType: 'upload_link_requested',
        actor: 'system',
        metadata: { ...data, token, uploadUrl, expiresAt, n8nResponse, n8nError } as any,
      },
    });
  }

  // 5. Return response matching GeneratedLinkMetadata
  return res.json(new ApiResponse(200, 'Invoice upload link generated', {
    token,
    url: uploadUrl,
    expiresAt: expiresAt.toISOString(),
    createdAt: createdAt.toISOString(),
    vendorEmail: data.vendorEmail,
    poNumber: data.poNumber,
    n8nStatus: {
      sent: !n8nError,
      response: n8nResponse,
      error: n8nError
    }
  }));
});

// ─── Validate Upload Token ──────────────────────────
export const validateUploadToken = asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.params;

  if (!token) throw new ApiError(400, 'Token is required');

  const secret = process.env['API_SECRET'] || 'super-secret-key';

  try {
    const decoded = jwt.verify(token as string, secret) as any;

    if (decoded.purpose !== 'invoice_upload') {
      throw new ApiError(400, 'Invalid token purpose');
    }

    return res.json(new ApiResponse(200, 'Token is valid', {
      vendorEmail: decoded.vendorEmail,
      poNumber: decoded.poNumber,
      vendorId: decoded.vendorId,
      expiresAt: new Date(decoded.exp * 1000).toISOString(),
    }));
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      throw new ApiError(401, 'Upload link has expired');
    }
    throw new ApiError(401, 'Invalid upload link');
  }
});

// ─── Upload Invoice & Send to n8n ──────────────────
export const uploadInvoice = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) throw new ApiError(400, 'No file uploaded');

  const n8nWebhookUrl = `${process.env['N8N__WEBHOOK_URL']}/upload-invoice`;
  if (!n8nWebhookUrl) {
    throw new ApiError(500, 'N8N invoice processing webhook URL is not configured');
  }

  // Get metadata from body (e.g. from the validated token in frontend)
  const { vendorEmail, poNumber, vendorId } = req.body;

  // Prepare FormData for n8n
  const formData = new FormData();
  const blob = new Blob([new Uint8Array(req.file.buffer)], { type: req.file.mimetype });
  formData.append('file', blob, req.file.originalname);
  formData.append('vendorEmail', vendorEmail || '');
  formData.append('poNumber', poNumber || '');
  if (vendorId) formData.append('vendorId', vendorId);
  formData.append('source', 'upload_portal');
  formData.append('uploadedAt', new Date().toISOString());

  // Call n8n (non-blocking for extraction, but we wait for n8n's ACK)
  let n8nResponse: any = { success: false };
  let n8nError = null;

  try {
    const response = await fetch(n8nWebhookUrl, {
      method: 'POST',
      body: formData,
      // Note: Do NOT set Content-Type header manually when using FormData with fetch,
      // it will be set automatically with the correct boundary.
    });

    try {
      n8nResponse = await response.json();
    } catch (e) {
      n8nResponse = { success: response.ok, status: response.status };
    }

    if (!response.ok) {
      n8nError = `N8N responded with status ${response.status}`;
    }
  } catch (error: any) {
    console.error('N8N Processing Connection Error:', error);
    n8nError = error.message;
  }

  // Audit Log
  if (vendorId) {
    await prisma.auditLog.create({
      data: {
        entityType: 'vendor',
        entityId: vendorId,
        eventType: 'invoice_uploaded',
        actor: 'vendor',
        metadata: {
          fileName: req.file.originalname,
          fileSize: req.file.size,
          mimetype: req.file.mimetype,
          n8nResponse,
          n8nError
        } as any,
      },
    });
  }

  return res.json(new ApiResponse(200, 'Invoice uploaded successfully and sent for processing', {
    fileName: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size,
    n8nStatus: {
      sent: !n8nError,
      response: n8nResponse,
      error: n8nError
    }
  }));
});

// ─── Generic Send Email (Trigger n8n) ─────────────
export const sendGenericEmail = asyncHandler(async (req: Request, res: Response) => {
  const n8nWebhookUrl = process.env['N8N__WEBHOOK_URL'];
  if (!n8nWebhookUrl) {
    throw new ApiError(500, 'N8N generic email webhook URL is not configured');
  }

  // Proxy the entire body to n8n – gives the user full flexibility
  let n8nResponse: any = { success: false };
  let n8nError = null;

  try {
    const response = await fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...req.body,
        source: 'api_generic_email',
        sentAt: new Date().toISOString(),
      }),
    });

    try {
      n8nResponse = await response.json();
    } catch (e) {
      n8nResponse = { success: response.ok, status: response.status };
    }

    if (!response.ok) {
      n8nError = `N8N responded with status ${response.status}`;
    }
  } catch (error: any) {
    console.error('N8N Generic Email Error:', error);
    n8nError = error.message;
  }

  return res.json(new ApiResponse(200, 'Email request forwarded to n8n', {
    n8nStatus: {
      sent: !n8nError,
      response: n8nResponse,
      error: n8nError
    }
  }));
});

// ─── Send Upload Link Email (Trigger n8n) ──────────
export const sendUploadLink = asyncHandler(async (req: Request, res: Response) => {
  const n8nWebhookUrl = `${process.env['N8N__WEBHOOK_URL']}/send-invoice-link`;
  if (!n8nWebhookUrl) {
    throw new ApiError(500, 'N8N upload link webhook URL is not configured');
  }

  // Forward the payload to n8n
  let n8nResponse: any = { success: false };
  let n8nError = null;
  console.log(req.body);


  try {
    const response = await fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...req.body,
        source: 'api_resend_link',
        sentAt: new Date().toISOString(),
      }),
    });

    try {
      n8nResponse = await response.json();
    } catch (e) {
      n8nResponse = { success: response.ok, status: response.status };
    }

    if (!response.ok) {
      n8nError = `N8N responded with status ${response.status}`;
    }
  } catch (error: any) {
    console.error('N8N Send Link Error:', error);
    n8nError = error.message;
  }

  return res.json(new ApiResponse(200, 'Upload link email request sent to n8n', {
    n8nStatus: {
      sent: !n8nError,
      response: n8nResponse,
      error: n8nError
    }
  }));
});





