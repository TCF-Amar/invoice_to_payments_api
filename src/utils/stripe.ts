// utils/stripe.ts
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2026-04-22.dahlia',
});

interface VendorAccountPayload {
    email: string;
}

interface OnboardingLinkPayload {
    accountId: string;
}

interface TransferPayload {
    amount: number;
    stripeAccountId: string;
    description?: string;
}

// Creates a Stripe Express Connected Account for a vendor
export async function createStripeVendorAccount(data: VendorAccountPayload) {
    return await stripe.accounts.create({
        type: 'express',
        country: 'US',
        email: data.email,
    });
}

// Generates an onboarding link for vendor KYC
export async function createVendorOnboardingLink({ accountId }: OnboardingLinkPayload) {
    const baseUrl = process.env.APP_URL || 'http://localhost:3000';
    return await stripe.accountLinks.create({
        account: accountId,
        refresh_url: `${baseUrl}/reauth`,
        return_url: `${baseUrl}/success`,
        type: 'account_onboarding',
    });
}

// Transfers funds to a vendor's connected account
export async function transferToVendor(data: TransferPayload) {
    return await stripe.transfers.create({
        amount: data.amount,
        currency: 'usd',
        destination: data.stripeAccountId,
        ...(data.description && { description: data.description }),
    });
}

// Retrieves full account details from Stripe (to check onboarding/restrictions)
export async function getStripeAccount(accountId: string) {
    return await stripe.accounts.retrieve(accountId);
}