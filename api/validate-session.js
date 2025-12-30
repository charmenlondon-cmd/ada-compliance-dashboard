// Vercel Serverless Function: /api/validate-session
// Validates JWT session tokens by calling n8n validation webhook

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
      return res.status(400).json({ error: 'Session token required' });
    }

    // Call n8n validation webhook
    const n8nValidateUrl = process.env.N8N_VALIDATE_URL || 'https://bisonblu.app.n8n.cloud/webhook/validate-session';

    const response = await fetch(n8nValidateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return res.status(401).json({
        error: errorData.error || 'Invalid or expired session',
        valid: false
      });
    }

    const result = await response.json();

    if (!result.valid) {
      return res.status(401).json({
        error: result.error || 'Session validation failed',
        valid: false
      });
    }

    // Return validated customer info
    return res.status(200).json({
      valid: true,
      customer_id: result.customer_id,
      email: result.email,
      plan: result.plan
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
