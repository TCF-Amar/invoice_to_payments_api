import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma.js';
import { ApiError, ApiResponse, asyncHandler } from '../utils/helpers.js';
import * as cashfree from '../utils/cashfree.js';

const setupBeneficiarySchema = z.object({
    vendorId: z.string().uuid(),
    beneficiaryName: z.string(),
    bankAccount: z.string().optional(),
    ifsc: z.string().optional(),
    vpa: z.string().optional(),
    phone: z.string(),
    email: z.string().email(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    pincode: z.string().optional(),
});

const createPayoutSchema = z.object({
    invoiceId: z.string().uuid(),
    amount: z.number().positive(),
    description: z.string().optional(),
});

/**
 * POST /api/v1/payouts/cashfree/setup-beneficiary
 * Creates a beneficiary on Cashfree for a vendor
 */
export const setupCashfreeBeneficiary = asyncHandler(async (req: Request, res: Response) => {
    const data = setupBeneficiarySchema.parse(req.body);

    const vendor = await prisma.vendor.findUnique({ where: { id: data.vendorId } });
    if (!vendor) throw new ApiError(404, 'Vendor not found');

    // Generate a unique beneficiary ID if not provided
    const beneficiaryId = (vendor as any).cashfreeBeneficiaryId || `BEN_${vendor.id.slice(0, 8)}_${Date.now()}`;

    const cfData: cashfree.CashfreeBeneficiaryDetails = {
        beneficiary_id: beneficiaryId,
        beneficiary_name: data.beneficiaryName,
        beneficiary_instrument_details: {
            bank_account_number: data.bankAccount,
            bank_ifsc: data.ifsc,
            vpa: data.vpa,
        },
        beneficiary_contact_details: {
            beneficiary_email: data.email,
            beneficiary_phone: data.phone,
            beneficiary_country_code: "+91",
            beneficiary_address: data.address,
            beneficiary_city: data.city,
            beneficiary_state: data.state,
            beneficiary_postal_code: data.pincode,
        }
    };

    const response = await cashfree.createBeneficiary(cfData);

    await prisma.vendor.update({
        where: { id: data.vendorId },
        data: { cashfreeBeneficiaryId: beneficiaryId },
    });

    return res.status(201).json(
        new ApiResponse(201, 'Cashfree beneficiary setup successful', {
            beneficiaryId,
            cashfreeResponse: response
        })
    );
});

/**
 * GET /api/v1/payouts/cashfree/beneficiary/:vendorId
 * Fetches beneficiary details from Cashfree
 */
export const getCashfreeBeneficiaryDetails = asyncHandler(async (req: Request, res: Response) => {
    const vendorId = req.params.vendorId as string;
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
    
    if (!vendor) throw new ApiError(404, 'Vendor not found');
    const cashfreeBeneficiaryId = (vendor as any).cashfreeBeneficiaryId;
    if (!cashfreeBeneficiaryId) throw new ApiError(400, 'Vendor has no Cashfree beneficiary setup');

    const response = await cashfree.getBeneficiary(cashfreeBeneficiaryId);
    return res.json(new ApiResponse(200, 'Beneficiary details fetched', response));
});

/**
 * POST /api/v1/payouts/cashfree
 * Initiates a transfer for an invoice
 */
export const createCashfreePayout = asyncHandler(async (req: Request, res: Response) => {
    const data = createPayoutSchema.parse(req.body);

    const invoice = await prisma.invoice.findUnique({
        where: { id: data.invoiceId },
        include: { vendor: true, matchedPo: true },
    });

    if (!invoice) throw new ApiError(404, 'Invoice not found');
    if (!invoice.vendor) throw new ApiError(400, 'Invoice has no vendor linked');
    
    const vendor = invoice.vendor as any;
    if (!vendor.cashfreeBeneficiaryId) throw new ApiError(400, 'Vendor has no Cashfree beneficiary setup');

    const transferId = `TXN_${Date.now()}`;
    const payload: cashfree.CashfreeTransferPayload = {
        transfer_id: transferId,
        transfer_amount: data.amount,
        transfer_currency: invoice.currency === 'USD' ? 'INR' : invoice.currency, // Cashfree Payouts is usually INR
        beneficiary_details: {
            beneficiary_id: vendor.cashfreeBeneficiaryId
        }
    };

    const response = await cashfree.transferPayment(payload);

    // Create payment record
    const payment = await prisma.payment.create({
        data: {
            invoiceId: invoice.id,
            amountPaid: data.amount,
            currency: payload.transfer_currency || 'INR',
            cashfreeTransferId: transferId,
            status: response.status === 'RECEIVED' ? 'processing' : 'failed',
            poId: invoice.matchedPoId || undefined,
        },
    });

    // Update invoice status if needed
    if (response.status === 'RECEIVED') {
        const newPaid = Number(invoice.amountPaid || 0) + data.amount;
        await prisma.invoice.update({
            where: { id: invoice.id },
            data: {
                status: 'payment_processing',
                amountPaid: newPaid,
            }
        });
    }

    return res.status(201).json(
        new ApiResponse(201, 'Cashfree transfer initiated', {
            paymentId: payment.id,
            transferId,
            cashfreeResponse: response
        })
    );
});

/**
 * GET /api/v1/payouts/cashfree/status/:transferId
 */
export const getCashfreeTransferStatus = asyncHandler(async (req: Request, res: Response) => {
    const transferId = req.params.transferId as string;
    const response = await cashfree.getTransferStatus(transferId);
    
    // Sync with database status if needed
    // ...
    
    return res.json(new ApiResponse(200, 'Transfer status fetched', response));
});
