"use client";
import type { Project } from "@/lib/types";

// Horizontal project switcher shown above the dashboard board. "All projects"
// scopes the board to every repo; each project tab scopes to one. The active
// tab gets a bright label + an accent underline so it's obvious which project
// you're working in.
export function ProjectTabs({
  projects,
  activeProject,
  onSelectProject,
}: {
  projects: Project[];
  activeProject: string | null;
  onSelectProject: (id: string | null) => void;
}) {
  return (
    <div className="flex items-end gap-1 border-b border-[#332f28] overflow-x-auto flex-shrink-0">
      <Tab
        label="All projects"
        active={activeProject === null}
        onClick={() => onSelectProject(null)}
      />
      {projects.map((p) => (
        <Tab
          key={p.id}
          label={p.name}
          color={p.color || "#b08a3e"}
          active={activeProject === p.id}
          onClick={() => onSelectProject(p.id)}
        />
      ))}
    </div>
  );
}

function Tab({
  label,
  color,
  active,
  onClick,
}: {
  label: string;
  color?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative flex items-center gap-2 px-3 py-2 text-[13px] whitespace-nowrap transition-colors ${
        active ? "text-ink" : "text-muted hover:text-ink"
      }`}
    >
      {color && (
        <span className="w-2 h-2 rounded-[3px] flex-shrink-0" style={{ backgroundColor: color }} />
      )}
      <span>{label}</span>
      {active && <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-[#b08a3e]" />}
    </button>
  );
}
