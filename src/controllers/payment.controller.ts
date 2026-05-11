import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { ApiError, ApiResponse, asyncHandler } from '../utils/helpers';

// ─── Schemas ──────────────────────────────────────────
const createPaymentSchema = z.object({
  invoiceId:  z.string().uuid(),
  amountPaid: z.number().positive(),
  currency:   z.string().default('USD'),
  stripeId:   z.string().optional(),
  status: z.enum(['pending', 'processing', 'paid', 'completed', 'failed']).default('pending'),
  
});

// ─── Get Payments by Invoice ──────────────────────────
export const getPaymentsByInvoice = asyncHandler(async (req: Request, res: Response) => {
  const payments = await prisma.payment.findMany({
    where:   { invoiceId: req.params.invoiceId as string },
    orderBy: { createdAt: 'desc' }
  });

  return res.json(new ApiResponse(200, 'Payments fetched', payments));
});

// ─── Create Payment (Stripe webhook triggers this) ────
export const createPayment = asyncHandler(async (req: Request, res: Response) => {
  const data = createPaymentSchema.parse(req.body);

  const invoice = await prisma.invoice.findUnique({
    where:   { id: data.invoiceId },
    include: { matchedPo: true }
  });

  if (!invoice) throw new ApiError(404, 'Invoice not found');
  if (invoice.status === 'paid') throw new ApiError(400, 'Invoice already paid');

  const payment = await prisma.payment.create({
    data: {
      ...data,
      poId:   invoice.matchedPoId ?? undefined,
      paidAt: ['paid','completed'].includes(data.status) ? new Date() : null,
    }
  });

  // Update invoice amountPaid
  const newAmountPaid = Number(invoice.amountPaid) + data.amountPaid;
  const totalAmount   = Number(invoice.totalAmount);
  const isPaid        = newAmountPaid >= totalAmount;

  await prisma.invoice.update({
    where: { id: data.invoiceId },
    data: {
      amountPaid: newAmountPaid,
      amountDue:  Math.max(0, totalAmount - newAmountPaid),
      status:     isPaid ? 'paid' : 'payment_processing'
    }
  });

  // Update PO remaining amount
  if (invoice.matchedPoId) {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: invoice.matchedPoId }
    });

    if (po) {
      const newRemaining = Math.max(0, Number(po.remainingAmount) - data.amountPaid);
      await prisma.purchaseOrder.update({
        where: { id: po.id },
        data: {
          remainingAmount: newRemaining,
          status: newRemaining <= 0 ? 'closed' : po.status
        }
      });
    }
  }

  // Audit log
  await prisma.auditLog.create({
    data: {
      entityType: 'payment',
      entityId:   payment.id,
      eventType:  'payment_created',
      actor:      'stripe',
      invoiceId:  data.invoiceId,
      paymentId:  payment.id,
      metadata:   { amountPaid: data.amountPaid, stripeId: data.stripeId } as any
    }
  });

  return res.status(201).json(new ApiResponse(201, 'Payment recorded', payment));
});

// ─── Update Payment Status (Stripe webhook) ───────────
export const updatePaymentStatus = asyncHandler(async (req: Request, res: Response) => {
  const { status, stripeId, failureReason } = z.object({
    status:        z.enum(['pending','processing','paid','completed','failed','refunded']),
    stripeId:      z.string().optional(),
    failureReason: z.string().optional(),
  }).parse(req.body);

  const payment = await prisma.payment.update({
    where: { id: req.params.id as string },
    data: {
      status,
      stripeId:      stripeId      ?? undefined,
      failureReason: failureReason ?? null,
      paidAt: ['paid','completed'].includes(status) ? new Date() : undefined,
    }
  });

  // If failed → revert invoice status
  if (status === 'failed' && payment.invoiceId) {
    await prisma.invoice.update({
      where: { id: payment.invoiceId },
      data:  { status: 'approved' } // back to approved for retry
    });
  }

  return res.json(new ApiResponse(200, 'Payment status updated', payment));
});
