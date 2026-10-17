# Steward

Steward reviews supplier invoices before paying them. It checks the approved payee, purchase order and delivery acceptance, catches duplicates, and leaves enough cash for operating expenses. Each decision stays attached to the invoice.

Built for the [Tameion hackathon](https://tameion.thecanteenapp.com/). [Source on GitHub](https://github.com/traien/steward-payables).

## Where it stands

**Payments on Arc through Circle.** Steward has moved 13.85 test USDC on Arc testnet across five transfers, all submitted by the app through Circle Developer-Controlled Wallets and reconciled against Circle's `COMPLETE` state and the chain receipt.

- An earlier single 1 USDC transfer proved the payment path end to end. [Transaction](https://explorer.testnet.arc.io/tx/0x318baf89186886c0723a6304f84517682aa98d2f7a5c11c2c27663cc0db7f034)

The invoices behind those transfers are fictional and both wallets are mine, so this is integration evidence, not customer volume. Mainnet is disabled.

**Real use.** I ran one of my own paid freelance invoices through the client-invoice review. It was a historical record, not a payment Steward collected, and I found the recordkeeping useful. No other users yet.

## Try the demo

The sample business opens with 16 payable invoices, eight suppliers and five client invoices. Five historical simulated payments total 1,863 USDC. Client records show USD 11,450 invoiced, 4,200 recorded paid and 7,250 outstanding. All are fictional examples, separate from your private records.

The dashboard previews the policy before a run: one eligible payment, four holds and six exceptions. Run the agent to simulate a 343 USDC payment after a 2% discount. The remaining 907 USDC protects a 500 reserve and a 1 fee buffer, leaving 406 available; the 600 USDC invoice stays held. Other examples include changed recipients, duplicates, missing evidence, order mismatches, future due dates and owner approval limits.

Add 500 demo USDC and run again to release the held invoice, leaving 807 USDC. Running a third time will not pay it twice. Open an invoice for its checks, or export the decision journal.

## Review your client invoices

Open **Client invoices** to read the five sample records, covering paid, overdue, upcoming, pending acceptance and disputed work. Sample records cannot be edited or used to submit owner feedback. To use your own records, sign in and open the private workspace as the configured owner. Record a client alias, reference, total, currency, due date, amount already received and work-acceptance status. Keep the original document in your own files; the app stores a source reference only.

The review calculates the remaining balance and suggests a next step. Paid-in-full records are historical and need no collection follow-up. Disputed work and pending acceptance take priority over overdue reminders. USD, EUR, GBP and TRY stay in their original currency; the app does not convert or add them together.

Read the result and record your own assessment. Feedback is attached to the review you saw and must be reconsidered when that review changes. These records never enter the outgoing payment queue or call an AI provider. Paid amounts are owner-reported, not verified bank receipts or Circle volume. Imports cannot replace records, and editing saved records is not yet supported.

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

The API smoke test checks concurrent runs, payment replay, balances, exports and session isolation using disposable sample records. It refuses non-loopback URLs. `tests/receivables-api-smoke.mjs` separately checks imports, owner authorization, stale-review feedback and audit exports against a fresh local production Worker. Set `STEWARD_RECEIVABLES_TEST_URL` to that Worker, configure only `STEWARD_OWNER_ID=receivables_test_owner` and `STEWARD_ENABLE_AI=false`, and use a separate D1 state directory with no provider credentials. It refuses a populated receivables workspace or a Circle-enabled Worker.

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

Follow the [Circle setup guide](docs/circle-setup.md) to create the test key and wallet. Once configured, `npm run test:circle` reads the actual wallet and USDC balance without submitting a payment. A successful connection check does not prove that transfers work; the guide describes the separate payment and receipt check.

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
