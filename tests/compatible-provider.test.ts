import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { getAIConfiguration, getAIStatus } from "../lib/ai-config.ts";
import { enhanceDecisions } from "../lib/planner.ts";
import { createDemoWorkspace } from "../lib/fixtures.ts";
import { evaluateWorkspace } from "../lib/engine.ts";
import { runAgent } from "../lib/runner.ts";
import type { Decision } from "../lib/domain.ts";

const names = [
  "STEWARD_ENABLE_AI",
  "STEWARD_AI_PROVIDER",
  "STEWARD_AI_BASE_URL",
  "STEWARD_AI_API_KEY",
  "STEWARD_AI_MODEL",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
];
const originalEnv = Object.fromEntries(
  names.map((name) => [name, process.env[name]]),
);
const realFetch = globalThis.fetch;
let calls: { url: string; init?: RequestInit }[];

function configure() {
  Object.assign(process.env, {
    STEWARD_ENABLE_AI: "true",
    STEWARD_AI_PROVIDER: "compatible",
    STEWARD_AI_BASE_URL: "https://provider.invalid/v1/",
    STEWARD_AI_API_KEY: "test-provider-key",
    STEWARD_AI_MODEL: "test-review-model",
    OPENAI_API_KEY: "test-openai-key-do-not-send",
    OPENAI_MODEL: "test-openai-model-do-not-use",
  });
}

function result(decisions: Decision[]) {
  return {
    choices: [
      {
        finish_reason: "stop",
        message: {
          role: "assistant",
          content: JSON.stringify({
            reviews: decisions.map((decision) => ({
              invoiceId: decision.invoiceId,
              action: decision.action === "pay" ? "hold" : "pay",
              rationale: "Synthetic provider review for a mock test.",
            })),
          }),
        },
      },
    ],
  };
}

function respond(body: unknown) {
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    if (init?.redirect === "error")
      throw new TypeError("Invalid redirect value, must be 'follow' or 'manual'.");
    return Response.json(body);
  };
}

beforeEach(() => {
  for (const name of names) delete process.env[name];
  calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    throw new Error(
      "Unexpected mocked request; real network access is disabled.",
    );
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const name of names) {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  }
});

test("compatible review uses only its own endpoint, key, model and bounded decisions", async () => {
  configure();
  const workspace = createDemoWorkspace("provider-test");
  const decisions = evaluateWorkspace(workspace);
  respond(result(decisions));
  const reviewed = await enhanceDecisions(workspace, decisions);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://provider.invalid/v1/chat/completions");
  assert.equal(
    new Headers(calls[0].init?.headers).get("Authorization"),
    "Bearer test-provider-key",
  );
  assert.equal(calls[0].init?.redirect, "manual");
  const payload = JSON.parse(String(calls[0].init?.body));
  assert.equal(payload.model, "test-review-model");
  assert.equal(payload.response_format.json_schema.strict, true);
  assert.equal(payload.stream, false);
  assert.match(payload.messages[0].content, /untrusted data/);
  assert.equal(JSON.stringify(calls).includes("test-openai"), false);
  assert.equal(
    JSON.stringify(payload).includes(workspace.vendors[0].approvedAddress),
    false,
  );
  for (const [index, decision] of reviewed.entries()) {
    assert.equal(decision.engine, "compatible");
    assert.equal(
      decision.action,
      decisions[index].action === "pay" ? "hold" : decisions[index].action,
    );
    assert.equal(decision.amountCents, decisions[index].amountCents);
    assert.deepEqual(decision.checks, decisions[index].checks);
  }
});

test("custom settings never fall back to an existing OpenAI key or model", async () => {
  for (const missing of [
    "STEWARD_AI_API_KEY",
    "STEWARD_AI_MODEL",
    "STEWARD_AI_BASE_URL",
    "STEWARD_AI_PROVIDER",
  ]) {
    configure();
    delete process.env[missing];
    const workspace = createDemoWorkspace("missing-config");
    await assert.rejects(
      enhanceDecisions(workspace, evaluateWorkspace(workspace)),
      /STEWARD_AI/,
    );
    assert.equal(getAIStatus().ai, false);
    assert.ok(getAIStatus().aiConfigurationError);
  }
  assert.equal(calls.length, 0);
});

test("disabled AI ignores provider settings without sending a request", async () => {
  configure();
  process.env.STEWARD_ENABLE_AI = "false";
  const workspace = createDemoWorkspace("disabled-ai");
  const decisions = await enhanceDecisions(
    workspace,
    evaluateWorkspace(workspace),
  );
  assert.ok(decisions.every((decision) => decision.engine === "rules"));
  assert.deepEqual(getAIStatus(), { ai: false });
  assert.equal(calls.length, 0);
});

test("invalid custom URLs are rejected without leaking their contents", () => {
  configure();
  for (const url of [
    "http://provider.invalid/v1",
    "ftp://provider.invalid/v1",
    "not-a-url",
    "https://user:accidental-secret@provider.invalid/v1",
    "https://provider.invalid/v1?key=accidental-secret",
    "https://provider.invalid/v1#accidental-secret",
    "https://provider.invalid/v1?",
    "https://provider.invalid/v1#",
  ]) {
    process.env.STEWARD_AI_BASE_URL = url;
    assert.throws(
      getAIConfiguration,
      (error: unknown) =>
        error instanceof Error &&
        /HTTPS URL/.test(error.message) &&
        !error.message.includes("accidental-secret"),
    );
  }
  assert.equal(calls.length, 0);
});

test("an explicit OpenAI selection keeps its fixed endpoint and separate key", () => {
  configure();
  process.env.STEWARD_AI_PROVIDER = "openai";
  const config = getAIConfiguration()!;
  assert.equal(config.endpoint, "https://api.openai.com/v1/responses");
  assert.equal(config.apiKey, "test-openai-key-do-not-send");
  assert.equal(config.model, "test-openai-model-do-not-use");
  delete process.env.OPENAI_API_KEY;
  assert.throws(getAIConfiguration, /OPENAI_API_KEY is required/);
  assert.equal(calls.length, 0);
});

test("chat refusals, truncation, tools and multiple choices stop the run", async () => {
  configure();
  const workspace = createDemoWorkspace("invalid-chat");
  const decisions = evaluateWorkspace(workspace);
  const valid = result(decisions).choices[0];
  for (const choices of [
    [],
    [valid, valid],
    [{ ...valid, finish_reason: "length" }],
    [{ ...valid, finish_reason: "content_filter" }],
    [{ ...valid, message: { ...valid.message, role: "user" } }],
    [{ ...valid, message: { ...valid.message, refusal: "Cannot review" } }],
    [{ ...valid, message: { ...valid.message, content: null } }],
    [{ ...valid, message: { ...valid.message, content: "not JSON" } }],
    [{ ...valid, message: { ...valid.message, tool_calls: [{}] } }],
    [{ ...valid, message: { ...valid.message, function_call: {} } }],
  ]) {
    respond({ choices });
    await assert.rejects(
      enhanceDecisions(workspace, decisions),
      /No payments were submitted/,
    );
  }
});

test("chat reviews reject extra fields, invalid action types and omitted invoices", async () => {
  configure();
  const workspace = createDemoWorkspace("invalid-reviews");
  const decisions = evaluateWorkspace(workspace);
  const complete = JSON.parse(
    result(decisions).choices[0].message.content,
  ).reviews;
  for (const reviews of [
    complete.slice(1),
    complete.map((review: object) => ({ ...review, action: ["pay"] })),
    complete.map((review: object) => ({ ...review, amountCents: 1 })),
    complete.map((review: object) => ({
      ...review,
      invoiceId: decisions[0].invoiceId,
    })),
  ]) {
    const body = result(decisions);
    body.choices[0].message.content = JSON.stringify({ reviews });
    respond(body);
    await assert.rejects(
      enhanceDecisions(workspace, decisions),
      /No payments were submitted/,
    );
  }
});

test("provider errors cannot reveal credentials or silently switch engines", async () => {
  configure();
  globalThis.fetch = async () => {
    throw new Error("test-provider-key private details");
  };
  const workspace = createDemoWorkspace("provider-error");
  await assert.rejects(
    enhanceDecisions(workspace, evaluateWorkspace(workspace)),
    (error: unknown) =>
      error instanceof Error &&
      /No payments were submitted/.test(error.message) &&
      !error.message.includes("test-provider-key"),
  );
});

test("provider redirects stop before any payment and never forward credentials", async () => {
  configure();
  const workspace = createDemoWorkspace("redirected-provider");
  const before = structuredClone(workspace);
  const destination = "https://untrusted.invalid/collect-provider-key";
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    if (init?.redirect === "error")
      throw new TypeError("Invalid redirect value, must be 'follow' or 'manual'.");
    if (init?.redirect === "manual")
      return new Response("test-provider-key private redirect details", {
        status: 307,
        headers: { Location: destination },
      });
    // Model a followed redirect without allowing any real network request.
    calls.push({ url: destination, init });
    return Response.json(result(evaluateWorkspace(workspace)));
  };
  let saves = 0;
  await assert.rejects(
    runAgent(
      workspace,
      async () => {
        saves++;
      },
      true,
    ),
    (error: unknown) =>
      error instanceof Error &&
      /No payments were submitted/.test(error.message) &&
      !error.message.includes("test-provider-key") &&
      !error.message.includes(destination),
  );
  assert.deepEqual(workspace, before);
  assert.equal(saves, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://provider.invalid/v1/chat/completions");
  assert.equal(calls[0].init?.redirect, "manual");
  assert.equal(
    new Headers(calls[0].init?.headers).get("Authorization"),
    "Bearer test-provider-key",
  );
  assert.equal(JSON.stringify(calls).includes("test-openai"), false);
});

test("incomplete AI setup cannot create a run or payment intent", async () => {
  configure();
  delete process.env.STEWARD_AI_API_KEY;
  const workspace = createDemoWorkspace("incomplete-run");
  const before = structuredClone(workspace);
  let saves = 0;
  await assert.rejects(
    runAgent(
      workspace,
      async () => {
        saves++;
      },
      true,
    ),
    /STEWARD_AI_API_KEY/,
  );
  assert.deepEqual(workspace, before);
  assert.equal(saves, 0);
  assert.equal(calls.length, 0);
});

test("invalid AI output cannot create a run or payment intent", async () => {
  configure();
  const workspace = createDemoWorkspace("failed-review");
  const before = structuredClone(workspace);
  respond({ choices: [] });
  let saves = 0;
  await assert.rejects(
    runAgent(
      workspace,
      async () => {
        saves++;
      },
      true,
    ),
    /No payments were submitted/,
  );
  assert.deepEqual(workspace, before);
  assert.equal(saves, 0);
  assert.equal(calls.length, 1);
});

test("compatible reviews retain their provider label in runs and journal", async () => {
  configure();
  const workspace = createDemoWorkspace("compatible-run");
  respond(result(evaluateWorkspace(workspace)));
  await runAgent(workspace, async () => {}, true);
  assert.equal(workspace.runs[0].engine, "compatible");
  assert.equal(workspace.runs[0].paymentCount, 0);
  assert.ok(
    workspace.audit.some((event) =>
      /AI with deterministic checks/.test(event.detail),
    ),
  );
  assert.equal(calls.length, 1);
});
