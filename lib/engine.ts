import type { Check, Decision, Invoice, Workspace } from "./domain";

const TERMINAL = new Set(["submitted", "settled", "simulated", "failed"]);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const isCents = (value: number) => Number.isSafeInteger(value) && value >= 0;
const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";
const normalize = (value: string) =>
  text(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
const keyOf = (invoice: Invoice) =>
  `${normalize(invoice.vendorId)}:${normalize(invoice.number)}`;
const validAddress = (value: string) =>
  ADDRESS.test(value) && !/^0x0{40}$/i.test(value);
const money = (cents: number) => `${(cents / 100).toFixed(2)} USDC`;

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

/** Pure, conservative application policy. This is not an onchain spending guard. */
export function evaluateWorkspace(
  workspace: Workspace,
  now: Date = new Date(),
): Decision[] {
  if (!Number.isFinite(now.getTime()))
    throw new RangeError("A valid review time is required.");
  const today = now.toISOString().slice(0, 10);
  const { policy } = workspace;
  const policyValid =
    [
      policy.reserveCents,
      policy.perPaymentLimitCents,
      policy.runLimitCents,
      policy.gasReserveCents,
      policy.approvalRequiredAboveCents,
      workspace.balanceCents,
    ].every(isCents) &&
    Number.isSafeInteger(policy.reserveCents + policy.gasReserveCents);
  const seen = new Map<string, number>();
  for (const invoice of workspace.invoices)
    seen.set(keyOf(invoice), (seen.get(keyOf(invoice)) ?? 0) + 1);
  let remainingCash = policyValid
    ? workspace.balanceCents - policy.reserveCents - policy.gasReserveCents
    : 0;
  let remainingRun = policyValid ? policy.runLimitCents : 0;

  // Due obligations come first; discounted future bills cannot consume their reserved cash.
  const candidates = workspace.invoices
    .filter((invoice) => !invoice.payment && !TERMINAL.has(invoice.status))
    .map((invoice, index) => ({ invoice, index }))
    .sort((a, b) => {
      const aDue = validDate(a.invoice.dueDate) && a.invoice.dueDate <= today;
      const bDue = validDate(b.invoice.dueDate) && b.invoice.dueDate <= today;
      return (
        Number(bDue) - Number(aDue) ||
        a.invoice.dueDate.localeCompare(b.invoice.dueDate) ||
        a.index - b.index
      );
    });

  return candidates.map(({ invoice }): Decision => {
    const checks: Check[] = [];
    const check = (
      code: string,
      label: string,
      passed: boolean,
      detail: string,
    ) => {
      checks.push({ code, label, passed, detail });
      return passed;
    };
    let amountCents = isCents(invoice.amountCents) ? invoice.amountCents : 0;
    const finish = (action: Decision["action"], reason: string): Decision => ({
      invoiceId: invoice.id,
      action,
      reason,
      checks,
      amountCents,
      evidence: checks.filter((item) => item.passed).map((item) => item.detail),
      decidedAt: now.toISOString(),
      engine: "rules",
    });

    if (
      !check(
        "policy",
        "Valid money and policy",
        policyValid,
        policyValid
          ? `Cash floor ${money(policy.reserveCents)} plus ${money(policy.gasReserveCents)} reserved for fees.`
          : "Balance and all limits must be nonnegative, safe integer cents.",
      )
    ) {
      return finish(
        "block",
        "Invalid cash balance or policy. Correct the configuration before any payment.",
      );
    }
    if (
      !check(
        "amount",
        "Exact invoice amount",
        isCents(invoice.amountCents) &&
          invoice.amountCents > 0 &&
          invoice.currency === "USD",
        "Invoice must be a positive USD amount represented in integer cents.",
      )
    ) {
      return finish(
        "block",
        "Invalid invoice amount or currency. No payment can be proposed.",
      );
    }
    if (
      !check(
        "identity",
        "Invoice identity",
        Boolean(normalize(invoice.vendorId) && normalize(invoice.number)),
        `Invoice reference: ${text(invoice.number) || "missing"}.`,
      )
    ) {
      return finish(
        "block",
        "A vendor and invoice number are required to prevent duplicate payment.",
      );
    }
    if (
      !check(
        "duplicate",
        "Unique obligation",
        seen.get(keyOf(invoice)) === 1,
        seen.get(keyOf(invoice)) === 1
          ? "No other invoice has this normalized vendor and invoice number."
          : "Another record has the same normalized vendor and invoice number, including payment history.",
      )
    ) {
      return finish(
        "block",
        "Duplicate invoice reference. Resolve the duplicate; no copy will be paid automatically.",
      );
    }
    const vendors = workspace.vendors.filter(
      (vendor) => vendor.id === invoice.vendorId,
    );
    if (
      !check(
        "vendor",
        "Known vendor",
        vendors.length === 1,
        vendors.length === 1
          ? `Vendor record: ${vendors[0].name}.`
          : "Exactly one approved vendor record is required.",
      )
    ) {
      return finish("block", "Vendor identity is missing or ambiguous.");
    }
    const approvedAddress = text(vendors[0].approvedAddress);
    const recipientAddress = text(invoice.recipientAddress);
    if (
      !check(
        "recipient",
        "Approved payment address",
        validAddress(approvedAddress) &&
          validAddress(recipientAddress) &&
          approvedAddress.toLowerCase() === recipientAddress.toLowerCase(),
        "Invoice recipient must match the independently approved vendor address.",
      )
    ) {
      return finish(
        "escalate",
        "The recipient does not match a valid approved vendor address. Independently confirm any change before paying.",
      );
    }
    if (
      !check(
        "purchase-order",
        "Purchase order match",
        Boolean(text(invoice.purchaseOrderRef)) &&
          isCents(invoice.purchaseOrderAmountCents) &&
          invoice.purchaseOrderAmountCents === invoice.amountCents,
        `Order ${text(invoice.purchaseOrderRef) || "missing"} must authorize exactly the invoice amount.`,
      )
    ) {
      return finish(
        "escalate",
        "The purchase order is missing or its amount differs from the invoice.",
      );
    }
    if (
      !check(
        "source",
        "Source evidence",
        Boolean(text(invoice.sourceReference)),
        text(invoice.sourceReference)
          ? `Source reference: ${text(invoice.sourceReference)}.`
          : "No invoice source reference was recorded.",
      )
    ) {
      return finish(
        "escalate",
        "A source document reference is required before this invoice can be paid.",
      );
    }
    if (
      !check(
        "acceptance",
        "Delivery accepted",
        invoice.acceptanceVerified === true,
        invoice.acceptanceVerified === true
          ? "An operator recorded acceptance of the goods or services."
          : "Delivery acceptance has not been verified by an operator.",
      )
    ) {
      return finish(
        "escalate",
        "Delivery acceptance is missing. A model's confidence cannot authorize release.",
      );
    }
    if (
      !check(
        "due-date",
        "Valid due date",
        validDate(invoice.dueDate),
        `Invoice due date: ${invoice.dueDate}.`,
      )
    ) {
      return finish(
        "block",
        "Invoice due date is invalid. Correct it before scheduling a payment.",
      );
    }
    const hasDiscount =
      invoice.discountBps !== undefined || invoice.discountUntil !== undefined;
    const discountValid =
      Number.isInteger(invoice.discountBps) &&
      invoice.discountBps! > 0 &&
      invoice.discountBps! < 10_000 &&
      validDate(invoice.discountUntil ?? "") &&
      invoice.discountUntil! <= invoice.dueDate;
    if (
      hasDiscount &&
      !check(
        "discount-terms",
        "Valid discount terms",
        discountValid,
        "Discount must be between 0 and 100 percent and expire on or before the invoice due date.",
      )
    ) {
      return finish(
        "escalate",
        "Discount terms are incomplete or invalid. Confirm the payable amount.",
      );
    }
    const activeDiscount = discountValid && invoice.discountUntil! >= today;
    // Round savings down to cents: a fractional cent never creates an underpayment.
    const savings = activeDiscount
      ? Number(
          (BigInt(invoice.amountCents) * BigInt(invoice.discountBps!)) /
            BigInt(10_000),
        )
      : 0;
    amountCents = invoice.amountCents - savings;
    if (
      !check(
        "timing",
        "Payment timing",
        invoice.dueDate <= today || savings > 0,
        savings > 0
          ? `An active discount saves ${money(savings)}; payable amount ${money(amountCents)}.`
          : invoice.dueDate <= today
            ? "This invoice is due or overdue."
            : "This invoice is not due and has no usable early-payment discount.",
      )
    ) {
      return finish(
        "hold",
        `Not due until ${invoice.dueDate}; preserve cash until then.`,
      );
    }
    if (
      !check(
        "payment-limit",
        "Per-payment cap",
        amountCents <= policy.perPaymentLimitCents,
        `Payment ${money(amountCents)} must be at or below ${money(policy.perPaymentLimitCents)}.`,
      )
    ) {
      return finish("block", "Payment exceeds the configured per-payment cap.");
    }
    if (
      !check(
        "approval",
        "Delegated approval limit",
        invoice.amountCents <= policy.approvalRequiredAboveCents,
        `Gross obligation ${money(invoice.amountCents)} must be at or below the delegated ${money(policy.approvalRequiredAboveCents)} approval limit.`,
      )
    ) {
      return finish(
        "escalate",
        "This obligation exceeds the delegated approval threshold. Owner review is required.",
      );
    }
    if (
      !check(
        "run-limit",
        "Review spending cap",
        amountCents <= remainingRun,
        `${money(Math.max(0, remainingRun))} remains available under this review's spending cap.`,
      )
    ) {
      return finish(
        "hold",
        "This review's spending cap would be exceeded. Reassess in a later review.",
      );
    }
    if (
      !check(
        "cash-reserve",
        "Protected operating cash",
        amountCents <= remainingCash,
        `${money(Math.max(0, remainingCash))} is available after earlier planned payments, operating reserve, and fee reserve.`,
      )
    ) {
      return finish(
        "hold",
        "Hold to protect operating cash and the fee reserve. Reassess when funds arrive.",
      );
    }
    remainingCash -= amountCents;
    remainingRun -= amountCents;
    return finish(
      "pay",
      savings > 0
        ? `Pay ${money(amountCents)} to capture ${money(savings)} in verified discount savings while preserving cash reserves.`
        : `Pay ${money(amountCents)}: due, matched, accepted, and within the available cash and delegated limits.`,
    );
  });
}
