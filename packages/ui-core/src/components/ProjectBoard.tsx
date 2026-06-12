"use client";
import { useState } from "react";
import { LayoutGrid, List as ListIcon } from "lucide-react";
import { KanbanBoard } from "@/components/KanbanBoard";
import { JobListView } from "@/components/JobListView";
import { PushHelpBanner } from "@/components/PushHelpBanner";

// The main Board tab: a ClickUp-style List | Board toggle over the project's
// jobs. Board is the existing Kanban; List is a grouped, inline-editable list
// you can type new tasks straight into.
export function ProjectBoard({ projectId, onSelectJob }: { projectId?: string; onSelectJob: (id: string) => void }) {
  const [view, setView] = useState<"board" | "list">("board");

  return (
    <div className="h-full flex flex-col gap-3">
      <PushHelpBanner projectId={projectId} />
      <div className="flex border-2 border-ink w-max">
        <button
          onClick={() => setView("list")}
          className={`font-data text-[11px] px-3 py-1.5 uppercase flex items-center gap-1.5 transition-colors ${view === "list" ? "bg-ink text-paper" : "bg-paper text-ink hover:bg-concrete"}`}
        ><ListIcon className="w-3 h-3" /> List</button>
        <button
          onClick={() => setView("board")}
          className={`font-data text-[11px] px-3 py-1.5 uppercase flex items-center gap-1.5 border-l-2 border-ink transition-colors ${view === "board" ? "bg-ink text-paper" : "bg-paper text-ink hover:bg-concrete"}`}
        ><LayoutGrid className="w-3 h-3" /> Board</button>
      </div>

      <div className="flex-1 min-h-0">
        {view === "board"
          ? <KanbanBoard projectId={projectId} onSelectJob={onSelectJob} />
          : (projectId
            ? <JobListView projectId={projectId} onSelectJob={onSelectJob} />
            : <p className="font-data text-[10px] uppercase text-muted p-4">Select a project.</p>)}
      </div>
    </div>
  );
}
