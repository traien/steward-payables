import { constants, publicEncrypt } from "node:crypto";
import type { Capabilities, Invoice } from "./domain.ts";

const API = "https://api.circle.com/v1/w3s";
const NETWORK = "ARC-TESTNET" as const;
const USDC = "0x3600000000000000000000000000000000000000";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
type JsonObject = Record<string, unknown>;
type Config = { apiKey: string; walletId: string; entitySecret?: string };

function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Circle returned an invalid response.");
  return value as JsonObject;
}

/** Configuration presence only: this does not claim connectivity or authentication. */
export function getCapabilities(): Capabilities {
  return {
    ai:
      process.env.STEWARD_ENABLE_AI === "true" &&
      Boolean(process.env.OPENAI_API_KEY?.trim()),
    circle: Boolean(
      process.env.CIRCLE_API_KEY?.trim() &&
        process.env.CIRCLE_ENTITY_SECRET?.trim() &&
        process.env.CIRCLE_WALLET_ID?.trim(),
    ),
    walletIdConfigured: Boolean(process.env.CIRCLE_WALLET_ID?.trim()),
    network: NETWORK,
    enforcement: "application",
  };
}

function config(write = false): Config {
  const apiKey = process.env.CIRCLE_API_KEY?.trim() ?? "";
  const walletId = process.env.CIRCLE_WALLET_ID?.trim() ?? "";
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET?.trim();
  if ((process.env.CIRCLE_BLOCKCHAIN?.trim() || NETWORK) !== NETWORK)
    throw new Error("Only Arc testnet is supported.");
  if (!/^TEST_API_KEY:[^:\s]+:[^:\s]+$/.test(apiKey))
    throw new Error("A Circle test API key is required.");
  if (!UUID.test(walletId))
    throw new Error("A valid Circle wallet ID is required.");
  if (write && !/^[0-9a-f]{64}$/i.test(entitySecret ?? ""))
    throw new Error("A registered 32-byte Circle entity secret is required.");
  return { apiKey, walletId, entitySecret };
}

async function request(
  settings: Config,
  path: string,
  body?: JsonObject,
): Promise<JsonObject> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    // The caller retains the intent: a timeout never proves that a write failed.
    throw new Error(
      "Circle request could not be confirmed. Reconcile the existing payment intent.",
    );
  }
  if (!response.ok)
    throw new Error(
      `Circle request was not confirmed (HTTP ${response.status}).`,
    );
  try {
    return object(object(await response.json()).data);
  } catch {
    throw new Error(
      "Circle returned an invalid response. Reconcile the existing payment intent.",
    );
  }
}

async function verifiedWallet(settings: Config): Promise<{ address: string }> {
  const wallet = object(
    (await request(settings, `/wallets/${settings.walletId}`)).wallet,
  );
  if (
    wallet.id !== settings.walletId ||
    wallet.blockchain !== NETWORK ||
    wallet.custodyType !== "DEVELOPER" ||
    wallet.state !== "LIVE"
  ) {
    throw new Error(
      "The configured wallet must be a live developer-controlled Arc testnet wallet.",
    );
  }
  if (typeof wallet.address !== "string" || !ADDRESS.test(wallet.address))
    throw new Error("Circle returned an invalid wallet address.");
  return { address: wallet.address };
}

function centsFromUSDC(value: unknown): number {
  if (typeof value !== "string" || !/^\d{1,16}(?:\.\d{1,6})?$/.test(value))
    throw new Error("Circle returned an invalid USDC balance.");
  const [whole, fraction = ""] = value.split(".");
  // Round down sub-cent funds so the rules can never overspend a rounded balance.
  const cents =
    BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0").slice(0, 2));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("USDC balance exceeds the supported range.");
  return Number(cents);
}

async function usdcBalance(
  settings: Config,
): Promise<{ balanceCents: number; verified: boolean }> {
  const data = await request(
    settings,
    `/wallets/${settings.walletId}/balances?includeAll=true&tokenAddress=${USDC}`,
  );
  if (!Array.isArray(data.tokenBalances))
    throw new Error("Circle returned an invalid balance response.");
  const matches = data.tokenBalances.map(object).filter((balance) => {
    const token = object(balance.token);
    return (
      typeof token.tokenAddress === "string" &&
      token.tokenAddress.toLowerCase() === USDC &&
      token.blockchain === NETWORK
    );
  });
  // Arc's native 18-decimal representation is the same funds. Never add it again.
  const erc20 = matches.filter((balance) => {
    const token = object(balance.token);
    return (
      token.decimals === 6 &&
      token.isNative === false &&
      token.symbol === "USDC"
    );
  });
  if (erc20.length > 1 || (matches.length > 0 && erc20.length !== 1))
    throw new Error("Circle USDC metadata could not be verified.");
  if (erc20.length === 0) return { balanceCents: 0, verified: false };
  return { balanceCents: centsFromUSDC(erc20[0].amount), verified: true };
}

export async function getWalletBalance(): Promise<{
  balanceCents: number;
  address: string;
}> {
  const settings = config();
  const wallet = await verifiedWallet(settings);
  const balance = await usdcBalance(settings);
  return { balanceCents: balance.balanceCents, address: wallet.address };
}

export async function submitPayment(
  invoice: Invoice,
  idempotencyKey: string,
): Promise<{ transactionId: string }> {
  const settings = config(true);
  const decision = invoice.decision;
  if (!UUID.test(idempotencyKey))
    throw new Error("A persisted UUID payment key is required.");
  if (
    !decision ||
    decision.invoiceId !== invoice.id ||
    decision.action !== "pay" ||
    !Number.isSafeInteger(decision.amountCents) ||
    decision.amountCents <= 0 ||
    !Number.isSafeInteger(invoice.amountCents) ||
    decision.amountCents > invoice.amountCents ||
    invoice.currency !== "USD"
  ) {
    throw new Error(
      "Only an approved payment within the original invoice amount can be submitted.",
    );
  }
  if (
    !ADDRESS.test(invoice.recipientAddress) ||
    /^0x0{40}$/i.test(invoice.recipientAddress)
  )
    throw new Error("A valid testnet recipient is required.");
  const intent = invoice.payment;
  if (
    !intent ||
    intent.mode !== "testnet" ||
    intent.status !== "pending" ||
    intent.idempotencyKey !== idempotencyKey ||
    intent.amountCents !== decision.amountCents ||
    intent.recipientAddress !== invoice.recipientAddress
  ) {
    throw new Error("A matching pending testnet payment intent is required.");
  }
  await verifiedWallet(settings);
  const balance = await usdcBalance(settings);
  // A retry may already have spent the balance. Do not reject it on current balance:
  // Circle must resolve the ORIGINAL idempotency key without creating a second write.
  if (!balance.verified)
    throw new Error(
      "The wallet's six-decimal Arc testnet USDC token could not be verified.",
    );
  const publicKey = (await request(settings, "/config/entity/publicKey"))
    .publicKey;
  if (typeof publicKey !== "string" || !publicKey.includes("BEGIN PUBLIC KEY"))
    throw new Error("Circle returned an invalid encryption key.");
  let ciphertext: string;
  try {
    ciphertext = publicEncrypt(
      {
        key: publicKey,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      Buffer.from(settings.entitySecret!, "hex"),
    ).toString("base64");
  } catch {
    throw new Error("Circle entity secret encryption could not be completed.");
  }
  const cents = BigInt(decision.amountCents);
  const amount = `${cents / BigInt(100)}.${String(cents % BigInt(100)).padStart(2, "0")}`;
  const result = await request(settings, "/developer/transactions/transfer", {
    idempotencyKey,
    entitySecretCiphertext: ciphertext,
    walletId: settings.walletId,
    blockchain: NETWORK,
    tokenAddress: USDC,
    destinationAddress: intent.recipientAddress,
    amounts: [amount],
    feeLevel: "MEDIUM",
    refId: idempotencyKey,
  });
  if (typeof result.id !== "string" || !UUID.test(result.id))
    throw new Error(
      "Circle did not return a valid transaction ID. Reconcile the existing payment intent.",
    );
  return { transactionId: result.id };
}

export async function getPayment(
  transactionId: string,
  invoice?: Invoice,
): Promise<{
  status: "pending" | "complete" | "failed";
  transactionHash?: string;
}> {
  const settings = config();
  if (!UUID.test(transactionId))
    throw new Error("A valid Circle transaction ID is required.");
  const transaction = object(
    (await request(settings, `/transactions/${transactionId}`)).transaction,
  );
  if (
    transaction.id !== transactionId ||
    transaction.walletId !== settings.walletId ||
    transaction.blockchain !== NETWORK ||
    transaction.custodyType !== "DEVELOPER" ||
    transaction.operation !== "TRANSFER"
  ) {
    throw new Error(
      "Circle transaction does not match the configured testnet wallet.",
    );
  }
  const transactionHash =
    typeof transaction.txHash === "string" &&
    /^0x[0-9a-f]{64}$/i.test(transaction.txHash)
      ? transaction.txHash
      : undefined;
  if (transaction.state === "COMPLETE") {
    if (!transactionHash)
      throw new Error(
        "Completed Circle transaction is missing a valid transaction hash.",
      );
    const intent = invoice?.payment;
    if (
      !intent ||
      intent.mode !== "testnet" ||
      intent.transactionId !== transactionId ||
      !Number.isSafeInteger(intent.amountCents) ||
      intent.amountCents <= 0 ||
      !UUID.test(intent.idempotencyKey)
    )
      throw new Error(
        "A matching persisted invoice intent is required to verify completion.",
      );
    if (
      transaction.transactionType !== "OUTBOUND" ||
      transaction.refId !== intent.idempotencyKey ||
      typeof transaction.destinationAddress !== "string" ||
      transaction.destinationAddress.toLowerCase() !==
        intent.recipientAddress.toLowerCase()
    )
      throw new Error(
        "Circle receipt does not match the intended recipient or reference.",
      );
    if (
      !Array.isArray(transaction.amounts) ||
      transaction.amounts.length !== 1 ||
      typeof transaction.amounts[0] !== "string" ||
      !/^\d{1,16}(?:\.\d{1,6})?$/.test(transaction.amounts[0])
    )
      throw new Error("Circle receipt has an invalid transfer amount.");
    const [whole, fraction = ""] = transaction.amounts[0].split(".");
    const receiptUnits =
      BigInt(whole) * BigInt(1_000_000) + BigInt(fraction.padEnd(6, "0"));
    if (receiptUnits !== BigInt(intent.amountCents) * BigInt(10_000))
      throw new Error("Circle receipt does not match the intended amount.");
    if (
      typeof transaction.tokenId !== "string" ||
      !UUID.test(transaction.tokenId)
    )
      throw new Error("Circle receipt has no verifiable token.");
    const token = object(
      (await request(settings, `/tokens/${transaction.tokenId}`)).token,
    );
    if (
      token.id !== transaction.tokenId ||
      token.blockchain !== NETWORK ||
      token.tokenAddress !== USDC ||
      token.decimals !== 6 ||
      token.isNative !== false ||
      token.symbol !== "USDC"
    )
      throw new Error(
        "Circle receipt does not use canonical Arc testnet USDC.",
      );
    return { status: "complete", transactionHash };
  }
  if (["FAILED", "CANCELLED", "DENIED"].includes(String(transaction.state)))
    return { status: "failed", transactionHash };
  return { status: "pending", transactionHash };
}
