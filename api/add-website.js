// Vercel Serverless Function: /api/add-website
// Add a new website to Professional user's account

const { google } = require('googleapis');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { token, new_url } = req.body;

    if (!token || !new_url) {
      return res.status(400).json({ error: 'Token and new_url required' });
    }

    // Initialize Google Sheets API
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    // Get customer record
    const customerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Customers!A:T',
    });

    const rows = customerResponse.data.values || [];
    const customerData = rows.slice(1);
    const customerIndex = customerData.findIndex(row => row[13] === token); // Column N: token

    if (customerIndex === -1) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const customer = customerData[customerIndex];

    // Check plan
    if (customer[6] !== 'professional') {
      return res.status(403).json({ error: 'Professional plan required' });
    }

    // Get current URLs
    const currentUrls = customer[5] // Column F: website_url
      .split(',')
      .map(url => url.trim())
      .filter(Boolean);

    // Validate
    if (currentUrls.length >= 5) {
      return res.status(400).json({ error: 'Maximum 5 websites allowed' });
    }

    const normalizedUrl = new_url.trim();
    if (currentUrls.includes(normalizedUrl)) {
      return res.status(400).json({ error: 'Website already exists' });
    }

    // Validate URL format
    try {
      new URL(normalizedUrl);
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Add new URL
    currentUrls.push(normalizedUrl);
    const updatedUrls = currentUrls.join(',');

    // Update Google Sheet (Column F, row = customerIndex + 2 for header)
    const rowNumber = customerIndex + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Customers!F${rowNumber}`,
      valueInputOption: 'RAW',
      resource: {
        values: [[updatedUrls]]
      }
    });

    return res.status(200).json({
      success: true,
      websites: currentUrls,
      message: 'Website added successfully'
    });

  } catch (error) {
    console.error('Error adding website:', error);
    return res.status(500).json({
      error: 'Failed to add website',
      details: error.message
    });
  }
};
