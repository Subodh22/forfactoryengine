import { NextRequest, NextResponse } from "next/server";
import { oauthConfigured, originFromRequest, callbackUrl, authorizeUrl } from "@/lib/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!oauthConfigured) {
    return NextResponse.json({ error: "OAuth not configured — set GITHUB_CLIENT_ID/SECRET in Vercel env" }, { status: 400 });
  }
  const origin = originFromRequest(req);
  const state = crypto.randomUUID();
  const res = NextResponse.redirect(authorizeUrl(callbackUrl(origin), state));
  // State rides a short-lived cookie (serverless has no shared memory).
  res.cookies.set("gh_state", state, { httpOnly: true, secure: origin.startsWith("https"), sameSite: "lax", path: "/", maxAge: 600 });
  return res;
}
