# n8n Vendor Payout Workflow Guide

## Overview

This n8n workflow automates the complete company-to-vendor payout process. It runs daily at 10 AM, fetches approved unpaid invoices, validates vendor details, creates Razorpay payouts, and sends notifications.

## Workflow File

**File**: `n8n_vendor_payout_workflow.json`

## Workflow Steps

### 1. **Daily Cron Trigger** (10 AM)
- Triggers automatically every day at 10:00 AM
- No manual intervention required
- Configurable time in n8n UI

### 2. **Get Approved Unpaid Invoices**
- **Endpoint**: `GET /api/v1/invoices/approved-unpaid`
- **Purpose**: Fetch all invoices with status "approved" that haven't been paid
- **Response**: Array of invoice objects

### 3. **Check if Invoices Exist**
- **Type**: Conditional (IF node)
- **Condition**: `data.length > 0`
- **True Path**: Process invoices
- **False Path**: Send "no invoices" notification

### 4. **Loop Through Invoices**
- **Type**: Split in Batches
- **Purpose**: Process each invoice individually
- **Batch Size**: 1 (process one at a time)

### 5. **Get Invoice Details**
- **Endpoint**: `GET /api/v1/invoices/{invoiceId}`
- **Purpose**: Fetch complete invoice information
- **Data Used**: Invoice ID, amount, vendor ID, PO number

### 6. **Get Vendor Details**
- **Endpoint**: `GET /api/v1/vendors/{vendorId}`
- **Purpose**: Fetch vendor information including bank details
- **Data Used**: Account number, IFSC code, vendor name

### 7. **Check Vendor Bank Details**
- **Type**: Conditional (IF node)
- **Condition**: `accountNumber && routingNumber` (both not empty)
- **True Path**: Create payout
- **False Path**: Send "missing details" notification

### 8. **Create Payout**
- **Endpoint**: `POST /api/v1/payouts`
- **Method**: POST
- **Payload**:
  ```json
  {
    "invoiceId": "invoice-uuid",
    "amount": 50000.00,
    "currency": "INR",
    "mode": "IMPS",
    "purpose": "vendor bill",
    "narration": "Payment for Invoice INV-001",
    "notes": {
      "vendor_name": "Vendor Name",
      "po_number": "PO-001",
      "invoice_date": "2024-01-15"
    }
  }
  ```
- **Response**: Payout details with Razorpay ID

### 9. **Check Payout Success**
- **Type**: Conditional (IF node)
- **Condition**: `razorpayPayout.id` exists
- **True Path**: Update invoice status
- **False Path**: Send failure notification

### 10. **Update Invoice Status**
- **Endpoint**: `PATCH /api/v1/invoices/{invoiceId}/status`
- **Payload**: `{ "status": "payment_processing" }`
- **Purpose**: Mark invoice as payment in progress

### 11. **Send Success Email**
- **Type**: Email node
- **Recipient**: `$env.NOTIFICATION_EMAIL`
- **Subject**: ✅ Payout Created
- **Content**: Payout details, amount, status

### 12. **Send Failure Email**
- **Type**: Email node
- **Recipient**: `$env.NOTIFICATION_EMAIL`
- **Subject**: ❌ Payout Failed
- **Content**: Invoice details, error information

### 13. **Send Missing Details Email**
- **Type**: Email node
- **Recipient**: `$env.NOTIFICATION_EMAIL`
- **Subject**: ⚠️ Missing Bank Details
- **Content**: Vendor info, action required

### 14. **Send No Invoices Email**
- **Type**: Email node
- **Recipient**: `$env.NOTIFICATION_EMAIL`
- **Subject**: ℹ️ No Approved Invoices
- **Content**: Run status, next run time

### 15. **Merge Results**
- **Type**: Merge node
- **Purpose**: Consolidate all paths
- **Output**: Combined results

### 16. **End**
- **Type**: No-op (End node)
- **Purpose**: Workflow completion

## Installation Steps

### 1. Import Workflow in n8n

```bash
# Option A: Via n8n UI
1. Open n8n dashboard
2. Click "Workflows" → "Import"
3. Select "n8n_vendor_payout_workflow.json"
4. Click "Import"

# Option B: Via API
curl -X POST http://localhost:5678/api/v1/workflows \
  -H "Content-Type: application/json" \
  -d @n8n_vendor_payout_workflow.json
```

### 2. Configure Environment Variables

In n8n, set these environment variables:

```
NOTIFICATION_EMAIL=admin@company.com
API_BASE_URL=http://localhost:3000/api/v1
```

### 3. Configure Email Credentials

1. Go to Credentials in n8n
2. Create new "Email" credential
3. Configure SMTP settings:
   - **Host**: Your SMTP server
   - **Port**: 587 or 465
   - **User**: Your email
   - **Password**: Your email password
   - **TLS**: Enable

### 4. Test the Workflow

1. Click "Test Workflow"
2. Check execution logs
3. Verify email notifications

### 5. Activate Workflow

1. Click "Activate" button
2. Workflow will run daily at 10 AM
3. Monitor execution history

## Configuration Options

### Change Execution Time

1. Click on "Daily Cron - 10 AM" node
2. Modify time in "Trigger Times"
3. Save changes

### Change Payment Mode

In "Create Payout" node, modify the `mode` field:
- `IMPS` - Instant (default)
- `NEFT` - Next batch
- `RTGS` - Real-time
- `UPI` - UPI transfer

### Change Notification Email

1. Update `NOTIFICATION_EMAIL` environment variable
2. Or modify email address in each email node

### Add Additional Notifications

1. Add new "Email" node
2. Connect to desired path
3. Configure recipient and content

## Error Handling

### Missing Bank Details
- **Trigger**: Vendor has no account number or IFSC
- **Action**: Send notification email
- **Resolution**: Setup vendor via `POST /api/v1/payouts/setup-vendor`

### Payout Creation Failed
- **Trigger**: Razorpay API error
- **Action**: Send failure notification
- **Resolution**: Check Razorpay account balance and limits

### No Approved Invoices
- **Trigger**: No invoices with status "approved"
- **Action**: Send info notification
- **Resolution**: Approve invoices first

### API Connection Error
- **Trigger**: Cannot reach Invoice API
- **Action**: Workflow fails
- **Resolution**: Check API server status

## Monitoring

### View Execution History

1. Open workflow in n8n
2. Click "Executions" tab
3. View all runs with timestamps
4. Click on execution to see details

### Check Logs

```bash
# View n8n logs
docker logs n8n

# Or check n8n UI → Executions → Details
```

### Success Metrics

Track these metrics:
- Total invoices processed
- Successful payouts created
- Failed payouts
- Success rate (%)
- Average processing time

## Troubleshooting

### Workflow Not Triggering

**Problem**: Cron job not running at scheduled time

**Solutions**:
1. Check n8n server is running
2. Verify cron time is set correctly
3. Check n8n logs for errors
4. Restart n8n service

### Emails Not Sending

**Problem**: Notification emails not received

**Solutions**:
1. Verify SMTP credentials
2. Check email configuration in n8n
3. Verify `NOTIFICATION_EMAIL` is correct
4. Check spam folder
5. Review n8n execution logs

### Payouts Not Creating

**Problem**: Payout creation fails

**Solutions**:
1. Check Razorpay account balance
2. Verify vendor bank details are setup
3. Check API endpoint is accessible
4. Review error message in execution logs
5. Verify Razorpay credentials

### API Connection Issues

**Problem**: Cannot connect to Invoice API

**Solutions**:
1. Verify API server is running
2. Check API URL in workflow
3. Verify network connectivity
4. Check firewall rules
5. Review API logs

## Advanced Features

### Bulk Payout Processing

To process multiple invoices in parallel:

1. Modify "Loop Through Invoices" batch size
2. Increase from 1 to desired number
3. Adjust based on API rate limits

### Custom Notifications

Add Slack notifications:

1. Add "Slack" node
2. Configure Slack webhook
3. Connect to success/failure paths
4. Customize message format

### Database Logging

Log all payouts to database:

1. Add "Database" node
2. Configure connection
3. Insert payout records
4. Track history

### Conditional Payment Modes

Use different modes based on amount:

```javascript
// In "Create Payout" node
if (amount > 500000) {
  mode = "RTGS"
} else if (amount > 200000) {
  mode = "NEFT"
} else {
  mode = "IMPS"
}
```

## API Integration

### Required Endpoints

The workflow uses these API endpoints:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/invoices/approved-unpaid` | GET | Fetch approved invoices |
| `/invoices/{id}` | GET | Get invoice details |
| `/vendors/{id}` | GET | Get vendor details |
| `/payouts` | POST | Create payout |
| `/invoices/{id}/status` | PATCH | Update invoice status |

### API Response Format

**Get Approved Invoices Response**:
```json
{
  "success": true,
  "message": "Invoices fetched",
  "data": [
    {
      "id": "uuid",
      "invoiceNumber": "INV-001",
      "vendorId": "uuid",
      "totalAmount": 50000,
      "status": "approved"
    }
  ]
}
```

**Create Payout Response**:
```json
{
  "success": true,
  "message": "Payout created successfully",
  "data": {
    "payment": {
      "id": "uuid",
      "status": "scheduled"
    },
    "razorpayPayout": {
      "id": "pout_xxxxx",
      "status": "queued",
      "amount": 5000000
    }
  }
}
```

## Performance Optimization

### Batch Processing

Process invoices in batches:
- Reduces API calls
- Improves performance
- Prevents rate limiting

### Caching

Cache vendor details:
- Reduces API calls
- Faster processing
- Lower latency

### Parallel Processing

Process multiple invoices simultaneously:
- Faster execution
- Better resource utilization
- Requires higher API limits

## Security Considerations

1. **API Keys**: Store in n8n credentials
2. **Email**: Use encrypted SMTP
3. **Webhook**: Verify Razorpay signatures
4. **Logs**: Don't log sensitive data
5. **Access**: Restrict workflow access

## Maintenance

### Regular Tasks

- Monitor execution logs weekly
- Review failed payouts
- Update vendor details
- Check API rate limits
- Verify email delivery

### Backup

- Export workflow regularly
- Backup n8n database
- Document custom changes
- Version control workflow

## Support

For issues:
1. Check n8n documentation
2. Review API logs
3. Check Razorpay dashboard
4. Contact support team

## Workflow Diagram

```
Start
  ↓
Daily Cron (10 AM)
  ↓
Get Approved Unpaid Invoices
  ↓
Check if Invoices Exist
  ├─ YES → Loop Through Invoices
  │         ↓
  │         Get Invoice Details
  │         ↓
  │         Get Vendor Details
  │         ↓
  │         Check Bank Details
  │         ├─ YES → Create Payout
  │         │         ↓
  │         │         Check Success
  │         │         ├─ YES → Update Status → Send Success Email
  │         │         └─ NO → Send Failure Email
  │         └─ NO → Send Missing Details Email
  └─ NO → Send No Invoices Email
  ↓
Merge Results
  ↓
End
```

## Version History

- **v1.0** (May 2026): Initial release
  - Daily cron trigger
  - Invoice fetching
  - Payout creation
  - Email notifications
  - Error handling

## Future Enhancements

- [ ] Slack notifications
- [ ] Database logging
- [ ] Custom payment modes
- [ ] Bulk processing
- [ ] Webhook integration
- [ ] Advanced filtering
- [ ] Scheduled payouts
- [ ] Approval workflow
