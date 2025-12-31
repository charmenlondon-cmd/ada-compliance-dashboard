// Vercel Serverless Function: /api/customer-data
// Fetches customer data from Google Sheets for the ADA Compliance Dashboard

const { google } = require('googleapis');

module.exports = async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const token = req.query.token;
    const customerId = req.query.id;

    if (!token && !customerId) {
      return res.status(400).json({ error: 'Authentication required. Use ?token=YOUR_TOKEN or ?id=CUST001' });
    }

    // Initialize Google Sheets API
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    // Fetch customer data from Customers sheet (now including Column L for token)
    const customerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Customers!A:L',
    });

    const customerRows = customerResponse.data.values || [];
    const customerHeaders = customerRows[0] || [];
    const customerData = customerRows.slice(1);

    // Find customer by token (Column L, index 11) or by customer_id (Column A, index 0)
    let customer;
    if (token) {
      customer = customerData.find(row => row[11] === token);
      if (!customer) {
        return res.status(404).json({ error: 'Invalid or expired token' });
      }
    } else {
      customer = customerData.find(row => row[0] === customerId);
      if (!customer) {
        return res.status(404).json({ error: `Customer ${customerId} not found` });
      }
    }

    // Map customer data to object
    const customerObj = {
      customer_id: customer[0],
      email: customer[1],
      company_name: customer[2],
      website_url: customer[3],
      plan: customer[4],
      scan_frequency: customer[5],
      created_date: customer[6],
      last_scan_date: customer[7],
      current_score: customer[8],
      status: customer[9],
    };

    // Store the customer_id for filtering scans (works for both token and customer_id auth)
    const actualCustomerId = customerObj.customer_id;

    // Fetch subscription data from Subscriptions sheet
    const subscriptionResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Subscriptions!A:J',
    });

    const subscriptionRows = subscriptionResponse.data.values || [];
    const subscriptionData = subscriptionRows.slice(1);

    // Find active subscription for this customer (match on customer_id, Column A, index 0)
    const subscription = subscriptionData.find(row => row[0] === actualCustomerId);

    const subscriptionObj = subscription ? {
      customer_id: subscription[0],
      payment_gateway_customer_id: subscription[1],
      subscription_id: subscription[2],
      plan: subscription[3],
      status: subscription[4],
      current_period_start: subscription[5],
      current_period_end: subscription[6], // This is the expiry date!
      mrr_amount: subscription[7],
      created_date: subscription[8],
      cancelled_date: subscription[9],
    } : null;

    // Fetch scan history from Scan Summary sheet
    const scansResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Scan Summary!A:M',
    });

    const scanRows = scansResponse.data.values || [];
    const scanData = scanRows.slice(1);

    // Filter scans for this customer (customer_id is column B, index 1)
    const customerScans = scanData.filter(row => row[1] === actualCustomerId);

    // Sort by scan_date descending to get latest first (scan_date is Column K, index 10)
    customerScans.sort((a, b) => new Date(b[10]) - new Date(a[10]));

    const latestScan = customerScans[0];

    // Fetch violations for the latest scan
    let violations = [];
    if (latestScan) {
      const latestScanId = latestScan[0]; // scan_id is column A

      const violationsResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Violations!A:L',
      });

      const violationRows = violationsResponse.data.values || [];
      const violationData = violationRows.slice(1);

      // Normalize latestScanId for comparison (trim whitespace, convert to string)
      const normalizedScanId = String(latestScanId || '').trim();

      // Debug logging: Show what we're looking for
      console.log('[DEBUG] Latest Scan ID:', normalizedScanId);
      console.log('[DEBUG] Total violation rows:', violationData.length);

      // Log first 3 violation scan_ids for comparison
      if (violationData.length > 0) {
        console.log('[DEBUG] Sample violation scan_ids:',
          violationData.slice(0, 3).map(row => `"${row[1]}" (type: ${typeof row[1]})`));
      }

      // Filter violations for latest scan with robust comparison
      const scanViolations = violationData.filter(row => {
        // Safety check: ensure row has at least 2 columns
        if (!row || row.length < 2) {
          return false;
        }

        // Normalize the scan_id from the violation row (column B, index 1)
        const rowScanId = String(row[1] || '').trim();

        // Return true if normalized values match
        return rowScanId === normalizedScanId;
      });

      console.log('[DEBUG] Matching violations found:', scanViolations.length);

      violations = scanViolations.map(v => ({
        violation_id: v[0],
        scan_id: v[1],
        customer_id: v[2],
        page_url: v[3],
        rule_id: v[4],
        impact: v[5],
        description: v[6],
        element_selector: v[7],
        help_url: v[8],
        fixed_status: v[9],
        detected_date: v[10],
        fixed_date: v[11],
      }));
    }

    // Build historical data for trend chart (last 10 scans)
    const historical = customerScans.slice(0, 10).reverse().map(scan => ({
      date: scan[10], // scan_date (Column K, index 10)
      score: parseInt(scan[4]) || 0, // compliance_score (Column E, index 4)
    }));

    // Build response matching dashboard expectations
    const response = {
      score: latestScan ? parseInt(latestScan[4]) || 0 : 0, // Column E (index 4)
      lastScan: latestScan ? latestScan[10] : customerObj.last_scan_date, // Column K (index 10)
      violations: violations.map(v => ({
        impact: v.impact,
        rule_id: v.rule_id,
        description: v.description,
        element_selector: v.element_selector,
        help_url: v.help_url,
        page_url: v.page_url,
        fixed_status: v.fixed_status,
      })),
      historical,
      customer: {
        id: customerObj.customer_id,
        email: customerObj.email,
        company_name: customerObj.company_name,
        website_url: customerObj.website_url,
        plan: customerObj.plan,
        status: customerObj.status,
        subscription: subscriptionObj, // Include subscription data
      },
      scan_summary: latestScan ? {
        scan_id: latestScan[0], // Column A (index 0)
        pages_scanned: parseInt(latestScan[3]) || 0, // Column D (index 3)
        total_violations: parseInt(latestScan[5]) || 0, // Column F (index 5)
        critical_count: parseInt(latestScan[6]) || 0, // Column G (index 6)
        serious_count: parseInt(latestScan[7]) || 0, // Column H (index 7)
        moderate_count: parseInt(latestScan[8]) || 0, // Column I (index 8)
        minor_count: parseInt(latestScan[9]) || 0, // Column J (index 9)
        scan_duration: latestScan[11], // Column L (index 11)
        status: latestScan[12], // Column M (index 12)
      } : null,
    };

    return res.status(200).json(response);

  } catch (error) {
    console.error('Error fetching customer data:', error);
    return res.status(500).json({
      error: 'Failed to fetch customer data',
      details: error.message
    });
  }
};
