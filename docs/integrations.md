# Integration contract and testnet boundaries

The app can run with deterministic rules and simulated payments without external credentials. Configuration badges report whether server configuration exists; they do not prove a successful provider connection. The implementation uses native `fetch` and Node crypto and installs no provider SDK or global tools.

## OpenAI review

AI API use is disabled by default, including when an `OPENAI_API_KEY` already exists. The owner has explicitly required permission before using their OpenAI account. Do not create keys, configure credentials, enable AI, or make live AI requests without that permission. Mock tests are the only AI verification performed here.

After explicit permission, set `STEWARD_ENABLE_AI=true` and configure `OPENAI_API_KEY` in server-side secrets. Both are required for AI capability to be enabled. `OPENAI_MODEL` is optional and defaults to `gpt-5.4-mini`. When the operator then requests AI review, the planner sends invoice descriptions, source references, purchase-order evidence, rule decisions, and business policy to `POST https://api.openai.com/v1/responses`. It uses strict JSON Schema output and `store: false`. Do not load confidential business documents into a pilot without the business's permission to process them with OpenAI. `store: false` is not a promise of zero provider retention.

The application rules determine payment eligibility and amounts first. AI may retain a payable decision or stop it for review; held, escalated, and blocked decisions cannot be promoted. The response schema has no amount or destination field, and the parser rejects unexpected fields, unknown or duplicate invoice IDs, omissions, refusals, and incomplete responses. Invoice text is explicitly treated as untrusted data in the instruction. Recipient addresses and credentials are not included in the model input. Original evidence and checks remain attached to decisions.

With the opt-in gate off or no API key, decisions remain explicitly labeled `rules` and disclose that AI review was not performed. Once AI is explicitly enabled and a key is configured, owner runs use AI review. An API or parsing failure aborts the run before transfers; it does not silently pretend a rule-based result was an AI result. Set `STEWARD_ENABLE_AI=false` on the server to restore rules-only execution.

Reference: [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

## Circle developer-controlled wallet

Required server secrets/configuration:

| Variable               | Value                                                               |
| ---------------------- | ------------------------------------------------------------------- |
| `CIRCLE_API_KEY`       | Full `TEST_API_KEY:ID:SECRET` key; live keys are rejected.          |
| `CIRCLE_ENTITY_SECRET` | Previously registered 32-byte entity secret as 64 hex characters.   |
| `CIRCLE_WALLET_ID`     | Existing developer-controlled wallet UUID on Arc testnet.           |
| `CIRCLE_BLOCKCHAIN`    | Optional; defaults to `ARC-TESTNET`. Every other value is rejected. |

The integration does not create accounts, register entity secrets, create wallets, request faucet funds, or support mainnet. Those setup steps must be completed separately using the owner's Circle account. Never put credentials in source files, chat, screenshots, audit exports, or public environment variables. Use only no-value test tokens.

All requests use `https://api.circle.com/v1/w3s` with server-only bearer authentication. Before each write, the adapter retrieves `/wallets/{id}` and verifies the returned ID, `ARC-TESTNET` network, `LIVE` state, and `DEVELOPER` custody. This checks the actual wallet rather than trusting an environment label. See [Circle API keys](https://developers.circle.com/api-reference/keys) and [Retrieve a wallet](https://developers.circle.com/api-reference/wallets/developer-controlled-wallets/get-wallet).

Balances come from `/wallets/{id}/balances?includeAll=true&tokenAddress=0x3600000000000000000000000000000000000000`. The adapter requires the canonical Arc testnet USDC contract, six decimals, USDC symbol, and non-native representation. Native 18-decimal USDC is never added to the ERC-20 balance; it represents the same funds. Sub-cent balances round down using integer arithmetic. Unknown token metadata fails closed. See [Circle balances](https://developers.circle.com/api-reference/wallets/developer-controlled-wallets/list-wallet-balance), [USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses), and [Circle's Arc decimal guidance](https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-arc/SKILL.md).

For each transfer, the adapter retrieves `/config/entity/publicKey` and creates a fresh RSA-OAEP SHA-256 encryption of the entity secret. It sends the resulting base64 ciphertext to `POST /developer/transactions/transfer`. Payload fields are `idempotencyKey`, `entitySecretCiphertext`, `walletId`, `blockchain`, `tokenAddress`, `destinationAddress`, `amounts`, `feeLevel`, and `refId`. Amounts are exact decimal strings derived from the approved integer cents, including any approved early-payment discount. See [Entity secret authorization](https://developers.circle.com/wallets/dev-controlled/entity-secret-management) and [Create a transfer](https://developers.circle.com/api-reference/wallets/developer-controlled-wallets/create-developer-transaction-transfer).

## Intent and reconciliation

The runner must save the UUID idempotency key, exact amount, and recipient before submitting. The adapter requires the matching pending testnet intent and a `pay` decision whose amount is positive and no larger than the original invoice. It never generates replacement keys. Timeouts and ambiguous errors preserve pending state; reconcile with the original key, then poll `/transactions/{id}`. Provider response bodies and thrown provider errors are never exposed to the browser or audit log.

Only `COMPLETE` with a valid transaction hash and a matching persisted invoice intent counts as complete. The receipt must be outbound and match the intent's recipient, exact amount (including fractional units), transaction ID, and idempotency reference. The adapter resolves the receipt's token ID through `/tokens/{id}` and verifies canonical six-decimal Arc testnet USDC. Calling `getPayment(transactionId, invoice)` with the invoice is therefore required to recognize completion; a missing invoice fails closed. `FAILED`, `CANCELLED`, and `DENIED` are terminal failures. `CONFIRMED` and all other nonterminal states remain pending. Every transaction must match the configured wallet, Arc testnet, developer custody, and transfer operation. An unresolved transfer must block new runs until reconciliation. See [Get a transaction](https://developers.circle.com/api-reference/wallets/developer-controlled-wallets/get-transaction), [Get token details](https://developers.circle.com/api-reference/wallets/developer-controlled-wallets/get-token-id), and [Circle transfer lifecycle](https://developers.circle.com/wallets/dev-controlled/transfer-tokens-across-wallets).

Payment caps, vendor allowlists, invoice evidence checks, and cash reserves are enforced by this application's server. They are not presented as Circle-enforced wallet policies: Circle's [agent wallet spending policies](https://developers.circle.com/agent-stack/agent-wallets/wallet-operations/custom-policies) currently require mainnet and do not support testnet. This prototype does not establish mainnet security or real-world invoice discharge.

## Verification performed

`tests/integrations.test.ts` uses mocked fetch responses and an ephemeral RSA key pair. It covers mainnet/live-key rejection, actual wallet validation, canonical USDC accounting, discounted exact amounts, fresh decryptable ciphertext, persistent idempotency, sanitized ambiguous errors, transaction-state mapping, absent AI credentials, AI privilege boundaries, and malformed AI outputs. These tests make no provider requests and move no funds. Real credentials and a successful onchain transfer are separate evidence still required before claiming a working live testnet pilot.
