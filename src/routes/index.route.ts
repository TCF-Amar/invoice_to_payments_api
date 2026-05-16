import { Router } from 'express';
import * as vendorCtrl from '../controllers/vendor.controller.js';
import * as poCtrl from '../controllers/po.controller.js';
import * as invoiceCtrl from '../controllers/invoice.controller.js';
import * as paymentCtrl from '../controllers/payment.controller.js';
import * as stripePayoutCtrl from '../controllers/stripe.payout.controller.js';
import * as ticketCtrl from '../controllers/ticket.controller.js';
import { uploadMiddleware } from '../middleware/upload.middleware.js';

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

router.get('/vendors', vendorCtrl.getAllVendors);
router.get('/vendors/by-name/:name', vendorCtrl.getVendorByName);
router.get('/vendors/by-email/:email', vendorCtrl.getVendorByEmail);
router.get('/vendors/:id', vendorCtrl.getVendorById);
router.post('/vendors', vendorCtrl.createVendor);
router.patch('/vendors/:id', vendorCtrl.updateVendor);
router.delete('/vendors/:id', vendorCtrl.deleteVendor);

// ════════════════════════════════════════════════════
// PURCHASE ORDER ROUTES
// ════════════════════════════════════════════════════
// GET    /api/v1/purchase-orders                            → all POs
// GET    /api/v1/purchase-orders/by-number/:poNumber        → PO by number (n8n)
// GET    /api/v1/purchase-orders/vendor-sync/:vendorId      → vendor-bot sync
// GET    /api/v1/purchase-orders/:id                        → PO by ID
// POST   /api/v1/purchase-orders                            → create PO (auto-create vendor)
// PATCH  /api/v1/purchase-orders/:id                        → update PO fields
// PATCH  /api/v1/purchase-orders/:id/status                 → generic status transition
// PATCH  /api/v1/purchase-orders/:id/submit                 → draft → pending_approval
// PATCH  /api/v1/purchase-orders/:id/approve                → pending_approval → approved
// PATCH  /api/v1/purchase-orders/:id/reject                 → pending_approval → rejected
// DELETE /api/v1/purchase-orders/:id                        → delete (draft/rejected/cancelled only)

router.get('/purchase-orders', poCtrl.getAllPOs);
router.get('/purchase-orders/by-number/:poNumber', poCtrl.getPOByNumber);         // ← n8n
router.get('/purchase-orders/vendor-sync/:vendorId', poCtrl.getVendorPOSync);       // ← vendor bot
router.get('/purchase-orders/:id', poCtrl.getPOById);
router.post('/purchase-orders', poCtrl.createPO);
router.patch('/purchase-orders/:id', poCtrl.updatePO);
router.patch('/purchase-orders/:id/status', poCtrl.updatePOStatus);
router.patch('/purchase-orders/:id/submit', poCtrl.submitPOForApproval);   // ← approval flow
router.patch('/purchase-orders/:id/approve', poCtrl.approvePO);              // ← admin
router.patch('/purchase-orders/:id/reject', poCtrl.rejectPO);               // ← admin
router.delete('/purchase-orders/:id', poCtrl.deletePO);

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

router.get('/invoices', invoiceCtrl.getAllInvoices);
router.get('/invoices/approved-unpaid', invoiceCtrl.getApprovedUnpaid);   // ← n8n cron
router.get('/invoices/duplicate/:invoiceNumber', invoiceCtrl.checkDuplicate);      // ← n8n check
router.get('/invoices/by-number/:invoiceNumber', invoiceCtrl.getInvoiceByNumber);  // ← n8n fetch
router.get('/invoices/:id', invoiceCtrl.getInvoiceById);
router.post('/invoices', invoiceCtrl.createInvoice);
router.patch('/invoices/:id', invoiceCtrl.updateInvoice);
router.patch('/invoices/:id/status', invoiceCtrl.updateInvoiceStatus); // ← n8n verdict
router.delete('/invoices/:id', invoiceCtrl.deleteInvoice);
router.post('/invoices/upload-links/generate', invoiceCtrl.generateUploadLink);
router.post('/invoices/upload-links/send', invoiceCtrl.sendUploadLink);
router.get('/invoices/upload-links/validate/:token', invoiceCtrl.validateUploadToken);
router.post('/invoices/upload', uploadMiddleware, invoiceCtrl.uploadInvoice);
router.post('/emails/send', invoiceCtrl.sendGenericEmail);



// ════════════════════════════════════════════════════
// PAYMENT ROUTES
// ════════════════════════════════════════════════════
// GET    /api/v1/payments                     → all payments (table data)
// GET    /api/v1/payments/invoice/:invoiceId  → payments by invoice
// POST   /api/v1/payments                     → create payment (Stripe webhook)
// PATCH  /api/v1/payments/:id/status          → update status (Stripe confirm)

router.get('/payments', paymentCtrl.getPaymentTableData);
router.get('/payments/invoice/:invoiceId', paymentCtrl.getPaymentsByInvoice);
router.post('/payments', paymentCtrl.createPayment);
router.patch('/payments/:id/status', paymentCtrl.updatePaymentStatus);

// ════════════════════════════════════════════════════
// STRIPE PAYOUT ROUTES
// ════════════════════════════════════════════════════
// POST   /api/v1/payouts/stripe/setup-vendor            → setup Stripe Express account
// GET    /api/v1/payouts/stripe/onboarding-link/:vendorId → fresh onboarding link
// POST   /api/v1/payouts/stripe                         → create Stripe transfer
// POST   /api/v1/payouts/stripe/bulk                    → bulk Stripe transfers

router.post('/payouts/stripe/setup-vendor', stripePayoutCtrl.setupVendorStripeAccount);
router.get('/payouts/stripe/onboarding-link/:vendorId', stripePayoutCtrl.getStripeOnboardingLink);
router.get('/payouts/stripe/status/:vendorId', stripePayoutCtrl.checkVendorStripeStatus);
router.post('/payouts/stripe', stripePayoutCtrl.createStripePayout);
router.post('/payouts/stripe/bulk', stripePayoutCtrl.createBulkStripePayouts);
router.post('/payouts/trigger', stripePayoutCtrl.triggerN8nPayout); // ← n8n  

// ════════════════════════════════════════════════════
// TICKET ROUTES
// ════════════════════════════════════════════════════
// POST   /api/v1/tickets                                → raise new ticket
// GET    /api/v1/tickets                                → list all tickets
// GET    /api/v1/tickets/:id                            → get ticket details
// PATCH  /api/v1/tickets/:id                            → update ticket status/priority

router.post('/tickets', ticketCtrl.raiseTicket);
router.get('/tickets', ticketCtrl.listTickets);
router.get('/tickets/:id', ticketCtrl.getTicketById);
router.patch('/tickets/:id', ticketCtrl.updateTicket);
router.patch('/tickets/:id/status', ticketCtrl.updateTicketStatus);

export default router;

