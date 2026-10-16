import { env } from "cloudflare:workers";
import type { Workspace } from "./domain";

function database() {
  if (!env.DB) throw new Error("Persistent database is not connected.");
  return env.DB;
}
export async function readWorkspace(id: string): Promise<Workspace | null> {
  const row = await database()
    .prepare("SELECT payload FROM workspaces WHERE id = ?")
    .bind(id)
    .first<{ payload: string }>();
  return row ? JSON.parse(row.payload) : null;
}
export async function insertWorkspace(
  workspace: Workspace,
): Promise<Workspace> {
  await database()
    .prepare(
      "INSERT OR IGNORE INTO workspaces (id,payload,revision,lock_until) VALUES (?,?,0,0)",
    )
    .bind(workspace.id, JSON.stringify(workspace))
    .run();
  return (await readWorkspace(workspace.id))!;
}
export async function lockWorkspace(id: string): Promise<string> {
  const token = crypto.randomUUID();
  const now = Date.now();
  const result = await database()
    .prepare(
      "UPDATE workspaces SET lock_token=?,lock_until=? WHERE id=? AND lock_until < ?",
    )
    .bind(token, now + 300_000, id, now)
    .run();
  if (result.meta.changes !== 1)
    throw new Error(
      "Another operation is running. Wait for it to finish, then refresh.",
    );
  return token;
}
export async function saveWorkspace(
  workspace: Workspace,
  token: string,
): Promise<void> {
  const next = workspace.revision + 1;
  const now = Date.now();
  const result = await database()
    .prepare(
      "UPDATE workspaces SET payload=?,revision=?,lock_until=? WHERE id=? AND lock_token=? AND revision=? AND lock_until>?",
    )
    .bind(
      JSON.stringify({ ...workspace, revision: next }),
      next,
      now + 300_000,
      workspace.id,
      token,
      workspace.revision,
      now,
    )
    .run();
  if (result.meta.changes !== 1)
    throw new Error(
      "Workspace changed while processing. Refresh before continuing.",
    );
  workspace.revision = next;
}
export async function releaseWorkspace(
  id: string,
  token: string,
): Promise<void> {
  await database()
    .prepare(
      "UPDATE workspaces SET lock_token=NULL,lock_until=0 WHERE id=? AND lock_token=?",
    )
    .bind(id, token)
    .run();
}
