import type { Workspace, AgentRun } from "./domain.ts";
import { evaluateWorkspace } from "./engine.ts";
import { appendAudit } from "./audit.ts";
import { enhanceDecisions } from "./planner.ts";
import { getWalletBalance, submitPayment, getPayment } from "./circle.ts";

type Persist = () => Promise<void>;
export async function runAgent(
  workspace: Workspace,
  persist: Persist,
  useAI: boolean,
) {
  if (workspace.invoices.some((i) => i.payment?.status === "pending"))
    throw new Error("Reconcile pending payments before starting another run.");
  if (workspace.mode === "pilot")
    workspace.balanceCents = (await getWalletBalance()).balanceCents;
  let decisions = evaluateWorkspace(workspace);
  if (useAI) decisions = await enhanceDecisions(workspace, decisions);
  const now = new Date().toISOString();
  const run: AgentRun = {
    id: crypto.randomUUID(),
    at: now,
    engine: decisions.some((d) => d.engine === "openai") ? "openai" : "rules",
    decisions,
    paidCents: 0,
    paymentCount: 0,
    heldCount: 0,
    blockedCount: 0,
  };
  run.inputSnapshot = structuredClone({
    balanceCents: workspace.balanceCents,
    policy: workspace.policy,
    vendors: workspace.vendors,
    invoices: workspace.invoices.map(
      ({ decision: previousDecision, payment: previousPayment, ...input }) =>
        input,
    ),
  });
  workspace.runs.push(run);
  await appendAudit(
    workspace,
    "run",
    "Payment review started",
    `${decisions.length} obligations reviewed using ${run.engine === "openai" ? "AI with deterministic checks" : "deterministic rules"}.`,
  );
  for (const decision of decisions) {
    const invoice = workspace.invoices.find(
      (i) => i.id === decision.invoiceId,
    )!;
    invoice.decision = decision;
    if (invoice.payment) continue;
    invoice.status =
      decision.action === "pay"
        ? "ready"
        : decision.action === "hold"
          ? "held"
          : "blocked";
    if (decision.action === "hold") run.heldCount++;
    if (decision.action === "block" || decision.action === "escalate")
      run.blockedCount++;
    await appendAudit(
      workspace,
      "decision",
      `${decision.action.toUpperCase()} · ${invoice.number}`,
      decision.reason,
      invoice.id,
    );
  }
  await persist();
  const payable = decisions.filter((d) => d.action === "pay").slice(0, 5);
  for (const decision of payable) {
    const invoice = workspace.invoices.find(
      (i) => i.id === decision.invoiceId,
    )!;
    if (invoice.payment) continue;
    invoice.payment = {
      idempotencyKey: crypto.randomUUID(),
      mode: workspace.mode === "demo" ? "demo" : "testnet",
      status: workspace.mode === "demo" ? "simulated" : "pending",
      amountCents: decision.amountCents,
      recipientAddress: invoice.recipientAddress,
      submittedAt: now,
    };
    if (workspace.mode === "demo") {
      invoice.status = "simulated";
      invoice.payment.completedAt = now;
      workspace.balanceCents -= decision.amountCents;
      run.paidCents += decision.amountCents;
      run.paymentCount++;
      await appendAudit(
        workspace,
        "simulation",
        `Simulated · ${invoice.number}`,
        `Simulated ${(decision.amountCents / 100).toFixed(2)} USDC. No blockchain transaction or business debt settlement.`,
        invoice.id,
      );
      await persist();
      continue;
    }
    invoice.status = "submitted";
    await appendAudit(
      workspace,
      "payment-intent",
      `Reserved · ${invoice.number}`,
      `Saved payment intent before contacting Circle. Key ${invoice.payment.idempotencyKey}.`,
      invoice.id,
    );
    await persist();
    try {
      const result = await submitPayment(
        invoice,
        invoice.payment.idempotencyKey,
      );
      invoice.payment.transactionId = result.transactionId;
      await appendAudit(
        workspace,
        "submitted",
        `Submitted · ${invoice.number}`,
        `Circle transaction ${result.transactionId}; awaiting confirmed settlement.`,
        invoice.id,
      );
      await persist();
    } catch {
      await appendAudit(
        workspace,
        "payment-unresolved",
        `Check required · ${invoice.number}`,
        "Transfer outcome is unresolved. The original payment intent is preserved; reconcile using the same idempotency key. No new payment will be attempted.",
        invoice.id,
      );
      await persist();
      break;
    }
  }
  await appendAudit(
    workspace,
    "run-complete",
    "Review complete",
    workspace.mode === "demo"
      ? `${run.paymentCount} simulated transfers. ${run.heldCount} held. ${run.blockedCount} exceptions.`
      : "Testnet intents recorded. Reconcile to check confirmed transfers; fiat obligations remain outstanding.",
  );
  await persist();
}
export async function reconcilePayments(
  workspace: Workspace,
  persist: Persist,
) {
  if (workspace.mode !== "pilot") return;
  for (const invoice of workspace.invoices
    .filter((i) => i.payment?.status === "pending")
    .slice(0, 5)) {
    const payment = invoice.payment!;
    if (!payment.transactionId) {
      const result = await submitPayment(invoice, payment.idempotencyKey);
      payment.transactionId = result.transactionId;
      await persist();
    }
    const result = await getPayment(payment.transactionId, invoice);
    if (result.status === "complete") {
      payment.status = "complete";
      payment.transactionHash = result.transactionHash;
      payment.completedAt = new Date().toISOString();
      invoice.status = "settled";
      await appendAudit(
        workspace,
        "settled",
        `Testnet settled · ${invoice.number}`,
        `Confirmed testnet transfer ${payment.transactionHash ?? payment.transactionId}. This does not discharge a real-world invoice.`,
        invoice.id,
      );
    } else if (result.status === "failed") {
      payment.status = "failed";
      invoice.status = "failed";
      await appendAudit(
        workspace,
        "failed",
        `Transfer failed · ${invoice.number}`,
        "Circle reported a terminal failure. This intent stays in the journal; it will not be silently reissued.",
        invoice.id,
      );
    }
    await persist();
  }
  workspace.balanceCents = (await getWalletBalance()).balanceCents;
  await persist();
}
