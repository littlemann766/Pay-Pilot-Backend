# Pay-Pilot Connected Accounts backend

This is the **Sandbox foundation**, not production storage.

1. Copy `.env.example` to `.env` and add Plaid Sandbox credentials.
2. Run `npm install` then `npm start`.
3. Keep `.env` private. Never put `PLAID_SECRET` in the Android/WebView app.

Before production: add authentication, encrypted database storage, per-user token ownership, webhook verification, transaction sync persistence, rate limiting, monitoring, and deletion/export flows.
