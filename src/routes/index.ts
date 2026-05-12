import { Router } from 'express';
import * as vendorCtrl from '../controllers/vendor.controller.js';
import * as poCtrl from '../controllers/po.controller.js';
import * as invoiceCtrl from '../controllers/invoice.controller.js';
import * as paymentCtrl from '../controllers/payment.controller.js';
import * as payoutCtrl from '../controllers/payout.controller.js';

const router = Router();

// ════════════════════════════════════════════════════
// VENDOR ROUTES
// ════════════════════════════════════════════════════
// GET    /api/v1/vendors                → all vendors
// GET    /api/v1/vendors/:id            → vendor by ID
// GET    /api/v1/vendors/by-name/:name  → vendor by name (n8n)
// POST   /api/v1/vendors                → create vendor
// PATCH  /api/v1/vendors/:id            → update vendor
// DELETE /api/v1/vendors/:id            → delete vendor

router.get   ('/vendors',                              vendorCtrl.getAllVendors);
router.get   ('/vendors/by-name/:name',                 vendorCtrl.getVendorByName);
router.get   ('/vendors/by-email/:email',               vendorCtrl.getVendorByEmail);
router.get   ('/vendors/:id',                           vendorCtrl.getVendorById);
router.post  ('/vendors',                               vendorCtrl.createVendor);
router.patch ('/vendors/:id',                           vendorCtrl.updateVendor);
router.delete('/vendors/:id',                           vendorCtrl.deleteVendor);

// ════════════════════════════════════════════════════
// PURCHASE ORDER ROUTES
// ════════════════════════════════════════════════════
// GET    /api/v1/purchase-orders                      → all POs
// GET    /api/v1/purchase-orders/:id                  → PO by ID
// GET    /api/v1/purchase-orders/by-number/:poNumber  → PO by number (n8n)
// POST   /api/v1/purchase-orders                      → create PO
// PATCH  /api/v1/purchase-orders/:id                  → update PO
// PATCH  /api/v1/purchase-orders/:id/status           → update status
// DELETE /api/v1/purchase-orders/:id                  → delete PO

router.get   ('/purchase-orders',                       poCtrl.getAllPOs);
router.get   ('/purchase-orders/by-number/:poNumber',   poCtrl.getPOByNumber);  // ← n8n uses this
router.get   ('/purchase-orders/:id',                   poCtrl.getPOById);
router.post  ('/purchase-orders',                       poCtrl.createPO);
router.patch ('/purchase-orders/:id',                   poCtrl.updatePO);
router.patch ('/purchase-orders/:id/status',            poCtrl.updatePOStatus);
router.delete('/purchase-orders/:id',                   poCtrl.deletePO);

// ════════════════════════════════════════════════════
// INVOICE ROUTES
// ════════════════════════════════════════════════════
// GET    /api/v1/invoices                              → all invoices
// GET    /api/v1/invoices/approved-unpaid              → cron job (n8n)
// GET    /api/v1/invoices/duplicate/:invoiceNumber     → duplicate check (n8n)
// GET    /api/v1/invoices/by-number/:invoiceNumber     → by number (n8n)
// GET    /api/v1/invoices/:id                          → by ID
// POST   /api/v1/invoices                              → create (n8n after AI)
// PATCH  /api/v1/invoices/:id                          → update
// PATCH  /api/v1/invoices/:id/status                   → update status (n8n verdict)
// DELETE /api/v1/invoices/:id                          → delete

router.get   ('/invoices',                              invoiceCtrl.getAllInvoices);
router.get   ('/invoices/approved-unpaid',              invoiceCtrl.getApprovedUnpaid);   // ← n8n cron
router.get   ('/invoices/duplicate/:invoiceNumber',     invoiceCtrl.checkDuplicate);      // ← n8n check
router.get   ('/invoices/by-number/:invoiceNumber',     invoiceCtrl.getInvoiceByNumber);  // ← n8n fetch
router.get   ('/invoices/:id',                          invoiceCtrl.getInvoiceById);
router.post  ('/invoices',                              invoiceCtrl.createInvoice);
router.patch ('/invoices/:id',                          invoiceCtrl.updateInvoice);
router.patch ('/invoices/:id/status',                   invoiceCtrl.updateInvoiceStatus); // ← n8n verdict
router.delete('/invoices/:id',                          invoiceCtrl.deleteInvoice);

// n8n automation helpers
router.post  ('/invoices/:id/create-payment-intent',    invoiceCtrl.createPaymentIntent);
router.patch ('/invoices/:id/payment-pending',         invoiceCtrl.markPaymentPending);
router.patch ('/invoices/:id/mark-failed',              invoiceCtrl.markFailed);
router.patch ('/invoices/stripe/payment-success',       invoiceCtrl.stripePaymentSuccess);

// ════════════════════════════════════════════════════
// PAYMENT ROUTES
// ════════════════════════════════════════════════════
// GET    /api/v1/payments/invoice/:invoiceId  → payments by invoice
// POST   /api/v1/payments                     → create payment (Stripe webhook)
// PATCH  /api/v1/payments/:id/status          → update status (Stripe confirm)

router.get   ('/payments/invoice/:invoiceId',           paymentCtrl.getPaymentsByInvoice);
router.post  ('/payments',                              paymentCtrl.createPayment);
router.patch ('/payments/:id/status',                   paymentCtrl.updatePaymentStatus);

// ════════════════════════════════════════════════════
// RAZORPAY PAYOUT ROUTES
// ════════════════════════════════════════════════════
// POST   /api/v1/payouts/setup-vendor         → setup vendor for Razorpay payouts
// POST   /api/v1/payouts                      → create payout for invoice
// POST   /api/v1/payouts/bulk                 → create bulk payouts
// GET    /api/v1/payouts/:payoutId            → get payout status
// POST   /api/v1/payouts/:payoutId/cancel     → cancel queued payout
// POST   /api/v1/payouts/webhook              → Razorpay webhook handler

router.post  ('/payouts/setup-vendor',                  payoutCtrl.setupVendorPayout);
router.post  ('/payouts',                               payoutCtrl.createPayout);
router.post  ('/payouts/bulk',                          payoutCtrl.createBulkPayouts);
router.get   ('/payouts/:payoutId',                     payoutCtrl.getPayoutStatus);
router.post  ('/payouts/:payoutId/cancel',              payoutCtrl.cancelPayout);
router.post  ('/payouts/webhook',                       payoutCtrl.handleRazorpayWebhook);

export default router;
