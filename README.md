# Invoice-to-Payment API

A comprehensive invoice management and payment processing API built with Node.js, TypeScript, Prisma, and PostgreSQL. This system automates invoice processing, vendor management, purchase order tracking, and vendor payouts with Razorpay integration and n8n workflow automation.

## 🚀 Features

- **Vendor Management**: Complete CRUD operations for vendor profiles with bank details and verification status
- **Purchase Order Tracking**: Create and manage POs with line items, approval amounts, and status tracking
- **Invoice Processing**: Automated invoice ingestion with AI extraction support, duplicate detection, and validation
- **Razorpay Payouts**: Automated vendor payments via IMPS, NEFT, RTGS, and UPI
- **Audit Logging**: Comprehensive audit trail for all entity changes
- **n8n Integration**: Seamless workflow automation with dedicated endpoints

## 📋 Prerequisites

- Node.js (v18 or higher)
- PostgreSQL database
- npm or yarn package manager
- Razorpay account (for vendor payouts)

## 🛠️ Tech Stack

- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL with Prisma ORM
- **Payment Processing**: Razorpay (vendor payouts)
- **Validation**: Zod
- **Security**: Helmet, CORS
- **Development**: tsx (TypeScript execution)

## ⚙️ Setup

### 1. Clone and Install

```bash
# Clone the repository
git clone <repository-url>
cd invoice-api-clean

# Install dependencies
npm install
```

### 2. Environment Configuration

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env and configure:
# - DATABASE_URL: PostgreSQL connection string
# - RAZORPAY_KEY_ID: Your Razorpay key ID
# - RAZORPAY_KEY_SECRET: Your Razorpay key secret
# - RAZORPAY_ACCOUNT_NUMBER: Your RazorpayX account number
# - RAZORPAY_WEBHOOK_SECRET: Razorpay webhook secret
# - PORT: API server port (default: 3000)
```

### 3. Database Setup

```bash
# Generate Prisma client
npm run db:generate

# Push schema to database
npm run db:push

# Seed initial data (optional)
npm run db:seed
```

### 4. Start Development Server

```bash
# Run in development mode with hot reload
npm run dev

# Or build and run in production
npm run build
npm start
```

## 📚 API Endpoints

### Health Check
```
GET /health
```
Returns API health status

### Vendors

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/vendors` | List all vendors |
| GET | `/api/v1/vendors/:id` | Get vendor by ID |
| GET | `/api/v1/vendors/by-name/:name` | Get vendor by name |
| GET | `/api/v1/vendors/by-email/:email` | Get vendor by email |
| POST | `/api/v1/vendors` | Create new vendor |
| PATCH | `/api/v1/vendors/:id` | Update vendor |
| DELETE | `/api/v1/vendors/:id` | Delete vendor |

### Purchase Orders

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/purchase-orders` | List all POs |
| GET | `/api/v1/purchase-orders/:id` | Get PO by ID |
| GET | `/api/v1/purchase-orders/by-number/:poNumber` | Get PO by number |
| POST | `/api/v1/purchase-orders` | Create new PO |
| PATCH | `/api/v1/purchase-orders/:id` | Update PO |
| PATCH | `/api/v1/purchase-orders/:id/status` | Update PO status |
| DELETE | `/api/v1/purchase-orders/:id` | Delete PO |

### Invoices

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/invoices` | List all invoices |
| GET | `/api/v1/invoices/:id` | Get invoice by ID |
| GET | `/api/v1/invoices/by-number/:invoiceNumber` | Get invoice by number |
| GET | `/api/v1/invoices/approved-unpaid` | Get approved unpaid invoices |
| GET | `/api/v1/invoices/duplicate/:invoiceNumber` | Check for duplicates |
| POST | `/api/v1/invoices` | Create new invoice |
| PATCH | `/api/v1/invoices/:id` | Update invoice |
| PATCH | `/api/v1/invoices/:id/status` | Update invoice status |
| DELETE | `/api/v1/invoices/:id` | Delete invoice |

### Payments

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/payments/invoice/:invoiceId` | Get payments for invoice |
| POST | `/api/v1/payments` | Create payment |
| PATCH | `/api/v1/payments/:id/status` | Update payment status |

### Razorpay Payouts

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/payouts/setup-vendor` | Setup vendor bank account |
| POST | `/api/v1/payouts` | Create payout for invoice |
| POST | `/api/v1/payouts/bulk` | Create bulk payouts |
| GET | `/api/v1/payouts/:payoutId` | Get payout status |
| POST | `/api/v1/payouts/:payoutId/cancel` | Cancel queued payout |
| POST | `/api/v1/payouts/webhook` | Razorpay webhook handler |

## 🔄 Workflow Integration

### Invoice Processing Flow

1. **PDF Upload** → n8n Webhook receives invoice PDF
2. **AI Extraction** → Extract invoice data using AI/OCR
3. **Create Invoice** → `POST /api/v1/invoices` (status: `received`)
4. **Fetch Details** → `GET /api/v1/invoices/by-number/:number`
5. **Validation** → n8n Code Node validates against PO and vendor
6. **Duplicate Check** → `GET /api/v1/invoices/duplicate/:invoiceNumber`
7. **Update Status** → `PATCH /api/v1/invoices/:id/status` (approved/rejected)
8. **Create Payout** → `POST /api/v1/payouts` (if approved)
9. **Razorpay Processing** → Automatic bank transfer
10. **Webhook Update** → `POST /api/v1/payouts/webhook` (status update)
11. **Invoice Marked Paid** → Status updated automatically

### Invoice Status Flow

```
received → pending → approved → paid
                  ↘ rejected
```

### Payout Status Flow

```
queued → pending → processing → processed → paid
                                         ↘ failed
```

## 💳 Razorpay Payout Integration

### Supported Payment Modes

| Mode | Speed | Limit | Availability |
|------|-------|-------|--------------|
| **IMPS** | Instant | ₹5 lakh | 24x7 |
| **NEFT** | 30 min - 2 hrs | ₹10 lakh | Banking hours |
| **RTGS** | Real-time | ₹2 lakh+ | Banking hours |
| **UPI** | Instant | ₹1 lakh | 24x7 |

### Quick Start - Razorpay Payouts

#### 1. Setup Vendor Bank Account

```bash
curl -X POST http://localhost:3000/api/v1/payouts/setup-vendor \
  -H "Content-Type: application/json" \
  -d '{
    "vendorId": "vendor-uuid",
    "bankName": "HDFC Bank",
    "accountName": "Vendor Company Pvt Ltd",
    "accountNumber": "50100123456789",
    "ifscCode": "HDFC0001234"
  }'
```

**Find IFSC Codes**: Visit [ifsc.razorpay.com](https://ifsc.razorpay.com/)

#### 2. Create Payout

```bash
curl -X POST http://localhost:3000/api/v1/payouts \
  -H "Content-Type: application/json" \
  -d '{
    "invoiceId": "invoice-uuid",
    "amount": 50000.00,
    "currency": "INR",
    "mode": "IMPS",
    "purpose": "vendor bill",
    "narration": "Payment for Invoice INV-001"
  }'
```

#### 3. Check Payout Status

```bash
curl http://localhost:3000/api/v1/payouts/pout_xxxxx
```

#### 4. Cancel Payout (if queued)

```bash
curl -X POST http://localhost:3000/api/v1/payouts/pout_xxxxx/cancel
```

### Razorpay Configuration

#### Prerequisites

1. Sign up at [Razorpay Dashboard](https://dashboard.razorpay.com/)
2. Complete KYC verification
3. Enable **RazorpayX** (Razorpay's banking product)
4. Activate **Payouts** feature
5. Add funds to your RazorpayX account

#### Get API Credentials

From Razorpay Dashboard:
- Navigate to **Settings** → **API Keys**
- Generate API Key ID and Secret
- Note down your **Account Number** from RazorpayX dashboard

#### Configure Webhooks

1. Go to **Settings** → **Webhooks**
2. Create a new webhook with URL: `https://your-domain.com/api/v1/payouts/webhook`
3. Select events:
   - `payout.processed`
   - `payout.paid`
   - `payout.failed`
   - `payout.rejected`
   - `payout.reversed`
4. Copy the **Webhook Secret**

#### Environment Variables

```env
RAZORPAY_KEY_ID=rzp_test_your_key_id
RAZORPAY_KEY_SECRET=your_key_secret
RAZORPAY_ACCOUNT_NUMBER=your_account_number
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret
```

### Webhook Events

The API handles these Razorpay webhook events:

- **payout.processed**: Payout is being processed
- **payout.paid**: Payout completed successfully (UTR received)
- **payout.failed**: Payout failed
- **payout.rejected**: Payout rejected by bank
- **payout.reversed**: Payout reversed

### Bulk Payouts

Process multiple invoices at once:

```bash
curl -X POST http://localhost:3000/api/v1/payouts/bulk \
  -H "Content-Type: application/json" \
  -d '{
    "invoiceIds": ["uuid1", "uuid2", "uuid3"],
    "mode": "IMPS"
  }'
```

## 🗄️ Database Schema

### Core Models

- **Vendor**: Vendor information with bank details and verification
- **PurchaseOrder**: PO tracking with line items and approval amounts
- **Invoice**: Invoice details with vendor, PO matching, and line items
- **Payment**: Payment records with Razorpay integration
- **AuditLog**: Comprehensive audit trail for all entities
- **VendorAlias**: Vendor name variations for matching

### Key Relationships

- Vendor → Invoices (one-to-many)
- Vendor → PurchaseOrders (one-to-many)
- PurchaseOrder → Invoices (one-to-many)
- Invoice → Payments (one-to-many)
- Invoice → LineItems (one-to-many)

## 🔧 Available Scripts

```bash
# Development
npm run dev              # Start dev server with hot reload

# Database
npm run db:generate      # Generate Prisma client
npm run db:push          # Push schema to database
npm run db:seed          # Seed database with sample data
npm run prisma:studio    # Open Prisma Studio GUI
npm run prisma:migrate   # Create and run migrations

# Production
npm run build            # Compile TypeScript
npm start                # Run production server

# Testing
npm test                 # Run tests (to be implemented)
```

## 🔐 Security Features

- **Helmet**: Security headers middleware
- **CORS**: Cross-origin resource sharing configuration
- **Input Validation**: Zod schema validation
- **SQL Injection Protection**: Prisma parameterized queries
- **Webhook Signature Verification**: HMAC SHA256 validation
- **Error Handling**: Centralized error middleware

## 📝 Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/invoice_db

# Server
PORT=3000
NODE_ENV=development

# Razorpay
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=your_key_secret
RAZORPAY_ACCOUNT_NUMBER=your_account_number
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret

# Optional
LOG_LEVEL=info
```

## 🚦 Error Handling

The API uses standardized error responses:

```json
{
  "error": "Error message",
  "details": "Additional context",
  "statusCode": 400
}
```

Common status codes:
- `200`: Success
- `201`: Created
- `400`: Bad Request
- `404`: Not Found
- `500`: Internal Server Error

## 📊 Monitoring & Logging

- Request logging with Morgan
- Audit logs for all entity changes
- Error tracking middleware
- Database query logging (Prisma)

### Database Queries for Monitoring

**Today's Payouts:**
```sql
SELECT * FROM payments 
WHERE DATE(created_at) = CURRENT_DATE 
AND stripe_id LIKE 'pout_%'
ORDER BY created_at DESC;
```

**Payout Success Rate:**
```sql
SELECT 
  COUNT(*) FILTER (WHERE status = 'paid') as successful,
  COUNT(*) FILTER (WHERE status = 'failed') as failed,
  COUNT(*) as total,
  ROUND(COUNT(*) FILTER (WHERE status = 'paid') * 100.0 / COUNT(*), 2) as success_rate
FROM payments
WHERE stripe_id LIKE 'pout_%';
```

**Failed Payouts:**
```sql
SELECT * FROM payments 
WHERE status = 'failed' 
AND stripe_id LIKE 'pout_%'
ORDER BY created_at DESC;
```

## 🧪 Testing

### Using Postman

Import the included `postman_collection.json` file:

1. Open Postman
2. Import → Upload Files → Select `postman_collection.json`
3. Set environment variables:
   - `baseUrl`: `http://localhost:3000/api/v1`
   - `vendorId`: Your vendor ID
   - `invoiceId`: Your invoice ID
   - `payoutId`: Your payout ID

### Test Mode

- Use `rzp_test_` API keys for testing
- No real money is transferred
- Test bank accounts provided by Razorpay

### Webhook Testing (Local Development)

Use ngrok to expose your local server:

```bash
# Install ngrok
npm install -g ngrok

# Expose port 3000
ngrok http 3000
```

Then configure the ngrok URL in Razorpay webhook settings:
```
https://your-ngrok-url.ngrok.io/api/v1/payouts/webhook
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

ISC

## 🆘 Support

For issues and questions:
- Check existing issues in the repository
- Create a new issue with detailed description
- Include error logs and reproduction steps

### Razorpay Support

- **Documentation**: [razorpay.com/docs/payouts](https://razorpay.com/docs/payouts/)
- **IFSC Finder**: [ifsc.razorpay.com](https://ifsc.razorpay.com/)
- **Dashboard**: [dashboard.razorpay.com](https://dashboard.razorpay.com/)
- **Support Email**: support@razorpay.com

## 🔮 Future Enhancements

- [ ] Unit and integration tests
- [ ] API documentation with Swagger/OpenAPI
- [ ] Rate limiting and throttling
- [ ] Multi-currency support enhancement
- [ ] Advanced reporting and analytics
- [ ] Email notifications
- [ ] File attachment storage (S3/cloud)
- [ ] GraphQL API option
- [ ] Scheduled payouts
- [ ] Vendor self-service portal
- [ ] OCR/AI invoice extraction integration
- [ ] Recurring payouts
- [ ] Payout approval workflow

## 📋 Common Workflows

### Daily Automated Payouts (n8n)

```javascript
// Cron Node: Daily at 10 AM
// HTTP Request Node
GET /api/v1/invoices/approved-unpaid

// For each invoice:
POST /api/v1/payouts
{
  "invoiceId": "{{$json.id}}",
  "amount": {{$json.totalAmount}},
  "currency": "INR",
  "mode": "IMPS",
  "purpose": "vendor bill"
}
```

### Vendor Onboarding

1. Create vendor: `POST /api/v1/vendors`
2. Setup payout: `POST /api/v1/payouts/setup-vendor`
3. Ready for invoices and payouts

### Invoice to Payment Flow

1. Create invoice: `POST /api/v1/invoices`
2. Approve invoice: `PATCH /api/v1/invoices/:id/status`
3. Create payout: `POST /api/v1/payouts`
4. Monitor via webhooks: `POST /api/v1/payouts/webhook`

## 🎯 Production Checklist

- [ ] Switch to live Razorpay API keys (`rzp_live_`)
- [ ] Complete Razorpay KYC verification
- [ ] Add sufficient funds to RazorpayX account
- [ ] Configure production webhook URL (HTTPS)
- [ ] Test webhook signature verification
- [ ] Set up monitoring and alerts
- [ ] Configure rate limiting
- [ ] Review payout limits with Razorpay
- [ ] Set up backup payment method
- [ ] Document vendor onboarding process
- [ ] Setup automated backups
- [ ] Configure error notifications

---

**Version**: 1.0.0  
**Last Updated**: May 2026  
**Status**: Production Ready
