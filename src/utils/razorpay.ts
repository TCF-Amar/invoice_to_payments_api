import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

// ─── Base HTTP Helper ──────────────────────────────────

const BASE_URL = 'https://api.razorpay.com/v1';

function getAuthHeader(): string {
  const key = process.env.RAZORPAY_KEY_ID || '';
  const secret = process.env.RAZORPAY_KEY_SECRET || '';
  return 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64');
}

async function razorpayRequest<T = any>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: Record<string, any>,
  queryParams?: Record<string, string | number | undefined>
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  try {
    let url = `${BASE_URL}${path}`;

    if (queryParams) {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(queryParams)) {
        if (v !== undefined) q.append(k, String(v));
      }
      const qs = q.toString();
      if (qs) url += `?${qs}`;
    }

    const res = await fetch(url, {
      method,
      headers: {
        Authorization: getAuthHeader(),
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const data: any = await res.json();

    if (!res.ok) {
      const message = data?.error?.description || data?.error?.reason || JSON.stringify(data?.error) || 'Razorpay API error';
      return { success: false, error: message };
    }

    return { success: true, data: data as T };
  } catch (err: any) {
    console.error(`[Razorpay] ${method} ${path} failed:`, err.message);
    return { success: false, error: err.message || 'Network error' };
  }
}

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
  amount: number; // in paise
  currency: string;
  mode: 'IMPS' | 'NEFT' | 'RTGS' | 'UPI';
  purpose: 'refund' | 'cashback' | 'payout' | 'salary' | 'utility bill' | 'vendor bill';
  queue_if_low_balance?: boolean;
  reference_id?: string;
  narration?: string;
  notes?: Record<string, any>;
}

// ─── Contact APIs ─────────────────────────────────────

/** POST /v1/contacts */
export function createRazorpayContact(data: RazorpayContactData) {
  return razorpayRequest('POST', '/contacts', data);
}

/** GET /v1/contacts */
export function fetchRazorpayContacts(params?: { count?: number; skip?: number }) {
  return razorpayRequest('GET', '/contacts', undefined, params as any);
}

/** GET /v1/contacts/:id */
export function fetchRazorpayContact(contactId: string) {
  return razorpayRequest('GET', `/contacts/${contactId}`);
}

/** PATCH /v1/contacts/:id — activate or deactivate */
export function toggleRazorpayContact(contactId: string, active: boolean) {
  return razorpayRequest('PATCH', `/contacts/${contactId}`, { active });
}

// ─── Fund Account APIs ────────────────────────────────

/** POST /v1/fund_accounts */
export function createRazorpayFundAccount(data: RazorpayFundAccountData) {
  return razorpayRequest('POST', '/fund_accounts', data);
}

/** GET /v1/fund_accounts */
export function fetchRazorpayFundAccounts(params?: { contact_id?: string; count?: number; skip?: number }) {
  return razorpayRequest('GET', '/fund_accounts', undefined, params as any);
}

/** GET /v1/fund_accounts/:id */
export function fetchRazorpayFundAccount(fundAccountId: string) {
  return razorpayRequest('GET', `/fund_accounts/${fundAccountId}`);
}

/** PATCH /v1/fund_accounts/:id — activate or deactivate */
export function toggleRazorpayFundAccount(fundAccountId: string, active: boolean) {
  return razorpayRequest('PATCH', `/fund_accounts/${fundAccountId}`, { active });
}

// ─── Payout APIs ──────────────────────────────────────

/** POST /v1/payouts */
export function createRazorpayPayout(data: RazorpayPayoutData) {
  return razorpayRequest('POST', '/payouts', data);
}

/** GET /v1/payouts?account_number=... */
export function fetchAllRazorpayPayouts(params: { account_number: string; count?: number; skip?: number }) {
  return razorpayRequest('GET', '/payouts', undefined, params as any);
}

/** GET /v1/payouts/:id */
export function getRazorpayPayout(payoutId: string) {
  return razorpayRequest('GET', `/payouts/${payoutId}`);
}

/** PATCH /v1/payouts/:id/cancel */
export function cancelRazorpayPayout(payoutId: string) {
  return razorpayRequest('POST', `/payouts/${payoutId}/cancel`);
}

// ─── Banking Balance API ──────────────────────────────

/** GET /v1/banking_balances */
export function fetchBankingBalances(params?: {
  account_type?: 'current_account' | 'razorpayx_lite';
  bank_code?: string;
  count?: number;
  skip?: number;
}) {
  return razorpayRequest('GET', '/banking_balances', undefined, params as any);
}

// ─── Webhook Verification ─────────────────────────────

/** Verify Razorpay webhook HMAC-SHA256 signature */
export function verifyRazorpayWebhook(
  webhookBody: string,
  webhookSignature: string,
  webhookSecret: string
): boolean {
  try {
    const expected = crypto
      .createHmac('sha256', webhookSecret)
      .update(webhookBody)
      .digest('hex');
    return expected === webhookSignature;
  } catch {
    return false;
  }
}

// ─── Amount Helpers ───────────────────────────────────

/** Convert INR rupees → paise */
export function convertToPaise(amount: number): number {
  return Math.round(amount * 100);
}

/** Convert paise → INR rupees */
export function convertToRupees(paise: number): number {
  return paise / 100;
}
