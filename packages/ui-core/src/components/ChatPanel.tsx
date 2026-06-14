"use client";
import { useState, useRef, useCallback } from "react";
import { Paperclip, Play, MessageSquare, ListTree } from "lucide-react";
import { toast } from "sonner";
import { AttachmentPreview } from "@/components/AttachmentPreview";
import { PlanBuilder } from "@/components/PlanBuilder";
import { useFactory, useProject } from "@/lib/data";
import { createJob } from "@/lib/mutations";
import { uploadFiles } from "@/lib/api";

interface Props {
  projectId: string;
  onJobCreated?: (id: string) => void;
}

export function ChatPanel({ projectId, onJobCreated }: Props) {
  const [mode, setMode] = useState<"describe" | "plan">("describe");
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [autoRun, setAutoRun] = useState(true);
  const [delegate, setDelegate] = useState(false);
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const { addJob } = useFactory();
  const project = useProject(projectId);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const { images, skipped } = await uploadFiles(files);
    setAttachments((prev) => [...prev, ...images]);
    if (skipped.length) toast.error(`Too large to attach: ${skipped.join(", ")}`);
  }, []);


  function onPaste(e: React.ClipboardEvent) {
    const files = Array.from(e.clipboardData.files);
    if (files.length) addFiles(files);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length) addFiles(files);
  }

  async function submit() {
    if (!prompt.trim()) return;
    setLoading(true);
    try {
      const title = prompt.slice(0, 80).trim();
      const job = await createJob({
        projectId,
        title,
        prompt: prompt.trim(),
        images: attachments,
        kind: delegate ? "epic" : undefined,
        model: model || undefined,
        effort: effort || undefined,
        autoRun: autoRun || delegate,
      });
      addJob(job);
      toast.success(delegate ? "Epic queued — the engine will plan it" : autoRun ? "Queued — the engine will run it" : "Job created");
      onJobCreated?.(job.id);
      setPrompt("");
      setAttachments([]);
    } catch (err) {
      toast.error("Failed to create job");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
  }

  return (
    <div ref={dropRef} onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      <div className="flex gap-0 mb-3 border border-[#332f28] w-max">
        <button
          onClick={() => setMode("describe")}
          className={`font-data text-[11px] px-3 py-1.5 uppercase flex items-center gap-1.5 transition-colors ${mode === "describe" ? "bg-ink text-paper" : "bg-paper text-ink hover:bg-concrete"}`}
        >
          <MessageSquare className="w-3 h-3" /> Describe
        </button>
        <button
          onClick={() => setMode("plan")}
          className={`font-data text-[11px] px-3 py-1.5 uppercase flex items-center gap-1.5 transition-colors border-l border-[#332f28] ${mode === "plan" ? "bg-ink text-paper" : "bg-paper text-ink hover:bg-concrete"}`}
        >
          <ListTree className="w-3 h-3" /> Plan myself
        </button>
      </div>

      {mode === "plan" ? (
        <PlanBuilder projectId={projectId} />
      ) : (
      <div className="bg-paper border-2 border-[#332f28] brutal-shadow">
        <div className="p-6 pb-0">
          <div className="flex justify-between items-start mb-5">
            <b className="font-display uppercase text-[17px] tracking-wide">New Job — {project?.name ?? "…"}</b>
            <div className="flex items-center gap-2">
              <button
                className={`font-data text-[11px] px-2.5 py-1.5 uppercase flex items-center gap-1.5 select-none transition-colors ${delegate ? "bg-ink text-paper" : "bg-paper text-ink border border-[#332f28]"}`}
                onClick={() => setDelegate((v) => !v)}
                title="Delegate: plan the task and split it into parallel sub-agents, merged into one PR"
              >
                <span className={`w-[7px] h-[7px] ${delegate ? "bg-[#e0a32e]" : "bg-[#888]"}`} />
                Delegate {delegate ? "on" : "off"}
              </button>
              <button
                className={`font-data text-[11px] px-2.5 py-1.5 uppercase flex items-center gap-1.5 select-none transition-colors ${autoRun ? "bg-ink text-paper" : "bg-paper text-ink border border-[#332f28]"} ${delegate ? "opacity-40 pointer-events-none" : ""}`}
                onClick={() => setAutoRun((v) => !v)}
                title="Auto-run: start executing immediately after creating"
              >
                <span className={`w-[7px] h-[7px] ${autoRun ? "bg-[#3bd16f]" : "bg-[#888]"}`} />
                Auto-run {autoRun ? "on" : "off"}
              </button>
            </div>
          </div>

          {attachments.length > 0 && (
            <div className="flex gap-2 flex-wrap mb-4">
              {attachments.map((src, i) => <AttachmentPreview key={i} src={src} onRemove={() => setAttachments((prev) => prev.filter((_, j) => j !== i))} />)}
            </div>
          )}
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            autoFocus
            placeholder="Describe what you want to build or change..."
            className="w-full min-h-[220px] resize-y border-2 border-[#332f28] bg-concrete p-5 font-mono text-[14px] text-ink leading-[1.7] placeholder:text-muted/60 placeholder:text-[14px] focus:outline-none focus:bg-[#dfdcd4] focus:border-ink focus:shadow-[4px_4px_0_0_var(--ink)] transition-all"
          />
        </div>

        <div className="flex justify-between items-center px-6 py-4 mt-2">
          <div className="flex items-center gap-4">
            <button className="font-data text-[11px] uppercase flex items-center gap-1.5 text-ink/60 hover:text-ink transition-colors" onClick={() => fileRef.current?.click()}>
              <Paperclip className="w-4 h-4" />Attach
            </button>
            <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => e.target.files && addFiles(e.target.files)} />
            <span className="text-[1px]">|</span>
            <label className="font-data text-[11px] uppercase flex items-center gap-1.5 text-ink/60">
              Model
              <select value={model} onChange={(e) => setModel(e.target.value)} className="font-data text-[11px] uppercase bg-concrete border border-[#332f28] px-2 py-1 focus:outline-none cursor-pointer">
                <option value="">Default</option>
                <option value="claude-opus-4-6">Opus 4.6</option>
                <option value="claude-sonnet-4-6">Sonnet 4.6</option>
                <option value="claude-sonnet-4-5-20250514">Sonnet 4.5</option>
                <option value="claude-haiku-4-5-20251001">Haiku 4.5</option>
                <option value="opus">Opus (latest)</option>
                <option value="sonnet">Sonnet (latest)</option>
                <option value="haiku">Haiku (latest)</option>
              </select>
            </label>
            <label className="font-data text-[11px] uppercase flex items-center gap-1.5 text-ink/60">
              Effort
              <select value={effort} onChange={(e) => setEffort(e.target.value)} className="font-data text-[11px] uppercase bg-concrete border border-[#332f28] px-2 py-1 focus:outline-none cursor-pointer">
                <option value="">Default</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="max">Max</option>
              </select>
            </label>
          </div>
          <button onClick={submit} disabled={!prompt.trim() || loading} className="font-display uppercase text-[14px] bg-ink text-paper px-8 py-3.5 inline-flex items-center gap-2 brutal-press disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-none">
            {delegate ? "Delegate" : autoRun ? "Run" : "Queue"} <Play className="w-4 h-4" />
          </button>
        </div>
      </div>
      )}
      {mode === "describe" && (
        <p className="font-data text-[10px] text-muted mt-3 uppercase text-right tracking-wide">paste / drag-drop images · Cmd+Enter to send</p>
      )}
    </div>
  );
}
