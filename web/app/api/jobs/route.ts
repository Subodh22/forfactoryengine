import { NextRequest, NextResponse } from "next/server";
import { listJobs, createJob } from "@/lib/turso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { return NextResponse.json(await listJobs()); }
  catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const projectId = String(b.projectId ?? "").trim();
    const prompt = String(b.prompt ?? "").trim();
    if (!projectId || !prompt) return NextResponse.json({ error: "projectId and prompt required" }, { status: 400 });
    // Written as "pending" — the engine on your Mac syncs it down and runs it.
    const j = await createJob({ projectId, prompt });
    return NextResponse.json(j, { status: 201 });
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}
