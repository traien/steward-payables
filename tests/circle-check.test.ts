import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const walletId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
const address = `0x${"1".repeat(40)}`;
const apiKey = "TEST_API_KEY:fixture:do-not-print";
const entitySecret = "ab".repeat(32);
const command = new URL("../scripts/check-circle.ts", import.meta.url).href;
const walletURL = `https://api.circle.com/v1/w3s/wallets/${walletId}`;

function runCheck(scenario: string, extraEnv: Record<string, string> = {}) {
  // A fresh process exercises the actual command with fake credentials only.
  // Every fetch is intercepted, including unexpected AI or write requests.
  const fixture = `
    const calls = [], messages = [], errors = [];
    const write = console.log.bind(console);
    console.log = (message) => messages.push(message);
    console.error = (message) => errors.push(message);
    globalThis.fetch = async (url, init) => {
      calls.push({ url, method: init?.method });
      if (init?.method !== "GET" || !url.startsWith(${JSON.stringify(walletURL)})) {
        throw new Error("Unexpected network request");
      }
      if (${JSON.stringify(scenario)} === "network-error") {
        throw new Error(${JSON.stringify(apiKey + " " + entitySecret)});
      }
      if (${JSON.stringify(scenario)} === "unauthorized") {
        return new Response(${JSON.stringify(apiKey + " " + entitySecret)}, { status: 401 });
      }
      const wallet = {
        id: ${JSON.stringify(walletId)},
        address: ${JSON.stringify(address)},
        blockchain: ${JSON.stringify(scenario)} === "wrong-network" ? "ETH" : "ARC-TESTNET",
        custodyType: "DEVELOPER",
        state: "LIVE"
      };
      const tokenBalances = ${JSON.stringify(scenario)} === "empty" ? [] : [{
        amount: "12.349999",
        token: {
          tokenAddress: "0x3600000000000000000000000000000000000000",
          blockchain: "ARC-TESTNET",
          decimals: 6,
          isNative: false,
          symbol: "USDC"
        }
      }];
      return Response.json({ data: url === ${JSON.stringify(walletURL)} ? { wallet } : { tokenBalances } });
    };
    await import(${JSON.stringify(command)});
    write(JSON.stringify({ calls, messages, errors }));
  `;
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", fixture],
    {
      encoding: "utf8",
      timeout: 10_000,
      env: {
        NODE_ENV: "test",
        CIRCLE_API_KEY: apiKey,
        CIRCLE_WALLET_ID: walletId,
        CIRCLE_ENTITY_SECRET: entitySecret,
        CIRCLE_BLOCKCHAIN: "ARC-TESTNET",
        // Even enabled AI must not be contacted by the wallet check.
        STEWARD_ENABLE_AI: "true",
        OPENAI_API_KEY: "fixture-openai-key-do-not-use",
        ...extraEnv,
      },
    },
  );
  assert.ifError(result.error);
  const output = JSON.parse(result.stdout) as {
    calls: { url: string; method: string }[];
    messages: string[];
    errors: string[];
  };
  return { status: result.status, ...output };
}

test("Circle check reads the real adapter contract without submitting a payment", () => {
  const result = runCheck("success", { CIRCLE_ENTITY_SECRET: "" });
  assert.equal(result.status, 0);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.calls, [
    { url: walletURL, method: "GET" },
    {
      url: `${walletURL}/balances?includeAll=true&tokenAddress=0x3600000000000000000000000000000000000000`,
      method: "GET",
    },
  ]);
  const report = JSON.parse(result.messages[0]);
  assert.equal(report.status, "connection_verified");
  assert.equal(report.network, "ARC-TESTNET");
  assert.equal(report.walletAddress, address);
  assert.equal(report.balanceUSDC, "12.34");
  assert.equal(report.paymentVerified, false);
  assert.equal(report.paymentsSubmitted, 0);
  assert.ok(!result.messages.join("").includes(apiKey));
});

test("Circle check reports a missing token balance without claiming payment verification", () => {
  const result = runCheck("empty");
  assert.equal(result.status, 0);
  const report = JSON.parse(result.messages[0]);
  assert.equal(report.balanceUSDC, "0.00");
  assert.match(report.balancePrecision, /no token entry reports zero/);
  assert.equal(report.paymentVerified, false);
});

test("Circle check fails before requests when the test key is missing", () => {
  const result = runCheck("success", { CIRCLE_API_KEY: "" });
  assert.equal(result.status, 1);
  assert.deepEqual(result.calls, []);
  assert.deepEqual(result.messages, []);
  assert.match(result.errors[0], /could not be verified/);
});

test("Circle check rejects a provider wallet on another network", () => {
  const result = runCheck("wrong-network");
  assert.equal(result.status, 1);
  assert.equal(result.calls.length, 1);
  assert.deepEqual(result.messages, []);
});

test("Circle check hides raw provider bodies and thrown errors", () => {
  for (const scenario of ["unauthorized", "network-error"]) {
    const result = runCheck(scenario);
    assert.equal(result.status, 1);
    assert.deepEqual(result.messages, []);
    assert.equal(result.calls.length, 1);
    assert.match(result.errors[0], /No payment was submitted/);
    assert.ok(!result.errors.join("").includes(apiKey));
    assert.ok(!result.errors.join("").includes(entitySecret));
  }
});
