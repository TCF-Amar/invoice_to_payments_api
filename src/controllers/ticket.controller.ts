import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma.js';
import { ApiError, ApiResponse, asyncHandler } from '../utils/helpers.js';

// Schemas for validation
const raiseTicketSchema = z.object({
  subject: z.string().min(5, 'Subject must be at least 5 characters'),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  vendorId: z.string().uuid().optional(),
  invoiceId: z.string().uuid().optional(),
});

const updateTicketSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
});

/**
 * POST /api/v1/tickets
 * Create a new support ticket
 */
export const raiseTicket = asyncHandler(async (req: Request, res: Response) => {
  const data = raiseTicketSchema.parse(req.body);

  // Validate relationships if provided
  if (data.vendorId) {
    const vendor = await prisma.vendor.findUnique({ where: { id: data.vendorId } });
    if (!vendor) throw new ApiError(404, 'Vendor not found');
  }

  if (data.invoiceId) {
    const invoice = await prisma.invoice.findUnique({ where: { id: data.invoiceId } });
    if (!invoice) throw new ApiError(404, 'Invoice not found');
  }

  const ticket = await prisma.ticket.create({
    data: {
      subject: data.subject,
      description: data.description,
      priority: data.priority,
      vendorId: data.vendorId,
      invoiceId: data.invoiceId,
    },
  });

  return res.status(201).json(
    new ApiResponse(201, 'Ticket raised successfully', ticket)
  );
});

/**
 * GET /api/v1/tickets
 * List all tickets with optional filtering
 */
export const listTickets = asyncHandler(async (req: Request, res: Response) => {
  const { status, vendorId, invoiceId } = req.query;

  const filters: any = {};
  if (typeof status === 'string') filters.status = status;
  if (typeof vendorId === 'string') filters.vendorId = vendorId;
  if (typeof invoiceId === 'string') filters.invoiceId = invoiceId;

  const tickets = await prisma.ticket.findMany({
    where: filters,
    orderBy: { createdAt: 'desc' },
    include: {
      vendor: { select: { name: true, email: true } },
      invoice: { select: { invoiceNumber: true, status: true } },
    },
  });

  return res.json(
    new ApiResponse(200, 'Tickets retrieved successfully', tickets)
  );
});

/**
 * GET /api/v1/tickets/:id
 * Get details of a specific ticket
 */
export const getTicketById = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: {
      vendor: true,
      invoice: true,
    },
  });

  if (!ticket) throw new ApiError(404, 'Ticket not found');

  return res.json(
    new ApiResponse(200, 'Ticket details retrieved', ticket)
  );
});

/**
 * PATCH /api/v1/tickets/:id
 * Update a ticket's status or priority
 */
export const updateTicket = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const data = updateTicketSchema.parse(req.body);

  const existingTicket = await prisma.ticket.findUnique({ where: { id } });
  if (!existingTicket) throw new ApiError(404, 'Ticket not found');

  const ticket = await prisma.ticket.update({
    where: { id },
    data,
  });

  return res.json(
    new ApiResponse(200, 'Ticket updated successfully', ticket)
  );
});
