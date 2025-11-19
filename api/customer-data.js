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

    if (!token) {
      return res.status(401).json({ error: 'Access token required. Please use your unique dashboard link.' });
    }

    // Initialize Google Sheets API
    // Handle private key - works whether Vercel stores it with literal \n or actual line breaks
    let privateKey = process.env.GOOGLE_PRIVATE_KEY || '';
    // If the key contains literal \n strings, convert them to actual newlines
    if (privateKey.includes('\\n')) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }
    // Also handle escaped backslashes
    if (privateKey.includes('\\\\n')) {
      privateKey = privateKey.replace(/\\\\n/g, '\n');
    }

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: privateKey,
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    // Fetch customer data from Customers sheet (A:L includes token column)
    const customerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Customers!A:L',
    });

    const customerRows = customerResponse.data.values || [];
    const customerHeaders = customerRows[0] || [];
    const customerData = customerRows.slice(1);

    // Find customer by token (token is column L, index 11)
    const customer = customerData.find(row => row[11] === token);

    if (!customer) {
      return res.status(401).json({ error: 'Invalid access token. Please check your dashboard link.' });
    }

    // Get the customer ID for fetching related data
    const customerId = customer[0];

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

    // Fetch scan history from Scan Summary sheet
    const scansResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'Scan Summary'!A:M",
    });

    const scanRows = scansResponse.data.values || [];
    const scanData = scanRows.slice(1);

    // Filter scans for this customer (customer_id is column B, index 1)
    const customerScans = scanData.filter(row => row[1] === customerId);

    // Sort by scan_date descending to get latest first
    customerScans.sort((a, b) => new Date(b[9]) - new Date(a[9]));

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

      // Filter violations for latest scan (scan_id is column B, index 1)
      const scanViolations = violationData.filter(row => row[1] === latestScanId);

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
      date: scan[9], // scan_date
      score: parseInt(scan[4]) || 0, // compliance_score
    }));

    // Build response matching dashboard expectations
    const response = {
      score: latestScan ? parseInt(latestScan[4]) || 0 : 0,
      lastScan: latestScan ? latestScan[9] : customerObj.last_scan_date,
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
      },
      scan_summary: latestScan ? {
        scan_id: latestScan[0],
        pages_scanned: parseInt(latestScan[3]) || 0,
        total_violations: parseInt(latestScan[5]) || 0,
        critical_count: parseInt(latestScan[6]) || 0,
        serious_count: parseInt(latestScan[7]) || 0,
        moderate_count: parseInt(latestScan[8]) || 0,
        minor_count: parseInt(latestScan[9]) || 0,
        scan_duration: latestScan[10],
        status: latestScan[11],
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
