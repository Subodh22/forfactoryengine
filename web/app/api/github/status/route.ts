import { NextResponse } from "next/server";
import { oauthConfigured } from "@/lib/github";
import { getSetting } from "@/lib/turso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const login = await getSetting("githubLogin");
    return NextResponse.json({ connected: Boolean(login), login: login ?? "", oauthConfigured });
  } catch {
    return NextResponse.json({ connected: false, login: "", oauthConfigured });
  }
}
