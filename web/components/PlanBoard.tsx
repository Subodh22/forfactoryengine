"use client";
import { Bot, Hand } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDescendants } from "@/lib/data";
import type { Job } from "@/lib/types";

// Same status columns as the main KanbanBoard, scoped to one plan's tasks.
const COLUMNS = [
  { key: "pending", label: "To Do", dot: "#6b675f" },
  { key: "queued", label: "Queued", dot: "#b8860b" },
  { key: "running", label: "In Progress", dot: "#1f7a3d" },
  { key: "waiting_for_input", label: "Needs Reply", dot: "#d97706" },
  { key: "completed", label: "Done", dot: "#1f7a3d" },
  { key: "failed", label: "Failed", dot: "#d6210f" },
] as const;

export function PlanBoard({ epicId }: { epicId: string }) {
  const tasks = useDescendants(epicId);

  const byStatus = Object.fromEntries(
    COLUMNS.map((col) => [
      col.key,
      tasks.filter((t) =>
        col.key === "running" ? t.status === "running" || t.status === "delegating" : t.status === col.key,
      ),
    ]),
  ) as Record<string, Job[]>;

  return (
    <div className="w-full border-4 border-ink bg-concrete overflow-hidden flex flex-col brutal-shadow min-h-[40vh]">
      <div className="flex-1 flex overflow-x-auto">
        {COLUMNS.map((col, i) => {
          const colJobs = byStatus[col.key] ?? [];
          return (
            <div
              key={col.key}
              className={`flex-shrink-0 w-[70vw] sm:flex-1 sm:w-auto sm:min-w-[160px] flex flex-col ${i < COLUMNS.length - 1 ? "border-r-4 border-ink" : ""}`}
            >
              <div className="flex items-center justify-between px-3 py-2.5 border-b-4 border-ink bg-ink text-concrete">
                <span className="font-display uppercase text-[11px] flex items-center gap-1.5">
                  <span className="w-2 h-2" style={{ backgroundColor: col.dot }} />
                  {col.label}
                </span>
                <span className="font-data text-[11px]">{String(colJobs.length).padStart(2, "0")}</span>
              </div>
              <ScrollArea className="flex-1">
                <div className="flex flex-col gap-2 p-2">
                  {colJobs.map((job) => (
                    <div key={job.id} className="border-2 border-ink bg-paper p-2 flex flex-col gap-1.5">
                      <span className={`font-mono text-[12px] leading-snug ${job.status === "completed" ? "line-through text-muted" : "text-ink"}`}>
                        {job.title || "Untitled task"}
                      </span>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted" title={job.assignee === "human" ? "You" : "Agent"}>
                          {job.assignee === "human" ? <Hand className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
                        </span>
                        <StatusBadge status={job.status} />
                      </div>
                    </div>
                  ))}
                  {colJobs.length === 0 && (
                    <div className="border-2 border-dashed border-ink/30 p-4 text-center font-data text-[9px] uppercase text-muted">
                      Empty
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          );
        })}
      </div>
    </div>
  );
}
