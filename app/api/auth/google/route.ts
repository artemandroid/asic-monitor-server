import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { buildSessionToken, setSessionCookie } from "@/app/lib/web-auth";
import { isEmailAllowed } from "@/app/lib/access-config";

type LoginBody = {
  idToken?: string;
  keepLoggedIn?: boolean;
};

type GoogleTokenInfo = {
  email?: string;
  email_verified?: "true" | "false";
  aud?: string;
  exp?: string;
};

export async function POST(request: NextRequest) {
  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.idToken) {
    return NextResponse.json({ error: "idToken is required" }, { status: 400 });
  }

  const verifyResp = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(body.idToken)}`,
    { cache: "no-store" },
  );
  if (!verifyResp.ok) {
    return NextResponse.json({ error: "Google token verification failed" }, { status: 401 });
  }
  const tokenInfo = (await verifyResp.json()) as GoogleTokenInfo;
  const email = (tokenInfo.email ?? "").trim().toLowerCase();
  if (!email || tokenInfo.email_verified !== "true") {
    return NextResponse.json({ error: "Google email is not verified" }, { status: 401 });
  }

  const expectedAud = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (expectedAud && tokenInfo.aud !== expectedAud) {
    return NextResponse.json({ error: "Google token audience mismatch" }, { status: 401 });
  }

  if (!isEmailAllowed(email)) {
    return NextResponse.json({ error: "Email is not allowed" }, { status: 403 });
  }

  const keepLoggedIn = body.keepLoggedIn !== false;
  const { token, expiresAt } = buildSessionToken(email, keepLoggedIn);
  const response = NextResponse.json({ ok: true, email, expiresAt });
  setSessionCookie(response, token, expiresAt);
  return response;
}
