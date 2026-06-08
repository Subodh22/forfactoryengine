"use client";
import { cn } from "@/lib/utils";

// Brutalist signage tags — square, uppercase Space Mono, hard ink edges.
const config = {
  pending: { label: "Pending", className: "border-ink text-ink" },
  queued: { label: "Queued", className: "border-ink text-ink" },
  running: { label: "Running", className: "bg-ink text-concrete border-ink animate-pulse" },
  completed: { label: "Done", className: "border-[#1f7a3d] text-[#1f7a3d]" },
  failed: { label: "Failed", className: "border-[#d6210f] text-[#d6210f]" },
  cancelled: { label: "Cancelled", className: "border-muted text-muted" },
  waiting_for_input: { label: "Needs Reply", className: "bg-ink text-concrete border-ink animate-pulse" },
  clarifying: { label: "Clarifying", className: "bg-ink text-concrete border-ink animate-pulse" },
  plan_review: { label: "Review Plan", className: "border-[#b8860b] text-[#b8860b]" },
  delegating: { label: "Delegating", className: "bg-ink text-concrete border-ink animate-pulse" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = config[status as keyof typeof config] ?? config.pending;
  return (
    <span className={cn("inline-flex items-center font-data text-[10px] uppercase tracking-wide border px-1.5 leading-[1.4]", s.className)}>
      {s.label}
    </span>
  );
}