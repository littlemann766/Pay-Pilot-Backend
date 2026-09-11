# Pay-Pilot Backend — Sandbox Hosting Build

This is the deploy-ready Sandbox backend for Pay-Pilot + Plaid.

## Required environment variables
- PLAID_CLIENT_ID
- PLAID_SECRET
- PLAID_ENV=sandbox

Do not commit `.env` or Plaid secrets to GitHub.

## Start locally
npm install
npm start

## Production warning
The current access-token store is intentionally in-memory for Sandbox testing only. Before connecting real customer accounts, add authentication and encrypted persistent per-user token storage.
