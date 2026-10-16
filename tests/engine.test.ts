import test from "node:test";
import assert from "node:assert/strict";
import type { Invoice, Workspace } from "../lib/domain.ts";
import { evaluateWorkspace } from "../lib/engine.ts";
import { createDemoWorkspace, createPilotWorkspace } from "../lib/fixtures.ts";
import { appendAudit, verifyAudit } from "../lib/audit.ts";

const now = new Date("2026-10-16T12:00:00.000Z");
function fixture(): Workspace {
  const workspace = createPilotWorkspace("test", "Test business");
  workspace.balanceCents = 10_000;
  workspace.policy = {
    reserveCents: 1_000,
    gasReserveCents: 100,
    perPaymentLimitCents: 5_000,
    runLimitCents: 7_000,
    approvalRequiredAboveCents: 5_000,
  };
  workspace.vendors = [
    {
      id: "vendor",
      name: "Vendor",
      category: "Services",
      approvedAddress: "0xabcdef0123456789abcdef0123456789abcdef01",
    },
  ];
  workspace.invoices = [
    {
      id: "invoice",
      number: "INV-001",
      vendorId: "vendor",
      description: "Services",
      amountCents: 2_000,
      currency: "USD",
      dueDate: "2026-10-16",
      recipientAddress: workspace.vendors[0].approvedAddress,
      purchaseOrderRef: "PO-001",
      purchaseOrderAmountCents: 2_000,
      acceptanceVerified: true,
      sourceReference: "Authorized business fixture",
      status: "inbox",
    },
  ];
  return workspace;
}
function amount(workspace: Workspace, cents: number) {
  workspace.invoices[0].amountCents = cents;
  workspace.invoices[0].purchaseOrderAmountCents = cents;
}
function decision(workspace: Workspace) {
  return evaluateWorkspace(workspace, now)[0];
}

test("valid due invoice pays; review does not mutate source state", () => {
  const workspace = fixture();
  const before = structuredClone(workspace);
  assert.equal(decision(workspace).action, "pay");
  assert.equal(decision(workspace).amountCents, 2_000);
  assert.deepEqual(workspace, before);
});

test("synthetic demo has five distinct active outcomes and keeps history out of payments", () => {
  const workspace = createDemoWorkspace("demo");
  const result = evaluateWorkspace(workspace);
  assert.equal(result.length, 5);
  const outcomes = Object.fromEntries(
    result.map((item) => [item.invoiceId, item.action]),
  );
  assert.deepEqual(outcomes, {
    "invoice-ready": "pay",
    "invoice-reserve": "hold",
    "invoice-wallet": "escalate",
    "invoice-duplicate": "block",
    "invoice-acceptance": "escalate",
  });
  assert.equal(workspace.mode, "demo");
  assert.match(workspace.businessName, /synthetic/i);
  workspace.balanceCents += 50_000;
  assert.equal(
    evaluateWorkspace(workspace).find(
      (item) => item.invoiceId === "invoice-reserve",
    )?.action,
    "pay",
  );
});

test("future invoice holds without an actual positive discount", () => {
  const workspace = fixture();
  workspace.invoices[0].dueDate = "2026-10-20";
  assert.equal(decision(workspace).action, "hold");
  workspace.invoices[0].discountBps = 1;
  workspace.invoices[0].discountUntil = "2026-10-18";
  assert.equal(
    decision(workspace).action,
    "hold",
    "sub-cent savings must not justify early payment",
  );
});

test("active early discount uses integer cents and conservatively rounds savings", () => {
  const workspace = fixture();
  amount(workspace, 1_001);
  Object.assign(workspace.invoices[0], {
    dueDate: "2026-10-20",
    discountBps: 200,
    discountUntil: "2026-10-16",
  });
  assert.equal(decision(workspace).action, "pay");
  assert.equal(decision(workspace).amountCents, 981);
  assert.equal(
    evaluateWorkspace(workspace, new Date("2026-10-17T00:00:00Z"))[0].action,
    "hold",
  );
});

test("expired discounts are not applied to due bills", () => {
  const workspace = fixture();
  Object.assign(workspace.invoices[0], {
    discountBps: 200,
    discountUntil: "2026-10-15",
  });
  assert.equal(decision(workspace).amountCents, 2_000);
  assert.equal(decision(workspace).action, "pay");
});

test("malformed discount terms cannot lower payment or evade approval", () => {
  for (const terms of [
    { discountBps: 10_000, discountUntil: "2026-10-16" },
    { discountBps: -100, discountUntil: "2026-10-16" },
    { discountBps: 200 },
    { discountBps: 200, discountUntil: "2026-10-17" },
  ]) {
    const workspace = fixture();
    Object.assign(workspace.invoices[0], terms);
    assert.equal(decision(workspace).action, "escalate");
  }
  const workspace = fixture();
  amount(workspace, 5_100);
  Object.assign(workspace.invoices[0], {
    discountBps: 200,
    discountUntil: "2026-10-16",
  });
  assert.equal(
    decision(workspace).action,
    "escalate",
    "approval is checked against gross obligation",
  );
});

test("invalid amounts and unsafe integers fail closed", () => {
  for (const cents of [
    0,
    -1,
    0.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    const workspace = fixture();
    amount(workspace, cents);
    assert.equal(decision(workspace).action, "block", String(cents));
  }
});

test("invalid policy or balance cannot authorize a payment", () => {
  for (const field of Object.keys(fixture().policy) as Array<
    keyof Workspace["policy"]
  >) {
    const workspace = fixture();
    workspace.policy[field] = -1;
    assert.equal(decision(workspace).action, "block", field);
  }
  const workspace = fixture();
  workspace.balanceCents = NaN;
  assert.equal(decision(workspace).action, "block");
});

test("cash and fee reserve is preserved to the exact cent", () => {
  const workspace = fixture();
  workspace.balanceCents = 3_100;
  assert.equal(decision(workspace).action, "pay");
  workspace.balanceCents--;
  assert.equal(decision(workspace).action, "hold");
});

test("per-payment, run and approval limits enforce inclusive boundaries", () => {
  const workspace = fixture();
  workspace.policy.perPaymentLimitCents = 2_000;
  workspace.policy.approvalRequiredAboveCents = 2_000;
  workspace.policy.runLimitCents = 2_000;
  assert.equal(decision(workspace).action, "pay");
  workspace.policy.perPaymentLimitCents = 1_999;
  assert.equal(decision(workspace).action, "block");
  workspace.policy.perPaymentLimitCents = 2_000;
  workspace.policy.approvalRequiredAboveCents = 1_999;
  assert.equal(decision(workspace).action, "escalate");
  workspace.policy.approvalRequiredAboveCents = 2_000;
  workspace.policy.runLimitCents = 1_999;
  assert.equal(decision(workspace).action, "hold");
});

test("a batch reserves funds and run allowance for earlier approved payments", () => {
  const workspace = fixture();
  amount(workspace, 4_000);
  workspace.invoices.push({
    ...workspace.invoices[0],
    id: "invoice-two",
    number: "INV-002",
  });
  assert.deepEqual(
    evaluateWorkspace(workspace, now).map((item) => item.action),
    ["pay", "hold"],
  );
  workspace.policy.runLimitCents = 10_000;
  workspace.balanceCents = 8_000;
  assert.deepEqual(
    evaluateWorkspace(workspace, now).map((item) => item.action),
    ["pay", "hold"],
  );
});

test("due obligations have priority over future discounted bills", () => {
  const workspace = fixture();
  amount(workspace, 4_000);
  const due = {
    ...workspace.invoices[0],
    id: "invoice-due",
    number: "INV-002",
  };
  Object.assign(workspace.invoices[0], {
    dueDate: "2026-10-20",
    discountBps: 200,
    discountUntil: "2026-10-18",
  });
  workspace.invoices.push(due);
  workspace.policy.runLimitCents = 4_000;
  const result = evaluateWorkspace(workspace, now);
  assert.equal(result[0].invoiceId, "invoice-due");
  assert.equal(result[0].action, "pay");
  assert.equal(result[1].action, "hold");
});

test("recipient substitution and unknown vendor cannot pass", () => {
  const workspace = fixture();
  workspace.invoices[0].recipientAddress =
    "0x9999999999999999999999999999999999999999";
  assert.equal(decision(workspace).action, "escalate");
  workspace.invoices[0].recipientAddress = workspace.vendors[0].approvedAddress
    .toUpperCase()
    .replace("0X", "0x");
  assert.equal(
    decision(workspace).action,
    "pay",
    "EVM address casing is equivalent",
  );
  workspace.vendors = [];
  assert.equal(decision(workspace).action, "block");
});

test("zero addresses are rejected even if both records match", () => {
  const workspace = fixture();
  workspace.invoices[0].recipientAddress =
    workspace.vendors[0].approvedAddress = `0x${"0".repeat(40)}`;
  assert.equal(decision(workspace).action, "escalate");
});

test("missing source, order, amount match or delivery acceptance requires review", () => {
  const cases: Partial<Invoice>[] = [
    { sourceReference: "  " },
    { purchaseOrderRef: "" },
    { purchaseOrderAmountCents: 1_999 },
    { acceptanceVerified: false },
    { acceptanceVerified: "true" as unknown as boolean },
  ];
  for (const patch of cases) {
    const workspace = fixture();
    Object.assign(workspace.invoices[0], patch);
    assert.equal(decision(workspace).action, "escalate");
  }
});

test("normalized duplicate references block all copies regardless of ingestion order", () => {
  const workspace = fixture();
  workspace.invoices.push({
    ...workspace.invoices[0],
    id: "duplicate",
    number: "  inv ００１ ",
  });
  assert.deepEqual(
    evaluateWorkspace(workspace, now).map((item) => item.action),
    ["block", "block"],
  );
  workspace.invoices.reverse();
  assert.deepEqual(
    evaluateWorkspace(workspace, now).map((item) => item.action),
    ["block", "block"],
  );
});

test("historical or pending payment prevents repayment under a new invoice id", () => {
  const workspace = fixture();
  workspace.invoices.push({
    ...workspace.invoices[0],
    id: "copy",
    number: "inv 001",
  });
  workspace.invoices[0].payment = {
    idempotencyKey: "same-key",
    mode: "testnet",
    status: "pending",
    amountCents: 2_000,
    recipientAddress: workspace.invoices[0].recipientAddress,
    submittedAt: now.toISOString(),
  };
  const result = evaluateWorkspace(workspace, now);
  assert.equal(result.length, 1);
  assert.equal(result[0].invoiceId, "copy");
  assert.equal(result[0].action, "block");
});

test("no payment record is retried, even if its status is failed", () => {
  for (const status of [
    "pending",
    "complete",
    "failed",
    "simulated",
  ] as const) {
    const workspace = fixture();
    workspace.invoices[0].payment = {
      idempotencyKey: "original",
      mode: "testnet",
      status,
      amountCents: 2_000,
      recipientAddress: workspace.invoices[0].recipientAddress,
      submittedAt: now.toISOString(),
    };
    assert.deepEqual(evaluateWorkspace(workspace, now), []);
  }
  for (const status of [
    "submitted",
    "settled",
    "simulated",
    "failed",
  ] as const) {
    const workspace = fixture();
    workspace.invoices[0].status = status;
    assert.deepEqual(evaluateWorkspace(workspace, now), []);
  }
});

test("invalid dates and invalid review time cannot pay", () => {
  for (const dueDate of [
    "2026-02-30",
    "2026-1-2",
    "tomorrow",
    "2026-10-16T00:00:00Z",
  ]) {
    const workspace = fixture();
    workspace.invoices[0].dueDate = dueDate;
    assert.equal(decision(workspace).action, "block");
  }
  assert.throws(() => evaluateWorkspace(fixture(), new Date(NaN)), RangeError);
});

test("new pilot contains no fabricated traction or obligations", () => {
  const workspace = createPilotWorkspace("pilot", "  Actual business  ");
  assert.equal(workspace.mode, "pilot");
  assert.equal(workspace.businessName, "Actual business");
  assert.equal(workspace.balanceCents, 0);
  assert.deepEqual(
    [workspace.invoices, workspace.vendors, workspace.runs, workspace.audit],
    [[], [], [], []],
  );
});

test("audit chain verifies; editing, reordering and removing a middle entry fails", async () => {
  const workspace = fixture();
  assert.equal(await verifyAudit(workspace.audit), true);
  await appendAudit(workspace, "review", "Review started", "Original state");
  await appendAudit(
    workspace,
    "decision",
    "Pay",
    "Verified documents",
    "invoice",
  );
  await appendAudit(
    workspace,
    "receipt",
    "Confirmed",
    "External transaction receipt",
    "invoice",
  );
  assert.equal(await verifyAudit(workspace.audit), true);
  assert.equal(workspace.audit[0].previousHash, "0".repeat(64));
  assert.equal(workspace.audit[1].previousHash, workspace.audit[0].hash);
  const edited = structuredClone(workspace.audit);
  edited[1].detail = "Pay another wallet";
  assert.equal(await verifyAudit(edited), false);
  assert.equal(await verifyAudit([...workspace.audit].reverse()), false);
  assert.equal(
    await verifyAudit([workspace.audit[0], workspace.audit[2]]),
    false,
  );
});

test("audit canonicalization is independent of JSON key ordering", async () => {
  const workspace = fixture();
  await appendAudit(workspace, "review", "Review", "Evidence");
  const reordered = workspace.audit.map((event) =>
    Object.fromEntries(Object.entries(event).reverse()),
  );
  assert.equal(await verifyAudit(reordered as typeof workspace.audit), true);
});
