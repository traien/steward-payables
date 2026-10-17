import type { ClientInvoice, ReceivableReview, Workspace } from "./domain.ts";
import {
  importReceivableSchema,
  receivableFeedbackSchema,
} from "./validation.ts";

function requirePilot(workspace: Workspace) {
  if (workspace.mode !== "pilot")
    throw new Error("Client invoices belong in the private workspace.");
}

function normalizedReference(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function importReceivable(
  workspace: Workspace,
  businessName: string,
  record: Omit<ClientInvoice, "review" | "feedback">,
): ClientInvoice {
  requirePilot(workspace);
  const data = importReceivableSchema.parse({ businessName, record });
  const records = workspace.receivables ?? [];
  if (records.length >= 30)
    throw new Error("This workspace supports at most 30 client invoices.");
  if (records.some((existing) => existing.id === data.record.id))
    throw new Error("This client invoice ID already exists. Imported records cannot be replaced.");
  if (
    records.some(
      (existing) =>
        normalizedReference(existing.clientAlias) === normalizedReference(data.record.clientAlias) &&
        normalizedReference(existing.number) === normalizedReference(data.record.number),
    )
  )
    throw new Error("This client and invoice number already exist. Use the original record.");
  workspace.businessName = data.businessName;
  workspace.receivables = [...records, data.record];
  return data.record;
}

export function reviewReceivable(
  record: ClientInvoice,
  asOf = new Date().toISOString().slice(0, 10),
): ReceivableReview {
  const today = new Date(asOf);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(asOf) ||
    !Number.isFinite(today.getTime()) ||
    today.toISOString().slice(0, 10) !== asOf
  )
    throw new Error("Review date must be a valid calendar date.");
  const outstandingCents = record.amountCents - record.paidCents;
  const daysPastDue = Math.floor((today.getTime() - new Date(record.dueDate).getTime()) / 86_400_000);
  const base = {
    outstandingCents,
    daysOverdue: outstandingCents > 0 ? Math.max(0, daysPastDue) : 0,
    asOf,
  };
  if (outstandingCents === 0)
    return { ...base, action: "paid", reason: "The recorded paid amount covers this invoice. No collection follow-up is needed." };
  if (record.workStatus === "disputed")
    return { ...base, action: "resolve-dispute", reason: "The work is disputed. Resolve the disagreement before requesting payment." };
  if (record.workStatus === "pending")
    return { ...base, action: "confirm-acceptance", reason: "Client acceptance is pending. Confirm the work was accepted before requesting payment." };
  if (daysPastDue < 0)
    return { ...base, action: "wait", reason: `The accepted invoice is not due until ${record.dueDate}. Review it again on the due date.` };
  return {
    ...base,
    action: "follow-up",
    reason: daysPastDue === 0
      ? "The accepted invoice is due today and has an outstanding balance. Review a payment follow-up with the client."
      : `The accepted invoice has an outstanding balance and is ${daysPastDue} ${daysPastDue === 1 ? "day" : "days"} overdue. Review a payment follow-up with the client.`,
  };
}

export function reviewReceivables(
  workspace: Workspace,
  asOf = new Date().toISOString().slice(0, 10),
): ClientInvoice[] {
  requirePilot(workspace);
  const records = workspace.receivables ?? [];
  if (!records.length) throw new Error("Import a client invoice before reviewing receivables.");
  for (const record of records) {
    const review = reviewReceivable(record, asOf);
    // Feedback on an older review remains in the journal, not on the new result.
    if (JSON.stringify(record.review) !== JSON.stringify(review)) delete record.feedback;
    record.review = review;
  }
  return records;
}

export function recordReceivableFeedback(
  workspace: Workspace,
  input: { id: string; reviewAsOf: string; assessment: "useful" | "needs-correction"; note: string },
): ClientInvoice {
  requirePilot(workspace);
  const data = receivableFeedbackSchema.parse(input);
  const record = workspace.receivables?.find((item) => item.id === data.id);
  if (!record) throw new Error("Client invoice was not found.");
  if (!record.review) throw new Error("Review this client invoice before recording feedback.");
  if (record.review.asOf !== data.reviewAsOf)
    throw new Error("This review has changed. Refresh and read the current review before recording feedback.");
  record.feedback = {
    assessment: data.assessment,
    note: data.note,
    recordedAt: new Date().toISOString(),
  };
  return record;
}
