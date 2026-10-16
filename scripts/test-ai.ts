import { getAIConfiguration } from "../lib/ai-config.ts";
import { createDemoWorkspace } from "../lib/fixtures.ts";
import { evaluateWorkspace } from "../lib/engine.ts";
import { enhanceDecisions } from "../lib/planner.ts";

// This command reviews fictional invoices only. It never runs the payment executor.
try {
  const config = getAIConfiguration();
  if (!config)
    throw new Error(
      "AI is disabled. Enable it only after the account owner approves this test.",
    );
  const workspace = createDemoWorkspace("provider-smoke-test");
  const decisions = await enhanceDecisions(
    workspace,
    evaluateWorkspace(workspace),
  );
  console.log(
    JSON.stringify(
      {
        provider: config.provider,
        model: config.model,
        reviewed: decisions.length,
        decisions: decisions.map(({ invoiceId, action, engine }) => ({
          invoiceId,
          action,
          engine,
        })),
        paymentsSubmitted: 0,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Provider test failed.",
  );
  process.exitCode = 1;
}
