import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { runAgent, reconcilePayments } from "../lib/runner.ts";
import { createDemoWorkspace, createPilotWorkspace } from "../lib/fixtures.ts";
import { verifyAudit } from "../lib/audit.ts";
import type { Workspace } from "../lib/domain.ts";

const WALLET = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
const TX = "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
const TOKEN = "d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
const USDC = "0x3600000000000000000000000000000000000000";
const SENDER = `0x${"1".repeat(40)}`;
const RECIPIENT = `0x${"2".repeat(40)}`;
const TX_HASH = `0x${"a".repeat(64)}`;
// Ephemeral cryptographic fixture only. No provider credentials or wallets are created.
const { publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const realFetch = globalThis.fetch;
const envNames = [
  "CIRCLE_API_KEY",
  "CIRCLE_ENTITY_SECRET",
  "CIRCLE_WALLET_ID",
  "CIRCLE_BLOCKCHAIN",
  "OPENAI_API_KEY",
  "STEWARD_ENABLE_AI",
];
const originalEnv = Object.fromEntries(
  envNames.map((name) => [name, process.env[name]]),
);
let calls: { url: string; method: string; body?: Record<string, unknown> }[];
let posts: Record<string, unknown>[];
let timeoutFirstPost: boolean;
let wrongReceipt: boolean;
let beforePost: (() => void) | undefined;
let receiptState: string;

function pilot(): Workspace {
  const workspace = createPilotWorkspace(
    "test-pilot",
    "Synthetic integration fixture",
  );
  workspace.vendors = [
    {
      id: "vendor-1",
      name: "Synthetic vendor",
      category: "Services",
      approvedAddress: RECIPIENT,
    },
  ];
  workspace.invoices = [
    {
      id: "invoice-1",
      number: "INV-1",
      vendorId: "vendor-1",
      description: "Synthetic accepted milestone",
      amountCents: 300,
      currency: "USD",
      dueDate: "2020-01-01",
      recipientAddress: RECIPIENT,
      purchaseOrderRef: "PO-1",
      purchaseOrderAmountCents: 300,
      acceptanceVerified: true,
      sourceReference: "Mock test evidence",
      status: "inbox",
    },
  ];
  return workspace;
}

function journal(workspace: Workspace) {
  const snapshots: Workspace[] = [];
  return {
    snapshots,
    persist: async () => {
      snapshots.push(structuredClone(workspace));
    },
  };
}
function response(data: unknown) {
  return new Response(JSON.stringify({ data }), {
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  for (const name of envNames) delete process.env[name];
  process.env.CIRCLE_API_KEY = "TEST_API_KEY:fake-id:fake-secret";
  process.env.CIRCLE_ENTITY_SECRET = "ab".repeat(32);
  process.env.CIRCLE_WALLET_ID = WALLET;
  calls = [];
  posts = [];
  timeoutFirstPost = false;
  wrongReceipt = false;
  beforePost = undefined;
  receiptState = "COMPLETE";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : undefined;
    calls.push({ url, method, body });
    if (url.endsWith(`/wallets/${WALLET}`))
      return response({
        wallet: {
          id: WALLET,
          address: SENDER,
          blockchain: "ARC-TESTNET",
          custodyType: "DEVELOPER",
          state: "LIVE",
        },
      });
    if (url.includes(`/wallets/${WALLET}/balances?`))
      return response({
        tokenBalances: [
          {
            amount: "10.000000",
            token: {
              id: TOKEN,
              tokenAddress: USDC,
              blockchain: "ARC-TESTNET",
              symbol: "USDC",
              decimals: 6,
              isNative: false,
            },
          },
        ],
      });
    if (url.endsWith("/config/entity/publicKey"))
      return response({ publicKey });
    if (url.endsWith("/developer/transactions/transfer") && method === "POST") {
      beforePost?.();
      posts.push(body!);
      if (timeoutFirstPost && posts.length === 1)
        throw new Error("Synthetic timeout after remote acceptance.");
      return response({ id: TX, state: "INITIATED" });
    }
    if (url.endsWith(`/transactions/${TX}`))
      return response({
        transaction: {
          id: TX,
          walletId: WALLET,
          blockchain: "ARC-TESTNET",
          custodyType: "DEVELOPER",
          operation: "TRANSFER",
          transactionType: "OUTBOUND",
          state: receiptState,
          txHash: TX_HASH,
          tokenId: TOKEN,
          destinationAddress: wrongReceipt ? SENDER : RECIPIENT,
          amounts: ["3.000000"],
          refId: posts[0]?.idempotencyKey,
        },
      });
    if (url.endsWith(`/tokens/${TOKEN}`))
      return response({
        token: {
          id: TOKEN,
          tokenAddress: USDC,
          blockchain: "ARC-TESTNET",
          symbol: "USDC",
          decimals: 6,
          isNative: false,
        },
      });
    throw new Error("Unexpected provider call in runner test.");
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const name of envNames) {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  }
});

test("demo pays 343 once, preserves exceptions, then releases 600 after funds arrive", async () => {
  const workspace = createDemoWorkspace("demo-runner");
  const saved = journal(workspace);
  await runAgent(workspace, saved.persist, false);
  assert.equal(workspace.balanceCents, 90700);
  assert.equal(workspace.runs[0].paidCents, 34300);
  assert.equal(workspace.runs[0].paymentCount, 1);
  assert.equal(workspace.runs[0].heldCount, 1);
  assert.equal(workspace.runs[0].blockedCount, 3);
  assert.equal(workspace.runs[0].inputSnapshot?.balanceCents, 125000);
  const ready = workspace.invoices.find(
    (invoice) => invoice.id === "invoice-ready",
  )!;
  assert.equal(ready.payment?.status, "simulated");
  assert.equal(ready.payment?.amountCents, 34300);
  const key = ready.payment!.idempotencyKey;
  await runAgent(workspace, saved.persist, false);
  assert.equal(workspace.balanceCents, 90700);
  assert.equal(workspace.runs[1].paidCents, 0);
  assert.equal(workspace.runs[1].paymentCount, 0);
  assert.equal(ready.payment!.idempotencyKey, key);
  workspace.balanceCents += 50000;
  await runAgent(workspace, saved.persist, false);
  assert.equal(workspace.balanceCents, 80700);
  assert.equal(workspace.runs[2].paidCents, 60000);
  assert.equal(workspace.runs[2].paymentCount, 1);
  assert.equal(
    workspace.invoices.find((invoice) => invoice.id === "invoice-reserve")!
      .payment?.amountCents,
    60000,
  );
  assert.equal(
    workspace.invoices.filter((invoice) => invoice.payment).length,
    3,
    "includes one synthetic historical payment",
  );
  assert.equal(await verifyAudit(workspace.audit), true);
  assert.equal(calls.length, 0, "demo never contacts providers");
  assert.deepEqual(saved.snapshots.at(-1), workspace);
});

test("pending payment blocks a new run before provider reads or persistence", async () => {
  const workspace = pilot();
  workspace.invoices[0].payment = {
    idempotencyKey: TX,
    mode: "testnet",
    status: "pending",
    amountCents: 300,
    recipientAddress: RECIPIENT,
    submittedAt: new Date().toISOString(),
  };
  const saved = journal(workspace);
  await assert.rejects(
    runAgent(workspace, saved.persist, false),
    /Reconcile pending payments/,
  );
  assert.equal(calls.length, 0);
  assert.equal(saved.snapshots.length, 0);
  assert.equal(workspace.runs.length, 0);
});

test("failed decision or intent persistence prevents every payment POST", async () => {
  for (const failAt of [1, 2]) {
    const workspace = pilot();
    let saves = 0;
    await assert.rejects(
      runAgent(
        workspace,
        async () => {
          saves++;
          if (saves === failAt)
            throw new Error("Synthetic storage unavailable.");
        },
        false,
      ),
      /storage unavailable/,
    );
    assert.equal(saves, failAt);
    assert.equal(posts.length, 0);
    assert.ok(
      calls.every((call) => call.method === "GET"),
      "balance checks may precede the persisted intent, transfers may not",
    );
    assert.equal(
      calls.some((call) => call.url.endsWith("/config/entity/publicKey")),
      false,
    );
  }
});

test("ambiguous submission survives restart and reconciles with the same persisted key", async () => {
  const workspace = pilot();
  const saved = journal(workspace);
  timeoutFirstPost = true;
  beforePost = () => {
    const persisted = saved.snapshots.at(-1)?.invoices[0].payment;
    assert.equal(persisted?.status, "pending");
    assert.equal(
      persisted?.idempotencyKey,
      workspace.invoices[0].payment?.idempotencyKey,
    );
    assert.equal(persisted?.amountCents, 300);
    assert.equal(persisted?.recipientAddress, RECIPIENT);
  };
  await runAgent(workspace, saved.persist, false);
  assert.equal(posts.length, 1);
  assert.equal(workspace.invoices[0].payment?.status, "pending");
  assert.equal(workspace.invoices[0].payment?.transactionId, undefined);
  assert.equal(workspace.invoices[0].status, "submitted");
  assert.ok(
    workspace.audit.some((event) => event.type === "payment-unresolved"),
  );
  const restored = structuredClone(saved.snapshots.at(-1)!);
  const retryJournal = journal(restored);
  const originalKey = restored.invoices[0].payment!.idempotencyKey;
  beforePost = undefined;
  await reconcilePayments(restored, retryJournal.persist);
  assert.equal(posts.length, 2);
  assert.equal(posts[0].idempotencyKey, originalKey);
  assert.equal(posts[1].idempotencyKey, originalKey);
  assert.deepEqual(posts[1].amounts, posts[0].amounts);
  assert.equal(posts[1].destinationAddress, posts[0].destinationAddress);
  assert.notEqual(
    posts[1].entitySecretCiphertext,
    posts[0].entitySecretCiphertext,
  );
  assert.equal(restored.invoices[0].payment?.status, "complete");
  assert.equal(restored.invoices[0].payment?.transactionHash, TX_HASH);
  assert.equal(restored.invoices[0].status, "settled");
  assert.equal(await verifyAudit(restored.audit), true);
  await runAgent(restored, retryJournal.persist, false);
  assert.equal(posts.length, 2, "settled obligation is not submitted again");
});

test("wrong receipt cannot settle an invoice or append a settlement event", async () => {
  const workspace = pilot();
  const saved = journal(workspace);
  await runAgent(workspace, saved.persist, false);
  assert.equal(workspace.invoices[0].payment?.transactionId, TX);
  wrongReceipt = true;
  await assert.rejects(
    reconcilePayments(workspace, saved.persist),
    /receipt does not match/,
  );
  assert.equal(workspace.invoices[0].status, "submitted");
  assert.equal(workspace.invoices[0].payment?.status, "pending");
  assert.equal(workspace.invoices[0].payment?.transactionHash, undefined);
  assert.equal(
    workspace.audit.some((event) => event.type === "settled"),
    false,
  );
  assert.equal(posts.length, 1);
});

test("CONFIRMED stays pending and terminal failure remains journaled without reissue", async () => {
  const workspace = pilot();
  const saved = journal(workspace);
  await runAgent(workspace, saved.persist, false);
  receiptState = "CONFIRMED";
  await reconcilePayments(workspace, saved.persist);
  assert.equal(workspace.invoices[0].payment?.status, "pending");
  assert.equal(workspace.invoices[0].status, "submitted");
  receiptState = "FAILED";
  await reconcilePayments(workspace, saved.persist);
  assert.equal(workspace.invoices[0].payment?.status, "failed");
  assert.equal(workspace.invoices[0].status, "failed");
  const key = workspace.invoices[0].payment!.idempotencyKey;
  await runAgent(workspace, saved.persist, false);
  assert.equal(posts.length, 1);
  assert.equal(workspace.invoices[0].payment!.idempotencyKey, key);
});

test("requesting AI while owner opt-in is disabled still performs no AI request", async () => {
  process.env.OPENAI_API_KEY = "fake-key-present-but-not-authorized";
  const workspace = createDemoWorkspace("ai-gate-runner");
  const saved = journal(workspace);
  await runAgent(workspace, saved.persist, true);
  assert.equal(calls.length, 0);
  assert.equal(workspace.runs[0].engine, "rules");
  assert.equal(workspace.runs[0].paidCents, 34300);
  assert.ok(
    workspace.runs[0].decisions.every((decision) =>
      decision.modelRationale?.includes("owner has not enabled"),
    ),
  );
});
