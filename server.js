require('dotenv').config();

const express = require('express');
const cors = require('cors');
const {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
  CountryCode,
} = require('plaid');

const app = express();
app.use(express.json());

const allowed = String(process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
app.use(cors(allowed.length ? { origin: allowed } : {}));

const plaidEnvName = process.env.PLAID_ENV || 'sandbox';
const plaidBasePath = PlaidEnvironments[plaidEnvName] || PlaidEnvironments.sandbox;
const plaidClient = new PlaidApi(new Configuration({
  basePath: plaidBasePath,
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
}));

// Sandbox/development-only temporary storage.
// DO NOT use this for real customer bank connections.
// Before Production, replace with authenticated, encrypted, per-user database storage.
const accessTokens = new Map();
const DEFAULT_USER = 'pay-pilot-sandbox-user';
const userId = req => String(req.body?.userId || req.params?.userId || req.query?.userId || DEFAULT_USER);

app.get('/', (req, res) => {
  res.json({ status: 'ok', app: 'Pay-Pilot', plaidEnvironment: plaidEnvName });
});
app.get('/health', (req, res) => res.json({ ok: true, environment: plaidEnvName }));

app.post(['/api/create_link_token', '/api/plaid/create-link-token'], async (req, res) => {
  try {
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: userId(req) },
      client_name: 'Pay-Pilot',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
    });
    res.json({ link_token: response.data.link_token });
  } catch (error) {
    console.error('Plaid link token error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Unable to create Plaid Link token', details: error.response?.data || error.message });
  }
});

app.post(['/api/exchange_public_token', '/api/plaid/exchange-public-token'], async (req, res) => {
  try {
    const { public_token } = req.body || {};
    if (!public_token) return res.status(400).json({ error: 'public_token is required' });
    const response = await plaidClient.itemPublicTokenExchange({ public_token });
    accessTokens.set(userId(req), response.data.access_token);
    res.json({ success: true, connected: true, item_id: response.data.item_id });
  } catch (error) {
    console.error('Plaid exchange error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Unable to exchange Plaid public token', details: error.response?.data || error.message });
  }
});

app.get(['/api/accounts', '/api/plaid/accounts/:userId'], async (req, res) => {
  try {
    const token = accessTokens.get(userId(req));
    if (!token) return res.status(400).json({ error: 'No bank account connected yet' });
    const response = await plaidClient.accountsBalanceGet({ access_token: token });
    const accounts = response.data.accounts.map(account => ({
      account_id: account.account_id,
      id: account.account_id,
      name: account.name,
      official_name: account.official_name,
      mask: account.mask,
      type: account.type,
      subtype: account.subtype,
      available: account.balances.available,
      current: account.balances.current,
      currency: account.balances.iso_currency_code,
    }));
    res.json({ success: true, accounts });
  } catch (error) {
    console.error('Plaid accounts error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Unable to retrieve accounts', details: error.response?.data || error.message });
  }
});

app.get(['/api/transactions', '/api/plaid/transactions/:userId'], async (req, res) => {
  try {
    const token = accessTokens.get(userId(req));
    if (!token) return res.status(400).json({ error: 'No bank account connected yet' });
    const end_date = req.query.end_date || new Date().toISOString().slice(0, 10);
    const start_date = req.query.start_date || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const response = await plaidClient.transactionsGet({
      access_token: token,
      start_date,
      end_date,
      options: { count: 250, offset: 0 },
    });
    res.json(response.data);
  } catch (error) {
    console.error('Plaid transactions error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Unable to retrieve transactions', details: error.response?.data || error.message });
  }
});

const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Pay-Pilot backend running on port ${PORT} (${plaidEnvName})`);
});
