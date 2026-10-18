# Circle transfers on Arc testnet

Two live runs through Steward's API, both using Circle Developer-Controlled Wallets on Arc testnet: a single 1 USDC transfer on October 16, 2026 and a ten-invoice batch with four transfers (12.85 USDC) on October 17. Five transfers and 13.85 USDC in total. AI review was off for both.

Wallets used:

| Wallet | Address |
| --- | --- |
| Treasury | `0x1a5bcc3448256c0fdc810713ae0dc06ca98799a0` |
| Recipient | `0x948a4307b17c93a0a64dbf8d8c87aadcf40551dd` |

Token: Arc testnet USDC `0x3600000000000000000000000000000000000000` (six decimals).

## Batch run: ten invoices, four transfers

Run on October 17, 2026 through the app API, against a separate local Worker and an empty database. Ten sample invoices went to one approved vendor whose payout address is the second test wallet. Policy: 8.50 USDC operating reserve, 0.50 fee buffer, 5.00 per-payment cap, 15.00 per-run cap. AI was off.

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

Full record, including before/after balances, the reconciliation timeline and both exports: [evidence/circle-batch-testnet.json](evidence/circle-batch-testnet.json). The run is reproducible with [scripts/verify-circle-scenario.mjs](../scripts/verify-circle-scenario.mjs) (`prepare`, `execute`, `status`); it refuses to run against the main workspace and checks the expected decision for every invoice before sending anything.

## Single transfer

The first end-to-end check: one 1 USDC invoice imported into the private workspace, paid by a normal agent run and reconciled. Circle returned `COMPLETE` and the explorer shows the transfer as successful.

| Field | Value |
| --- | --- |
| Amount | 1 USDC |
| Transaction | [`0x318baf89…`](https://explorer.testnet.arc.io/tx/0x318baf89186886c0723a6304f84517682aa98d2f7a5c11c2c27663cc0db7f034) |
| Block | 67556120 |
| Network fee | 0.001589925 USDC |

The audit export is in [evidence/circle-testnet.json](evidence/circle-testnet.json). It holds the input snapshot, checks, payment intent, Circle transaction ID, completed payment record and journal. It contains no keys or recovery material.

This run also caught a runtime bug. Cloudflare Workers reject `fetch` with `redirect: "error"`, which a Node-only connection check didn't catch. Both provider adapters now use `redirect: "manual"` and reject redirect responses without forwarding credentials. There is a regression test for it.

## Scope

The invoices are sample data and both wallets are test wallets controlled by the developer, so these runs show the payment path works; they don't represent customer volume. Testnet USDC has no monetary value. To set up your own account, follow [circle-setup.md](circle-setup.md).
