import { useState, useRef, useCallback } from "react";
import { ChevronDown, ChevronRight, List, LayoutGrid, Paperclip, Plus, Monitor } from "lucide-react";
import { toast } from "sonner";
import { JobCard } from "./JobCard";
import { StatusBadge } from "./StatusBadge";
import { AttachmentPreview } from "./AttachmentPreview";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDistanceToNow } from "./time";
import { useJobs, useFactory } from "@/lib/data";
import { createJob } from "@/lib/mutations";
import { uploadFiles } from "@/lib/api";

const COLUMNS = [
  { key: "pending", label: "Backlog", dot: "#6b675f" },
  { key: "queued", label: "Queued", dot: "#b8860b" },
  { key: "running", label: "In Progress", dot: "#1f7a3d" },
  { key: "waiting_for_input", label: "Needs Reply", dot: "#d97706" },
  { key: "completed", label: "Done", dot: "#1f7a3d" },
  { key: "failed", label: "Failed", dot: "#d6210f" },
  { key: "cancelled", label: "Cancelled", dot: "#6b675f" },
] as const;

const LIST_GROUPS = [
  { key: "todo", label: "To Do", dot: "#6b675f", statuses: ["pending", "queued"] },
  { key: "active", label: "Active", dot: "#1f7a3d", statuses: ["running", "delegating", "waiting_for_input"] },
  { key: "done", label: "Done", dot: "#1f7a3d", statuses: ["completed"] },
  { key: "stopped", label: "Stopped", dot: "#d6210f", statuses: ["failed", "cancelled"] },
] as const;

interface Props {
  projectId?: string;
  onSelectJob: (id: string) => void;
}

function InlineJobCreate({ projectId, onCreated }: { projectId: string; onCreated?: (id: string) => void }) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const { addJob } = useFactory();

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const { images, skipped } = await uploadFiles(files);
    setAttachments((prev) => [...prev, ...images]);
    if (skipped.length) toast.error(`Too large to attach: ${skipped.join(", ")}`);
  }, []);

  const captureScreen = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = stream.getVideoTracks()[0];
      const video = document.createElement("video");
      video.srcObject = stream;
      await video.play();
      await new Promise((r) => requestAnimationFrame(r));
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d")!.drawImage(video, 0, 0);
      track.stop();
      setAttachments((prev) => [...prev, canvas.toDataURL("image/png")]);
    } catch { /* cancelled */ }
  }, []);

  function onPaste(e: React.ClipboardEvent) {
    const files = Array.from(e.clipboardData.files);
    if (files.length) { e.preventDefault(); addFiles(files); }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dropRef.current?.classList.remove("bg-paper");
    const files = Array.from(e.dataTransfer.files);
    if (files.length) addFiles(files);
  }

  async function submit() {
    if (!text.trim()) return;
    setLoading(true);
    try {
      const title = text.slice(0, 80).trim();
      const job = await createJob({
        projectId,
        title,
        prompt: text.trim(),
        images: attachments,
      });
      addJob(job);
      toast.success("Job created");
      onCreated?.(job.id);
      setText("");
      setAttachments([]);
    } catch (err) {
      toast.error("Failed to create job");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  }

  return (
    <div
      ref={dropRef}
      onDrop={onDrop}
      onDragOver={(e) => { e.preventDefault(); dropRef.current?.classList.add("bg-paper"); }}
      onDragLeave={() => dropRef.current?.classList.remove("bg-paper")}
      className="border-b-2 border-ink transition-colors"
    >
      {attachments.length > 0 && (
        <div className="flex gap-2 flex-wrap px-4 pt-2">
          {attachments.map((src, i) => (
            <AttachmentPreview key={i} src={src} size={40} onRemove={() => setAttachments((prev) => prev.filter((_, j) => j !== i))} />
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 px-4 py-2.5">
        <Plus className="w-3.5 h-3.5 text-muted flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder="Add a task… (paste images, Enter to create)"
          disabled={loading}
          className="flex-1 bg-transparent font-mono text-[13px] text-ink placeholder:text-muted focus:outline-none disabled:opacity-40"
        />
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            className="p-1 text-muted hover:text-ink transition-colors"
            onClick={() => fileRef.current?.click()}
            title="Attach files"
          >
            <Paperclip className="w-3.5 h-3.5" />
          </button>
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => e.target.files && addFiles(e.target.files)} />
          <button
            className="p-1 text-muted hover:text-ink transition-colors"
            onClick={captureScreen}
            title="Screenshot"
          >
            <Monitor className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ListView({ projectId, onSelectJob, allJobs, topLevel, childProgress }: {
  projectId?: string;
  onSelectJob: (id: string) => void;
  allJobs: ReturnType<typeof useJobs>;
  topLevel: ReturnType<typeof useJobs>;
  childProgress: Map<string, { done: number; total: number }>;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const byGroup = Object.fromEntries(
    LIST_GROUPS.map((g) => [
      g.key,
      topLevel.filter((j) => (g.statuses as readonly string[]).includes(j.status)),
    ]),
  );

  function toggleGroup(key: string) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <div className="w-full border-4 border-ink bg-concrete brutal-shadow">
      {LIST_GROUPS.map((group) => {
        const jobs = byGroup[group.key] ?? [];
        const isCollapsed = collapsed[group.key] ?? false;

        return (
          <div key={group.key} className="border-b-4 border-ink last:border-b-0">
            <button
              className="w-full flex items-center gap-2 px-4 py-3 bg-concrete hover:bg-paper transition-colors"
              onClick={() => toggleGroup(group.key)}
            >
              {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              <span className="w-2.5 h-2.5" style={{ backgroundColor: group.dot }} />
              <span className="font-display uppercase text-[13px]">{group.label}</span>
              <span className="font-data text-[12px] text-muted ml-1">{jobs.length}</span>
            </button>

            {!isCollapsed && (
              <div>
                {group.key === "todo" && projectId && (
                  <InlineJobCreate projectId={projectId} />
                )}
                {jobs.map((job) => (
                  <button
                    key={job.id}
                    className="w-full text-left px-4 py-3 border-b-2 border-ink last:border-b-0 hover:bg-paper transition-colors flex items-center gap-3 group"
                    onClick={() => onSelectJob(job.id)}
                  >
                    <StatusBadge status={job.status} />
                    <span className="text-[13px] font-bold uppercase leading-[1.25] truncate flex-1 min-w-0">{job.title}</span>
                    {job.kind === "epic" && (
                      <span className="font-data text-[9px] uppercase border border-ink px-1 bg-[#e0a32e]/25 text-ink flex-shrink-0">
                        Epic{childProgress.get(job.id) ? ` ${childProgress.get(job.id)!.done}/${childProgress.get(job.id)!.total}` : ""}
                      </span>
                    )}
                    {job.images.length > 0 && (
                      <span className="font-data text-[9px] uppercase text-muted flex-shrink-0">{job.images.length} img</span>
                    )}
                    <span className="font-data text-[10px] text-muted flex-shrink-0">{formatDistanceToNow(job.createdAt)}</span>
                  </button>
                ))}
                {jobs.length === 0 && group.key !== "todo" && (
                  <div className="px-4 py-4 text-center font-data text-[10px] uppercase text-muted">
                    No {group.label.toLowerCase()} jobs
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function KanbanBoard({ projectId, onSelectJob }: Props) {
  const [view, setView] = useState<"board" | "list">("list");
  const allJobs = useJobs(projectId);
  const topLevel = allJobs.filter((j) => !j.parentJobId);

  const childProgress = new Map<string, { done: number; total: number }>();
  for (const j of allJobs) {
    if (!j.parentJobId) continue;
    const p = childProgress.get(j.parentJobId) ?? { done: 0, total: 0 };
    p.total += 1;
    if (j.status === "completed") p.done += 1;
    childProgress.set(j.parentJobId, p);
  }

  const byStatus = Object.fromEntries(
    COLUMNS.map((col) => [
      col.key,
      topLevel.filter((j) =>
        col.key === "running" ? j.status === "running" || j.status === "delegating" : j.status === col.key,
      ),
    ]),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-0">
        <button
          className={`font-data text-[12px] uppercase px-3 py-1.5 border-2 border-ink flex items-center gap-1.5 transition-colors ${view === "list" ? "bg-ink text-concrete" : "bg-concrete text-ink hover:bg-paper"}`}
          onClick={() => setView("list")}
        >
          <List className="w-3.5 h-3.5" /> List
        </button>
        <button
          className={`font-data text-[12px] uppercase px-3 py-1.5 border-2 border-ink border-l-0 flex items-center gap-1.5 transition-colors ${view === "board" ? "bg-ink text-concrete" : "bg-concrete text-ink hover:bg-paper"}`}
          onClick={() => setView("board")}
        >
          <LayoutGrid className="w-3.5 h-3.5" /> Board
        </button>
      </div>

      {view === "list" ? (
        <ListView
          projectId={projectId}
          onSelectJob={onSelectJob}
          allJobs={allJobs}
          topLevel={topLevel}
          childProgress={childProgress}
        />
      ) : (
        <div className="w-full h-full border-4 border-ink bg-concrete overflow-hidden flex flex-col brutal-shadow">
          <div className="flex-1 flex overflow-x-auto">
            {COLUMNS.map((col, i) => {
              const colJobs = byStatus[col.key] ?? [];
              return (
                <div
                  key={col.key}
                  className={`flex-shrink-0 w-[80vw] sm:flex-1 sm:w-auto sm:min-w-[180px] flex flex-col ${i < COLUMNS.length - 1 ? "border-r-4 border-ink" : ""}`}
                >
                  <div className="flex items-center justify-between px-4 py-3.5 border-b-4 border-ink bg-ink text-concrete">
                    <span className="font-display uppercase text-[13px] flex items-center gap-2">
                      <span className="w-2 h-2" style={{ backgroundColor: col.dot }} />
                      {col.label}
                    </span>
                    <span className="font-data text-[12px]">{String(colJobs.length).padStart(2, "0")}</span>
                  </div>
                  <ScrollArea className="flex-1">
                    <div className="flex flex-col gap-3.5 p-3.5">
                      {colJobs.map((job) => (
                        <JobCard key={job.id} job={job} onSelect={onSelectJob} childProgress={childProgress.get(job.id)} />
                      ))}
                      {colJobs.length === 0 && (
                        <div className="border-2 border-dashed border-ink/40 p-6 text-center font-data text-[10px] uppercase text-muted">
                          No {col.label.toLowerCase()} jobs
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
