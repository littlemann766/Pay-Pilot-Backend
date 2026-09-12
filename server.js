require("dotenv").config();

const express = require("express");
const cors = require("cors");
const {Pool} = require ("pg");
const {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
  CountryCode,
} = require("plaid");

const app = express();

app.use(cors());
app.use(express.json());
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS plaid_items (
        id SERIAL PRIMARY KEY,
        item_id TEXT UNIQUE NOT NULL,
        access_token TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log("Pay-Pilot database ready");
  } catch (error) {
    console.error("Database setup error:", error.message);
  }
}

initDatabase();
const configuration = new Configuration({
  basePath: PlaidEnvironments.sandbox,
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
      "PLAID-SECRET": process.env.PLAID_SECRET,
    },
  },
});

const plaidClient = new PlaidApi(configuration);

// Simple test so we know Pay-Pilot's backend is alive.
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    app: "Pay-Pilot",
    plaidEnvironment: "sandbox",
  });
});

// Creates the token Pay-Pilot will use to open Plaid Link.
app.post("/api/create_link_token", async (req, res) => {
  try {
    const response = await plaidClient.linkTokenCreate({
      user: {
        client_user_id: "pay-pilot-sandbox-user",
      },
      client_name: "Pay-Pilot",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
    });

    res.json({
      link_token: response.data.link_token,
    });
  } catch (error) {
    console.error(
      "Plaid error:",
      error.response?.data || error.message
    );

    res.status(500).json({
      error: "Unable to create Plaid Link token",
      details: error.response?.data || error.message,
    });
  }
});
app.post("/api/exchange_public_token", async (req, res) => {
  try {
    const { public_token } = req.body;

    if (!public_token) {
      return res.status(400).json({
        error: "public_token is required",
      });
    }

    const response = await plaidClient.itemPublicTokenExchange({
      public_token,
    });

    const accessToken = response.data.access_token;
    const itemId = response.data.item_id;

    // Sandbox testing only — we'll replace this with
    // secure database storage before using real accounts.
   await pool.query(
  `INSERT INTO plaid_items (item_id, access_token)
   VALUES ($1, $2)
   ON CONFLICT (item_id)
   DO UPDATE SET
     access_token = EXCLUDED.access_token,
     updated_at = CURRENT_TIMESTAMP`,
  [itemId, accessToken]
);

    res.json({
      success: true,
      item_id: itemId,
    });
  } catch (error) {
    console.error(
      "Plaid token exchange error:",
      error.response?.data || error.message
    );

    res.status(500).json({
      error: "Unable to exchange Plaid public token",
      details: error.response?.data || error.message,
    });
  }
});
app.get("/api/accounts", async (req, res) => {
  try {
    const tokenResult = await pool.query(
  `SELECT access_token
   FROM plaid_items
   ORDER BY updated_at DESC
   LIMIT 1`
);

if (tokenResult.rows.length === 0) {
  return res.status(400).json({
    error: "No bank account connected yet",
  });
}

const accessToken = tokenResult.rows[0].access_token;

    const response = await plaidClient.accountsBalanceGet({
      access_token: accessToken,
    });

    const accounts = response.data.accounts.map((account) => ({
      account_id: account.account_id,
      name: account.name,
      official_name: account.official_name,
      mask: account.mask,
      type: account.type,
      subtype: account.subtype,
      available: account.balances.available,
      current: account.balances.current,
      currency: account.balances.iso_currency_code,
    }));

    res.json({
      success: true,
      accounts,
    });
  } catch (error) {
    console.error(
      "Plaid accounts error:",
      error.response?.data || error.message
    );

    res.status(500).json({
      error: "Unable to retrieve accounts",
      details: error.response?.data || error.message,
    });
  }
});
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Pay-Pilot backend running on port ${PORT}`);
});