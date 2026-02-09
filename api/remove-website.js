// Vercel Serverless Function: /api/remove-website
// Remove a website from Professional user's account

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
    const { token, remove_url } = req.body;

    if (!token || !remove_url) {
      return res.status(400).json({ error: 'Token and remove_url required' });
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

    // Get current URLs
    const currentUrls = customer[5] // Column F: website_url
      .split(',')
      .map(url => url.trim())
      .filter(Boolean);

    // Remove URL
    const updatedUrls = currentUrls.filter(url => url !== remove_url.trim());

    if (updatedUrls.length === currentUrls.length) {
      return res.status(404).json({ error: 'Website not found' });
    }

    if (updatedUrls.length === 0) {
      return res.status(400).json({ error: 'Cannot remove last website' });
    }

    // Update Google Sheet
    const rowNumber = customerIndex + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Customers!F${rowNumber}`,
      valueInputOption: 'RAW',
      resource: {
        values: [[updatedUrls.join(',')]]
      }
    });

    return res.status(200).json({
      success: true,
      websites: updatedUrls,
      message: 'Website removed successfully'
    });

  } catch (error) {
    console.error('Error removing website:', error);
    return res.status(500).json({
      error: 'Failed to remove website',
      details: error.message
    });
  }
};
