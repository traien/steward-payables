# Verify Circle on Arc testnet

Steward's automated tests use mocked Circle responses. They do not prove that an account, wallet or payment works. This runbook separates account setup, a read-only connection check, and a payment through the application.

## 1. Set up the Circle account and wallet

1. Sign in to the [Circle Console](https://console.circle.com/) and create a **testnet API key**. Save the entire `TEST_API_KEY:ID:SECRET` value locally as `CIRCLE_API_KEY`. A client key or live key will not work. See [Circle API keys](https://developers.circle.com/api-reference/keys).
2. Generate and register an **entity secret** using the Console's developer-controlled wallet setup. Keep its recovery file in a separate secure location. An arbitrary hex string is not a registered secret. Save the registered secret locally as `CIRCLE_ENTITY_SECRET`. Follow [Circle's entity secret setup](https://developers.circle.com/wallets/dev-controlled/register-entity-secret).
3. Create a developer-controlled wallet set and an **Arc Testnet** wallet following [Circle's wallet quickstart](https://developers.circle.com/wallets/dev-controlled/create-your-first-wallet). Record the wallet's UUID as `CIRCLE_WALLET_ID`; its `0x…` address is a different value. Existing wallets can be reused if they belong to the same configured account and secret.
4. Use the [Circle Faucet](https://faucet.circle.com/) to send **testnet USDC on Arc Testnet** to the wallet address. These are test tokens. Steward accepts only `ARC-TESTNET` and the canonical USDC contract `0x3600000000000000000000000000000000000000`.

Enter configuration in the ignored `.env.local` file from an editor. Do not put keys in shell commands, screenshots, source files or chat. Keep any existing AI settings; Circle verification does not need AI. The registered entity secret is required for transfers, but the read-only check below needs only the test API key and wallet ID.

```dotenv
CIRCLE_API_KEY=
CIRCLE_ENTITY_SECRET=
CIRCLE_WALLET_ID=
CIRCLE_BLOCKCHAIN=ARC-TESTNET
```

The repository does not automate account creation, secret registration, wallet creation or faucet requests. No global tools are needed for its connection check.

## 2. Verify the actual wallet connection

From the `steward` directory, run:

```sh
npm run test:circle
```

This loads `.env.local`, then uses the application's Circle adapter to read the configured wallet and USDC balance. It checks the actual wallet ID, network, developer custody and live state. It never creates wallets, submits payments, registers secrets or contacts an AI provider.

A successful result reports `connection_verified`, the wallet's public address, `ARC-TESTNET`, and its balance rounded down to cents. `paymentVerified` remains `false` and `paymentsSubmitted` remains `0`. A zero balance can mean there is no USDC entry yet; fund the wallet and check again before attempting a payment. An unsuccessful check exits with status 1 and a sanitized message.

This proves that the configured test API key can read that wallet. It does **not** prove that the entity secret can authorize transfers, that there is enough gas, or that an invoice has been settled.

## 3. Verify a payment through Steward

After the connection check succeeds, restart the local server so it reads the new configuration. Configure `STEWARD_OWNER_ID` for the signed-in owner. Use the pilot workspace with a small, explicitly authorized test invoice and a verified recipient address. Keep the amount within the configured payment limits and leave enough test USDC for the cash reserve and gas buffer.

Run the agent in the pilot workspace. Preserve the pending payment intent and its idempotency key if a request times out. Use reconciliation until the adapter verifies a matching `COMPLETE` receipt. A submitted transaction ID alone is not successful settlement. Do not reset the workspace or create a replacement invoice to retry an unresolved payment.

Record the transaction hash, explorer link, amount, recipient and audit export. Check the receipt against the invoice and show the completed payment in the demo. Only then describe the Circle payment path as verified. Keep fictional fixtures labeled as demo data; a genuine business pilot needs the business's participation and permission.

The [integration contract](integrations.md) documents receipt checks. Read-only connection results and synthetic test payments do not establish business adoption.
