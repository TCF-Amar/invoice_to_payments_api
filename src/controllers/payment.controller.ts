import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma.js';
import { ApiError, ApiResponse, asyncHandler } from '../utils/helpers.js';

// ─── Schemas ──────────────────────────────────────────
const createPaymentSchema = z.object({
  invoiceId:  z.string().uuid(),
  amountPaid: z.number().positive(),
  currency:   z.string().default('INR'),
  paymentId:  z.string().optional(),
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

// ─── Create Payment (Razorpay webhook triggers this) ────
export const createPayment = asyncHandler(async (req: Request, res: Response) => {
  const data = createPaymentSchema.parse(req.body);

  const invoice = await prisma.invoice.findUnique({
    where:   { id: data.invoiceId },
    include: { matchedPo: true }
  });

  if (!invoice) throw new ApiError(404, 'Invoice not found');
  if (invoice.status === 'paid') throw new ApiError(400, 'Invoice already paid');

  // Check if payment already exists
  let payment;
  if (data.paymentId) {
    payment = await prisma.payment.findFirst({
      where: { stripeId: data.paymentId }
    });
  }

  const isNew = !payment;
  if (payment) {
    // If already paid, don't process again
    if (['paid', 'completed'].includes(payment.status)) {
      return res.json(new ApiResponse(200, 'Payment already recorded as paid', payment));
    }

    payment = await prisma.payment.update({
      where: { id: payment.id },
      data: {
        ...data,
        poId: invoice.matchedPoId ?? undefined,
        paidAt: ['paid', 'completed'].includes(data.status) ? new Date() : null,
      }
    });
  } else {
    payment = await prisma.payment.create({
      data: {
        invoiceId: data.invoiceId,
        amountPaid: data.amountPaid,
        currency: data.currency,
        stripeId: data.paymentId,
        status: data.status,
        poId: invoice.matchedPoId ?? undefined,
        paidAt: ['paid', 'completed'].includes(data.status) ? new Date() : null,
      }
    });
  }

  // Update invoice amountPaid (Only if this payment is becoming 'paid' or 'completed')
  if (['paid', 'completed'].includes(data.status)) {
    const newAmountPaid = Number(invoice.amountPaid) + data.amountPaid;
    const totalAmount = Number(invoice.totalAmount);
    const isPaid = newAmountPaid >= totalAmount;

    await prisma.invoice.update({
      where: { id: data.invoiceId },
      data: {
        amountPaid: newAmountPaid,
        amountDue: Math.max(0, totalAmount - newAmountPaid),
        status: isPaid ? 'paid' : 'payment_processing'
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
  }

  // Audit log
  await prisma.auditLog.create({
    data: {
      entityType: 'payment',
      entityId: payment.id,
      eventType: isNew ? 'payment_created' : 'payment_updated',
      actor: 'razorpay',
      invoiceId: data.invoiceId,
      paymentId: payment.id,
      metadata: { amountPaid: data.amountPaid, paymentId: data.paymentId, status: data.status } as any
    }
  });

  return res.status(isNew ? 201 : 200)
    .json(new ApiResponse(200, 'Payment recorded', payment));
});

// ─── Update Payment Status (Razorpay webhook) ───────────
export const updatePaymentStatus = asyncHandler(async (req: Request, res: Response) => {
  const { status, paymentId, failureReason } = z.object({
    status:        z.enum(['pending','processing','paid','completed','failed','refunded']),
    paymentId:     z.string().optional(),
    failureReason: z.string().optional(),
  }).parse(req.body);

  let payment;
  if (req.params.id && req.params.id !== 'undefined') {
    payment = await prisma.payment.findUnique({
      where: { id: req.params.id as string },
      include: { invoice: true }
    });
  } else if (paymentId) {
    payment = await prisma.payment.findFirst({
      where: { stripeId: paymentId as string },
      include: { invoice: true }
    });
  }

  if (!payment) throw new ApiError(404, 'Payment record not found');

  const oldStatus = payment.status;
  const updatedPayment = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status,
      stripeId: paymentId ?? undefined,
      failureReason: failureReason ?? null,
      paidAt: ['paid', 'completed'].includes(status) ? new Date() : undefined,
    }
  });

  // If newly paid → update invoice
  if (['paid', 'completed'].includes(status) && !['paid', 'completed'].includes(oldStatus)) {
    if (payment.invoice) {
      const amountPaid = Number(payment.amountPaid || 0);
      const newTotalPaid = Number(payment.invoice.amountPaid) + amountPaid;
      const totalAmount = Number(payment.invoice.totalAmount);
      const isPaid = newTotalPaid >= totalAmount;

      await prisma.invoice.update({
        where: { id: payment.invoice.id },
        data: {
          status: isPaid ? 'paid' : 'payment_processing',
          amountPaid: newTotalPaid,
          amountDue: Math.max(0, totalAmount - newTotalPaid)
        }
      });
    }
  }

  // If failed → revert invoice status
  if (status === 'failed' && payment.invoiceId) {
    await prisma.invoice.update({
      where: { id: payment.invoiceId },
      data: { status: 'approved' } // back to approved for retry
    });
  }

  return res.json(new ApiResponse(200, 'Payment status updated', updatedPayment));
});
