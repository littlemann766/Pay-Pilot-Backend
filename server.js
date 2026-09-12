import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import pg from 'pg';
import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from 'plaid';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const env = process.env.PLAID_ENV || 'sandbox';
const config = new Configuration({
  basePath: PlaidEnvironments[env],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});
const plaid = new PlaidApi(config);

const { Pool } = pg;
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false } })
  : null;

const memory = new Map();
const pendingMemory = new Map();

async function init() {
  if (!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS plaid_items (
    user_id TEXT NOT NULL,
    item_id TEXT PRIMARY KEY,
    access_token TEXT NOT NULL,
    institution_id TEXT,
    institution_name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS plaid_pending_links (
    user_id TEXT PRIMARY KEY,
    link_token TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);
}

async function putItem(x) {
  if (pool) {
    await pool.query(
      `INSERT INTO plaid_items(user_id,item_id,access_token,institution_id,institution_name)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(item_id) DO UPDATE SET
         access_token=EXCLUDED.access_token,
         institution_id=EXCLUDED.institution_id,
         institution_name=EXCLUDED.institution_name,
         updated_at=NOW()`,
      [x.userId, x.itemId, x.accessToken, x.institutionId || null, x.institutionName || null]
    );
  } else {
    const a = memory.get(x.userId) || [];
    memory.set(x.userId, [...a.filter(i => i.itemId !== x.itemId), x]);
  }
}

async function getItems(userId) {
  if (pool) {
    const r = await pool.query('SELECT * FROM plaid_items WHERE user_id=$1 ORDER BY created_at', [userId]);
    return r.rows.map(x => ({
      userId: x.user_id,
      itemId: x.item_id,
      accessToken: x.access_token,
      institutionId: x.institution_id,
      institutionName: x.institution_name,
    }));
  }
  return memory.get(userId) || [];
}

async function delItem(userId, itemId) {
  if (pool) await pool.query('DELETE FROM plaid_items WHERE user_id=$1 AND item_id=$2', [userId, itemId]);
  else memory.set(userId, (memory.get(userId) || []).filter(x => x.itemId !== itemId));
}

async function putPending(userId, linkToken) {
  if (pool) {
    await pool.query(
      `INSERT INTO plaid_pending_links(user_id,link_token) VALUES($1,$2)
       ON CONFLICT(user_id) DO UPDATE SET link_token=EXCLUDED.link_token,updated_at=NOW()`,
      [userId, linkToken]
    );
  } else pendingMemory.set(userId, linkToken);
}

async function getPending(userId) {
  if (pool) {
    const r = await pool.query('SELECT link_token FROM plaid_pending_links WHERE user_id=$1', [userId]);
    return r.rows[0]?.link_token || null;
  }
  return pendingMemory.get(userId) || null;
}

async function clearPending(userId) {
  if (pool) await pool.query('DELETE FROM plaid_pending_links WHERE user_id=$1', [userId]);
  else pendingMemory.delete(userId);
}

function plaidError(e, fallback) {
  const d = e?.response?.data;
  console.error(d || e);
  return d?.display_message || d?.error_message || d?.error_code || fallback;
}

async function exchangeAndStore(userId, publicToken, metadata = {}) {
  const exchange = await plaid.itemPublicTokenExchange({ public_token: publicToken });
  const institution = metadata?.institution || {};
  await putItem({
    userId,
    itemId: exchange.data.item_id,
    accessToken: exchange.data.access_token,
    institutionId: institution.institution_id || '',
    institutionName: institution.name || '',
  });
  return {
    connected: true,
    item_id: exchange.data.item_id,
    institution: institution.name || null,
  };
}

app.get('/', (req, res) => res.json({ status: 'ok', app: 'Pay-Pilot', version: '9.4.1', plaidEnvironment: env, multiBank: true, hostedLink: true }));
app.get('/api/health', (req, res) => res.json({ status: 'ok', app: 'Pay-Pilot', version: '9.4.1', plaidEnvironment: env, hostedLink: true }));

app.post('/api/plaid/create-link-token', async (req, res) => {
  const userId = String(req.body.userId || 'paypilot-local-user');
  try {
    const request = {
      user: { client_user_id: userId },
      client_name: 'Pay-Pilot',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
      hosted_link: {
        completion_redirect_uri: 'paypilot://plaid-complete',
        is_mobile_app: true,
        url_lifetime_seconds: 1800,
      },
    };
    const r = await plaid.linkTokenCreate(request);
    await putPending(userId, r.data.link_token);
    res.json({
      link_token: r.data.link_token,
      hosted_link_url: r.data.hosted_link_url || null,
      expiration: r.data.expiration || null,
    });
  } catch (e) {
    res.status(500).json({ error: plaidError(e, 'link_token_failed') });
  }
});

app.get('/api/plaid/hosted-status/:userId', async (req, res) => {
  const userId = String(req.params.userId || '');
  try {
    const linkToken = await getPending(userId);
    if (!linkToken) return res.json({ connected: false, pending: false, error: 'No pending bank connection was found.' });

    const status = await plaid.linkTokenGet({ link_token: linkToken });
    const data = status.data || {};
    const sessions = Array.isArray(data.link_sessions) ? data.link_sessions : [];
    const session = sessions.length ? sessions[sessions.length - 1] : null;

    // Hosted Link results are returned per Link session, not at the top level.
    const itemResults = Array.isArray(session?.results?.item_add_results)
      ? session.results.item_add_results
      : [];

    // Legacy accounts can still surface the single-item on_success object.
    const legacySuccess = session?.on_success || null;
    const successes = itemResults.length
      ? itemResults
      : (legacySuccess?.public_token ? [{ public_token: legacySuccess.public_token, metadata: legacySuccess.metadata || {} }] : []);

    if (successes.length) {
      const connectedItems = [];
      for (const result of successes) {
        const publicToken = result?.public_token;
        if (!publicToken) continue;
        const metadata = result?.metadata || {
          institution: result?.institution || null,
          accounts: result?.accounts || [],
        };
        connectedItems.push(await exchangeAndStore(userId, publicToken, metadata));
      }
      if (connectedItems.length) {
        await clearPending(userId);
        return res.json({
          connected: true,
          count: connectedItems.length,
          institution: connectedItems[0]?.institution || null,
          items: connectedItems,
        });
      }
    }

    const finished = !!session?.finished_at;
    if (finished) {
      const exit = session?.on_exit || session?.exit || {};
      const error = exit?.error?.display_message || exit?.error?.error_message || exit?.error_message ||
        'Bank connection was closed before an account was connected.';
      await clearPending(userId);
      return res.json({ connected: false, pending: false, error });
    }

    return res.json({ connected: false, pending: true });
  } catch (e) {
    res.status(500).json({ error: plaidError(e, 'hosted_status_failed') });
  }
});

app.post('/api/plaid/exchange-public-token', async (req, res) => {
  try {
    const userId = String(req.body.userId || 'paypilot-local-user');
    const out = await exchangeAndStore(userId, req.body.public_token, req.body.metadata || {});
    await clearPending(userId);
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: plaidError(e, 'token_exchange_failed') });
  }
});

app.get('/api/plaid/accounts/:userId', async (req, res) => {
  try {
    const items = await getItems(req.params.userId);
    if (!items.length) return res.json({ accounts: [], items: [] });
    const accounts = [];
    for (const item of items) {
      try {
        const r = await plaid.accountsGet({ access_token: item.accessToken });
        for (const a of r.data.accounts) {
          accounts.push({
            ...a,
            item_id: item.itemId,
            institution_id: item.institutionId,
            institution_name: item.institutionName || 'Connected institution',
          });
        }
      } catch (e) {
        console.error('accounts item failed', item.itemId, e.response?.data || e);
      }
    }
    res.json({
      accounts,
      items: items.map(i => ({ item_id: i.itemId, institution_id: i.institutionId, institution_name: i.institutionName })),
    });
  } catch (e) {
    res.status(500).json({ error: 'accounts_failed' });
  }
});

app.delete('/api/plaid/items/:userId/:itemId', async (req, res) => {
  try {
    const items = await getItems(req.params.userId);
    const item = items.find(x => x.itemId === req.params.itemId);
    if (item) {
      try { await plaid.itemRemove({ access_token: item.accessToken }); }
      catch (e) { console.error('Plaid remove warning', e.response?.data || e); }
      await delItem(req.params.userId, req.params.itemId);
    }
    res.json({ disconnected: true });
  } catch (e) {
    res.status(500).json({ error: 'disconnect_failed' });
  }
});

app.get('/api/plaid/transactions/:userId', async (req, res) => {
  try {
    const items = await getItems(req.params.userId);
    const start_date = req.query.start_date || new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
    const end_date = req.query.end_date || new Date().toISOString().slice(0, 10);
    const transactions = [];
    for (const item of items) {
      try {
        const r = await plaid.transactionsGet({
          access_token: item.accessToken,
          start_date,
          end_date,
          options: { count: 250, offset: 0 },
        });
        transactions.push(...r.data.transactions.map(t => ({
          ...t,
          item_id: item.itemId,
          institution_name: item.institutionName || 'Connected institution',
        })));
      } catch (e) {
        console.error('transactions item failed', item.itemId, e.response?.data || e);
      }
    }
    res.json({ transactions });
  } catch (e) {
    res.status(500).json({ error: 'transactions_failed' });
  }
});

const port = Number(process.env.PORT || 8787);
init()
  .then(() => app.listen(port, () => console.log(`Pay-Pilot backend listening on ${port}`)))
  .catch(err => { console.error('Backend init failed', err); process.exit(1); });
