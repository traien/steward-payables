import test from "node:test";
import assert from "node:assert/strict";
import { actionSchema, importSchema, policySchema } from "../lib/validation.ts";

const vendor = {
  id: "one",
  name: "Owner-approved supplier",
  category: "Design",
  approvedAddress: `0x${"1".repeat(40)}`,
};
const invoice = {
  id: "invoice1",
  number: "INV-1",
  vendorId: "one",
  description: "Accepted design work",
  amountCents: 100,
  currency: "USD",
  dueDate: "2026-10-17",
  recipientAddress: vendor.approvedAddress,
  purchaseOrderRef: "PO-1",
  purchaseOrderAmountCents: 100,
  acceptanceVerified: true,
  sourceReference: "Delivery reference",
};
const data = () => ({
  businessName: "A real pilot, if actually recruited",
  vendors: [vendor],
  invoices: [invoice],
});
test("rejects fractional cents, unsupported currency, impossible dates and unknown vendors", () => {
  for (const override of [
    { amountCents: 0.5 },
    { amountCents: -1 },
    { currency: "EUR" },
    { dueDate: "2026-02-30" },
    { vendorId: "missing" },
    { recipientAddress: "not-a-wallet" },
  ]) {
    assert.equal(
      importSchema.safeParse({
        ...data(),
        invoices: [{ ...invoice, ...override }],
      }).success,
      false,
    );
  }
});
test("strips client-supplied payment and AI decision when importing", () => {
  const parsed = importSchema.parse({
    ...data(),
    invoices: [
      {
        ...invoice,
        payment: { status: "complete" },
        decision: { action: "pay" },
      },
    ],
  });
  assert.equal("payment" in parsed.invoices[0], false);
  assert.equal("decision" in parsed.invoices[0], false);
});
test("rejects ambiguous IDs, excessive input, negative caps and zero gas reserve", () => {
  assert.equal(
    importSchema.safeParse({ ...data(), invoices: [invoice, invoice] }).success,
    false,
  );
  assert.equal(
    importSchema.safeParse({ ...data(), vendors: [vendor, vendor] }).success,
    false,
  );
  assert.equal(
    importSchema.safeParse({
      ...data(),
      invoices: Array.from({ length: 31 }, (_, n) => ({
        ...invoice,
        id: `n${n}`,
      })),
    }).success,
    false,
  );
  assert.equal(
    policySchema.safeParse({
      reserveCents: 0,
      perPaymentLimitCents: -1,
      runLimitCents: 100,
      gasReserveCents: 0,
      approvalRequiredAboveCents: 100,
    }).success,
    false,
  );
  assert.equal(
    actionSchema.safeParse({ action: "send-money", amountCents: 100 }).success,
    false,
  );
});
