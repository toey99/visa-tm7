// Signed public links for pictures the LINE bot has to post (LINE fetches
// image messages itself, with no sign-in). The token is the blob path plus an
// HMAC, so nothing is stored and a link cannot be forged or guessed; it only
// ever points at files under a board's out/ folder.
import { createHmac, timingSafeEqual } from "node:crypto";

function key(): string {
  const k = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || process.env.LINE_CHANNEL_SECRET;
  if (!k) throw new Error("Server is missing AUTH_SECRET");
  return k;
}
const b64u = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

export const PUB_PATH = /^(?:(?:days|run)\/\d{8}\/[A-Z][A-Z0-9_]+|ledger\/[A-Z]+)\/out\/[A-Za-z0-9_.-]+\.(?:png|jpg|jpeg)$/;

export function signPath(path: string): string {
  if (!PUB_PATH.test(path)) throw new Error("not a publishable path");
  const p = b64u(Buffer.from(path, "utf8"));
  const sig = b64u(createHmac("sha256", key()).update(p).digest()).slice(0, 32);
  return `${p}.${sig}`;
}

export function verifyToken(token: string): string | null {
  const [p, sig] = token.split(".");
  if (!p || !sig) return null;
  const want = b64u(createHmac("sha256", key()).update(p).digest()).slice(0, 32);
  if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  const path = unb64u(p).toString("utf8");
  return PUB_PATH.test(path) ? path : null;
}
