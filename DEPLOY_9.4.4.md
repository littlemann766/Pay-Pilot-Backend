# Pay-Pilot Backend 9.4.4

Fixes Hosted Link token creation by sending the Plaid request as exact raw JSON so the required mobile redirect fields cannot be stripped by SDK serialization.

Required Railway variables:
- PLAID_CLIENT_ID
- PLAID_SECRET
- PLAID_ENV=sandbox (while testing)

Plaid Allowed redirect URI:
https://pay-pilot-backend-production.up.railway.app/plaid/oauth-redirect
