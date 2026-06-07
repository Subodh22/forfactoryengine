import { NextRequest, NextResponse } from "next/server";
import { originFromRequest, callbackUrl, exchangeCode, getUser } from "@/lib/github";
import { setSetting } from "@/lib/turso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const origin = originFromRequest(req);
  const code = req.nextUrl.searchParams.get("code") ?? "";
  const state = req.nextUrl.searchParams.get("state") ?? "";
  const cookieState = req.cookies.get("gh_state")?.value;

  if (!code || !state || state !== cookieState) {
    return NextResponse.redirect(`${origin}/?gh=error`);
  }
  try {
    const token = await exchangeCode(code, callbackUrl(origin));
    const { login } = await getUser(token);
    await setSetting("githubToken", token);
    await setSetting("githubLogin", login);
    const res = NextResponse.redirect(`${origin}/?gh=ok`);
    res.cookies.delete("gh_state");
    return res;
  } catch {
    return NextResponse.redirect(`${origin}/?gh=error`);
  }
}
