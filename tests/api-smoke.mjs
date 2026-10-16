import assert from "node:assert/strict";

// Opt-in local integration check. All data is synthetic; no provider credentials.
const base = process.env.STEWARD_TEST_URL || "http://127.0.0.1:5173";
const target = new URL(base);
assert.ok(
  ["127.0.0.1", "localhost"].includes(target.hostname),
  "Smoke tests must target loopback",
);
let cookies = "";
async function request(path, body, extra = {}) {
  const response = await fetch(`${base}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Cookie: cookies,
      ...(body ? { "Content-Type": "application/json", Origin: base } : {}),
      ...extra,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = response.headers.getSetCookie();
  if (set.length) cookies = set.map((value) => value.split(";")[0]).join("; ");
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text };
  }
  return { status: response.status, data };
}
let result = await request("/api/workspace");
assert.equal(result.status, 200);
assert.equal(result.data.workspace.mode, "demo");
assert.equal(result.data.capabilities.ai, false);
const originalId = result.data.workspace.id;
const concurrent = await Promise.all([
  request("/api/workspace", { action: "run" }),
  request("/api/workspace", { action: "run" }),
]);
assert.ok(concurrent.some((item) => item.status === 200));
assert.ok(
  concurrent.every(
    (item) =>
      item.status === 200 || /operation is running/.test(item.data.error),
  ),
);
result = await request("/api/workspace");
assert.equal(
  result.data.workspace.balanceCents,
  90_700,
  "Concurrent run must not pay twice",
);
assert.equal(
  result.data.workspace.invoices.find((item) => item.id === "invoice-ready")
    .payment.amountCents,
  34_300,
);
assert.equal(
  result.data.workspace.invoices.find((item) => item.id === "invoice-reserve")
    .status,
  "held",
);
result = await request("/api/workspace", { action: "run" });
assert.equal(result.status, 200);
assert.equal(result.data.workspace.balanceCents, 90_700);
await request("/api/workspace", { action: "add-funds", amountCents: 50_000 });
result = await request("/api/workspace", { action: "run" });
assert.equal(result.data.workspace.balanceCents, 80_700);
assert.equal(
  result.data.workspace.invoices.find((item) => item.id === "invoice-reserve")
    .payment.amountCents,
  60_000,
);
assert.ok(
  result.data.workspace.balanceCents >=
    result.data.workspace.policy.reserveCents,
);
const evidence = await request("/api/export");
assert.equal(evidence.data.auditIntegrity, true);
assert.equal(evidence.data.metrics.confirmedTestnetPayments, 0);
assert.equal(evidence.data.metrics.realUSDCVolume, 0);
assert.equal(evidence.data.workspace.id, "[private workspace]");
assert.equal(
  evidence.data.workspace.runs[0].inputSnapshot.balanceCents,
  125_000,
);
result = await request(
  "/api/workspace",
  { action: "run" },
  { Origin: "https://untrusted.example" },
);
assert.ok([400, 403].includes(result.status));
assert.match(result.data.error, /Cross-origin|Forbidden/);
result = await request("/api/workspace", { action: "pilot" });
assert.equal(result.status, 400);
assert.match(result.data.error, /Sign in/);
cookies = "";
result = await request("/api/workspace");
assert.notEqual(result.data.workspace.id, originalId);
assert.equal(
  result.data.workspace.balanceCents,
  125_000,
  "New anonymous session must have isolated state",
);
console.log(
  "Local API smoke passed: concurrent runs, exact balances, no repeated payment, reserve release, evidence export, origin rejection, pilot authentication, session isolation.",
);
