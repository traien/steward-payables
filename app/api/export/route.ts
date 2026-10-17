import { session } from "@/lib/session";
import { readWorkspace } from "@/lib/store";
import { verifyAudit } from "@/lib/audit";
export const dynamic = "force-dynamic";
export async function GET() {
  const context = await session();
  const workspace = await readWorkspace(context.id);
  if (!workspace)
    return Response.json({ error: "Open a workspace first." }, { status: 404 });
  const payments = workspace.invoices.flatMap((i) =>
    i.payment ? [i.payment] : [],
  );
  const confirmed = payments.filter(
    (p) => p.mode === "testnet" && p.status === "complete",
  );
  const payload = {
    exportedAt: new Date().toISOString(),
    disclosure:
      workspace.mode === "demo"
        ? "Synthetic data and simulated payments. Zero genuine customer traction."
        : "Owner-supplied pilot data. Sandbox USDC has no monetary value; no real invoices are discharged. Client invoice balances and feedback are owner-reported, not verified client payments. Business participation must be evidenced separately.",
    auditIntegrity: await verifyAudit(workspace.audit),
    metrics: {
      confirmedTestnetPayments: confirmed.length,
      confirmedTestnetUSDC:
        confirmed.reduce((sum, p) => sum + p.amountCents, 0) / 100,
      realUSDCVolume: 0,
      simulatedPayments: payments.filter((p) => p.mode === "demo").length,
    },
    workspace: { ...workspace, id: "[private workspace]" },
  };
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="steward-evidence.json"',
      "Cache-Control": "no-store",
    },
  });
}
