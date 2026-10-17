# Circle testnet payment verification

Two live runs, both through Steward's normal API on Arc testnet: a single 1 USDC transfer on October 16 and a ten-invoice batch with four transfers (12.85 USDC) on October 17. Together: five confirmed transfers, 13.85 test USDC.

## Single transfer

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

## Batch run: ten invoices, four transfers

On October 17, 2026, Steward ran a scaled business batch through the same app API, against a separate local Worker and empty database. Ten fictional invoices went to one approved vendor whose payout address is the second controlled wallet. Policy: 8.50 USDC operating reserve, 0.50 fee buffer, 5.00 per-payment cap, 15.00 per-run cap. AI was off.

| Invoice | Amount | Decision | Result |
| --- | --- | --- | --- |
| Accepted design milestone | 4.25 | Pay | [`0x7a72b75d…`](https://explorer.testnet.arc.io/tx/0x7a72b75d79af8d0f40355004aa01acd1bee6746ab25f77fa2ac0f571895fe324), block 67748138 |
| Monthly hosting bill | 3.10 | Pay | [`0x3f78afbb…`](https://explorer.testnet.arc.io/tx/0x3f78afbb09c84ffa0ee237d3ce2b231334cc7bfed5a1663eee3b7d1ea402de68), block 67748142 |
| Accepted copywriting milestone | 2.00 | Pay | [`0x8a149e8a…`](https://explorer.testnet.arc.io/tx/0x8a149e8a0ebaafa03d21bbb732acef001477174ae61bd132d0c7bc4fe8b0395c), block 67748142 |
| Development invoice | 3.50 | Hold for reserve, paid after the owner lowered it to 4.50 | [`0x7d1637d2…`](https://explorer.testnet.arc.io/tx/0x7d1637d2e0f301ec1d44381b8ae41c1fc02342a02ed842495a2d15ccf30caa1a), block 67748177 |
| Duplicate vendor invoice (two copies, number spelled differently) | 1.20 each | Block | No payment intent |
| Payee address changed | 1.75 | Escalate | No payment intent |
| Milestone awaiting acceptance | 2.25 | Escalate | No payment intent |
| Over the per-payment cap | 7.25 | Block | No payment intent |
| Subscription due in 30 days | 1.90 | Hold | No payment intent |

What the run showed:

- The first run sent three transfers totalling 9.35 USDC and left the treasury above reserve plus fee buffer.
- Running the agent again created no new payment and kept every idempotency key and Circle transaction ID unchanged.
- After the explicit policy change, the next run released only the held development invoice. A final run paid nothing.
- Each transfer was reconciled against Circle's `COMPLETE` state, then checked independently over Arc RPC (`https://rpc.testnet.arc.io`, chain 5042002): receipt status success, recipient, amount and calldata matched.
- The recipient balance rose by exactly 12.85 USDC. Network fees for the four transfers came to about 0.113 USDC. The audit chain verified after every step.

Full record, including before/after balances, the reconciliation timeline and both exports: [evidence/circle-batch-testnet.json](evidence/circle-batch-testnet.json). The run is reproducible with [scripts/verify-circle-scenario.mjs](../scripts/verify-circle-scenario.mjs) (`prepare`, `execute`, `status`); it refuses to run against the main workspace and asserts the expected decision for every invoice before sending anything.

## What was exercised (single transfer)

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
