// Vercel Serverless Function: /api/cancel-subscription
// Handles subscription cancellation by updating the Subscriptions sheet

const { google } = require('googleapis');

module.exports = async function handler(req, res) {
  // Enable CORS
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
    const { customer_id, subscription_id, current_period_end } = req.body;

    if (!customer_id || !current_period_end) {
      return res.status(400).json({ error: 'Missing required fields: customer_id and current_period_end' });
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

    // Calculate cancellation date (day after current_period_end)
    const endDate = new Date(current_period_end);
    const cancellationDate = new Date(endDate);
    cancellationDate.setDate(cancellationDate.getDate() + 1);

    // Format as YYYY-MM-DD for Google Sheets
    const formattedCancellationDate = cancellationDate.toISOString().split('T')[0];

    // Fetch Subscriptions sheet to find the row
    const subscriptionsResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Subscriptions!A:J',
    });

    const rows = subscriptionsResponse.data.values || [];
    const headers = rows[0];
    const dataRows = rows.slice(1);

    // Find the subscription row (match by customer_id in column A)
    const rowIndex = dataRows.findIndex(row => row[0] === customer_id);

    if (rowIndex === -1) {
      return res.status(404).json({ error: 'Subscription not found for this customer' });
    }

    // Row number in sheet (1-indexed, +2 for header and 0-index offset)
    const sheetRowNumber = rowIndex + 2;

    // Update the subscription row
    // Column E (index 4): status = "cancelled"
    // Column J (index 9): cancelled_date = calculated date
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      resource: {
        data: [
          {
            range: `Subscriptions!E${sheetRowNumber}`, // Status column
            values: [['cancelled']]
          },
          {
            range: `Subscriptions!J${sheetRowNumber}`, // Cancelled date column
            values: [[formattedCancellationDate]]
          }
        ],
        valueInputOption: 'RAW'
      }
    });

    console.log(`[SUCCESS] Cancelled subscription for customer ${customer_id}`);
    console.log(`[INFO] Cancellation date set to: ${formattedCancellationDate}`);

    return res.status(200).json({
      success: true,
      message: 'Subscription cancelled successfully',
      cancellation_date: formattedCancellationDate,
      status: 'cancelled'
    });

  } catch (error) {
    console.error('Error cancelling subscription:', error);
    return res.status(500).json({
      error: 'Failed to cancel subscription',
      details: error.message
    });
  }
};
