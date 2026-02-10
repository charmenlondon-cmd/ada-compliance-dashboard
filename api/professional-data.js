// Vercel Serverless Function: /api/professional-data
// Fetches multi-site data for Professional tier users

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

    if (!token) {
      return res.status(400).json({ error: 'Token required' });
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

    // Fetch customer data
    const customerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Customers!A:T',
    });

    const customerRows = customerResponse.data.values || [];
    const customerData = customerRows.slice(1);

    // Find customer by session_token (Column P, index 15)
    const customer = customerData.find(row => row[15] === token);

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    // Verify this is a Professional user
    if (customer[6] !== 'professional') {
      return res.status(403).json({ error: 'Professional plan required' });
    }

    // Parse website URLs (comma-separated in Column F, index 5)
    const websiteUrls = customer[5]
      .split(',')
      .map(url => url.trim())
      .filter(Boolean);

    // Fetch all scans
    const scansResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Scan Summary!A:W',
    });

    const scanRows = scansResponse.data.values || [];
    const scanData = scanRows.slice(1);

    // Fetch all violations
    const violationsResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Violations!A:L',
    });

    const violationRows = violationsResponse.data.values || [];
    const violationData = violationRows.slice(1);

    const customerId = customer[0]; // Column A

    // Build data for each website
    const websites = websiteUrls.map(url => {
      // Get scans for this customer and URL
      const scans = scanData
        .filter(scan =>
          scan[1] === customerId && // Column B: customer_id
          scan[4] === url // Column E: website_url
        )
        .sort((a, b) => new Date(b[14]) - new Date(a[14])); // Column O: scan_date

      const latestScan = scans[0];

      // Get last 10 scans for historical chart
      const last10 = scans.slice(0, 10).reverse();

      // Get violations for latest scan
      const violations = latestScan
        ? violationData
            .filter(v => v[1] === latestScan[0]) // Match scan_id
            .map(v => ({
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
            }))
        : [];

      // Parse scanned page URLs from Column H (index 7)
      const parseScannedPageUrls = (raw) => {
        if (!raw) return [];

        // Handle old format: stringified array
        if (raw.startsWith('[') && raw.endsWith(']')) {
          try {
            return JSON.parse(raw);
          } catch (e) {
            return [];
          }
        }

        // Handle new format: comma-separated
        return raw.split(',').map(url => url.trim()).filter(Boolean);
      };

      return {
        website_url: url,
        current_score: latestScan ? parseInt(latestScan[8]) || 0 : 0, // Column I
        last_scan_date: latestScan ? latestScan[14] : null, // Column O
        total_violations: latestScan ? parseInt(latestScan[9]) || 0 : 0, // Column J
        latest_scan: latestScan ? {
          scan_id: latestScan[0],
          pages_scanned: parseInt(latestScan[6]) || 0,
          compliance_score: parseInt(latestScan[8]) || 0,
          total_violations: parseInt(latestScan[9]) || 0,
          critical_count: parseInt(latestScan[10]) || 0,
          serious_count: parseInt(latestScan[11]) || 0,
          moderate_count: parseInt(latestScan[12]) || 0,
          minor_count: parseInt(latestScan[13]) || 0,
          scan_date: latestScan[14],
          scanned_page_urls: parseScannedPageUrls(latestScan[7]), // Column H
          ai_analysis: latestScan[21], // Column V
          ai_level: latestScan[22], // Column W
        } : null,
        violations: violations,
        historical: last10.map(s => ({
          date: s[14], // scan_date
          score: parseInt(s[8]) || 0, // compliance_score
        })),
      };
    });

    // Fetch subscription data
    const subscriptionResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Subscriptions!A:J',
    });

    const subscriptionRows = subscriptionResponse.data.values || [];
    const subscriptionData = subscriptionRows.slice(1);
    const subscription = subscriptionData.find(row => row[0] === customerId);

    const subscriptionObj = subscription ? {
      customer_id: subscription[0],
      payment_gateway_customer_id: subscription[1],
      subscription_id: subscription[2],
      plan: subscription[3],
      status: subscription[4],
      current_period_start: subscription[5],
      current_period_end: subscription[6],
      mrr_amount: subscription[7],
      created_date: subscription[8],
      cancelled_date: subscription[9],
    } : null;

    return res.status(200).json({
      customer: {
        id: customer[0],
        email: customer[3],
        company_name: customer[4],
        plan: customer[6],
        status: customer[11],
        stripe_id: customer[19],
        subscription: subscriptionObj,
      },
      websites: websites,
    });

  } catch (error) {
    console.error('Error fetching professional data:', error);
    return res.status(500).json({
      error: 'Failed to fetch data',
      details: error.message
    });
  }
};
