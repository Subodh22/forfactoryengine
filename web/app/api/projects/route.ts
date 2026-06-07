import { NextRequest, NextResponse } from "next/server";
import { listProjects, createProject } from "@/lib/turso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { return NextResponse.json(await listProjects()); }
  catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const name = String(b.name ?? "").trim();
    const repo = String(b.repo ?? "").trim();
    if (!name || !repo) return NextResponse.json({ error: "name and repo (owner/name) required" }, { status: 400 });
    const p = await createProject({ name, repo, defaultBranch: String(b.defaultBranch ?? "main") });
    return NextResponse.json(p, { status: 201 });
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}
