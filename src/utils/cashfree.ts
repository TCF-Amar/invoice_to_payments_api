import axios from "axios";

const baseUrl = process.env.CASHFREE_BASE_URL || 'https://sandbox.cashfree.com/payout';
const clientId = process.env.CASHFREE_CLIENT_ID;
const clientSecret = process.env.CASHFREE_CLIENT_SECRET;

const axiosInstance = axios.create({
    baseURL: baseUrl,
    headers: {
        'x-client-id': clientId,
        'x-client-secret': clientSecret,
        'x-api-version': '2024-01-01',
        'Content-Type': 'application/json',
    }
});

export interface CashfreeBeneficiaryDetails {
    beneficiary_id: string;
    beneficiary_name: string;
    beneficiary_instrument_details: {
        bank_account_number?: string;
        bank_ifsc?: string;
        vpa?: string;
    };
    beneficiary_contact_details: {
        beneficiary_email: string;
        beneficiary_phone: string;
        beneficiary_country_code: string;
        beneficiary_address?: string;
        beneficiary_city?: string;
        beneficiary_state?: string;
        beneficiary_postal_code?: string;
    };
}

export interface CashfreeTransferPayload {
    transfer_id: string;
    transfer_amount: number;
    transfer_currency?: string;
    transfer_mode?: string;
    beneficiary_details: {
        beneficiary_id: string;
    };
}

export const createBeneficiary = async (data: CashfreeBeneficiaryDetails) => {
    const response = await axiosInstance.post('/beneficiary', data);
    return response.data;
};

export const getBeneficiary = async (beneficiaryId: string) => {
    const response = await axiosInstance.get(`/beneficiary/${beneficiaryId}`);
    return response.data;
};

export const transferPayment = async (data: CashfreeTransferPayload) => {
    const response = await axiosInstance.post('/transfers', data);
    return response.data;
};

export const getTransferStatus = async (transferId: string) => {
    const response = await axiosInstance.get(`/transfers/${transferId}`);
    return response.data;
};

