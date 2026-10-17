import assert from "node:assert/strict";
import test from "node:test";
import type { ClientInvoice } from "../lib/domain.ts";
import { createDemoWorkspace, createPilotWorkspace } from "../lib/fixtures.ts";
import {
  importReceivable,
  reviewReceivable,
  reviewReceivables,
  recordReceivableFeedback,
} from "../lib/receivables.ts";
import { actionSchema, clientInvoiceSchema } from "../lib/validation.ts";

const invoice = (changes: Partial<ClientInvoice> = {}): ClientInvoice => ({
  id: "client-invoice-1",
  number: "CLIENT-001",
  clientAlias: "Client A",
  description: "Synthetic test fixture for accepted freelance work",
  amountCents: 50_000,
  paidCents: 0,
  currency: "EUR",
  dueDate: "2026-10-17",
  workStatus: "accepted",
  sourceReference: "Synthetic unit-test record; not business evidence",
  ...changes,
});
const pilot = () => createPilotWorkspace("test:pilot", "Synthetic test workspace");

test("review changes at the UTC due-date boundary without early collection", () => {
  assert.equal(reviewReceivable(invoice(), "2026-10-16").action, "wait");
  const due = reviewReceivable(invoice(), "2026-10-17");
  assert.equal(due.action, "follow-up");
  assert.equal(due.daysOverdue, 0);
  assert.equal(due.asOf, "2026-10-17");
  const overdue = reviewReceivable(invoice(), "2026-10-18");
  assert.equal(overdue.action, "follow-up");
  assert.equal(overdue.daysOverdue, 1);
  assert.match(overdue.reason, /1 day overdue/);
});

test("partial payments retain only the outstanding balance and paid invoices need no follow-up", () => {
  const partial = reviewReceivable(invoice({ paidCents: 12_345 }), "2026-10-20");
  assert.equal(partial.outstandingCents, 37_655);
  assert.equal(partial.daysOverdue, 3);
  assert.equal(partial.action, "follow-up");
  const paid = reviewReceivable(invoice({ paidCents: 50_000 }), "2026-10-20");
  assert.equal(paid.action, "paid");
  assert.equal(paid.outstandingCents, 0);
  assert.equal(paid.daysOverdue, 0);
});

test("disputes and pending acceptance take precedence over due-date follow-up", () => {
  for (const date of ["2026-10-16", "2026-10-17", "2026-10-20"]) {
    assert.equal(
      reviewReceivable(invoice({ workStatus: "disputed" }), date).action,
      "resolve-dispute",
    );
    assert.equal(
      reviewReceivable(invoice({ workStatus: "pending" }), date).action,
      "confirm-acceptance",
    );
  }
  assert.equal(
    reviewReceivable(invoice({ paidCents: 50_000, workStatus: "disputed" }), "2026-10-20").action,
    "paid",
  );
});

test("strict import rejects overpayment, bad money, impossible dates and payment instructions", () => {
  for (const change of [
    { amountCents: 0 },
    { amountCents: 100_000_001 },
    { amountCents: 12.5 },
    { paidCents: -1 },
    { paidCents: 50_001 },
    { dueDate: "2026-02-29" },
    { dueDate: "2026-04-31" },
    { dueDate: "2026-10-17T00:00:00Z" },
    { currency: "USDC" },
    { sourceReference: " " },
    { clientAlias: " " },
    { recipientAddress: `0x${"1".repeat(40)}` },
    { payment: { status: "complete" } },
    { review: { action: "paid" } },
    { feedback: { assessment: "useful" } },
  ]) {
    assert.equal(clientInvoiceSchema.safeParse({ ...invoice(), ...change }).success, false);
  }
  assert.equal(clientInvoiceSchema.safeParse(invoice({ dueDate: "2028-02-29" })).success, true);
  for (const currency of ["USD", "EUR", "GBP", "TRY"] as const) {
    assert.equal(clientInvoiceSchema.safeParse(invoice({ currency })).success, true);
  }
});

test("receivable action payloads reject unrecognized fields and unreviewed client evidence", () => {
  assert.equal(actionSchema.safeParse({
    action: "import-receivable", businessName: "Test", record: invoice(),
  }).success, true);
  assert.equal(actionSchema.safeParse({
    action: "import-receivable", businessName: "Test", record: invoice(), execute: true,
  }).success, false);
  assert.equal(actionSchema.safeParse({ action: "review-receivables", asOf: "2020-01-01" }).success, false);
  assert.equal(actionSchema.safeParse({
    action: "receivable-feedback", id: invoice().id, reviewAsOf: "2026-10-17", assessment: "useful", note: " ",
  }).success, false);
  assert.equal(actionSchema.safeParse({
    action: "receivable-feedback", id: invoice().id, assessment: "useful", note: "Missing review date",
  }).success, false);
});

test("import supports a legacy workspace without receivables and never replaces a record", () => {
  const workspace = pilot();
  assert.equal(workspace.receivables, undefined);
  importReceivable(workspace, "Test freelancer", invoice());
  const original = structuredClone(workspace);
  assert.throws(() => importReceivable(workspace, "Replacement name", invoice({
    number: "OTHER", amountCents: 1,
  })), /ID already exists/);
  assert.deepEqual(workspace, original);
});

test("duplicate normalized client and invoice references cannot bypass import protection", () => {
  const workspace = pilot();
  importReceivable(workspace, "Test freelancer", invoice());
  assert.throws(() => importReceivable(workspace, "Test freelancer", invoice({
    id: "different-id", clientAlias: " client   a ", number: "ＣＬＩＥＮＴ-001",
  })), /client and invoice number already exist/);
  importReceivable(workspace, "Test freelancer", invoice({ id: "client-b-1", clientAlias: "Client B" }));
  assert.equal(workspace.receivables?.length, 2);
});

test("the workspace limit counts earlier imports", () => {
  const workspace = pilot();
  workspace.receivables = Array.from({ length: 30 }, (_, i) => invoice({ id: `r${i}`, number: `INV-${i}` }));
  assert.throws(() => importReceivable(workspace, "Test", invoice()), /at most 30/);
  assert.equal(workspace.receivables.length, 30);
});

test("feedback must follow an actual review and records the owner's supplied assessment", () => {
  const workspace = pilot();
  importReceivable(workspace, "Test", invoice());
  const feedback = { id: invoice().id, reviewAsOf: "2026-10-17", assessment: "needs-correction" as const, note: "  Client says acceptance is still pending.  " };
  assert.throws(() => recordReceivableFeedback(workspace, feedback), /Review this client invoice/);
  reviewReceivables(workspace, "2026-10-17");
  recordReceivableFeedback(workspace, feedback);
  const saved = workspace.receivables![0].feedback!;
  assert.equal(saved.assessment, "needs-correction");
  assert.equal(saved.note, "Client says acceptance is still pending.");
  assert.equal(Number.isFinite(Date.parse(saved.recordedAt)), true);
  assert.throws(() => recordReceivableFeedback(workspace, { ...feedback, id: "unknown" }), /not found/);
});

test("a changed review cannot inherit feedback from the previous result", () => {
  const workspace = pilot();
  importReceivable(workspace, "Test", invoice());
  reviewReceivables(workspace, "2026-10-16");
  recordReceivableFeedback(workspace, { id: invoice().id, reviewAsOf: "2026-10-16", assessment: "useful", note: "Waiting matches the terms." });
  reviewReceivables(workspace, "2026-10-16");
  assert.equal(workspace.receivables![0].feedback?.assessment, "useful");
  reviewReceivables(workspace, "2026-10-17");
  assert.equal(workspace.receivables![0].review?.action, "follow-up");
  assert.equal(workspace.receivables![0].feedback, undefined);
});

test("feedback from a stale review cannot be attached to a newer result", () => {
  const workspace = pilot();
  importReceivable(workspace, "Test", invoice());
  reviewReceivables(workspace, "2026-10-16");
  const staleFeedback = {
    id: invoice().id,
    reviewAsOf: "2026-10-16",
    assessment: "useful" as const,
    note: "Waiting matches the terms.",
  };
  reviewReceivables(workspace, "2026-10-17");
  const before = structuredClone(workspace);
  assert.throws(() => recordReceivableFeedback(workspace, staleFeedback), /review has changed/);
  assert.deepEqual(workspace, before);
  recordReceivableFeedback(workspace, {
    ...staleFeedback, reviewAsOf: "2026-10-17", note: "The invoice is due today.",
  });
  assert.equal(workspace.receivables![0].feedback?.note, "The invoice is due today.");
});

test("receivable operations cannot enter the payable queue or change funds and make no network requests", (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("Receivables must not request providers."); });
  const workspace = createDemoWorkspace("fixture");
  workspace.mode = "pilot";
  const payables = structuredClone({
    invoices: workspace.invoices, vendors: workspace.vendors,
    policy: workspace.policy, balanceCents: workspace.balanceCents, runs: workspace.runs,
  });
  importReceivable(workspace, "Test freelancer", invoice());
  reviewReceivables(workspace, "2026-10-17");
  recordReceivableFeedback(workspace, { id: invoice().id, reviewAsOf: "2026-10-17", assessment: "useful", note: "Due date matches the fixture." });
  assert.deepEqual({
    invoices: workspace.invoices, vendors: workspace.vendors,
    policy: workspace.policy, balanceCents: workspace.balanceCents, runs: workspace.runs,
  }, payables);
  assert.equal("payment" in workspace.receivables![0], false);
  assert.equal("recipientAddress" in workspace.receivables![0], false);
});

test("receivable helpers reject the public demo and invalid review dates", () => {
  const workspace = createDemoWorkspace("demo");
  assert.throws(() => importReceivable(workspace, "Test", invoice()), /private workspace/);
  assert.throws(() => reviewReceivables(workspace), /private workspace/);
  assert.throws(() => recordReceivableFeedback(workspace, { id: "missing", reviewAsOf: "2026-10-17", assessment: "useful", note: "Test" }), /private workspace/);
  assert.throws(() => reviewReceivables(pilot()), /Import a client invoice/);
  for (const asOf of ["2026-02-30", "2026-10-17T00:00:00Z", "invalid"]) {
    assert.throws(() => reviewReceivable(invoice(), asOf), /valid calendar date/);
  }
});
