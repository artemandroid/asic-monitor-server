import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isEmailAllowed } from "@/app/lib/access-config";

const SESSION_COOKIE = "mc_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const PERSIST_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type SessionPayload = {
  email: string;
  exp: number;
};

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function getSessionSecret(): string {
  return process.env.AUTH_SESSION_SECRET || process.env.AGENT_TOKEN || "dev-session-secret";
}

function sign(content: string): string {
  return createHmac("sha256", getSessionSecret()).update(content, "utf8").digest("base64url");
}

function verify(content: string, providedSig: string): boolean {
  const expected = sign(content);
  const a = Buffer.from(expected);
  const b = Buffer.from(providedSig);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function buildSessionToken(email: string, keepLoggedIn: boolean): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + (keepLoggedIn ? PERSIST_TTL_MS : SESSION_TTL_MS);
  const payload: SessionPayload = { email: email.toLowerCase(), exp: expiresAt };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const sig = sign(encoded);
  return { token: `${encoded}.${sig}`, expiresAt };
}

export function parseSessionToken(token: string): SessionPayload | null {
  const [encoded, sig] = token.split(".");
  if (!encoded || !sig) return null;
  if (!verify(encoded, sig)) return null;
  try {
    const parsed = JSON.parse(base64UrlDecode(encoded)) as SessionPayload;
    if (!parsed?.email || typeof parsed.exp !== "number") return null;
    if (Date.now() >= parsed.exp) return null;
    if (!isEmailAllowed(parsed.email)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setSessionCookie(response: NextResponse, token: string, expiresAt: number) {
  const maxAgeSec = Math.max(1, Math.floor((expiresAt - Date.now()) / 1000));
  response.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSec,
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export function getSessionEmail(request: NextRequest): string | null {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = parseSessionToken(token);
  return payload?.email ?? null;
}

export function getSession(request: NextRequest): SessionPayload | null {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return parseSessionToken(token);
}

export function requireWebAuth(request: NextRequest): { email: string } | NextResponse {
  const email = getSessionEmail(request);
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return { email };
}
