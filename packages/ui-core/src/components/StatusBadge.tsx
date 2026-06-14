"use client";
import { cn } from "@/lib/utils";

// Brutalist signage tags — square, uppercase Space Mono, hard ink edges.
const config = {
  pending: { label: "Pending", className: "border-[#332f28] text-ink/60" },
  queued: { label: "Queued", className: "border-[#332f28] text-ink/60" },
  running: { label: "Running", className: "bg-ink text-concrete border-[#332f28] animate-pulse" },
  completed: { label: "Done", className: "border-[#332f28] text-ink/60" },
  failed: { label: "Failed", className: "border-[#332f28] text-ink/60" },
  cancelled: { label: "Cancelled", className: "border-[#332f28] text-muted" },
  waiting_for_input: { label: "Needs Reply", className: "bg-ink text-concrete border-[#332f28] animate-pulse" },
  clarifying: { label: "Clarifying", className: "bg-ink text-concrete border-[#332f28] animate-pulse" },
  plan_review: { label: "Review Plan", className: "border-[#332f28] text-ink/60" },
  delegating: { label: "Delegating", className: "bg-ink text-concrete border-[#332f28] animate-pulse" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = config[status as keyof typeof config] ?? config.pending;
  return (
    <span className={cn("inline-flex items-center font-data text-[10px] uppercase tracking-wide border px-1.5 leading-[1.4]", s.className)}>
      {s.label}
    </span>
  );
}
