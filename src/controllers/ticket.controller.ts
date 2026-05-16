import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma.js';
import { ApiError, ApiResponse, asyncHandler } from '../utils/helpers.js';

// ─────────────────────────────────────────────────────────────
// STATUS & PRIORITY CONSTANTS
// ─────────────────────────────────────────────────────────────
const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;
const TICKET_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

type TicketStatus = (typeof TICKET_STATUSES)[number];

const ALLOWED_TICKET_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open: ['in_progress', 'resolved', 'closed'],
  in_progress: ['resolved', 'closed'],
  resolved: ['in_progress', 'closed'],
  closed: ['open'],
};

// ─── Schemas ──────────────────────────────────────────────────
const raiseTicketSchema = z.object({
  subject: z.string().min(5, 'Subject must be at least 5 characters'),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  priority: z.enum(TICKET_PRIORITIES).default('medium'),
  vendorId: z.string().uuid().optional(),
  invoiceId: z.string().uuid().optional(),
});

const updateTicketSchema = z.object({
  priority: z.enum(TICKET_PRIORITIES).optional(),
  subject: z.string().min(5).optional(),
  description: z.string().min(10).optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(TICKET_STATUSES),
  reason: z.string().optional(),
  actor: z.string().optional().default('system'),
});

// ─── Internal Helpers ─────────────────────────────────────────

/** Write an audit record for a Ticket event */
async function auditTicket(
  ticketId: string,
  eventType: string,
  metadata: Record<string, unknown>,
  actor = 'system'
) {
  await prisma.auditLog.create({
    data: {
      entityType: 'ticket',
      entityId: ticketId,
      eventType,
      actor,
      metadata: metadata as any,
    },
  });
}

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

  await auditTicket(ticket.id, 'ticket_raised', {
    subject: ticket.subject,
    priority: ticket.priority,
    vendorId: ticket.vendorId,
    invoiceId: ticket.invoiceId,
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
  if (typeof status === 'string') filters.status = status.toLowerCase();
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
  console.log(data);

  const existingTicket = await prisma.ticket.findUnique({ where: { id } });
  if (!existingTicket) throw new ApiError(404, 'Ticket not found');

  if (existingTicket.status === 'closed') {
    throw new ApiError(400, 'Cannot update a closed ticket. Please re-open it first.');
  }

  const ticket = await prisma.ticket.update({
    where: { id },
    data,
  });

  await auditTicket(ticket.id, 'ticket_updated', data as Record<string, unknown>);

  return res.json(
    new ApiResponse(200, 'Ticket updated successfully', ticket)
  );
});

/**
 * PATCH /api/v1/tickets/:id/status
 * Specific endpoint for status transitions
 */
export const updateTicketStatus = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { status: newStatus, reason, actor } = updateStatusSchema.parse(req.body);

  const existing = await prisma.ticket.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, 'Ticket not found');

  const currentStatus = existing.status as TicketStatus;

  // Validate transition
  if (!ALLOWED_TICKET_TRANSITIONS[currentStatus]?.includes(newStatus)) {
    throw new ApiError(
      400,
      `Status transition '${currentStatus}' → '${newStatus}' is not allowed. ` +
      `Allowed next statuses: [${ALLOWED_TICKET_TRANSITIONS[currentStatus]?.join(', ') || 'none'}]`
    );
  }

  const ticket = await prisma.ticket.update({
    where: { id },
    data: { status: newStatus },
  });

  await auditTicket(ticket.id, `ticket_status_${newStatus}`, {
    previousStatus: currentStatus,
    newStatus,
    reason: reason ?? null,
    actor: actor ?? 'system',
  }, actor);

  return res.json(
    new ApiResponse(200, `Ticket status updated to '${newStatus}'`, ticket)
  );
});

