import { cookies, headers } from "next/headers";
import { getChatGPTUser } from "@/app/chatgpt-auth";

export async function session() {
  const user = await getChatGPTUser();
  const jar = await cookies();
  let nonce = jar.get("steward-session")?.value;
  if (!nonce || !/^[0-9a-f-]{36}$/.test(nonce)) nonce = crypto.randomUUID();
  const mode =
    jar.get("steward-mode")?.value === "pilot" && user ? "pilot" : "demo";
  const base = user ? `user:${user.userId}` : `demo:${nonce}`;
  const ownerAuthorized =
    !!user &&
    !!process.env.STEWARD_OWNER_ID &&
    user.userId === process.env.STEWARD_OWNER_ID;
  return { user, nonce, mode, base, id: `${base}:${mode}`, ownerAuthorized };
}
export async function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") || new URL(request.url).host;
  if (origin && new URL(origin).host !== host)
    throw new Error("Cross-origin write rejected.");
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new Error("Use application/json.");
}
