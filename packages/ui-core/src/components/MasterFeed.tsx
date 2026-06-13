import { useState } from "react";
import { Plus, ChevronRight, ChevronDown } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDistanceToNow } from "./time";
import { useJobs, useProjects } from "@/lib/data";

interface Props {
  projectId?: string;
  onSelectJob: (id: string) => void;
  onAddJob?: (projectId: string) => void;
}

export function MasterFeed({ projectId, onSelectJob, onAddJob }: Props) {
  const allJobs = useJobs(projectId);
  const projects = useProjects();
  const projectMap = Object.fromEntries(projects.map((p) => [p.id, p]));

  const jobs = allJobs.filter((j) => !j.parentJobId);
  const sorted = [...jobs].sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);

  const runningCount = allJobs.filter((j) => j.status === "running").length;
  const pendingCount = allJobs.filter((j) => j.status === "queued" || j.status === "pending").length;
  const doneCount = allJobs.filter((j) => j.status === "completed").length;

  // Group jobs by project when no project filter is active
  const grouped = !projectId
    ? projects.map((p) => ({
        project: p,
        jobs: sorted.filter((j) => j.projectId === p.id),
      }))
    : null;

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (pid: string) => setCollapsed((s) => ({ ...s, [pid]: !s[pid] }));

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-4 border-b-4 border-ink">
        <div className="font-display uppercase text-[13px] tracking-[.5px] mb-3">
          {projectId ? "Project Jobs" : "All Jobs"}
        </div>
        <div className="flex gap-5">
          <span className="flex flex-col">
            <b className="font-display text-2xl leading-none">{runningCount}</b>
            <small className="font-data text-[9px] uppercase tracking-[1px] text-muted mt-1">running</small>
          </span>
          <span className="flex flex-col">
            <b className="font-display text-2xl leading-none">{pendingCount}</b>
            <small className="font-data text-[9px] uppercase tracking-[1px] text-muted mt-1">queued</small>
          </span>
          <span className="flex flex-col">
            <b className="font-display text-2xl leading-none">{doneCount}</b>
            <small className="font-data text-[9px] uppercase tracking-[1px] text-muted mt-1">done</small>
          </span>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div>
          {grouped ? (
            grouped.map(({ project: p, jobs: pJobs }) => (
              <div key={p.id}>
                <div className="flex items-center justify-between px-5 py-2.5 border-b-2 border-ink bg-concrete-2">
                  <button onClick={() => toggle(p.id)} className="flex items-center gap-1.5 min-w-0 flex-1">
                    {collapsed[p.id] ? <ChevronRight className="w-3 h-3 flex-shrink-0" /> : <ChevronDown className="w-3 h-3 flex-shrink-0" />}
                    <span className="w-[7px] h-[7px] flex-shrink-0" style={{ backgroundColor: p.color || "#d6210f" }} />
                    <span className="font-data text-[11px] uppercase font-bold truncate">{p.name}</span>
                    <span className="font-data text-[9px] text-muted ml-1">{pJobs.length}</span>
                  </button>
                  {onAddJob && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onAddJob(p.id); }}
                      className="flex-shrink-0 hover:opacity-60 transition-opacity p-0.5"
                      title={`Add job to ${p.name}`}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {!collapsed[p.id] && pJobs.map((job) => (
                  <button
                    key={job.id}
                    className="w-full text-left px-5 pl-8 py-3 border-b-2 border-ink hover:bg-paper hover:translate-x-[3px] transition-all group"
                    onClick={() => onSelectJob(job.id)}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <h4 className="text-[12px] uppercase font-bold leading-[1.25] truncate min-w-0 flex-1">{job.title}</h4>
                    </div>
                    <div className="flex items-center gap-2 font-data text-[10px] text-muted">
                      {job.kind === "epic" && <span className="border border-ink px-1 uppercase bg-[#e0a32e]/25 text-ink">Epic</span>}
                      <StatusBadge status={job.status} />
                      <span>{formatDistanceToNow(job.createdAt)}</span>
                      {job.status === "running" && job.startedAt > 0 && (
                        <span className="text-ink font-bold">{Math.round((Date.now() - job.startedAt) / 1000)}s</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            ))
          ) : (
            <>
              {projectId && onAddJob && (
                <div className="flex items-center justify-between px-5 py-2.5 border-b-2 border-ink bg-concrete-2">
                  <span className="font-data text-[11px] uppercase font-bold">Jobs</span>
                  <button
                    onClick={() => onAddJob(projectId)}
                    className="flex-shrink-0 hover:opacity-60 transition-opacity p-0.5"
                    title="Add job"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              {sorted.map((job) => {
                const project = projectMap[job.projectId];
                return (
                  <button
                    key={job.id}
                    className="w-full text-left px-5 py-3.5 border-b-2 border-ink hover:bg-paper hover:translate-x-[3px] transition-all group"
                    onClick={() => onSelectJob(job.id)}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <h4 className="text-[13px] uppercase font-bold leading-[1.25] truncate min-w-0 flex-1">{job.title}</h4>
                    </div>
                    <div className="flex items-center gap-2 font-data text-[10px] text-muted">
                      {job.kind === "epic" && <span className="border border-ink px-1 uppercase bg-[#e0a32e]/25 text-ink">Epic</span>}
                      <StatusBadge status={job.status} />
                      {!projectId && project && <span className="border border-ink px-1.5 uppercase">{project.name}</span>}
                      <span>{formatDistanceToNow(job.createdAt)}</span>
                      {job.status === "running" && job.startedAt > 0 && (
                        <span className="text-ink font-bold">{Math.round((Date.now() - job.startedAt) / 1000)}s</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </>
          )}
          {sorted.length === 0 && (
            <div className="m-5 border-[3px] border-ink bg-paper p-4">
              <p className="font-data text-[11px] leading-[1.5] uppercase">No jobs yet — create one from the New Job tab.</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
