# ADA Compliance Dashboard

Customer-facing dashboard for the ADA Compliance Scanner SaaS platform.

## Features

- Real-time compliance score display
- Historical trend chart
- Violation details with fix recommendations
- On-demand scan requests
- Auto-refresh every 5 minutes

## Deployment to Vercel

### 1. Push to GitHub

```bash
cd ada-compliance-dashboard
git init
git add .
git commit -m "Initial dashboard setup"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/ada-compliance-dashboard.git
git push -u origin main
```

### 2. Deploy to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in
2. Click "New Project"
3. Import your GitHub repository
4. Configure Environment Variables (see below)
5. Click "Deploy"

### 3. Configure Environment Variables

In Vercel Dashboard → Project Settings → Environment Variables, add:

| Variable | Description |
|----------|-------------|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service account email from Google Cloud |
| `GOOGLE_PRIVATE_KEY` | Private key from service account JSON |
| `GOOGLE_SHEET_ID` | ID of your ADA-Compliance-Master spreadsheet |

### 4. Google Cloud Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select existing
3. Enable Google Sheets API
4. Create a Service Account:
   - IAM & Admin → Service Accounts → Create
   - Download JSON key file
5. Share your Google Sheet with the service account email

## API Endpoint

### GET /api/customer-data

Fetches customer compliance data from Google Sheets.

**Query Parameters:**
- `id` (required): Customer ID (e.g., `CUST001`)

**Example:**
```
GET /api/customer-data?id=CUST001
```

**Response:**
```json
{
  "score": 85,
  "lastScan": "2025-01-15T10:30:00Z",
  "violations": [...],
  "historical": [...],
  "customer": {...},
  "scan_summary": {...}
}
```

## Usage

Access the dashboard with a customer ID:

```
https://your-dashboard.vercel.app/?customer_id=CUST001
```

## Local Development

1. Copy `.env.example` to `.env.local`
2. Fill in your Google credentials
3. Install dependencies:
   ```bash
   npm install
   ```
4. Run locally:
   ```bash
   vercel dev
   ```

## Google Sheets Structure

The API expects these sheets in your spreadsheet:

1. **Customers** - Columns: customer_id, email, company_name, website_url, plan, scan_frequency, created_date, last_scan_date, current_score, status

2. **Scan_Summary** - Columns: scan_id, customer_id, website_url, pages_scanned, compliance_score, total_violations, critical_count, serious_count, moderate_count, minor_count, scan_date, scan_duration_seconds, status, max_pages, success, scanner_version, scan_method, ai_analysis, ai_level

3. **Violations** - Columns: violation_id, scan_id, customer_id, page_url, rule_id, impact, description, element_selector, help_url, fixed_status, detected_date, fixed_date

## Troubleshooting

### "Loading..." never resolves
- Check browser console for errors
- Verify environment variables are set in Vercel
- Ensure Google Sheet is shared with service account

### 404 on API calls
- Verify vercel.json is properly configured
- Redeploy after adding environment variables

### Google Sheets permission denied
- Share the spreadsheet with the service account email
- Check that Sheets API is enabled in Google Cloud

## License

MIT - Bison Blu AI Labs
