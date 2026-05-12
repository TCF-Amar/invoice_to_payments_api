# n8n Vendor Payout Workflow - Setup Instructions

## Quick Start

### Files Provided

1. **n8n_vendor_payout_workflow.json** - Complete workflow configuration
2. **N8N_WORKFLOW_GUIDE.md** - Detailed documentation

## Import Workflow

### Method 1: Via n8n UI (Recommended)

1. **Open n8n Dashboard**
   - Navigate to `http://localhost:5678` (or your n8n URL)
   - Login to your account

2. **Import Workflow**
   - Click **"Workflows"** in left sidebar
   - Click **"Import"** button
   - Select **"n8n_vendor_payout_workflow.json"**
   - Click **"Import"**

3. **Workflow Imported**
   - Workflow appears in your workflows list
   - Name: "Company to Vendor Payout Workflow"

### Method 2: Via File Upload

1. In n8n, go to **Workflows**
2. Click **"+"** to create new workflow
3. Click **"..."** menu → **"Import from file"**
4. Select **n8n_vendor_payout_workflow.json**
5. Click **"Import"**

## Configuration

### Step 1: Set Environment Variables

In n8n, go to **Settings** → **Environment Variables**:

```
NOTIFICATION_EMAIL=admin@company.com
API_BASE_URL=http://localhost:3000/api/v1
```

### Step 2: Configure Email Credentials

1. Go to **Credentials** in n8n
2. Click **"New"** → **"Email"**
3. Fill in SMTP details:
   - **Host**: smtp.gmail.com (or your provider)
   - **Port**: 587
   - **User**: your-email@gmail.com
   - **Password**: your-app-password
   - **TLS**: Enable
4. Click **"Save"**

### Step 3: Update Workflow Credentials

1. Open the imported workflow
2. Click on each **Email** node
3. Select the email credential you just created
4. Save changes

### Step 4: Verify API Connection

1. Click on **"Get Approved Unpaid Invoices"** node
2. Verify URL: `http://localhost:3000/api/v1/invoices/approved-unpaid`
3. Update if your API is on different host/port

## Test the Workflow

### Manual Test

1. Open workflow
2. Click **"Test Workflow"** button
3. Check execution logs
4. Verify email was sent

### Check Execution

1. Click **"Executions"** tab
2. View all workflow runs
3. Click on execution to see details
4. Check logs for errors

## Activate Workflow

### Enable Daily Execution

1. Open workflow
2. Click **"Activate"** button (top right)
3. Workflow is now active
4. Will run daily at 10:00 AM

### Verify Activation

- Green checkmark appears next to workflow name
- Cron job is scheduled
- Executions appear in history

## Workflow Overview

### What It Does

```
Daily at 10 AM:
  1. Fetch all approved unpaid invoices
  2. For each invoice:
     - Get invoice details
     - Get vendor details
     - Check vendor bank account
     - Create Razorpay payout
     - Update invoice status
     - Send notification email
  3. Handle errors and send alerts
```

### Success Flow

```
Invoice Approved
    ↓
Vendor Bank Details Verified
    ↓
Razorpay Payout Created
    ↓
Invoice Status Updated to "payment_processing"
    ↓
Success Email Sent
```

### Error Handling

- **Missing Bank Details** → Alert email sent
- **Payout Creation Failed** → Failure email sent
- **No Invoices** → Info email sent

## Email Notifications

### Success Email
- **Subject**: ✅ Payout Created
- **Contains**: Invoice ID, amount, payout ID, status

### Failure Email
- **Subject**: ❌ Payout Failed
- **Contains**: Invoice details, error info

### Missing Details Email
- **Subject**: ⚠️ Missing Bank Details
- **Contains**: Vendor info, action required

### No Invoices Email
- **Subject**: ℹ️ No Approved Invoices
- **Contains**: Run status, next run time

## Customization

### Change Execution Time

1. Click on **"Daily Cron - 10 AM"** node
2. Modify **"Trigger Times"**
3. Set desired hour and minute
4. Save

### Change Payment Mode

1. Click on **"Create Payout"** node
2. Find `"mode": "IMPS"` in body
3. Change to: NEFT, RTGS, or UPI
4. Save

### Add Slack Notifications

1. Add new **"Slack"** node
2. Configure Slack webhook
3. Connect to success/failure paths
4. Customize message

### Add Database Logging

1. Add **"Database"** node
2. Configure connection
3. Insert payout records
4. Track history

## Troubleshooting

### Workflow Not Running

**Check**:
1. Is workflow activated? (Green checkmark)
2. Is n8n server running?
3. Check n8n logs for errors
4. Verify cron time is correct

**Fix**:
```bash
# Restart n8n
docker restart n8n

# Or check logs
docker logs n8n
```

### Emails Not Sending

**Check**:
1. Email credentials configured?
2. SMTP settings correct?
3. Notification email valid?
4. Check spam folder

**Fix**:
1. Verify SMTP credentials
2. Test email manually
3. Check n8n execution logs
4. Review email provider settings

### Payouts Not Creating

**Check**:
1. Is Invoice API running?
2. Are invoices approved?
3. Do vendors have bank details?
4. Check Razorpay account balance

**Fix**:
1. Verify API is accessible
2. Approve invoices first
3. Setup vendor bank details
4. Add funds to Razorpay

### API Connection Error

**Check**:
1. Is API server running?
2. Is URL correct?
3. Network connectivity?
4. Firewall rules?

**Fix**:
```bash
# Test API connection
curl http://localhost:3000/api/v1/invoices/approved-unpaid

# Check API logs
npm run dev
```

## Monitoring

### View Executions

1. Open workflow
2. Click **"Executions"** tab
3. See all runs with timestamps
4. Click to view details

### Check Success Rate

```
Successful Payouts / Total Invoices × 100 = Success Rate
```

### Monitor Logs

```bash
# n8n logs
docker logs n8n -f

# API logs
npm run dev
```

## API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/invoices/approved-unpaid` | GET | Fetch approved invoices |
| `/invoices/{id}` | GET | Get invoice details |
| `/vendors/{id}` | GET | Get vendor details |
| `/payouts` | POST | Create payout |
| `/invoices/{id}/status` | PATCH | Update invoice status |

## Environment Variables

```env
# n8n Environment Variables
NOTIFICATION_EMAIL=admin@company.com
API_BASE_URL=http://localhost:3000/api/v1

# Email Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
```

## Performance Tips

1. **Batch Processing**: Process invoices in batches
2. **Caching**: Cache vendor details
3. **Parallel**: Process multiple invoices simultaneously
4. **Rate Limiting**: Respect API rate limits
5. **Monitoring**: Track execution times

## Security

1. **API Keys**: Store in n8n credentials
2. **Email**: Use encrypted SMTP
3. **Logs**: Don't log sensitive data
4. **Access**: Restrict workflow access
5. **Backup**: Regular backups

## Maintenance

### Daily
- Monitor execution logs
- Check for failures
- Review notifications

### Weekly
- Review success rate
- Check failed payouts
- Update vendor details

### Monthly
- Backup workflow
- Review performance
- Update documentation

## Support

### Documentation
- Read **N8N_WORKFLOW_GUIDE.md** for detailed info
- Check n8n official docs: https://docs.n8n.io/

### Troubleshooting
1. Check execution logs
2. Review API responses
3. Verify credentials
4. Check network connectivity

### Contact
- n8n Support: https://n8n.io/support/
- API Support: Check README.md

## Next Steps

1. ✅ Import workflow
2. ✅ Configure credentials
3. ✅ Test manually
4. ✅ Activate workflow
5. ✅ Monitor executions
6. ✅ Optimize as needed

## Workflow Statistics

- **Execution Time**: ~5-10 seconds per invoice
- **API Calls**: 5 per invoice
- **Email Notifications**: 1 per execution
- **Success Rate**: Target 95%+

## Version

- **Workflow Version**: 1.0
- **Created**: May 2026
- **Status**: Production Ready

---

**Ready to automate vendor payouts!** 🚀
