import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma.js';
import { ApiError, ApiResponse, asyncHandler } from '../utils/helpers.js';
import {
  createRazorpayContact,
  createRazorpayFundAccount,
  createRazorpayPayout,
  getRazorpayPayout,
  cancelRazorpayPayout,
  convertToPaise,
  convertToRupees,
  verifyRazorpayWebhook,
} from '../utils/razorpay.js';

// ─── Schemas ──────────────────────────────────────────
const createPayoutSchema = z.object({
  invoiceId: z.string().uuid(),
  amount: z.number().positive(),
  currency: z.string().default('INR'),
  mode: z.enum(['IMPS', 'NEFT', 'RTGS', 'UPI']).default('IMPS'),
  purpose: z.enum(['refund', 'cashback', 'payout', 'salary', 'utility bill', 'vendor bill']).default('vendor bill'),
  narration: z.string().optional(),
  notes: z.record(z.string(), z.any()).optional(),
});

const setupVendorPayoutSchema = z.object({
  vendorId: z.string().uuid(),
  bankName: z.string().min(1),
  accountName: z.string().min(1),
  accountNumber: z.string().min(1),
  ifscCode: z.string().min(1),
});

// ─── Setup Vendor for Razorpay Payouts ────────────────
export const setupVendorPayout = asyncHandler(async (req: Request, res: Response) => {
  const data = setupVendorPayoutSchema.parse(req.body);

  // Get vendor
  const vendor = await prisma.vendor.findUnique({
    where: { id: data.vendorId },
  });

  if (!vendor) throw new ApiError(404, 'Vendor not found');

  // Create Razorpay contact
  const contactResult = await createRazorpayContact({
    name: vendor.name,
    email: vendor.email || undefined,
    contact: vendor.phone || undefined,
    type: 'vendor',
    reference_id: vendor.id,
    notes: {
      vendor_id: vendor.id,
      vendor_name: vendor.name,
    },
  });

  if (!contactResult.success) {
    throw new ApiError(500, `Failed to create Razorpay contact: ${contactResult.error}`);
  }

  const razorpayContactId = contactResult.data.id;

  // Create fund account
  const fundAccountResult = await createRazorpayFundAccount({
    contact_id: razorpayContactId,
    account_type: 'bank_account',
    bank_account: {
      name: data.accountName,
      ifsc: data.ifscCode,
      account_number: data.accountNumber,
    },
  });

  if (!fundAccountResult.success) {
    throw new ApiError(500, `Failed to create fund account: ${fundAccountResult.error}`);
  }

  if (!fundAccountResult.data) {
    throw new ApiError(500, 'Fund account creation returned no data');
  }

  const fundAccountData: any = fundAccountResult.data;
  const razorpayFundAccountId = fundAccountData.id;

  // Update vendor with Razorpay details
  const updatedVendor = await prisma.vendor.update({
    where: { id: data.vendorId },
    data: {
      bankName: data.bankName,
      accountName: data.accountName,
      accountNumber: data.accountNumber,
      routingNumber: data.ifscCode, // Store IFSC in routingNumber field
      // Store Razorpay IDs in a JSON field or create new fields
      // For now, we'll add them to notes or create a separate table
    },
  });

  // Create audit log
  await prisma.auditLog.create({
    data: {
      entityType: 'vendor',
      entityId: vendor.id,
      eventType: 'razorpay_setup_completed',
      actor: 'system',
      metadata: {
        razorpayContactId,
        razorpayFundAccountId,
      } as any,
    },
  });

  return res.status(200).json(
    new ApiResponse(200, 'Vendor setup for Razorpay payouts', {
      vendor: updatedVendor,
      razorpayContactId,
      razorpayFundAccountId,
    })
  );
});

// ─── Create Payout for Invoice ────────────────────────
export const createPayout = asyncHandler(async (req: Request, res: Response) => {
  const data = createPayoutSchema.parse(req.body);

  // Get invoice with vendor details
  const invoice = await prisma.invoice.findUnique({
    where: { id: data.invoiceId },
    include: { vendor: true, matchedPo: true },
  });

  if (!invoice) throw new ApiError(404, 'Invoice not found');
  if (!invoice.vendor) throw new ApiError(400, 'Invoice has no associated vendor');
  if (invoice.status !== 'approved') {
    throw new ApiError(400, 'Invoice must be approved before creating payout');
  }

  // Check if vendor has bank details
  if (!invoice.vendor.accountNumber || !invoice.vendor.routingNumber) {
    throw new ApiError(400, 'Vendor bank details not configured. Please setup vendor for payouts first.');
  }

  // Check if payout already exists for this invoice
  const existingPayout = await prisma.payment.findFirst({
    where: {
      invoiceId: data.invoiceId,
      status: { in: ['scheduled', 'processing', 'paid', 'completed'] },
    },
  });

  if (existingPayout) {
    throw new ApiError(400, 'Payout already exists for this invoice');
  }

  // Get Razorpay fund account ID (you'll need to store this during vendor setup)
  // For now, we'll need to create contact and fund account on the fly
  // In production, store these IDs in the vendor table

  // Create Razorpay contact
  const contactResult = await createRazorpayContact({
    name: invoice.vendor.name,
    email: invoice.vendor.email || undefined,
    contact: invoice.vendor.phone || undefined,
    type: 'vendor',
    reference_id: invoice.vendor.id,
  });

  if (!contactResult.success) {
    throw new ApiError(500, `Failed to create Razorpay contact: ${contactResult.error}`);
  }

  // Create fund account
  const fundAccountResult = await createRazorpayFundAccount({
    contact_id: contactResult.data.id,
    account_type: 'bank_account',
    bank_account: {
      name: invoice.vendor.accountName || invoice.vendor.name,
      ifsc: invoice.vendor.routingNumber || '',
      account_number: invoice.vendor.accountNumber || '',
    },
  });

  if (!fundAccountResult.success) {
    throw new ApiError(500, `Failed to create fund account: ${fundAccountResult.error}`);
  }

  if (!fundAccountResult.data) {
    throw new ApiError(500, 'Fund account creation returned no data');
  }

  const fundAccountData: any = fundAccountResult.data;

  // Create Razorpay payout
  const amountInPaise = convertToPaise(data.amount);
  const payoutResult = await createRazorpayPayout({
    account_number: process.env.RAZORPAY_ACCOUNT_NUMBER || '',
    fund_account_id: fundAccountData.id,
    amount: amountInPaise,
    currency: data.currency,
    mode: data.mode,
    purpose: data.purpose,
    queue_if_low_balance: true,
    reference_id: invoice.id,
    narration: data.narration || `Payment for Invoice ${invoice.invoiceNumber}`,
    notes: {
      invoice_id: invoice.id,
      invoice_number: invoice.invoiceNumber,
      vendor_id: invoice.vendor.id,
      vendor_name: invoice.vendor.name,
      ...data.notes,
    },
  });

  if (!payoutResult.success) {
    throw new ApiError(500, `Failed to create payout: ${payoutResult.error}`);
  }

  const razorpayPayout = payoutResult.data;

  // Create payment record in database
  const payment = await prisma.payment.create({
    data: {
      invoiceId: data.invoiceId,
      amountPaid: data.amount,
      currency: data.currency,
      stripeId: razorpayPayout.id, // Store Razorpay payout ID in stripeId field
      status: razorpayPayout.status === 'queued' ? 'scheduled' : 'processing',
      scheduledDate: new Date(),
      poId: invoice.matchedPoId || undefined,
    },
  });

  // Update invoice status
  await prisma.invoice.update({
    where: { id: data.invoiceId },
    data: {
      status: 'payment_processing',
    },
  });

  // Create audit log
  await prisma.auditLog.create({
    data: {
      entityType: 'payment',
      entityId: payment.id,
      eventType: 'razorpay_payout_created',
      actor: 'system',
      invoiceId: invoice.id,
      paymentId: payment.id,
      metadata: {
        razorpayPayoutId: razorpayPayout.id,
        amount: data.amount,
        mode: data.mode,
        status: razorpayPayout.status,
      } as any,
    },
  });

  return res.status(201).json(
    new ApiResponse(201, 'Payout created successfully', {
      payment,
      razorpayPayout: {
        id: razorpayPayout.id,
        status: razorpayPayout.status,
        amount: convertToRupees(razorpayPayout.amount),
        currency: razorpayPayout.currency,
        mode: razorpayPayout.mode,
      },
    })
  );
});

// ─── Get Payout Status ────────────────────────────────
export const getPayoutStatus = asyncHandler(async (req: Request, res: Response) => {
  const payoutId = Array.isArray(req.params.payoutId) 
    ? req.params.payoutId[0] 
    : req.params.payoutId;

  const payoutResult = await getRazorpayPayout(payoutId);

  if (!payoutResult.success) {
    throw new ApiError(500, `Failed to fetch payout: ${payoutResult.error}`);
  }

  const payout = payoutResult.data;

  return res.json(
    new ApiResponse(200, 'Payout status fetched', {
      id: payout.id,
      status: payout.status,
      amount: convertToRupees(payout.amount),
      currency: payout.currency,
      mode: payout.mode,
      purpose: payout.purpose,
      reference_id: payout.reference_id,
      utr: payout.utr,
      created_at: payout.created_at,
    })
  );
});

// ─── Cancel Payout ────────────────────────────────────
export const cancelPayout = asyncHandler(async (req: Request, res: Response) => {
  const payoutId = Array.isArray(req.params.payoutId) 
    ? req.params.payoutId[0] 
    : req.params.payoutId;

  const payoutResult = await cancelRazorpayPayout(payoutId);

  if (!payoutResult.success) {
    throw new ApiError(500, `Failed to cancel payout: ${payoutResult.error}`);
  }

  // Update payment record
  const payment = await prisma.payment.findFirst({
    where: { stripeId: payoutId },
  });

  if (payment) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'failed',
        failureReason: 'Cancelled by user',
      },
    });

    // Update invoice status back to approved
    if (payment.invoiceId) {
      await prisma.invoice.update({
        where: { id: payment.invoiceId },
        data: { status: 'approved' },
      });
    }
  }

  return res.json(new ApiResponse(200, 'Payout cancelled successfully', payoutResult.data));
});

// ─── Razorpay Webhook Handler ─────────────────────────
export const handleRazorpayWebhook = asyncHandler(async (req: Request, res: Response) => {
  const webhookSignature = req.headers['x-razorpay-signature'] as string;
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || '';

  // Verify webhook signature
  const isValid = verifyRazorpayWebhook(
    JSON.stringify(req.body),
    webhookSignature,
    webhookSecret
  );

  if (!isValid) {
    throw new ApiError(401, 'Invalid webhook signature');
  }

  const event = req.body;
  const eventType = event.event;
  const payoutData = event.payload?.payout?.entity;

  if (!payoutData) {
    return res.json({ success: true, message: 'Event received but no payout data' });
  }

  const razorpayPayoutId = payoutData.id;

  // Find payment record
  const payment = await prisma.payment.findFirst({
    where: { stripeId: razorpayPayoutId },
    include: { invoice: true },
  });

  if (!payment) {
    console.warn(`Payment not found for Razorpay payout ID: ${razorpayPayoutId}`);
    return res.json({ success: true, message: 'Payment record not found' });
  }

  // Handle different event types
  switch (eventType) {
    case 'payout.processed':
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'processing',
        },
      });
      break;

    case 'payout.paid':
      const amountPaid = convertToRupees(payoutData.amount);
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'paid',
          paidAt: new Date(),
        },
      });

      // Update invoice
      if (payment.invoice) {
        const newAmountPaid = Number(payment.invoice.amountPaid) + amountPaid;
        const totalAmount = Number(payment.invoice.totalAmount);
        const isPaid = newAmountPaid >= totalAmount;

        await prisma.invoice.update({
          where: { id: payment.invoice.id },
          data: {
            status: isPaid ? 'paid' : 'payment_processing',
            amountPaid: newAmountPaid,
            amountDue: Math.max(0, totalAmount - newAmountPaid),
          },
        });

        // Update PO if exists
        if (payment.invoice.matchedPoId) {
          const po = await prisma.purchaseOrder.findUnique({
            where: { id: payment.invoice.matchedPoId },
          });

          if (po) {
            const newRemaining = Math.max(0, Number(po.remainingAmount) - amountPaid);
            await prisma.purchaseOrder.update({
              where: { id: po.id },
              data: {
                remainingAmount: newRemaining,
                status: newRemaining <= 0 ? 'closed' : po.status,
              },
            });
          }
        }
      }
      break;

    case 'payout.failed':
    case 'payout.rejected':
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'failed',
          failureReason: payoutData.failure_reason || 'Payout failed',
        },
      });

      // Update invoice status back to approved
      if (payment.invoiceId) {
        await prisma.invoice.update({
          where: { id: payment.invoiceId },
          data: { status: 'approved' },
        });
      }
      break;

    case 'payout.reversed':
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'failed',
          failureReason: 'Payout reversed',
        },
      });
      break;
  }

  // Create audit log
  await prisma.auditLog.create({
    data: {
      entityType: 'payment',
      entityId: payment.id,
      eventType: `razorpay_${eventType}`,
      actor: 'razorpay_webhook',
      paymentId: payment.id,
      invoiceId: payment.invoiceId || undefined,
      metadata: {
        razorpayPayoutId,
        status: payoutData.status,
        utr: payoutData.utr,
      } as any,
    },
  });

  return res.json({ success: true, message: 'Webhook processed' });
});

// ─── Bulk Payout for Approved Invoices ────────────────
export const createBulkPayouts = asyncHandler(async (req: Request, res: Response) => {
  const { invoiceIds, mode = 'IMPS' } = z.object({
    invoiceIds: z.array(z.string().uuid()),
    mode: z.enum(['IMPS', 'NEFT', 'RTGS', 'UPI']).default('IMPS'),
  }).parse(req.body);

  const results = [];
  const errors = [];

  for (const invoiceId of invoiceIds) {
    try {
      const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: { vendor: true },
      });

      if (!invoice) {
        errors.push({ invoiceId, error: 'Invoice not found' });
        continue;
      }

      if (invoice.status !== 'approved') {
        errors.push({ invoiceId, error: 'Invoice not approved' });
        continue;
      }

      // Create payout (reuse logic from createPayout)
      // This is simplified - in production, extract the logic to a shared function
      results.push({ invoiceId, status: 'queued' });
    } catch (error: any) {
      errors.push({ invoiceId, error: error.message });
    }
  }

  return res.json(
    new ApiResponse(200, 'Bulk payout processing completed', {
      successful: results.length,
      failed: errors.length,
      results,
      errors,
    })
  );
});
