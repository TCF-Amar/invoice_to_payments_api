import Razorpay from 'razorpay';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Razorpay instance
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || '',
  key_secret: process.env.RAZORPAY_KEY_SECRET || '',
});

export default razorpay;

// ─── Types ────────────────────────────────────────────
export interface RazorpayContactData {
  name: string;
  email?: string;
  contact?: string;
  type: 'vendor' | 'customer';
  reference_id?: string;
  notes?: Record<string, any>;
}

export interface RazorpayFundAccountData {
  contact_id: string;
  account_type: 'bank_account' | 'vpa' | 'card';
  bank_account?: {
    name: string;
    ifsc: string;
    account_number: string;
  };
  vpa?: {
    address: string;
  };
}

export interface RazorpayPayoutData {
  account_number: string;
  fund_account_id: string;
  amount: number; // in paise (smallest currency unit)
  currency: string;
  mode: 'IMPS' | 'NEFT' | 'RTGS' | 'UPI';
  purpose: 'refund' | 'cashback' | 'payout' | 'salary' | 'utility bill' | 'vendor bill';
  queue_if_low_balance?: boolean;
  reference_id?: string;
  narration?: string;
  notes?: Record<string, any>;
}

// ─── Helper Functions ─────────────────────────────────

/**
 * Create a contact in Razorpay for vendor
 */
export async function createRazorpayContact(data: RazorpayContactData) {
  try {
    // @ts-ignore - Razorpay types may not be complete
    const contact = await razorpay.contacts.create(data);
    return { success: true, data: contact };
  } catch (error: any) {
    console.error('Razorpay Contact Creation Error:', error);
    return { success: false, error: error.error || error.message };
  }
}

/**
 * Create a fund account for vendor
 */
export async function createRazorpayFundAccount(data: RazorpayFundAccountData): Promise<{ success: true; data: any } | { success: false; error: any; data?: undefined }> {
  try {
    // @ts-ignore - Razorpay types may not be complete
    const fundAccount = await razorpay.fundAccount.create(data);
    return { success: true, data: fundAccount };
  } catch (error: any) {
    console.error('Razorpay Fund Account Creation Error:', error);
    return { success: false, error: error.error || error.message };
  }
}

/**
 * Create a payout to vendor
 */
export async function createRazorpayPayout(data: RazorpayPayoutData) {
  try {
    // @ts-ignore - Razorpay types may not be complete
    const payout = await razorpay.payouts.create(data);
    return { success: true, data: payout };
  } catch (error: any) {
    console.error('Razorpay Payout Creation Error:', error);
    return { success: false, error: error.error || error.message };
  }
}

/**
 * Get payout details by ID
 */
export async function getRazorpayPayout(payoutId: string) {
  try {
    // @ts-ignore - Razorpay types may not be complete
    const payout = await razorpay.payouts.fetch(payoutId);
    return { success: true, data: payout };
  } catch (error: any) {
    console.error('Razorpay Payout Fetch Error:', error);
    return { success: false, error: error.error || error.message };
  }
}

/**
 * Cancel a queued payout
 */
export async function cancelRazorpayPayout(payoutId: string) {
  try {
    // @ts-ignore - Razorpay types may not be complete
    const payout = await razorpay.payouts.cancel(payoutId);
    return { success: true, data: payout };
  } catch (error: any) {
    console.error('Razorpay Payout Cancel Error:', error);
    return { success: false, error: error.error || error.message };
  }
}

/**
 * Verify Razorpay webhook signature
 */
export function verifyRazorpayWebhook(
  webhookBody: string,
  webhookSignature: string,
  webhookSecret: string
): boolean {
  try {
    const crypto = require('crypto');
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(webhookBody)
      .digest('hex');
    
    return expectedSignature === webhookSignature;
  } catch (error) {
    console.error('Webhook verification error:', error);
    return false;
  }
}

/**
 * Convert amount to paise (smallest currency unit)
 */
export function convertToPaise(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Convert paise to rupees
 */
export function convertToRupees(paise: number): number {
  return paise / 100;
}
