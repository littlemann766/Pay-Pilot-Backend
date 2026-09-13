# Pay-Pilot backend 9.4.7

Database migration release.

- Adds missing `plaid_items.user_id` automatically on Railway startup.
- Verifies the other columns required by connected banking.
- Adds an index on `plaid_items.user_id`.
- Keeps the working Plaid Hosted Link flow unchanged.

After Railway deploys, `/api/health` should report version `9.4.7`.
