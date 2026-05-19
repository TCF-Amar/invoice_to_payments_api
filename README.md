# Invoice-to-Payment API (Stripe Edition)

A comprehensive invoice management and payment processing API built with Node.js, TypeScript, Prisma, and PostgreSQL. This system automates invoice processing, vendor management, purchase order tracking, and vendor payouts via **Stripe Connect**.

## 🚀 Features

- **Vendor Management**: CRUD operations for vendor profiles with automated Stripe Express account creation.
- **Stripe Connect Payouts**: 
  - Automated Express account setup for vendors.
  - Seamless onboarding via generated Stripe links.
  - Real-time status tracking (Enabled/Restricted) for payouts.
  - Secure platform-to-vendor fund transfers.
- **Purchase Order Tracking**: Manage POs with line items, approval amounts, and delivery tracking.
- **Invoice Lifecycle**: Automated invoice ingestion with AI-ready endpoints, duplicate detection, and validation.
- **Ticketing System**: Support desk for vendors and admins to raise and track issues related to invoices/payments.
- **Audit Logging**: Comprehensive audit trail for every entity change and financial transaction.

## 🛠️ Tech Stack

- **Runtime**: Node.js (v18+) with TypeScript
- **Database**: PostgreSQL with Prisma ORM
- **Payment Processing**: Stripe Connect (Express)
- **Validation**: Zod
- **Workflow Integration**: n8n optimized endpoints

## 🌿 Git Branches

- **`api-v1`**: Working branch for Version 1 of the API.
- **`api-v2`**: Current working branch (active development).

## ⚙️ Setup

### 1. Installation
```bash
npm install
```

### 2. Environment Configuration
```powershell
cp .env .env.example
```

### 3. Database Initialization
```bash
npx prisma db push
npm run db:seed
```

## 📚 API Endpoints

All endpoints are prefixed with `/api/v1`.

### 🏢 Vendors
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/vendors` | List all vendors |
| GET | `/vendors/:id` | Get vendor by ID |
| GET | `/vendors/by-name/:name` | Get vendor by name (n8n use) |
| GET | `/vendors/by-email/:email` | Get vendor by email |
| POST | `/vendors` | Create a new vendor |
| PATCH | `/vendors/:id` | Update vendor profile |
| DELETE | `/vendors/:id` | Delete a vendor |

### 📦 Purchase Orders
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/purchase-orders` | List all purchase orders |
| GET | `/purchase-orders/:id` | Get PO by ID |
| GET | `/purchase-orders/by-number/:poNumber` | Get PO by number (n8n use) |
| GET | `/purchase-orders/vendor-sync/:vendorId` | PO sync for vendor-bot |
| POST | `/purchase-orders` | Create PO (auto-creates vendor if needed) |
| PATCH | `/purchase-orders/:id` | Update PO fields and line items |
| PATCH | `/purchase-orders/:id/status` | Update PO status generally |
| PATCH | `/purchase-orders/:id/submit` | Submit draft PO for approval |
| PATCH | `/purchase-orders/:id/approve` | Approve a pending PO (Admin) |
| PATCH | `/purchase-orders/:id/reject` | Reject a pending PO (Admin) |
| DELETE | `/purchase-orders/:id` | Delete a PO (Draft/Rejected/Cancelled only) |

### 📄 Invoices
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/invoices` | List all invoices (with status/vendor filters) |
| GET | `/invoices/:id` | Get invoice by ID |
| GET | `/invoices/approved-unpaid` | Get all approved invoices pending payment (n8n cron) |
| GET | `/invoices/duplicate/:invoiceNumber` | Check for duplicate invoice numbers |
| GET | `/invoices/by-number/:invoiceNumber` | Get invoice by number |
| POST | `/invoices` | Create invoice (after AI parsing) |
| PATCH | `/invoices/:id` | Update invoice |
| PATCH | `/invoices/:id/status` | Approve/Reject invoice (n8n verdict) |
| DELETE | `/invoices/:id` | Delete an invoice |
| POST | `/invoices/upload-links/generate` | Generate temporary upload link token |
| POST | `/invoices/upload-links/send` | Email upload link token to vendor |
| GET | `/invoices/upload-links/validate/:token` | Validate temporary upload link token |
| POST | `/invoices/upload` | Upload invoice file (multipart/form-data) |
| POST | `/emails/send` | Send generic proxy email |

### 💳 Payments
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/payments` | Get payment table data |
| GET | `/payments/invoice/:invoiceId` | Get payments associated with an invoice |
| POST | `/payments` | Log a new payment (triggered by Stripe Webhook) |
| PATCH | `/payments/:id/status` | Update payment status (Stripe confirmation) |

### 💸 Stripe Payouts
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/payouts/stripe/setup-vendor` | Setup Stripe Express account and onboarding link |
| GET | `/payouts/stripe/onboarding-link/:vendorId` | Refresh expired Stripe onboarding link |
| GET | `/payouts/stripe/status/:vendorId` | Check Stripe account status (Enabled/Restricted) |
| POST | `/payouts/stripe` | Create Stripe transfer for an approved invoice |
| POST | `/payouts/stripe/bulk` | Create bulk Stripe transfers for invoices |
| POST | `/payouts/trigger` | Trigger payout automation workflow (n8n webhook) |

### 🎫 Tickets (Support desk)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/tickets` | List all support tickets |
| GET | `/tickets/:id` | Get support ticket details |
| POST | `/tickets` | Raise a support ticket |
| PATCH | `/tickets/:id` | Update ticket details |
| PATCH | `/tickets/:id/status` | Resolve/update ticket status |


## 🔄 Vendor Payout Workflow

1. **Vendor Setup**: Platform calls `/setup-vendor`. A Stripe Express ID is generated.
2. **Onboarding**: Vendor completes the KYC via the returned `onboardingUrl`.
3. **Status Check**: Platform verifies `isEnabled: true` via `/status/:vendorId`.
4. **Approval**: Admin approves an invoice.
5. **Payout**: Platform calls `POST /api/v1/payouts/stripe`. Funds are transferred to the vendor's Stripe balance.

## 🗄️ Database Schema
- **Vendor**: Profile + `stripeAccountId`.
- **Invoice**: Financial record + relational `InvoiceLineItem`.
- **Payment**: Tracking for Stripe Transfers.
- **AuditLog**: System-wide event tracking.
- **Ticket**: Issue tracking linked to Vendors/Invoices.

