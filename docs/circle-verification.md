# Circle testnet payment verification

On October 16, 2026, Steward submitted and reconciled a **1 test-USDC transfer on Arc Testnet** through its normal local application API. The Circle API returned `COMPLETE`, and the Arc explorer independently showed `Success` and the one-USDC token transfer.

[View the explorer transaction](https://explorer.testnet.arc.io/tx/0x318baf89186886c0723a6304f84517682aa98d2f7a5c11c2c27663cc0db7f034).

| Field | Verified value |
| --- | --- |
| Invoice | `TEST-001`, explicitly synthetic |
| Amount | 1 test USDC |
| Chain | `ARC-TESTNET` |
| Token | `0x3600000000000000000000000000000000000000`, six-decimal USDC |
| Treasury | `0x1a5bcc3448256c0fdc810713ae0dc06ca98799a0` |
| Recipient | `0x948a4307b17c93a0a64dbf8d8c87aadcf40551dd` |
| Transaction hash | `0x318baf89186886c0723a6304f84517682aa98d2f7a5c11c2c27663cc0db7f034` |
| Explorer block | 67556120 |
| Explorer network fee | 0.001589925 test USDC |
| Decision engine | Deterministic rules; AI disabled |

The [application audit export](evidence/circle-testnet.json) contains the input snapshot, checks, persisted payment intent, submission ID, normalized completed payment record and journal. It does not include the raw Circle API response. Its metrics are one confirmed testnet payment, 1 test USDC and zero real USDC volume. Audit integrity passed. The export contains fictional records and public testnet identifiers only; no keys or recovery material are included.

## What was exercised

1. Authenticate with the user-supplied Circle test API key, register the initial entity secret with Circle's official SDK, and save the secret and recovery file privately.
2. Create a wallet set with two developer-controlled Arc testnet wallets. Fund the treasury with 20 test USDC from Circle's faucet.
3. Run `npm run test:circle` through Steward's adapter and verify the live wallet and 20-USDC balance.
4. Import a one-USDC synthetic invoice into the owner-authorized local workspace. The recipient is the second controlled test wallet. The invoice's purchase order and acceptance are test fixtures, not business evidence.
5. Call the app's run action. Steward checks policy and evidence, persists its intent, and submits the transfer through Circle.
6. Call reconciliation. Steward checks the wallet, chain, direction, reference, recipient, amount and token before recording completion. Export the journal and inspect the explorer transaction.

The first app attempt failed before creating an intent because the Worker runtime rejected `redirect: "error"`. Node-only checks had not caught this. Both provider adapters now use `manual` and reject redirect responses without following them. The payment above passed through the corrected Worker runtime.

## Limits

Both wallets are controlled test wallets and the invoice is fictional. This does not establish business adoption, settle a real invoice or demonstrate mainnet readiness. The local database and credentials are not automatically copied to hosting. A real operator must separately use the product with genuine records and permission before that activity can be described as a business pilot.

For a new account, follow the [Circle setup runbook](circle-setup.md). Do not reuse this fixture's identifiers to manufacture pilot results. Recovery material stays outside Git; back it up separately from the entity secret.
