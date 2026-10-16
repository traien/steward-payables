import { NextResponse } from "next/server";
import { session, checkOrigin } from "@/lib/session";
import {
  readWorkspace,
  insertWorkspace,
  lockWorkspace,
  saveWorkspace,
  releaseWorkspace,
} from "@/lib/store";
import { createDemoWorkspace, createPilotWorkspace } from "@/lib/fixtures";
import { getCapabilities } from "@/lib/circle";
import { isAIEnabled } from "@/lib/ai-config";
import { appendAudit } from "@/lib/audit";
import { actionSchema, importSchema } from "@/lib/validation";
import { runAgent, reconcilePayments } from "@/lib/runner";
import type { Workspace } from "@/lib/domain";

export const dynamic = "force-dynamic";
async function reply(
  workspace: Workspace,
  context: Awaited<ReturnType<typeof session>>,
) {
  const response = NextResponse.json(
    {
      workspace,
      capabilities: {
        ...getCapabilities(),
        currentUserId: context.user?.userId,
        ownerAuthorized: context.ownerAuthorized,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
  const options = {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 86400 * 30,
  };
  response.cookies.set("steward-session", context.nonce, options);
  response.cookies.set("steward-mode", workspace.mode, options);
  return response;
}
export async function GET() {
  try {
    const context = await session();
    let workspace = await readWorkspace(context.id);
    if (!workspace) {
      workspace =
        context.mode === "pilot"
          ? createPilotWorkspace(context.id, "Your business")
          : createDemoWorkspace(context.id);
      await appendAudit(
        workspace,
        "created",
        "Workspace opened",
        workspace.mode === "demo"
          ? "Synthetic demonstration. No customers, real invoices, or blockchain payments are represented."
          : "Private business pilot. Testnet transfers do not settle real invoices.",
      );
      workspace = await insertWorkspace(workspace);
    }
    return reply(workspace, context);
  } catch {
    return NextResponse.json(
      {
        error:
          "The workspace could not be loaded. Check the database connection and migrations.",
      },
      { status: 503 },
    );
  }
}
export async function POST(request: Request) {
  let token: string | undefined;
  let id: string | undefined;
  try {
    await checkOrigin(request);
    const body = await request.text();
    if (body.length > 100_000)
      throw new Error("Import is too large. Use at most 30 invoices.");
    const action = actionSchema.parse(JSON.parse(body));
    const context = await session();
    id = context.id;
    if (action.action === "demo") id = `${context.base}:demo`;
    if (action.action === "import" || action.action === "pilot") {
      if (!context.user)
        throw new Error(
          "Sign in with ChatGPT before importing private business records.",
        );
      id = `${context.base}:pilot`;
    }
    let workspace: Workspace =
      (await readWorkspace(id)) ??
      (await insertWorkspace(
        action.action === "import" || action.action === "pilot"
          ? createPilotWorkspace(
              id,
              action.action === "import"
                ? action.businessName
                : "Your business",
            )
          : createDemoWorkspace(id),
      ));
    token = await lockWorkspace(id);
    workspace = (await readWorkspace(id))!;
    const persist = () => saveWorkspace(workspace!, token!);
    switch (action.action) {
      case "run":
        if (workspace.mode === "pilot" && !context.ownerAuthorized)
          throw new Error(
            "Only the configured owner can execute testnet payments. Finish Setup first.",
          );
        await runAgent(
          workspace,
          persist,
          context.ownerAuthorized && isAIEnabled(),
        );
        break;
      case "reconcile":
        if (workspace.mode === "pilot" && !context.ownerAuthorized)
          throw new Error(
            "Only the configured owner can reconcile this wallet.",
          );
        await reconcilePayments(workspace, persist);
        break;
      case "reset": {
        if (workspace.mode !== "demo")
          throw new Error(
            "Pilot history is permanent. Switch to the demo to reset sample data.",
          );
        const revision = workspace.revision;
        workspace = createDemoWorkspace(id);
        workspace.revision = revision;
        await appendAudit(
          workspace,
          "created",
          "Demo reset",
          "A fresh synthetic scenario. No real payments or customer traction.",
        );
        await persist();
        break;
      }
      case "demo":
      case "pilot":
        break;
      case "add-funds":
        if (workspace.mode !== "demo")
          throw new Error(
            "Pilot balances come from Circle. Fund your testnet wallet with the official faucet.",
          );
        workspace.balanceCents += action.amountCents;
        if (
          !Number.isSafeInteger(workspace.balanceCents) ||
          workspace.balanceCents > 100_000_000
        )
          throw new Error("Balance exceeds the demo limit.");
        await appendAudit(
          workspace,
          "revenue",
          "Demo cash received",
          `${(action.amountCents / 100).toFixed(2)} simulated USDC added. Run the agent again to reconsider held invoices.`,
        );
        await persist();
        break;
      case "policy":
        if (workspace.mode === "pilot" && !context.ownerAuthorized)
          throw new Error(
            "Only the configured owner can change pilot payment policy.",
          );
        if (workspace.invoices.some((i) => i.payment?.status === "pending"))
          throw new Error("Reconcile pending payments before changing policy.");
        workspace.policy = action.policy;
        await appendAudit(
          workspace,
          "policy",
          "Spending rules updated",
          JSON.stringify(action.policy),
        );
        await persist();
        break;
      case "import": {
        const data = importSchema.parse(action);
        if (workspace.invoices.some((i) => i.payment?.status === "pending"))
          throw new Error(
            "Reconcile pending payments before importing more records.",
          );
        for (const vendor of data.vendors) {
          const existing = workspace.vendors.find((v) => v.id === vendor.id);
          if (
            existing &&
            existing.approvedAddress.toLowerCase() !==
              vendor.approvedAddress.toLowerCase()
          )
            throw new Error(
              "An approved payee cannot be changed through invoice import.",
            );
        }
        if (
          data.invoices.some((i) =>
            workspace.invoices.some((old) => old.id === i.id),
          )
        )
          throw new Error(
            "An imported invoice ID already exists. Historical obligations cannot be replaced.",
          );
        workspace.businessName = data.businessName;
        workspace.vendors.push(
          ...data.vendors.filter(
            (v) => !workspace.vendors.some((old) => old.id === v.id),
          ),
        );
        workspace.invoices.push(
          ...data.invoices.map((i) => ({ ...i, status: "inbox" as const })),
        );
        await appendAudit(
          workspace,
          "import",
          "Business records imported",
          `${data.invoices.length} owner-supplied obligations. Payee approval and delivery acceptance are owner attestations, not independent verification by Steward.`,
        );
        await persist();
        break;
      }
    }
    return reply(workspace, context);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "The action could not be completed.";
    const safe = message.includes('"code"')
      ? "Some fields are invalid. Check dates, whole-number cents, vendor IDs, and wallet addresses."
      : message;
    return NextResponse.json(
      { error: safe },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    if (token && id) await releaseWorkspace(id, token);
  }
}
