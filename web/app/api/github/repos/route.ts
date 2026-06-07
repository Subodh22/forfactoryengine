import { NextResponse } from "next/server";
import { listRepos } from "@/lib/github";
import { getSetting } from "@/lib/turso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const token = await getSetting("githubToken");
    if (!token) return NextResponse.json({ error: "not connected" }, { status: 400 });
    return NextResponse.json(await listRepos(token));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
