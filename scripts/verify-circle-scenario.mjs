import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateWorkspace } from "../lib/engine.ts";
import { getWalletBalance } from "../lib/circle.ts";

// Opt-in integration journey. Run against a separate local Worker and empty D1.
// Uses ten fictional invoices and at most 12.85 valueless Arc testnet USDC.
// AI stays disabled. Both wallet IDs must belong to the supplied Circle account.
const base = process.env.STEWARD_CIRCLE_SCENARIO_URL || "http://127.0.0.1:5175";
const target = new URL(base);
assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
assert.equal(target.protocol, "http:");
assert.notEqual(target.port, "5173", "Use an isolated runtime, not the private owner workspace");
assert.equal(process.env.STEWARD_ENABLE_AI, "false");
assert.match(process.env.CIRCLE_API_KEY || "", /^TEST_API_KEY:/);
assert.equal(process.env.CIRCLE_BLOCKCHAIN || "ARC-TESTNET", "ARC-TESTNET");
const recipientWalletId = process.env.STEWARD_CIRCLE_RECIPIENT_WALLET_ID;
assert.match(recipientWalletId || "", /^[a-f0-9-]{36}$/i);
assert.notEqual(recipientWalletId, process.env.CIRCLE_WALLET_ID);
const step = process.argv[2];
assert.ok(["prepare", "execute", "status"].includes(step));
if (step === "execute") {
  assert.equal(process.env.STEWARD_EXECUTE_CIRCLE_SCENARIO, "synthetic-arc-testnet-only");
}

const output = resolve(process.env.STEWARD_CIRCLE_SCENARIO_OUTPUT || "outputs/circle-batch-verification");
mkdirSync(output, { recursive: true, mode: 0o700 });
const jar = new Map();
const timeline = [];
function record(event, details) {
  const entry = { at: new Date().toISOString(), event, ...details };
  timeline.push(entry);
  console.log(JSON.stringify(entry));
}
async function request(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; "),
      ...(body ? { "Content-Type": "application/json", Origin: base } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
    signal: AbortSignal.timeout(60_000),
  });
  for (const cookie of response.headers.getSetCookie()) {
    const [name, ...value] = cookie.split(";")[0].split("=");
    jar.set(name, value.join("="));
  }
  if (response.status === 302) return;
  const data = await response.json();
  assert.equal(response.ok, true, `Local API HTTP ${response.status}: ${data.error || "unexpected response"}`);
  return data;
}
async function balances() {
  const treasury = await getWalletBalance();
  const originalId = process.env.CIRCLE_WALLET_ID;
  try {
    process.env.CIRCLE_WALLET_ID = recipientWalletId;
    const recipient = await getWalletBalance();
    return { treasury, recipient };
  } finally {
    process.env.CIRCLE_WALLET_ID = originalId;
  }
}
const wallets = await balances();
assert.notEqual(wallets.treasury.address, wallets.recipient.address);
const recipient = wallets.recipient.address;
const name = "Northstar Studio · synthetic Arc batch verification";
const date = new Date().toISOString().slice(0, 10);
const future = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
const policy = {
  reserveCents: 850,
  gasReserveCents: 50,
  perPaymentLimitCents: 500,
  runLimitCents: 1500,
  approvalRequiredAboveCents: 500,
};
const vendorId = "synthetic-controlled-recipient";
const invoice = (id, amountCents, description, extra = {}) => ({
  id,
  number: id.toUpperCase(),
  vendorId,
  description: `${description} · fictional scaled business case`,
  amountCents,
  currency: "USD",
  dueDate: date,
  recipientAddress: recipient,
  purchaseOrderRef: `SYNTHETIC-PO-${id}`,
  purchaseOrderAmountCents: amountCents,
  acceptanceVerified: true,
  sourceReference: "Synthetic integration fixture; no real service, invoice or acceptance",
  ...extra,
});
const fixtures = [
  invoice("batch-design", 425, "Accepted design milestone"),
  invoice("batch-hosting", 310, "Monthly hosting bill"),
  invoice("batch-copy", 200, "Accepted copywriting milestone"),
  invoice("batch-reserve", 350, "Development invoice held for operating cash"),
  invoice("batch-duplicate-a", 120, "Duplicate vendor invoice", { number: "DUPLICATE-001" }),
  invoice("batch-duplicate-b", 120, "Duplicate vendor invoice", { number: "duplicate 001" }),
  invoice("batch-recipient", 175, "Unapproved destination change", { recipientAddress: wallets.treasury.address }),
  invoice("batch-acceptance", 225, "Milestone awaiting acceptance", { acceptanceVerified: false }),
  invoice("batch-cap", 725, "Obligation above per-payment cap"),
  invoice("batch-future", 190, "Subscription not yet due", { dueDate: future }),
];
const expectedActions = {
  "batch-design": "pay", "batch-hosting": "pay", "batch-copy": "pay",
  "batch-reserve": "hold", "batch-duplicate-a": "block", "batch-duplicate-b": "block",
  "batch-recipient": "escalate", "batch-acceptance": "escalate", "batch-cap": "block",
  "batch-future": "hold",
};
const allowedPaymentIds = new Set(["batch-design", "batch-hosting", "batch-copy", "batch-reserve"]);
const paid = (workspace) => workspace.invoices.filter((item) => item.payment);
const identities = (workspace) => Object.fromEntries(paid(workspace).map((item) => [item.id, {
  key: item.payment.idempotencyKey,
  transactionId: item.payment.transactionId,
  amountCents: item.payment.amountCents,
}]));
function assertWorkspace(data) {
  assert.equal(data.capabilities.ownerAuthorized, true);
  assert.equal(data.capabilities.ai, false);
  assert.equal(data.capabilities.circle, true);
  assert.equal(data.capabilities.network, "ARC-TESTNET");
  assert.equal(data.workspace.mode, "pilot");
  assert.equal(data.workspace.businessName, name);
  assert.equal(data.workspace.receivables?.length || 0, 0);
  assert.equal(data.workspace.invoices.length, fixtures.length);
  for (const expected of fixtures) {
    const actual = data.workspace.invoices.find((item) => item.id === expected.id);
    assert.ok(actual);
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(actual[key], value, `${expected.id}.${key} changed`);
    if (actual.payment) {
      assert.ok(allowedPaymentIds.has(actual.id), "A guarded exception received a payment intent");
      assert.equal(actual.payment.mode, "testnet");
      assert.equal(actual.payment.amountCents, expected.amountCents);
      assert.equal(actual.payment.recipientAddress, recipient);
      assert.notEqual(actual.payment.status, "failed");
    }
  }
  assert.ok(paid(data.workspace).reduce((sum, item) => sum + item.payment.amountCents, 0) <= 1285);
}
async function snapshot(label, data) {
  assertWorkspace(data);
  const evidence = await request("/api/export");
  assert.equal(evidence.auditIntegrity, true);
  assert.equal(evidence.metrics.realUSDCVolume, 0);
  writeFileSync(resolve(output, `${label}.json`), JSON.stringify(evidence, null, 2) + "\n", { mode: 0o600 });
  record(label, { metrics: evidence.metrics, balanceCents: data.workspace.balanceCents });
  return evidence;
}
async function settle(data, count, total) {
  for (let attempt = 0; attempt < 15 && paid(data.workspace).some((item) => item.payment.status === "pending"); attempt++) {
    data = await request("/api/workspace", { action: "reconcile" });
    assertWorkspace(data);
    const complete = paid(data.workspace).filter((item) => item.payment.status === "complete");
    record("reconciliation", { attempt: attempt + 1, complete: complete.length, expected: count });
    if (complete.length < count) await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  assert.equal(paid(data.workspace).length, count);
  assert.ok(paid(data.workspace).every((item) => item.payment.status === "complete"), "Pending intent remains: reconcile it, never start a new transfer");
  assert.equal(paid(data.workspace).reduce((sum, item) => sum + item.payment.amountCents, 0), total);
  assert.ok(data.workspace.balanceCents >= data.workspace.policy.reserveCents + data.workspace.policy.gasReserveCents);
  return data;
}

await request("/signin-with-chatgpt?return_to=/");
let data = await request("/api/workspace", { action: "pilot" });
assert.equal(data.capabilities.ownerAuthorized, true);
assert.equal(data.capabilities.ai, false);
if (step === "prepare") {
  assert.equal(data.workspace.invoices.length, 0, "Preparation requires an empty isolated workspace");
  assert.equal(data.workspace.receivables?.length || 0, 0);
  assert.ok(wallets.treasury.balanceCents >= 1890 && wallets.treasury.balanceCents < 2000,
    "This scaled fixture expects the previously funded wallet; review its amounts for a different balance");
  data = await request("/api/workspace", {
    action: "import", businessName: name,
    vendors: [{ id: vendorId, name: "Controlled recipient · fictional service vendor", category: "Synthetic verification", approvedAddress: recipient }],
    invoices: fixtures,
  });
  data = await request("/api/workspace", { action: "policy", policy });
  assertWorkspace(data);
  const planned = evaluateWorkspace({ ...data.workspace, balanceCents: wallets.treasury.balanceCents });
  assert.deepEqual(Object.fromEntries(planned.map((item) => [item.invoiceId, item.action])), expectedActions);
  const details = { preparedAt: new Date().toISOString(), disclosure: "Fictional scaled business batch. Valueless Arc testnet funds between two controlled wallets. No real invoice settlement.", before: wallets, planned };
  writeFileSync(resolve(output, "plan.json"), JSON.stringify(details, null, 2) + "\n", { mode: 0o600 });
  record("prepared", { invoices: fixtures.length, plannedTransfers: 3, plannedUSDC: 9.35, maximumJourneyUSDC: 12.85, before: wallets });
} else if (step === "status") {
  assertWorkspace(data);
  record("status", { balanceCents: data.workspace.balanceCents, invoices: data.workspace.invoices.map((item) => ({ id: item.id, status: item.status, payment: item.payment })) });
} else {
  assertWorkspace(data);
  assert.equal(paid(data.workspace).length, 0, "Execute once only. Resume unresolved payments through reconciliation, never recreate the batch");
  assert.deepEqual(data.workspace.policy, policy);
  const before = JSON.parse(readFileSync(resolve(output, "plan.json"), "utf8")).before;
  assert.deepEqual(wallets, before, "Balances changed since preparation; review the plan again");
  const planned = evaluateWorkspace({ ...data.workspace, balanceCents: wallets.treasury.balanceCents });
  assert.deepEqual(Object.fromEntries(planned.map((item) => [item.invoiceId, item.action])), expectedActions);
  data = await request("/api/workspace", { action: "run" });
  assertWorkspace(data);
  assert.deepEqual(Object.fromEntries(data.workspace.invoices.map((item) => [item.id, item.decision.action])), expectedActions);
  assert.equal(paid(data.workspace).length, 3);
  data = await settle(data, 3, 935);
  const first = await snapshot("first-batch", data);
  const firstIdentities = identities(data.workspace);
  data = await request("/api/workspace", { action: "run" });
  assertWorkspace(data);
  assert.deepEqual(identities(data.workspace), firstIdentities, "A repeated review changed a payment intent");
  assert.equal(data.workspace.runs.at(-1).decisions.filter((item) => item.action === "pay").length, 0);
  assert.equal(data.workspace.invoices.find((item) => item.id === "batch-reserve").decision.action, "hold");
  const repeated = await snapshot("repeat-before-policy-change", data);
  data = await request("/api/workspace", { action: "policy", policy: { ...policy, reserveCents: 450 } });
  record("explicit-owner-policy-change", { previousReserveUSDC: 8.50, nextReserveUSDC: 4.50, feeReserveUSDC: 0.50 });
  data = await request("/api/workspace", { action: "run" });
  assertWorkspace(data);
  assert.deepEqual(data.workspace.runs.at(-1).decisions.filter((item) => item.action === "pay").map((item) => item.invoiceId), ["batch-reserve"]);
  data = await settle(data, 4, 1285);
  const finalIdentities = identities(data.workspace);
  data = await request("/api/workspace", { action: "run" });
  assertWorkspace(data);
  assert.deepEqual(identities(data.workspace), finalIdentities);
  assert.equal(data.workspace.runs.at(-1).decisions.filter((item) => item.action === "pay").length, 0);
  const final = await snapshot("final-batch", data);
  const after = await balances();
  assert.equal(after.recipient.balanceCents - before.recipient.balanceCents, 1285);
  assert.ok(before.treasury.balanceCents - after.treasury.balanceCents >= 1285);
  assert.ok(before.treasury.balanceCents - after.treasury.balanceCents < 1335, "Fee budget was exceeded");
  assert.equal(final.metrics.confirmedTestnetPayments, 4);
  assert.equal(final.metrics.confirmedTestnetUSDC, 12.85);
  const evidence = {
    verifiedAt: new Date().toISOString(),
    disclosure: "Ten fictional invoices, two controlled Arc testnet wallets, valueless USDC. Amounts are scaled to the faucet balance. This does not establish genuine business settlement, customer adoption or mainnet readiness.",
    network: "ARC-TESTNET", aiUsed: false, before, after, timeline,
    checks: {
      firstBatchPayments: 3, firstBatchUSDC: 9.35, reserveHeldUSDC: 3.50,
      exceptionInvoicesWithoutIntents: ["batch-duplicate-a", "batch-duplicate-b", "batch-recipient", "batch-acceptance", "batch-cap", "batch-future"],
      repeatedReviewsCreatedPayments: 0, reservePolicyChangeUSDC: [8.50, 4.50],
      releasedAfterPolicyChangeUSDC: 3.50, totalConfirmedPayments: 4, totalConfirmedTestnetUSDC: 12.85,
      recipientBalanceIncreaseUSDC: 12.85, realUSDCVolume: 0,
      auditIntegrity: [first.auditIntegrity, repeated.auditIntegrity, final.auditIntegrity].every(Boolean),
    },
    firstBatch: first, finalBatch: final,
  };
  writeFileSync(resolve(output, "circle-batch-testnet.json"), JSON.stringify(evidence, null, 2) + "\n", { mode: 0o600 });
  record("verified", { checks: evidence.checks, after });
}
