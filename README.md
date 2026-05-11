# Invoice-to-Payment API

Node.js + TypeScript + Prisma + PostgreSQL

## Setup

```bash
cp .env.example .env
# Edit DATABASE_URL in .env

npm install
npm run db:generate
npm run db:push
npm run db:seed
npm run dev
```

## API Endpoints

### Health
GET /health

### Vendors
GET    /api/v1/vendors
GET    /api/v1/vendors/:id
GET    /api/v1/vendors/by-name/:name     ← n8n uses this
POST   /api/v1/vendors
PATCH  /api/v1/vendors/:id
DELETE /api/v1/vendors/:id

### Purchase Orders
GET    /api/v1/purchase-orders
GET    /api/v1/purchase-orders/:id
GET    /api/v1/purchase-orders/by-number/:poNumber  ← n8n uses this
POST   /api/v1/purchase-orders
PATCH  /api/v1/purchase-orders/:id
PATCH  /api/v1/purchase-orders/:id/status
DELETE /api/v1/purchase-orders/:id

### Invoices
GET    /api/v1/invoices
GET    /api/v1/invoices/:id
GET    /api/v1/invoices/by-number/:invoiceNumber   ← n8n uses this
GET    /api/v1/invoices/approved-unpaid            ← n8n daily cron
GET    /api/v1/invoices/duplicate/:invoiceNumber   ← n8n duplicate check
POST   /api/v1/invoices                            ← n8n after AI extraction
PATCH  /api/v1/invoices/:id
PATCH  /api/v1/invoices/:id/status                 ← n8n verdict update
DELETE /api/v1/invoices/:id

### Payments
GET    /api/v1/payments/invoice/:invoiceId
POST   /api/v1/payments                            ← Stripe webhook
PATCH  /api/v1/payments/:id/status                 ← Stripe confirmation

## n8n → API Flow

1. PDF Upload → n8n Webhook
2. AI Extract → POST /api/v1/invoices (create with status=received)
3. Fetch full invoice → GET /api/v1/invoices/by-number/:number
4. Validate in n8n (Code Node)
5. Verdict → PATCH /api/v1/invoices/:id/status
6. approved → Stripe payment initiate
7. Stripe webhook → POST /api/v1/payments
8. Daily cron → GET /api/v1/invoices/approved-unpaid
