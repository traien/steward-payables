# Steward

Steward reviews supplier invoices before paying them. It checks the approved payee, purchase order and delivery acceptance, catches duplicates, and leaves enough cash for operating expenses. Each decision stays attached to the invoice.

Built for the [Tameion hackathon](https://tameion.thecanteenapp.com/). [Source on GitHub](https://github.com/traien/steward-payables).

## Try the demo

Run the agent to review five invoices. It simulates a 343 USDC payment after a 2% discount, holds a 600 USDC invoice to preserve the reserve, and stops three exceptions: a changed payee, a duplicate invoice and missing delivery acceptance. A previous 180 USDC simulated invoice is included to demonstrate duplicate detection.

Add demo funds and run again to release the held invoice. Running a third time will not pay it twice. Open an invoice for its checks, or export the decision journal.

## Local setup

Requires Node.js 22.13+ and npm. Dependencies stay inside the project.

```sh
npm ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_peaceful_millenium_guard.sql
npm run dev
```

Open the URL printed by the server. Local sign-in uses the starter's mock identity; keep this server on loopback. Hosted authentication is supplied by Sites.

```sh
npm test
npm run typecheck
npm run build
# With the development server running:
node tests/api-smoke.mjs
```

The API smoke test checks concurrent runs, payment replay, balances, exports and session isolation using disposable sample records. It refuses non-loopback URLs.

## Pilot configuration

Copy `.env.example` to `.env.local`, or use hosted runtime secrets. Both `.env.local` and `.dev.vars` are ignored by Git. Never commit keys or business records.

| Setting                | Purpose                                                                         |
| ---------------------- | ------------------------------------------------------------------------------- |
| `CIRCLE_API_KEY`       | Circle test API key                                                             |
| `CIRCLE_ENTITY_SECRET` | Registered 32-byte entity secret                                                |
| `CIRCLE_WALLET_ID`     | Developer-controlled Arc testnet wallet                                         |
| `CIRCLE_BLOCKCHAIN`    | Must be `ARC-TESTNET`                                                           |
| `STEWARD_OWNER_ID`     | Signed-in user ID shown in Setup                                                |
| `STEWARD_ENABLE_AI`    | `false` until the account owner approves API use                                |
| `STEWARD_AI_PROVIDER`  | Explicitly choose `compatible` or `openai`; no automatic fallback               |
| `STEWARD_AI_BASE_URL`  | Compatible provider's HTTPS API base, such as `https://provider.example/v1` |
| `STEWARD_AI_API_KEY`   | Separate key for the compatible provider                                        |
| `STEWARD_AI_MODEL`     | Model supported by that provider; no default                                    |
| `OPENAI_API_KEY`       | Optional OpenAI key, used only with the OpenAI endpoint                         |
| `OPENAI_MODEL`         | Defaults to `gpt-5.4-mini` for OpenAI                                           |

See [integration setup](docs/integrations.md) for provider details. Only the configured owner can run pilot payments or change pilot policy. Other signed-in users have separate records and cannot spend from that wallet.

A compatible provider never uses `OPENAI_API_KEY` or `OPENAI_MODEL`. Selecting OpenAI requires its own key and explicit approval to use that account. If AI is enabled but its configuration is incomplete, owner runs stop before creating payment intents.

After the provider account owner approves a live test, this command reviews fictional demo invoices only. It cannot submit payments and does not enable AI in the running app:

```sh
STEWARD_ENABLE_AI=true npm run test:ai
```

## How payments work

The rules check the invoice and reserve the amount within the run budget. An optional model review may hold or reject an eligible payment, but cannot change its amount or recipient or override a failed check.

The server saves a payment intent and UUID before contacting Circle. If the response is lost, reconciliation reuses that UUID. It marks a transfer complete only after checking the receipt's wallet, network, recipient, amount, token and reference. Failed intents stay in the journal for investigation.

D1 locks and revision checks serialize workspace changes. Imports append records; they cannot replace an invoice ID or change an approved vendor's address. Runs retain input snapshots. Journal entries are hash chained, but a server operator can replace the entire history; the hashes are not independent proof.

These controls run in application code. There is no contract-enforced spending limit, scheduler or accounting-system write-back. Vendor approval and delivery acceptance are supplied by the operator. Testnet transfers have no monetary value and do not settle real invoices.

The app uses React, the Next.js App Router interface, Vinext, Cloudflare Workers and D1. The Sites starter supplies hosting and authentication integration.
