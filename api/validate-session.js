// Vercel Serverless Function: /api/validate-session
// Validates JWT session tokens with signature verification

const { google } = require('googleapis');
const crypto = require('crypto');

// JWT decoder with signature verification
function verifyAndDecodeJWT(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format');
    }

    const [headerB64, payloadB64, signatureB64] = parts;

    // Verify signature
    const signatureInput = headerB64 + '.' + payloadB64;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(signatureInput)
      .digest('base64')
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    if (signatureB64 !== expectedSignature) {
      throw new Error('Invalid JWT signature');
    }

    // Decode payload
    const payloadJson = Buffer.from(
      payloadB64.replace(/-/g, '+').replace(/_/g, '/'),
      'base64'
    ).toString('utf8');

    return JSON.parse(payloadJson);
  } catch (error) {
    throw new Error('Failed to verify JWT: ' + error.message);
  }
}

module.exports = async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const { session } = req.body;

    if (!session) {
      return res.status(400).json({ error: 'Session token required', valid: false });
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

    // Get JWT_SECRET from Config sheet
    const configResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Config!A:B',
    });

    const configRows = configResponse.data.values || [];
    const jwtSecretRow = configRows.find(row => row[0] === 'jwt_secret');

    if (!jwtSecretRow || !jwtSecretRow[1]) {
      console.error('JWT_SECRET not found in Config sheet');
      return res.status(500).json({
        error: 'Server configuration error',
        valid: false
      });
    }

    const JWT_SECRET = jwtSecretRow[1];

    // Verify and decode JWT with signature verification
    const decoded = verifyAndDecodeJWT(session, JWT_SECRET);

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    const nowISO = new Date().toISOString();

    // DEBUG: Log timestamps for troubleshooting
    console.log('Token validation timestamps:', {
      vercel_current_time: nowISO,
      vercel_unix: now,
      token_issued_at: decoded.iat,
      token_expires_at: decoded.exp,
      is_expired: decoded.exp < now
    });

    if (decoded.exp && decoded.exp < now) {
      return res.status(401).json({
        error: 'Token expired',
        valid: false,
        debug: {
          vercel_time: nowISO,
          token_exp: decoded.exp,
          current_unix: now
        }
      });
    }

    // Lookup customer by customer_id from JWT
    const customerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Customers!A:P',
    });

    const rows = customerResponse.data.values || [];
    const customerData = rows.slice(1);

    // Find customer (customer_id is column A, index 0)
    const customer = customerData.find(row => row[0] === decoded.customer_id);

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found', valid: false });
    }

    // Check if session_token in sheet (column P, index 15) matches the JWT
    const storedToken = customer[15];
    if (storedToken !== session) {
      return res.status(401).json({ error: 'Session has been revoked or token mismatch', valid: false });
    }

    // Session is valid!
    return res.status(200).json({
      valid: true,
      customer_id: decoded.customer_id,
      email: decoded.email,
      plan: decoded.plan
    });

  } catch (error) {
    console.error('Session validation error:', error);
    return res.status(500).json({
      error: 'Session validation failed',
      details: error.message,
      valid: false
    });
  }
};
