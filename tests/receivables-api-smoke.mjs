import assert from "node:assert/strict";

// Run only against a disposable local Worker with this dedicated owner ID.
// The local Worker receives the trusted identity headers normally set by hosting.
const base = process.env.STEWARD_RECEIVABLES_TEST_URL;
assert.ok(base, "Set STEWARD_RECEIVABLES_TEST_URL to the disposable Worker.");
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const owner = "receivables_test_owner";
const jar = new Map();

async function request(body, user = owner, path = "/api/workspace", origin = base) {
  const response = await fetch(`${base}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; "),
      ...(user ? {
        "oai-authenticated-user-id": user,
        "oai-authenticated-user-email": `${user}@example.test`,
      } : {}),
      ...(body ? { "Content-Type": "application/json", Origin: origin } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(";")[0];
    const separator = pair.indexOf("=");
    jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  return { status: response.status, data: await response.json() };
}

let result = await request();
assert.equal(result.data.capabilities.currentUserId, owner);
assert.equal(result.data.capabilities.ownerAuthorized, true, "Use the dedicated test owner, never a user's workspace.");
assert.equal(result.data.capabilities.circle, false, "Remove Circle credentials from the disposable Worker.");
assert.equal(result.data.capabilities.ai, false);
assert.equal(result.data.workspace.receivables?.length ?? 0, 0, "Use fresh disposable state.");

const record = {
  id: "synthetic-ar-001",
  number: "SYNTHETIC-AR-001",
  clientAlias: "Fictional smoke-test client",
  description: "Synthetic test fixture, not business evidence",
  amountCents: 10000,
  paidCents: 2500,
  currency: "EUR",
  dueDate: "2026-01-01",
  workStatus: "accepted",
  sourceReference: "Synthetic API test only",
};
const imported = { action: "import-receivable", businessName: "Synthetic API test", record };
for (const action of [imported, { action: "review-receivables" }, {
  action: "receivable-feedback", id: record.id, reviewAsOf: "2000-01-01", assessment: "useful", note: "Synthetic feedback",
}]) {
  assert.equal((await request(action, null)).status, 400);
  assert.equal((await request(action, "unauthorized_test_user")).status, 400);
}
assert.ok([400, 403].includes((await request(imported, owner, "/api/workspace", "https://untrusted.example")).status));
result = await request(imported);
assert.equal(result.status, 200);
assert.equal(result.data.workspace.mode, "pilot");
assert.equal(result.data.workspace.invoices.length, 0, "AR imports must never create a payable.");
assert.equal(result.data.workspace.receivables.length, 1);
assert.equal((await request(imported)).status, 400, "Duplicate ID must be rejected.");
assert.equal((await request({ ...imported, record: { ...record, id: "another-id" } })).status, 400, "Duplicate client/reference must be rejected.");
const feedback = { action: "receivable-feedback", id: record.id, reviewAsOf: "2000-01-01", assessment: "useful", note: "Synthetic feedback, not a user testimonial" };
assert.equal((await request(feedback)).status, 400, "Feedback needs an actual review.");
result = await request({ action: "review-receivables" });
assert.equal(result.status, 200);
const review = result.data.workspace.receivables[0].review;
assert.equal(review.action, "follow-up");
assert.equal(review.outstandingCents, 7500);
assert.ok(review.daysOverdue > 0);
assert.equal(result.data.workspace.invoices.length, 0);
assert.equal(result.data.workspace.runs.length, 0, "AR review must not run the payment executor.");
assert.equal((await request(feedback)).status, 400, "Feedback must match the displayed review date.");
feedback.reviewAsOf = review.asOf;
result = await request(feedback);
assert.equal(result.status, 200);
assert.equal(result.data.workspace.receivables[0].feedback.note, feedback.note);
const exported = await request(undefined, owner, "/api/export");
assert.equal(exported.data.auditIntegrity, true);
assert.equal(exported.data.workspace.receivables[0].review.outstandingCents, 7500);
assert.equal(exported.data.metrics.confirmedTestnetPayments, 0);
assert.equal(exported.data.metrics.realUSDCVolume, 0);
assert.match(exported.data.disclosure, /owner-reported/);
console.log("Receivables API smoke passed: owner isolation, origin checks, immutable import, review, feedback, audit export and no payable/payment creation.");
