import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma.js';
import { ApiError, ApiResponse, asyncHandler } from '../utils/helpers.js';
import {
  createRazorpayContact,
  fetchRazorpayContacts,
  fetchRazorpayContact,
  createRazorpayFundAccount,
  fetchRazorpayFundAccounts,
  fetchRazorpayFundAccount,
  toggleRazorpayFundAccount,
  createRazorpayPayout,
  fetchAllRazorpayPayouts,
  getRazorpayPayout,
  cancelRazorpayPayout,
  fetchBankingBalances,
  verifyRazorpayWebhook,
  convertToPaise,
  convertToRupees,
} from '../utils/razorpay.js';

// ─── Schemas ──────────────────────────────────────────

const setupVendorPayoutSchema = z.object({
  vendorId: z.string().uuid(),
  bankName: z.string().min(1),
  accountName: z.string().min(1),
  accountNumber: z.string().min(1),
  ifscCode: z.string().min(1),
});

const setupVendorVpaSchema = z.object({
  vendorId: z.string().uuid(),
  vpaAddress: z.string().min(1, 'UPI VPA is required (e.g. vendor@upi)'),
});

const createPayoutSchema = z.object({
  invoiceId: z.string().uuid(),
  amount: z.number().positive(),
  currency: z.string().default('INR'),
  mode: z.enum(['IMPS', 'NEFT', 'RTGS', 'UPI']).default('IMPS'),
  purpose: z.enum(['refund', 'cashback', 'payout', 'salary', 'utility bill', 'vendor bill']).default('vendor bill'),
  narration: z.string().optional(),
  notes: z.record(z.string(), z.any()).optional(),
});

const bulkPayoutSchema = z.object({
  invoiceIds: z.array(z.string().uuid()).min(1),
  mode: z.enum(['IMPS', 'NEFT', 'RTGS', 'UPI']).default('IMPS'),
  purpose: z.enum(['refund', 'cashback', 'payout', 'salary', 'utility bill', 'vendor bill']).default('vendor bill'),
});

// ─── Internal: resolve or create Razorpay Contact + FundAccount ───
async function ensureRazorpaySetup(vendorId: string) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) throw new ApiError(404, 'Vendor not found');
  if (!vendor.accountNumber || !vendor.routingNumber) {
    throw new ApiError(400, 'Vendor bank details not configured. Use /payouts/setup-vendor first.');
  }

  // Reuse stored IDs to avoid duplicate contacts/fund accounts
  if (vendor.razorpayContactId && vendor.razorpayFundAccountId) {
    return {
      vendor,
      contactId: vendor.razorpayContactId,
      fundAccountId: vendor.razorpayFundAccountId,
    };
  }

  // Create contact
  const contactResult = await createRazorpayContact({
    name: vendor.name,
    email: vendor.email || undefined,
    contact: vendor.phone || undefined,
    type: 'vendor',
    reference_id: vendor.id,
    notes: { vendor_id: vendor.id },
  });
  if (!contactResult.success) throw new ApiError(500, `Razorpay contact error: ${contactResult.error}`);
  const contactId = contactResult.data.id;

  // Create fund account
  const fundResult = await createRazorpayFundAccount({
    contact_id: contactId,
    account_type: 'bank_account',
    bank_account: {
      name: vendor.accountName || vendor.name,
      ifsc: vendor.routingNumber!,
      account_number: vendor.accountNumber!,
    },
  });
  if (!fundResult.success) throw new ApiError(500, `Razorpay fund account error: ${fundResult.error}`);
  const fundAccountId = fundResult.data.id;

  // Persist IDs
  await prisma.vendor.update({
    where: { id: vendor.id },
    data: { razorpayContactId: contactId, razorpayFundAccountId: fundAccountId },
  });

  return { vendor, contactId, fundAccountId };
}

// ════════════════════════════════════════════════════
// BANKING BALANCE
// ════════════════════════════════════════════════════

/**
 * GET /api/v1/payouts/balance
 * Fetch balances for all banking accounts
 */
export const getBankingBalance = asyncHandler(async (req: Request, res: Response) => {
  const { account_type, bank_code, count, skip } = req.query as any;

  const result = await fetchBankingBalances({
    account_type: account_type as any,
    bank_code,
    count: count ? Number(count) : undefined,
    skip: skip ? Number(skip) : undefined,
  });

  if (!result.success) throw new ApiError(500, `Failed to fetch balance: ${result.error}`);

  return res.json(new ApiResponse(200, 'Banking balances fetched', result.data));
});

// ════════════════════════════════════════════════════
// CONTACTS
// ════════════════════════════════════════════════════

/**
 * POST /api/v1/payouts/setup-vendor
 * Create Razorpay contact + bank fund account for a vendor
 */
export const setupVendorPayout = asyncHandler(async (req: Request, res: Response) => {
  const data = setupVendorPayoutSchema.parse(req.body);

  const vendor = await prisma.vendor.findUnique({ where: { id: data.vendorId } });
  if (!vendor) throw new ApiError(404, 'Vendor not found');

  // Create Razorpay contact
  const contactResult = await createRazorpayContact({
    name: vendor.name,
    email: vendor.email || undefined,
    contact: vendor.phone || undefined,
    type: 'vendor',
    reference_id: vendor.id,
    notes: { vendor_id: vendor.id, vendor_name: vendor.name },
  });
  if (!contactResult.success) throw new ApiError(500, `Failed to create Razorpay contact: ${contactResult.error}`);
  const razorpayContactId = contactResult.data.id;

  // Create fund account
  const fundResult = await createRazorpayFundAccount({
    contact_id: razorpayContactId,
    account_type: 'bank_account',
    bank_account: {
      name: data.accountName,
      ifsc: data.ifscCode,
      account_number: data.accountNumber,
    },
  });
  if (!fundResult.success) throw new ApiError(500, `Failed to create fund account: ${fundResult.error}`);
  const razorpayFundAccountId = fundResult.data.id;

  // Persist all details
  const updatedVendor = await prisma.vendor.update({
    where: { id: data.vendorId },
    data: {
      bankName: data.bankName,
      accountName: data.accountName,
      accountNumber: data.accountNumber,
      routingNumber: data.ifscCode,
      razorpayContactId,
      razorpayFundAccountId,
    },
  });

  await prisma.auditLog.create({
    data: {
      entityType: 'vendor',
      entityId: vendor.id,
      eventType: 'razorpay_bank_setup_completed',
      actor: 'system',
      metadata: { razorpayContactId, razorpayFundAccountId } as any,
    },
  });

  return res.status(200).json(
    new ApiResponse(200, 'Vendor bank account setup for Razorpay payouts', {
      vendor: updatedVendor,
      razorpayContactId,
      razorpayFundAccountId,
    })
  );
});

/**
 * POST /api/v1/payouts/setup-vendor-vpa
 * Create Razorpay contact + VPA (UPI) fund account for a vendor
 */
export const setupVendorVpa = asyncHandler(async (req: Request, res: Response) => {
  const data = setupVendorVpaSchema.parse(req.body);

  const vendor = await prisma.vendor.findUnique({ where: { id: data.vendorId } });
  if (!vendor) throw new ApiError(404, 'Vendor not found');

  const contactResult = await createRazorpayContact({
    name: vendor.name,
    email: vendor.email || undefined,
    contact: vendor.phone || undefined,
    type: 'vendor',
    reference_id: vendor.id,
    notes: { vendor_id: vendor.id },
  });
  if (!contactResult.success) throw new ApiError(500, `Failed to create contact: ${contactResult.error}`);
  const razorpayContactId = contactResult.data.id;

  const fundResult = await createRazorpayFundAccount({
    contact_id: razorpayContactId,
    account_type: 'vpa',
    vpa: { address: data.vpaAddress },
  });
  if (!fundResult.success) throw new ApiError(500, `Failed to create VPA fund account: ${fundResult.error}`);
  const razorpayFundAccountId = fundResult.data.id;

  const updatedVendor = await prisma.vendor.update({
    where: { id: data.vendorId },
    data: { razorpayContactId, razorpayFundAccountId },
  });

  await prisma.auditLog.create({
    data: {
      entityType: 'vendor',
      entityId: vendor.id,
      eventType: 'razorpay_vpa_setup_completed',
      actor: 'system',
      metadata: { razorpayContactId, razorpayFundAccountId, vpa: data.vpaAddress } as any,
    },
  });

  return res.status(200).json(
    new ApiResponse(200, 'Vendor VPA (UPI) setup for Razorpay payouts', {
      vendor: updatedVendor,
      razorpayContactId,
      razorpayFundAccountId,
    })
  );
});

/**
 * GET /api/v1/payouts/contacts
 * Fetch all Razorpay contacts
 */
export const getContacts = asyncHandler(async (req: Request, res: Response) => {
  const { count, skip } = req.query as any;
  const result = await fetchRazorpayContacts({
    count: count ? Number(count) : undefined,
    skip: skip ? Number(skip) : undefined,
  });
  if (!result.success) throw new ApiError(500, `Failed to fetch contacts: ${result.error}`);
  return res.json(new ApiResponse(200, 'Contacts fetched', result.data));
});

/**
 * GET /api/v1/payouts/contacts/:contactId
 * Fetch a single Razorpay contact
 */
export const getContact = asyncHandler(async (req: Request, res: Response) => {
  const result = await fetchRazorpayContact(req.params.contactId);
  if (!result.success) throw new ApiError(500, `Failed to fetch contact: ${result.error}`);
  return res.json(new ApiResponse(200, 'Contact fetched', result.data));
});

// ════════════════════════════════════════════════════
// FUND ACCOUNTS
// ════════════════════════════════════════════════════

/**
 * GET /api/v1/payouts/fund-accounts
 * Fetch all fund accounts (optionally filtered by contact_id)
 */
export const getFundAccounts = asyncHandler(async (req: Request, res: Response) => {
  const { contact_id, count, skip } = req.query as any;
  const result = await fetchRazorpayFundAccounts({
    contact_id,
    count: count ? Number(count) : undefined,
    skip: skip ? Number(skip) : undefined,
  });
  if (!result.success) throw new ApiError(500, `Failed to fetch fund accounts: ${result.error}`);
  return res.json(new ApiResponse(200, 'Fund accounts fetched', result.data));
});

/**
 * GET /api/v1/payouts/fund-accounts/:fundAccountId
 * Fetch a single fund account
 */
export const getFundAccount = asyncHandler(async (req: Request, res: Response) => {
  const result = await fetchRazorpayFundAccount(req.params.fundAccountId);
  if (!result.success) throw new ApiError(500, `Failed to fetch fund account: ${result.error}`);
  return res.json(new ApiResponse(200, 'Fund account fetched', result.data));
});

/**
 * PATCH /api/v1/payouts/fund-accounts/:fundAccountId/toggle
 * Activate or deactivate a fund account
 */
export const toggleFundAccount = asyncHandler(async (req: Request, res: Response) => {
  const { active } = z.object({ active: z.boolean() }).parse(req.body);
  const result = await toggleRazorpayFundAccount(req.params.fundAccountId, active);
  if (!result.success) throw new ApiError(500, `Failed to toggle fund account: ${result.error}`);
  return res.json(new ApiResponse(200, `Fund account ${active ? 'activated' : 'deactivated'}`, result.data));
});

// ════════════════════════════════════════════════════
// PAYOUTS
// ════════════════════════════════════════════════════

/**
 * POST /api/v1/payouts
 * Create a payout for an approved invoice
 */
export const createPayout = asyncHandler(async (req: Request, res: Response) => {
  const data = createPayoutSchema.parse(req.body);

  const invoice = await prisma.invoice.findUnique({
    where: { id: data.invoiceId },
    include: { vendor: true, matchedPo: true },
  });

  if (!invoice) throw new ApiError(404, 'Invoice not found');
  if (!invoice.vendor) throw new ApiError(400, 'Invoice has no associated vendor');
  if (invoice.status !== 'approved') throw new ApiError(400, 'Invoice must be in "approved" status to create a payout');

  // Prevent duplicate payouts
  const existingPayout = await prisma.payment.findFirst({
    where: {
      invoiceId: data.invoiceId,
      status: { in: ['scheduled', 'processing', 'paid'] },
    },
  });
  if (existingPayout) throw new ApiError(400, 'A payout already exists for this invoice');

  // Ensure vendor has Razorpay setup
  const { fundAccountId } = await ensureRazorpaySetup(invoice.vendor.id);

  // Create Razorpay payout
  const amountInPaise = convertToPaise(data.amount);
  const payoutResult = await createRazorpayPayout({
    account_number: process.env.RAZORPAY_ACCOUNT_NUMBER || '',
    fund_account_id: fundAccountId,
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

  if (!payoutResult.success) throw new ApiError(500, `Failed to create payout: ${payoutResult.error}`);
  const rzPayout = payoutResult.data;

  // Persist payment record
  const payment = await prisma.payment.create({
    data: {
      invoiceId: data.invoiceId,
      amountPaid: data.amount,
      currency: data.currency,
      stripeId: rzPayout.id,
      status: rzPayout.status === 'queued' ? 'scheduled' : 'processing',
      scheduledDate: new Date(),
      poId: invoice.matchedPoId || undefined,
    },
  });

  await prisma.invoice.update({
    where: { id: data.invoiceId },
    data: { status: 'payment_processing' },
  });

  await prisma.auditLog.create({
    data: {
      entityType: 'payment',
      entityId: payment.id,
      eventType: 'razorpay_payout_created',
      actor: 'system',
      invoiceId: invoice.id,
      paymentId: payment.id,
      metadata: {
        razorpayPayoutId: rzPayout.id,
        amount: data.amount,
        mode: data.mode,
        status: rzPayout.status,
      } as any,
    },
  });

  return res.status(201).json(
    new ApiResponse(201, 'Payout created successfully', {
      payment,
      razorpayPayout: {
        id: rzPayout.id,
        status: rzPayout.status,
        amount: convertToRupees(rzPayout.amount),
        currency: rzPayout.currency,
        mode: rzPayout.mode,
        utr: rzPayout.utr || null,
      },
    })
  );
});

/**
 * GET /api/v1/payouts
 * Fetch all payouts for the business account
 */
export const getAllPayouts = asyncHandler(async (req: Request, res: Response) => {
  const { count, skip } = req.query as any;
  const accountNumber = process.env.RAZORPAY_ACCOUNT_NUMBER || '';
  if (!accountNumber) throw new ApiError(500, 'RAZORPAY_ACCOUNT_NUMBER not configured');

  const result = await fetchAllRazorpayPayouts({
    account_number: accountNumber,
    count: count ? Number(count) : undefined,
    skip: skip ? Number(skip) : undefined,
  });
  if (!result.success) throw new ApiError(500, `Failed to fetch payouts: ${result.error}`);
  return res.json(new ApiResponse(200, 'Payouts fetched', result.data));
});

/**
 * GET /api/v1/payouts/:payoutId
 * Fetch a single payout status from Razorpay
 */
export const getPayoutStatus = asyncHandler(async (req: Request, res: Response) => {
  const payoutId = req.params.payoutId;
  const result = await getRazorpayPayout(payoutId);
  if (!result.success) throw new ApiError(500, `Failed to fetch payout: ${result.error}`);
  const p = result.data;

  return res.json(
    new ApiResponse(200, 'Payout status fetched', {
      id: p.id,
      status: p.status,
      amount: convertToRupees(p.amount),
      currency: p.currency,
      mode: p.mode,
      purpose: p.purpose,
      reference_id: p.reference_id,
      utr: p.utr,
      narration: p.narration,
      created_at: p.created_at,
    })
  );
});

/**
 * POST /api/v1/payouts/:payoutId/cancel
 * Cancel a queued payout
 */
export const cancelPayout = asyncHandler(async (req: Request, res: Response) => {
  const payoutId = req.params.payoutId;
  const result = await cancelRazorpayPayout(payoutId);
  if (!result.success) throw new ApiError(500, `Failed to cancel payout: ${result.error}`);

  // Update DB record
  const payment = await prisma.payment.findFirst({ where: { stripeId: payoutId } });
  if (payment) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'failed', failureReason: 'Cancelled by user' },
    });
    if (payment.invoiceId) {
      await prisma.invoice.update({ where: { id: payment.invoiceId }, data: { status: 'approved' } });
    }
  }

  return res.json(new ApiResponse(200, 'Payout cancelled successfully', result.data));
});

/**
 * POST /api/v1/payouts/bulk
 * Create payouts for multiple approved invoices
 */
export const createBulkPayouts = asyncHandler(async (req: Request, res: Response) => {
  const { invoiceIds, mode, purpose } = bulkPayoutSchema.parse(req.body);

  const results: any[] = [];
  const errors: any[] = [];

  for (const invoiceId of invoiceIds) {
    try {
      const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: { vendor: true },
      });

      if (!invoice) { errors.push({ invoiceId, error: 'Invoice not found' }); continue; }
      if (invoice.status !== 'approved') { errors.push({ invoiceId, error: 'Invoice not approved' }); continue; }
      if (!invoice.vendor) { errors.push({ invoiceId, error: 'No vendor linked' }); continue; }

      const totalAmount = Number(invoice.totalAmount || 0);
      if (!totalAmount) { errors.push({ invoiceId, error: 'Invoice has no total amount' }); continue; }

      const existing = await prisma.payment.findFirst({
        where: { invoiceId, status: { in: ['scheduled', 'processing', 'paid'] } },
      });
      if (existing) { errors.push({ invoiceId, error: 'Payout already exists' }); continue; }

      const { fundAccountId } = await ensureRazorpaySetup(invoice.vendor.id);

      const payoutResult = await createRazorpayPayout({
        account_number: process.env.RAZORPAY_ACCOUNT_NUMBER || '',
        fund_account_id: fundAccountId,
        amount: convertToPaise(totalAmount),
        currency: 'INR',
        mode,
        purpose,
        queue_if_low_balance: true,
        reference_id: invoice.id,
        narration: `Bulk payout for Invoice ${invoice.invoiceNumber}`,
        notes: { invoice_id: invoice.id, invoice_number: invoice.invoiceNumber },
      });

      if (!payoutResult.success) { errors.push({ invoiceId, error: payoutResult.error }); continue; }
      const rzPayout = payoutResult.data;

      const payment = await prisma.payment.create({
        data: {
          invoiceId,
          amountPaid: totalAmount,
          currency: 'INR',
          stripeId: rzPayout.id,
          status: rzPayout.status === 'queued' ? 'scheduled' : 'processing',
          scheduledDate: new Date(),
          poId: invoice.matchedPoId || undefined,
        },
      });

      await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'payment_processing' } });

      results.push({ invoiceId, paymentId: payment.id, razorpayPayoutId: rzPayout.id, status: rzPayout.status });
    } catch (err: any) {
      errors.push({ invoiceId, error: err.message || 'Unknown error' });
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

// ════════════════════════════════════════════════════
// WEBHOOK
// ════════════════════════════════════════════════════

/**
 * POST /api/v1/payouts/webhook
 * Handle Razorpay payout webhooks (payout.paid, payout.failed, etc.)
 */
export const handleRazorpayWebhook = asyncHandler(async (req: Request, res: Response) => {
  const webhookSignature = req.headers['x-razorpay-signature'] as string;
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || '';

  const isValid = verifyRazorpayWebhook(JSON.stringify(req.body), webhookSignature, webhookSecret);
  if (!isValid) throw new ApiError(401, 'Invalid webhook signature');

  const event = req.body;
  const eventType: string = event.event;
  const payoutData = event.payload?.payout?.entity;

  if (!payoutData) {
    return res.json({ success: true, message: 'Webhook received — no payout entity' });
  }

  const razorpayPayoutId = payoutData.id;

  const payment = await prisma.payment.findFirst({
    where: { stripeId: razorpayPayoutId },
    include: { invoice: true },
  });

  if (!payment) {
    console.warn(`No DB payment found for Razorpay payout: ${razorpayPayoutId}`);
    return res.json({ success: true, message: 'Payment record not found — skipping' });
  }

  switch (eventType) {
    case 'payout.queued':
      await prisma.payment.update({ where: { id: payment.id }, data: { status: 'scheduled' } });
      break;

    case 'payout.initiated':
    case 'payout.processed':
      await prisma.payment.update({ where: { id: payment.id }, data: { status: 'processing' } });
      break;

    case 'payout.paid': {
      const amountPaid = convertToRupees(payoutData.amount);
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'paid', paidAt: new Date() },
      });

      if (payment.invoice) {
        const newPaid = Number(payment.invoice.amountPaid) + amountPaid;
        const total = Number(payment.invoice.totalAmount);
        const isPaid = newPaid >= total;

        await prisma.invoice.update({
          where: { id: payment.invoice.id },
          data: {
            status: isPaid ? 'paid' : 'payment_processing',
            amountPaid: newPaid,
            amountDue: Math.max(0, total - newPaid),
          },
        });

        // Deduct from PO remaining amount
        if (payment.invoice.matchedPoId) {
          const po = await prisma.purchaseOrder.findUnique({ where: { id: payment.invoice.matchedPoId } });
          if (po) {
            const newRemaining = Math.max(0, Number(po.remainingAmount) - amountPaid);
            await prisma.purchaseOrder.update({
              where: { id: po.id },
              data: { remainingAmount: newRemaining, status: newRemaining <= 0 ? 'closed' : po.status },
            });
          }
        }
      }
      break;
    }

    case 'payout.failed':
    case 'payout.rejected':
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'failed', failureReason: payoutData.failure_reason || eventType },
      });
      if (payment.invoiceId) {
        await prisma.invoice.update({ where: { id: payment.invoiceId }, data: { status: 'approved' } });
      }
      break;

    case 'payout.reversed':
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'failed', failureReason: 'Payout reversed by bank' },
      });
      break;

    case 'payout.cancelled':
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'failed', failureReason: 'Payout cancelled' },
      });
      if (payment.invoiceId) {
        await prisma.invoice.update({ where: { id: payment.invoiceId }, data: { status: 'approved' } });
      }
      break;

    default:
      console.info(`Unhandled Razorpay event: ${eventType}`);
  }

  await prisma.auditLog.create({
    data: {
      entityType: 'payment',
      entityId: payment.id,
      eventType: `razorpay_${eventType.replace('.', '_')}`,
      actor: 'razorpay_webhook',
      paymentId: payment.id,
      invoiceId: payment.invoiceId || undefined,
      metadata: {
        razorpayPayoutId,
        status: payoutData.status,
        utr: payoutData.utr,
        failure_reason: payoutData.failure_reason,
      } as any,
    },
  });

  return res.json({ success: true, message: `Webhook processed: ${eventType}` });
});
