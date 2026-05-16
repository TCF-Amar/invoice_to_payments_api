import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma.js';
import { ApiError, ApiResponse, asyncHandler } from '../utils/helpers.js';
import {
    createStripeVendorAccount,
    createVendorOnboardingLink,
    transferToVendor,
    getStripeAccount
} from '../utils/stripe.js';

const setupVendorStripeSchema = z.object({
    vendorId: z.string().uuid(),
});

const createPayoutSchema = z.object({
    invoiceId: z.string().uuid(),
    amount: z.number().positive(),
    description: z.string().optional(),
});

const bulkPayoutSchema = z.object({
    invoiceIds: z.array(z.string().uuid()).min(1),
    description: z.string().optional(),
});

/**
 * POST /api/v1/payouts/stripe/setup-vendor
 * Create a Stripe Connect Express account for a vendor
 */
export const setupVendorStripeAccount = asyncHandler(async (req: Request, res: Response) => {
    const { vendorId } = setupVendorStripeSchema.parse(req.body);

    const _vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!_vendor) throw new ApiError(404, 'Vendor not found');
    if (!_vendor.email) throw new ApiError(400, 'Vendor must have an email for Stripe setup');

    const vendor = _vendor as typeof _vendor & { stripeAccountId?: string | null };

    // If already set up, return link
    let stripeAccountId = vendor.stripeAccountId;
    if (!stripeAccountId) {
        const account = await createStripeVendorAccount({ email: vendor.email as string });
        stripeAccountId = account.id;

        await prisma.vendor.update({
            where: { id: vendorId },
            data: { stripeAccountId } as any,
        });

        await prisma.auditLog.create({
            data: {
                entityType: 'vendor',
                entityId: vendor.id,
                eventType: 'stripe_account_created',
                actor: 'system',
                metadata: { stripeAccountId } as any,
            },
        });
    }

    const link = await createVendorOnboardingLink({ accountId: stripeAccountId });

    return res.status(200).json(
        new ApiResponse(200, 'Stripe Vendor Account Setup', {
            vendorId: vendor.id,
            stripeAccountId,
            onboardingUrl: link.url,
        })
    );
});

/**
 * GET /api/v1/payouts/stripe/onboarding-link/:vendorId
 * Generate a fresh onboarding link for a vendor
 */
export const getStripeOnboardingLink = asyncHandler(async (req: Request, res: Response) => {
    const vendorId = req.params.vendorId as string;
    const _vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!_vendor) throw new ApiError(404, 'Vendor not found');

    const vendor = _vendor as typeof _vendor & { stripeAccountId?: string | null };
    if (!vendor.stripeAccountId) throw new ApiError(400, 'Vendor Stripe account not set up');

    const link = await createVendorOnboardingLink({ accountId: vendor.stripeAccountId });

    return res.status(200).json(
        new ApiResponse(200, 'Stripe Onboarding Link Generated', {
            vendorId: vendor.id,
            onboardingUrl: link.url,
        })
    );
});

/**
 * GET /api/v1/payouts/stripe/status/:vendorId
 * Check the real-time status of a vendor's Stripe account
 */
export const checkVendorStripeStatus = asyncHandler(async (req: Request, res: Response) => {
    const vendorId = req.params.vendorId as string;
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });

    if (!vendor) throw new ApiError(404, 'Vendor not found');
    const stripeAccountId = (vendor as any).stripeAccountId;
    if (!stripeAccountId) throw new ApiError(400, 'Vendor has no Stripe account setup');

    const account = await getStripeAccount(stripeAccountId);

    return res.json(
        new ApiResponse(200, 'Stripe Account Status Fetched', {
            vendorId,
            stripeAccountId,
            isEnabled: account.payouts_enabled,
            details_submitted: account.details_submitted,
            charges_enabled: account.charges_enabled,
            requirements: account.requirements,
        })
    );
});

/**
 * POST /api/v1/payouts/stripe
 * Create a Stripe payout/transfer for an approved invoice
 */
export const createStripePayout = asyncHandler(async (req: Request, res: Response) => {
    const data = createPayoutSchema.parse(req.body);

    const invoice = await prisma.invoice.findUnique({
        where: { id: data.invoiceId },
        include: { vendor: true, matchedPo: true },
    });

    if (!invoice) throw new ApiError(404, 'Invoice not found');
    if (!invoice.vendor) throw new ApiError(400, 'Invoice has no associated vendor');
    if (invoice.status !== 'approved') throw new ApiError(400, 'Invoice must be in "approved" status');

    const vendor = invoice.vendor as typeof invoice.vendor & { stripeAccountId?: string | null };
    if (!vendor.stripeAccountId) throw new ApiError(400, 'Vendor has no Stripe Connect account setup');

    // Check if account is restricted
    const account = await getStripeAccount(vendor.stripeAccountId);
    if (!account.payouts_enabled) {
        throw new ApiError(400, 'Vendor account is currently "Restricted". They must complete onboarding before receiving payouts.');
    }

    // Prevent duplicate payouts
    const existingPayout = await prisma.payment.findFirst({
        where: {
            invoiceId: data.invoiceId,
            status: { in: ['scheduled', 'processing', 'paid'] },
        },
    });
    if (existingPayout) throw new ApiError(400, 'A payout already exists for this invoice');

    // Create Stripe Transfer
    const amountInCents = Math.round(data.amount * 100);
    const transfer = await transferToVendor({
        amount: amountInCents,
        stripeAccountId: vendor.stripeAccountId,
        description: data.description || `Payment for Invoice ${invoice.invoiceNumber}`,
    });

    // Persist payment record
    const payment = await prisma.payment.create({
        data: {
            invoiceId: data.invoiceId,
            amountPaid: data.amount,
            currency: 'USD',
            stripeId: transfer.id,
            status: 'paid', // Transfers usually happen immediately
            paidAt: new Date(),
            poId: invoice.matchedPoId || undefined,
        },
    });

    // Update invoice
    const newPaid = Number(invoice.amountPaid || 0) + data.amount;
    const total = Number(invoice.totalAmount || 0);
    const isPaid = newPaid >= total;

    await prisma.invoice.update({
        where: { id: data.invoiceId },
        data: {
            status: isPaid ? 'paid' : 'payment_processing',
            amountPaid: newPaid,
            amountDue: Math.max(0, total - newPaid),
        },
    });

    // Deduct from PO if applicable
    if (invoice.matchedPoId && invoice.matchedPo) {
        const newRemaining = Math.max(0, Number(invoice.matchedPo.remainingAmount || 0) - data.amount);
        await prisma.purchaseOrder.update({
            where: { id: invoice.matchedPoId },
            data: { remainingAmount: newRemaining, status: newRemaining <= 0 ? 'closed' : invoice.matchedPo.status },
        });
    }

    await prisma.auditLog.create({
        data: {
            entityType: 'payment',
            entityId: payment.id,
            eventType: 'stripe_payout_created',
            actor: 'system',
            invoiceId: invoice.id,
            paymentId: payment.id,
            metadata: {
                stripeTransferId: transfer.id,
                amount: data.amount,
            } as any,
        },
    });

    return res.status(201).json(
        new ApiResponse(201, 'Stripe payout completed successfully', {
            payment,
            transferId: transfer.id,
        })
    );
});

/**
 * POST /api/v1/payouts/stripe/bulk
 * Create payouts for multiple approved invoices
 */
export const createBulkStripePayouts = asyncHandler(async (req: Request, res: Response) => {
    const { invoiceIds, description } = bulkPayoutSchema.parse(req.body);

    const results: any[] = [];
    const errors: any[] = [];

    for (const invoiceId of invoiceIds) {
        try {
            const invoice = await prisma.invoice.findUnique({
                where: { id: invoiceId },
                include: { vendor: true, matchedPo: true },
            });

            if (!invoice) { errors.push({ invoiceId, error: 'Invoice not found' }); continue; }
            if (invoice.status !== 'approved') { errors.push({ invoiceId, error: 'Invoice not approved' }); continue; }
            if (!invoice.vendor) { errors.push({ invoiceId, error: 'No vendor linked' }); continue; }

            const vendor = invoice.vendor as typeof invoice.vendor & { stripeAccountId?: string | null };
            if (!vendor.stripeAccountId) { errors.push({ invoiceId, error: 'Vendor has no Stripe Connect account' }); continue; }

            const totalAmount = Number(invoice.totalAmount || 0);
            if (!totalAmount) { errors.push({ invoiceId, error: 'Invoice has no total amount' }); continue; }

            const existing = await prisma.payment.findFirst({
                where: { invoiceId, status: { in: ['scheduled', 'processing', 'paid'] } },
            });
            if (existing) { errors.push({ invoiceId, error: 'Payout already exists' }); continue; }

            const amountInCents = Math.round(totalAmount * 100);
            const transfer = await transferToVendor({
                amount: amountInCents,
                stripeAccountId: vendor.stripeAccountId,
                description: description || `Bulk payout for Invoice ${invoice.invoiceNumber}`,
            });

            const payment = await prisma.payment.create({
                data: {
                    invoiceId,
                    amountPaid: totalAmount,
                    currency: 'USD',
                    stripeId: transfer.id,
                    status: 'paid',
                    paidAt: new Date(),
                    poId: invoice.matchedPoId || undefined,
                },
            });

            const newPaid = Number(invoice.amountPaid || 0) + totalAmount;
            const isPaid = newPaid >= totalAmount;

            await prisma.invoice.update({
                where: { id: invoiceId },
                data: {
                    status: isPaid ? 'paid' : 'payment_processing',
                    amountPaid: newPaid,
                    amountDue: Math.max(0, totalAmount - newPaid)
                }
            });

            if (invoice.matchedPoId && invoice.matchedPo) {
                const newRemaining = Math.max(0, Number(invoice.matchedPo.remainingAmount || 0) - totalAmount);
                await prisma.purchaseOrder.update({
                    where: { id: invoice.matchedPoId },
                    data: { remainingAmount: newRemaining, status: newRemaining <= 0 ? 'closed' : invoice.matchedPo.status },
                });
            }

            await prisma.auditLog.create({
                data: {
                    entityType: 'payment',
                    entityId: payment.id,
                    eventType: 'stripe_payout_created',
                    actor: 'system',
                    invoiceId: invoice.id,
                    paymentId: payment.id,
                    metadata: { stripeTransferId: transfer.id, amount: totalAmount } as any,
                },
            });

            results.push({ invoiceId, paymentId: payment.id, transferId: transfer.id });
        } catch (err: any) {
            errors.push({ invoiceId, error: err.message || 'Unknown error' });
        }
    }

    return res.json(
        new ApiResponse(200, 'Bulk Stripe payout processing completed', {
            successful: results.length,
            failed: errors.length,
            results,
            errors,
        })
    );
});

// ─── n8n Payout Trigger ───────────────────────────
export const triggerN8nPayout = asyncHandler(async (req: Request, res: Response) => {
    const n8nWebhookUrl = `${process.env['N8N__WEBHOOK_URL']}/payouts`;
    if (!n8nWebhookUrl) {
        throw new ApiError(500, 'N8N payout trigger webhook URL is not configured');
    }

    // Determine if single or bulk
    const isBulk = Array.isArray(req.body);
    const data = isBulk ? req.body : [req.body];

    // Log the request
    console.log(`Triggering ${isBulk ? 'bulk' : 'single'} payout via n8n:`, data.length, 'items');

    let n8nResponse: any = { success: false };
    let n8nError = null;

    try {
        const response = await fetch(n8nWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                payouts: data,
                isBulk,
                source: 'api_payout_trigger',
                triggeredAt: new Date().toISOString(),
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
        console.error('N8N Payout Trigger Error:', error);
        n8nError = error.message;
    }

    return res.json(new ApiResponse(200, 'Payout request forwarded to n8n', {
        isBulk,
        count: data.length,
        n8nStatus: {
            sent: !n8nError,
            response: n8nResponse,
            error: n8nError
        }
    }));
});