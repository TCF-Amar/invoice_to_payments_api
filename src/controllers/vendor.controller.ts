import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma.js';
import { ApiError, ApiResponse, asyncHandler } from '../utils/helpers.js';

// ─── Validation Schemas ───────────────────────────────
const createVendorSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  address: z.string().optional(),
  gstin: z.string().optional(),
  bankName: z.string().optional(),
  accountName: z.string().optional(),
  accountNumber: z.string().optional(),
  routingNumber: z.string().optional(),
  isVerified: z.boolean().optional().default(false),
});

const updateVendorSchema = createVendorSchema.partial();

// ─── Get All Vendors ──────────────────────────────────
export const getAllVendors = asyncHandler(async (req: Request, res: Response) => {
  const { search, isVerified, page = '1', limit = '10' } = req.query;

  const where: any = {};
  if (search) where.name = { contains: search as string, mode: 'insensitive' };
  if (isVerified) where.isVerified = isVerified === 'true';

  const [vendors, total] = await Promise.all([
    prisma.vendor.findMany({
      where,
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { purchaseOrders: true, invoices: true } } }
    }),
    prisma.vendor.count({ where })
  ]);

  return res.json(new ApiResponse(200, 'Vendors fetched', {
    vendors, total,
    page: Number(page),
    totalPages: Math.ceil(total / Number(limit))
  }));
});

// ─── Get Vendor By ID ─────────────────────────────────
export const getVendorById = asyncHandler(async (req: Request, res: Response) => {
  const vendor = await prisma.vendor.findUnique({
    where: { id: req.params.id as string },
    include: {
      purchaseOrders: { orderBy: { createdAt: 'desc' }, take: 5 },
      invoices: { orderBy: { createdAt: 'desc' }, take: 5 }
    }
  });

  if (!vendor) throw new ApiError(404, 'Vendor not found');

  return res.json(new ApiResponse(200, 'Vendor fetched', vendor));
});

// ─── Get Vendor By Name (n8n use karta hai) ───────────
export const getVendorByName = asyncHandler(async (req: Request, res: Response) => {
  const vendor = await prisma.vendor.findFirst({
    where: { name: { equals: decodeURIComponent(req.params.name as string), mode: 'insensitive' } }
  });

  if (!vendor) throw new ApiError(404, 'Vendor not found');

  return res.json(new ApiResponse(200, 'Vendor fetched', vendor));
});

// ─── Get Vendor By Email (n8n use karta hai) ──────────
export const getVendorByEmail = asyncHandler(async (req: Request, res: Response) => {
  const vendor = await prisma.vendor.findUnique({
    where: { email: req.params.email as string }
  });

  if (!vendor) throw new ApiError(404, 'Vendor not found');

  return res.json(new ApiResponse(200, 'Vendor fetched', vendor));
});

// ─── Create Vendor ────────────────────────────────────
export const createVendor = asyncHandler(async (req: Request, res: Response) => {
  const data = createVendorSchema.parse(req.body);

  const vendor = await prisma.vendor.create({ data });

  return res.status(201).json(new ApiResponse(201, 'Vendor created', vendor));
});

// ─── Update Vendor ────────────────────────────────────
export const updateVendor = asyncHandler(async (req: Request, res: Response) => {
  const data = updateVendorSchema.parse(req.body);

  const vendor = await prisma.vendor.update({
    where: { id: req.params.id as string },
    data
  });

  return res.json(new ApiResponse(200, 'Vendor updated', vendor));
});

// ─── Delete Vendor ────────────────────────────────────
export const deleteVendor = asyncHandler(async (req: Request, res: Response) => {
  // Check if vendor has invoices
  const invoiceCount = await prisma.invoice.count({
    where: { vendorId: req.params.id as string }
  });

  if (invoiceCount > 0) {
    throw new ApiError(400, `Cannot delete vendor — ${invoiceCount} invoices linked`);
  }

  await prisma.vendor.delete({ where: { id: req.params.id as string } });

  return res.json(new ApiResponse(200, 'Vendor deleted', null));
});

/**
 * Helper to find or create a vendor based on ID, Email, or Name.
 * Used internally by PO and Invoice controllers.
 */
export const findOrCreateVendor = async (data: {
  id?: string;
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
}) => {
  // 1. Try by ID (Check if it's a valid UUID before querying to avoid DB errors)
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.id || '');
  if (data.id && isUuid) {
    try {
      const v = await prisma.vendor.findUnique({ where: { id: data.id } });
      if (v) return v;
    } catch (e) {
      // Ignore invalid UUID or search errors and proceed to name/email
    }
  }

  // 2. Try by Email
  if (data.email) {
    const v = await prisma.vendor.findUnique({ where: { email: data.email } });
    if (v) return v;
  }

  // 3. Try by Name
  if (data.name) {
    const v = await prisma.vendor.findFirst({
      where: { name: { equals: data.name, mode: 'insensitive' } }
    });
    if (v) return v;

    // 4. Create new if name provided but no match found
    return await prisma.vendor.create({
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        address: data.address
      }
    });
  }

  return null;
};
