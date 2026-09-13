# Pay-Pilot Backend — Authoritative Guide

**Backend version:** 9.5.5

This is the single authoritative backend deployment document. Do not create separate `DEPLOY_9.x.x.md` files. Update this file whenever backend setup changes.

## Repository root
Railway must build the actual backend files from the repository root:

- `server.js`
- `package.json`
- `package-lock.json`
- `.env.example`
- `.gitignore`
- `README.md`
- `PAY-PILOT-BACKEND.md`

Do **not** upload `Pay-Pilot-Backend-main.zip` as a file inside the GitHub repository. Extract it first and upload/replace the files above.

## Railway
The Railway service should be connected to the backend GitHub repository and the `main` branch. A push to `main` should trigger deployment.

Start command:

```text
npm start
```

The app listens on Railway's `PORT` (default fallback 8080).

## Required Railway variables

- `DATABASE_URL` — Railway PostgreSQL connection string
- `PLAID_CLIENT_ID` — Plaid client ID
- `PLAID_SECRET` — Plaid secret for the selected environment
- `PLAID_ENV` — `sandbox` while testing; switch to `production` only when Production access and the Production secret are ready
- `PLAID_REDIRECT_URI` — Pay-Pilot OAuth redirect URL registered in Plaid
- `PLAID_COMPLETION_REDIRECT_URI` — `paypilot://plaid-complete`

Optional:

- `PGSSL=disable` only when using a database that explicitly requires SSL disabled

Never put `PLAID_SECRET` in the Android app or frontend files.

## Health check
After deployment, open:

```text
https://pay-pilot-backend-production.up.railway.app/api/health
```

Confirm the returned `version` is `9.5.5` before testing Connected Accounts.

## Plaid flow
Pay-Pilot uses Hosted Link. The working flow is:

1. Android requests a Hosted Link token from the backend.
2. Plaid opens in the secure browser.
3. Plaid returns to `paypilot://plaid-complete`.
4. Backend retrieves the Hosted Link session result.
5. Backend exchanges the returned public token.
6. Item/access token is stored in PostgreSQL.
7. Accounts/balances are fetched read-only for Pay-Pilot.

Do not change the working Hosted Link redirect configuration unless the Plaid integration itself requires it.

## Database migrations
`server.js` applies idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` migrations for existing Railway databases. Keep future schema migrations idempotent so old installations upgrade without deleting data.

## Multi-bank rules
Pay-Pilot supports multiple institutions. Canonical finance math is account-based, not institution-total based. Accounts must be deduplicated by Plaid account ID before totals are calculated.

## Release discipline
- Keep backend `package.json`, `server.js` health/version output, and the paired app version aligned.
- Update this file instead of creating a new deployment markdown file.
- Verify `/api/health` before testing a new APK.


## 9.5.5 transaction feed
`GET /api/plaid/transactions/:userId` is the authoritative read-only transaction-history endpoint used by the Spending screen. Account and transaction identifiers must be returned unchanged so the app can deduplicate safely.
