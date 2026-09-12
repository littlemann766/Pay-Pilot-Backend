# Pay-Pilot backend 9.4.1 deployment

Replace the files in the Pay-Pilot-Backend repository with this update and let Railway redeploy.

Required Railway variables:
- PLAID_CLIENT_ID
- PLAID_SECRET
- PLAID_ENV=sandbox (while testing Tartan Bank)

Optional:
- DATABASE_URL (the server now falls back to memory instead of crashing if Postgres is temporarily unavailable)
- PLAID_REDIRECT_URI for OAuth/app-to-app institutions. This must be an HTTPS URL allowlisted in Plaid.
- PLAID_WEBHOOK_URL

After deployment, opening the Railway service root or /api/health should return JSON containing:
- version: 9.4.1
- plaidConfigured: true
- hostedLink: true

If plaidConfigured is false, add the Plaid variables in Railway before testing Connect another bank.
