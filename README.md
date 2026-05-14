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

### Stripe Payouts
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/payouts/stripe/setup-vendor` | Create Stripe account & get onboarding link |
| GET | `/api/v1/payouts/stripe/onboarding-link/:vendorId` | Refresh expired onboarding link |
| GET | `/api/v1/payouts/stripe/status/:vendorId` | Check if vendor is "Restricted" or "Enabled" |
| POST | `/api/v1/payouts/stripe` | Initiate transfer for an approved invoice |
| POST | `/api/v1/payouts/stripe/bulk` | Bulk payout for multiple invoices |

### Invoices
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/invoices` | List all (supports status/vendor filtering) |
| GET | `/api/v1/invoices/approved-unpaid` | Fetch all approved invoices pending payment |
| POST | `/api/v1/invoices` | Create invoice (after AI extraction) |
| PATCH | `/api/v1/invoices/:id/status` | Approve/Reject invoice |

### Ticketing
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/tickets` | Raise a support ticket |
| GET | `/api/v1/tickets` | List all tickets |
| PATCH | `/api/v1/tickets/:id` | Update ticket status/priority |

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

