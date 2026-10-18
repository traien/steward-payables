# Integration contract and testnet boundaries

The app can run with deterministic rules and simulated payments without external credentials. Configuration badges report whether server configuration exists; they do not prove a successful provider connection. The implementation uses native `fetch` and Node crypto and installs no provider SDK or global tools.

## Optional AI review

LLM review is disabled by default, even when an `OPENAI_API_KEY` is present.

For a compatible provider, set `STEWARD_AI_PROVIDER=compatible`, `STEWARD_AI_BASE_URL`, `STEWARD_AI_API_KEY` and `STEWARD_AI_MODEL` in server-only secrets. The adapter calls `/chat/completions` beneath the base URL. It requires HTTPS, rejects URL credentials, queries and fragments, and refuses redirects. It never reads an OpenAI key or model as a fallback. The selected provider must support Chat Completions with JSON Schema output; an “OpenAI-compatible” label alone does not prove support.

For OpenAI, select `STEWARD_AI_PROVIDER=openai` and supply `OPENAI_API_KEY`. `OPENAI_MODEL` defaults to `gpt-5.4-mini`. This path always calls `POST https://api.openai.com/v1/responses`, using strict JSON Schema output and `store: false`.

Set `STEWARD_ENABLE_AI=true` to enable model review for owner runs. The planner sends invoice descriptions, source references, purchase-order evidence, rule decisions and business policy. Do not send confidential business records without the business's permission to process them with that provider. Provider retention is not controlled by Steward; OpenAI's `store: false` is not a zero-retention promise.

The application rules determine payment eligibility and amounts first. AI may retain a payable decision or stop it for review; held, escalated, and blocked decisions cannot be promoted. The response schema has no amount or destination field, and the parser rejects unexpected fields, unknown or duplicate invoice IDs, omissions, refusals, and incomplete responses. Invoice text is explicitly treated as untrusted data in the instruction. Recipient addresses and credentials are not included in the model input. Original evidence and checks remain attached to decisions.

With the opt-in gate off, decisions remain labeled `rules`. With the gate on, missing provider settings stop owner runs before creating payment intents. An API or parsing failure also aborts the run. Successful decisions retain the `openai` or `compatible` engine label. Chat responses must contain one assistant choice, end with `stop`, and contain no refusal or tool call. Set `STEWARD_ENABLE_AI=false` to restore rules-only execution.

`STEWARD_ENABLE_AI=true npm run test:ai` loads ignored `.env.local` settings and performs one review of fictional invoices. It does not import the payment runner or contact Circle. The command-level opt-in leaves AI disabled in the app when the file still says `false`.

References: [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Chat Completions request and response](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).

## Circle developer-controlled wallet

Required server secrets/configuration:

| Variable               | Value                                                               |
| ---------------------- | ------------------------------------------------------------------- |
| `CIRCLE_API_KEY`       | Full `TEST_API_KEY:ID:SECRET` key; live keys are rejected.          |
| `CIRCLE_ENTITY_SECRET` | Previously registered 32-byte entity secret as 64 hex characters.   |
| `CIRCLE_WALLET_ID`     | Existing developer-controlled wallet UUID on Arc testnet.           |
| `CIRCLE_BLOCKCHAIN`    | Optional; defaults to `ARC-TESTNET`. Every other value is rejected. |

The integration does not create accounts, register entity secrets, create wallets, request faucet funds, or support mainnet; see [Circle setup](circle-setup.md). Keep credentials out of source files, screenshots, audit exports and public environment variables.

All requests use `https://api.circle.com/v1/w3s` with server-only bearer authentication. Before each write, the adapter retrieves `/wallets/{id}` and verifies the returned ID, `ARC-TESTNET` network, `LIVE` state, and `DEVELOPER` custody. This checks the actual wallet rather than trusting an environment label. See [Circle API keys](https://developers.circle.com/api-reference/keys) and [Retrieve a wallet](https://developers.circle.com/api-reference/wallets/developer-controlled-wallets/get-wallet).

Balances come from `/wallets/{id}/balances?includeAll=true&tokenAddress=0x3600000000000000000000000000000000000000`. The adapter requires the canonical Arc testnet USDC contract, six decimals, USDC symbol, and non-native representation. Native 18-decimal USDC is never added to the ERC-20 balance; it represents the same funds. Sub-cent balances round down using integer arithmetic. Unknown token metadata fails closed. See [Circle balances](https://developers.circle.com/api-reference/wallets/developer-controlled-wallets/list-wallet-balance), [USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses), and [Circle's Arc decimal guidance](https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-arc/SKILL.md).

For each transfer, the adapter retrieves `/config/entity/publicKey` and creates a fresh RSA-OAEP SHA-256 encryption of the entity secret. It sends the resulting base64 ciphertext to `POST /developer/transactions/transfer`. Payload fields are `idempotencyKey`, `entitySecretCiphertext`, `walletId`, `blockchain`, `tokenAddress`, `destinationAddress`, `amounts`, `feeLevel`, and `refId`. Amounts are exact decimal strings derived from the approved integer cents, including any approved early-payment discount. See [Entity secret authorization](https://developers.circle.com/wallets/dev-controlled/entity-secret-management) and [Create a transfer](https://developers.circle.com/api-reference/wallets/developer-controlled-wallets/create-developer-transaction-transfer).

## Intent and reconciliation

The runner must save the UUID idempotency key, exact amount, and recipient before submitting. The adapter requires the matching pending testnet intent and a `pay` decision whose amount is positive and no larger than the original invoice. It never generates replacement keys. Timeouts and ambiguous errors preserve pending state; reconcile with the original key, then poll `/transactions/{id}`. Provider response bodies and thrown provider errors are never exposed to the browser or audit log.

Only `COMPLETE` with a valid transaction hash and a matching persisted invoice intent counts as complete. The receipt must be outbound and match the intent's recipient, exact amount (including fractional units), transaction ID, and idempotency reference. The adapter resolves the receipt's token ID through `/tokens/{id}` and verifies canonical six-decimal Arc testnet USDC. Calling `getPayment(transactionId, invoice)` with the invoice is therefore required to recognize completion; a missing invoice fails closed. `FAILED`, `CANCELLED`, and `DENIED` are terminal failures. `CONFIRMED` and all other nonterminal states remain pending. Every transaction must match the configured wallet, Arc testnet, developer custody, and transfer operation. An unresolved transfer must block new runs until reconciliation. See [Get a transaction](https://developers.circle.com/api-reference/wallets/developer-controlled-wallets/get-transaction), [Get token details](https://developers.circle.com/api-reference/wallets/developer-controlled-wallets/get-token-id), and [Circle transfer lifecycle](https://developers.circle.com/wallets/dev-controlled/transfer-tokens-across-wallets).

Payment caps, vendor allowlists, invoice evidence checks, and cash reserves are enforced by this application's server. They are not presented as Circle-enforced wallet policies: Circle's [agent wallet spending policies](https://developers.circle.com/agent-stack/agent-wallets/wallet-operations/custom-policies) currently require mainnet and do not support testnet. This prototype does not establish mainnet security or real-world invoice discharge.

## Tests

`tests/integrations.test.ts` uses mocked fetch responses and an ephemeral RSA key pair. It covers mainnet/live-key rejection, actual wallet validation, canonical USDC accounting, discounted exact amounts, fresh decryptable ciphertext, persistent idempotency, sanitized ambiguous errors, transaction-state mapping, AI privilege boundaries and malformed AI outputs. `tests/compatible-provider.test.ts` checks separate credentials, exact request routing, incomplete configuration, response validation and stopping runs before payment intents. These automated tests make no provider requests and move no funds. Live testnet runs are recorded in [circle-verification.md](circle-verification.md).
