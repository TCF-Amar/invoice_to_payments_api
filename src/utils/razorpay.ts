import Razorpay from 'razorpay';
import crypto from 'crypto';
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
    address: string; // UPI VPA, e.g. vendor@upi
  };
}

export interface RazorpayPayoutData {
  account_number: string;
  fund_account_id: string;
  amount: number; // in paise
  currency: string;
  mode: 'IMPS' | 'NEFT' | 'RTGS' | 'UPI';
  purpose: 'refund' | 'cashback' | 'payout' | 'salary' | 'utility bill' | 'vendor bill';
  queue_if_low_balance?: boolean;
  reference_id?: string;
  narration?: string;
  notes?: Record<string, any>;
}

// ─── Contact Functions ─────────────────────────────────

/**
 * Create a contact in Razorpay for a vendor
 */
export async function createRazorpayContact(data: RazorpayContactData) {
  try {
    // @ts-ignore
    const contact = await razorpay.contacts.create(data);
    return { success: true as const, data: contact };
  } catch (error: any) {
    console.error('Razorpay Contact Creation Error:', error);
    return { success: false as const, error: error.error?.description || error.message };
  }
}

/**
 * Fetch all contacts
 */
export async function fetchRazorpayContacts(params?: { count?: number; skip?: number }) {
  try {
    // @ts-ignore
    const contacts = await razorpay.contacts.all(params || {});
    return { success: true as const, data: contacts };
  } catch (error: any) {
    console.error('Razorpay Contacts Fetch Error:', error);
    return { success: false as const, error: error.error?.description || error.message };
  }
}

/**
 * Fetch a single contact by ID
 */
export async function fetchRazorpayContact(contactId: string) {
  try {
    // @ts-ignore
    const contact = await razorpay.contacts.fetch(contactId);
    return { success: true as const, data: contact };
  } catch (error: any) {
    console.error('Razorpay Contact Fetch Error:', error);
    return { success: false as const, error: error.error?.description || error.message };
  }
}

// ─── Fund Account Functions ────────────────────────────

/**
 * Create a fund account (bank account or VPA) for a contact
 */
export async function createRazorpayFundAccount(data: RazorpayFundAccountData): Promise<{ success: true; data: any } | { success: false; error: any; data?: undefined }> {
  try {
    // @ts-ignore
    const fundAccount = await razorpay.fundAccount.create(data);
    return { success: true, data: fundAccount };
  } catch (error: any) {
    console.error('Razorpay Fund Account Creation Error:', error);
    return { success: false, error: error.error?.description || error.message };
  }
}

/**
 * Fetch all fund accounts (optionally filtered by contact_id)
 */
export async function fetchRazorpayFundAccounts(params?: { contact_id?: string; count?: number; skip?: number }) {
  try {
    // @ts-ignore
    const accounts = await razorpay.fundAccount.all(params || {});
    return { success: true as const, data: accounts };
  } catch (error: any) {
    console.error('Razorpay Fund Accounts Fetch Error:', error);
    return { success: false as const, error: error.error?.description || error.message };
  }
}

/**
 * Fetch a single fund account by ID
 */
export async function fetchRazorpayFundAccount(fundAccountId: string) {
  try {
    // @ts-ignore
    const account = await razorpay.fundAccount.fetch(fundAccountId);
    return { success: true as const, data: account };
  } catch (error: any) {
    console.error('Razorpay Fund Account Fetch Error:', error);
    return { success: false as const, error: error.error?.description || error.message };
  }
}

/**
 * Activate or deactivate a fund account
 */
export async function toggleRazorpayFundAccount(fundAccountId: string, active: boolean) {
  try {
    // @ts-ignore
    const account = await razorpay.fundAccount.update(fundAccountId, { active });
    return { success: true as const, data: account };
  } catch (error: any) {
    console.error('Razorpay Fund Account Toggle Error:', error);
    return { success: false as const, error: error.error?.description || error.message };
  }
}

// ─── Payout Functions ─────────────────────────────────

/**
 * Create a payout to a vendor fund account
 */
export async function createRazorpayPayout(data: RazorpayPayoutData) {
  try {
    // @ts-ignore
    const payout = await razorpay.payouts.create(data);
    return { success: true as const, data: payout };
  } catch (error: any) {
    console.error('Razorpay Payout Creation Error:', error);
    return { success: false as const, error: error.error?.description || error.message };
  }
}

/**
 * Fetch all payouts for an account number
 */
export async function fetchAllRazorpayPayouts(params: { account_number: string; count?: number; skip?: number }) {
  try {
    // @ts-ignore
    const payouts = await razorpay.payouts.all(params);
    return { success: true as const, data: payouts };
  } catch (error: any) {
    console.error('Razorpay Payouts Fetch Error:', error);
    return { success: false as const, error: error.error?.description || error.message };
  }
}

/**
 * Fetch a single payout by ID
 */
export async function getRazorpayPayout(payoutId: string) {
  try {
    // @ts-ignore
    const payout = await razorpay.payouts.fetch(payoutId);
    return { success: true as const, data: payout };
  } catch (error: any) {
    console.error('Razorpay Payout Fetch Error:', error);
    return { success: false as const, error: error.error?.description || error.message };
  }
}

/**
 * Cancel a queued payout
 */
export async function cancelRazorpayPayout(payoutId: string) {
  try {
    // @ts-ignore
    const payout = await razorpay.payouts.cancel(payoutId);
    return { success: true as const, data: payout };
  } catch (error: any) {
    console.error('Razorpay Payout Cancel Error:', error);
    return { success: false as const, error: error.error?.description || error.message };
  }
}

// ─── Banking Balance Functions ────────────────────────

/**
 * Fetch balances of all banking accounts
 */
export async function fetchBankingBalances(params?: {
  account_type?: 'current_account' | 'razorpayx_lite';
  bank_code?: string;
  count?: number;
  skip?: number;
}) {
  try {
    const query = new URLSearchParams();
    if (params?.account_type) query.append('account_type', params.account_type);
    if (params?.bank_code) query.append('bank_code', params.bank_code);
    if (params?.count) query.append('count', String(params.count));
    if (params?.skip) query.append('skip', String(params.skip));

    const url = `https://api.razorpay.com/v1/banking_balances?${query.toString()}`;
    const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json() as any;

    if (!response.ok) {
      return { success: false as const, error: data.error?.description || 'Failed to fetch balances' };
    }

    return { success: true as const, data };
  } catch (error: any) {
    console.error('Razorpay Banking Balance Error:', error);
    return { success: false as const, error: error.message };
  }
}

// ─── Webhook Verification ─────────────────────────────

/**
 * Verify Razorpay webhook signature
 */
export function verifyRazorpayWebhook(
  webhookBody: string,
  webhookSignature: string,
  webhookSecret: string
): boolean {
  try {
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

// ─── Amount Conversion ────────────────────────────────

/** Convert rupees to paise */
export function convertToPaise(amount: number): number {
  return Math.round(amount * 100);
}

/** Convert paise to rupees */
export function convertToRupees(paise: number): number {
  return paise / 100;
}
