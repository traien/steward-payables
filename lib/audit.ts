import type { AuditEvent, Workspace } from "./domain";

const GENESIS = "0".repeat(64);
const HASH = /^[a-f0-9]{64}$/;

function canonicalEvent(event: Omit<AuditEvent, "hash">): string {
  const record = event as unknown as Record<string, unknown>;
  return JSON.stringify(
    Object.fromEntries(
      Object.keys(record)
        .sort()
        .filter((key) => record[key] !== undefined)
        .map((key) => [key, record[key]]),
    ),
  );
}

async function digest(event: Omit<AuditEvent, "hash">): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalEvent(event));
  const result = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(result), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Hash chaining detects edits relative to a trusted retained head; it is not an external anchor. */
export async function appendAudit(
  workspace: Workspace,
  type: string,
  title: string,
  detail: string,
  invoiceId?: string,
): Promise<void> {
  const event: Omit<AuditEvent, "hash"> = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    type,
    title,
    detail,
    ...(invoiceId === undefined ? {} : { invoiceId }),
    previousHash: workspace.audit.at(-1)?.hash ?? GENESIS,
  };
  workspace.audit.push({ ...event, hash: await digest(event) });
}

export async function verifyAudit(audit: AuditEvent[]): Promise<boolean> {
  if (!Array.isArray(audit)) return false;
  let previousHash = GENESIS;
  const ids = new Set<string>();
  for (const event of audit) {
    if (!event || typeof event !== "object") return false;
    const { hash, ...payload } = event;
    if (
      ![
        payload.id,
        payload.at,
        payload.type,
        payload.title,
        payload.detail,
        payload.previousHash,
      ].every((value) => typeof value === "string") ||
      !payload.id ||
      ids.has(payload.id) ||
      (payload.invoiceId !== undefined &&
        typeof payload.invoiceId !== "string") ||
      !Number.isFinite(Date.parse(payload.at)) ||
      !HASH.test(hash) ||
      payload.previousHash !== previousHash ||
      (await digest(payload)) !== hash
    )
      return false;
    ids.add(payload.id);
    previousHash = hash;
  }
  return true;
}
