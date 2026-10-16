# Steward · Pay with proof

An invoice-payment prototype for the Tameion Agents Hackathon. Steward checks the business evidence behind a payment, preserves a cash reserve, holds or escalates exceptions, and records the decision before requesting Arc testnet settlement through Circle.

**Status:** The sample workspace uses explicitly synthetic invoices and simulated transfers. Live AI and Circle functionality require owner-provided runtime credentials and end-to-end validation. No customer adoption or real-money payment volume is claimed. This is a hackathon prototype, not a production treasury system.

## What you can try

1. Open the demo and run the agent. Inspect the eligible invoice, cash-preserving hold, changed-recipient exception, duplicate, and missing acceptance.
2. Add simulated cash and run again. The held obligation can become payable while the cash reserve stays intact.
3. Run it again to check that a recorded payment is not repeated.
4. Inspect the evidence checks and decision journal; download an evidence export with honest demo/testnet metrics.
5. Sign in to import an actual pilot's structured records. Only the configured owner can change pilot policy or request testnet transfers.

## Run locally

Requires Node.js 22.13+ and npm. All tools are project-local. Do not install the event's global CLIs.

```sh
npm ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_peaceful_millenium_guard.sql
npm run dev
```

Open the printed local URL. The development server uses the starter's loopback-only mock ChatGPT identity. Follow **Setup → Sign in** to use it. Production authentication is supplied by Sites; never expose the local development server publicly.

```sh
npm test
npm run typecheck
npm run build
```

With the local server running, `node tests/api-smoke.mjs` exercises isolated demo sessions, concurrent runs, exact balances, repeat-payment prevention, the evidence export, and access checks. It refuses non-loopback destinations and uses synthetic records only.

## Connect the private pilot

Start with `.env.example`; place values in ignored `.env.local` for local work or Sites runtime secrets for hosting. Never commit credentials or real invoice data. The public browser receives configuration booleans, not keys.

| Setting                | Purpose                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`       | Optional structured AI planning                                                         |
| `OPENAI_MODEL`         | Planning model, default `gpt-5.4-mini`                                                  |
| `STEWARD_ENABLE_AI`    | Defaults to `false`; enable only after explicit account-owner approval for AI API calls |
| `CIRCLE_API_KEY`       | Circle **test** API key                                                                 |
| `CIRCLE_ENTITY_SECRET` | Registered Circle entity secret                                                         |
| `CIRCLE_WALLET_ID`     | Developer-controlled Arc testnet wallet                                                 |
| `CIRCLE_BLOCKCHAIN`    | Must be `ARC-TESTNET`                                                                   |
| `STEWARD_OWNER_ID`     | Exact signed-in Site user ID shown in Setup                                             |

See [integration instructions](docs/integrations.md). The initial server enforces one configured owner and wallet. Additional signed-in visitors can keep separate records but cannot spend that wallet. AI stays off by default even if a key exists; the account owner must explicitly approve usage before the server opt-in is enabled. Tests use mocked responses and make no live AI calls. Circle configuration badges do not prove connection health.

## Execution and safety boundaries

- The model receives business inputs, never payment keys. It cannot promote a failed check to a payment, increase the amount, or change the recipient. A configured AI request failure stops the run.
- Monetary values use integer cents. The Circle adapter uses the canonical USDC token and validates the wallet network. Mainnet execution is rejected.
- D1 persists each workspace. A database lock and revision checks serialize operations across server instances. Payment intent and UUID idempotency key are saved **before** the external request.
- Pilot imports append to history and cannot replace previous invoice IDs or change an approved vendor address. The demo can be reset independently; the pilot journal cannot be reset from the UI.
- Decision runs include their input snapshots. Journal entries form a SHA-256 hash chain. This detects ordinary alteration of exported history, but is **not signed, externally anchored, or tamper-proof against the server owner**.

The policy boundary is **application code**, not a smart contract. Circle Agent Wallet native custom policies currently do not support testnet. A malicious or compromised server operator could bypass application checks; production use needs an independently enforced spending boundary and a security review.

Imported acceptance and vendor approval are owner attestations, not independent checks of work quality or vendor identity. Steward does not perform comprehensive sanctions screening. Testnet transfers have no monetary value and do not discharge real-world invoices. The prototype does not write “paid” back to a business accounting system.

## Architecture

```text
Browser workspace → authenticated API → D1 workspace + serialized mutation
                                      ↓
                            deterministic evidence/policy checks
                                      ↓
                            optional bounded OpenAI planner
                                      ↓
                            persisted payment intent
                                      ↓
                            Circle wallet → Arc testnet
                                      ↓
                            reconciliation + evidence export
```

The frontend is React with the Next.js App Router interface, built by Vinext for Cloudflare Workers. Sites provisions D1 and hosts the Worker. The supplied starter's build and authentication integration is preserved. There is no always-running payment scheduler: an operator starts a run; eligible payments within that run need no per-invoice click.
