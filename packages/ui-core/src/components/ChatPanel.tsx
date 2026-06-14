"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import {
  Plus, Monitor, MessageSquare, ListTree, Send,
  Sparkles, Zap, ChevronDown,
} from "lucide-react";
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

const MODELS = [
  { value: "", label: "Default" },
  { value: "claude-opus-4-6", label: "Opus 4.6" },
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { value: "claude-sonnet-4-5-20250514", label: "Sonnet 4.5" },
  { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
  { value: "opus", label: "Opus (latest)" },
  { value: "sonnet", label: "Sonnet (latest)" },
  { value: "haiku", label: "Haiku (latest)" },
];

const EFFORTS = [
  { value: "", label: "Default" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "max", label: "Max" },
];

export function ChatPanel({ projectId, onJobCreated }: Props) {
  const [mode, setMode] = useState<"describe" | "plan">("describe");
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [autoRun, setAutoRun] = useState(true);
  const [delegate, setDelegate] = useState(false);
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [loading, setLoading] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showEffortMenu, setShowEffortMenu] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const effortMenuRef = useRef<HTMLDivElement>(null);
  const { addJob } = useFactory();
  const _project = useProject(projectId);

  const modelLabel = MODELS.find((m) => m.value === model)?.label ?? "Default";
  const effortLabel = EFFORTS.find((e) => e.value === effort)?.label ?? "Default";

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [prompt]);

  // Close menus on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) setShowModelMenu(false);
      if (effortMenuRef.current && !effortMenuRef.current.contains(e.target as Node)) setShowEffortMenu(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

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

  if (mode === "plan") {
    return (
      <div>
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => setMode("describe")}
            className="font-data text-[11px] px-2.5 py-1 flex items-center gap-1.5 rounded-md transition-colors text-muted hover:text-ink hover:bg-concrete-2"
          >
            <MessageSquare className="w-3 h-3" /> Chat
          </button>
          <button
            className="font-data text-[11px] px-2.5 py-1 flex items-center gap-1.5 rounded-md bg-concrete-2 text-ink"
          >
            <ListTree className="w-3 h-3" /> Plan
          </button>
        </div>
        <PlanBuilder projectId={projectId} />
      </div>
    );
  }

  return (
    <div ref={dropRef} onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      {/* Main chat input container */}
      <div className="rounded-xl border border-[rgba(255,255,255,0.09)] bg-paper brutal-shadow overflow-hidden">
        {/* Attachment previews above input */}
        {attachments.length > 0 && (
          <div className="flex gap-2 flex-wrap px-4 pt-3">
            {attachments.map((src, i) => (
              <AttachmentPreview
                key={i}
                src={src}
                size={48}
                onRemove={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
              />
            ))}
          </div>
        )}

        {/* Textarea */}
        <div className="px-4 pt-3 pb-2">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            rows={1}
            placeholder="Ask to make changes, @mention files, run /commands"
            className="w-full resize-none bg-transparent font-mono text-[13px] text-ink leading-[1.6] placeholder:text-muted/60 focus:outline-none min-h-[24px]"
          />
        </div>

        {/* Bottom toolbar */}
        <div className="flex items-center justify-between px-3 py-2 border-t border-[rgba(255,255,255,0.06)]">
          <div className="flex items-center gap-1">
            {/* Model selector */}
            <div className="relative" ref={modelMenuRef}>
              <button
                onClick={() => { setShowModelMenu((v) => !v); setShowEffortMenu(false); }}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md font-data text-[11px] text-muted hover:text-ink hover:bg-concrete-2 transition-colors"
              >
                <span className={`w-[6px] h-[6px] rounded-full ${model ? "bg-[#4ade80]" : "bg-muted/50"}`} />
                {modelLabel}
                <ChevronDown className="w-3 h-3 opacity-50" />
              </button>
              {showModelMenu && (
                <div className="absolute bottom-full mb-1 left-0 min-w-[160px] rounded-lg border border-[rgba(255,255,255,0.09)] bg-paper shadow-lg z-30 py-1">
                  {MODELS.map((m) => (
                    <button
                      key={m.value}
                      onClick={() => { setModel(m.value); setShowModelMenu(false); }}
                      className={`w-full text-left px-3 py-1.5 font-data text-[11px] transition-colors ${model === m.value ? "text-ink bg-concrete-2" : "text-muted hover:text-ink hover:bg-concrete-2"}`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Delegate toggle */}
            <button
              onClick={() => setDelegate((v) => !v)}
              title="Delegate: plan and split into parallel sub-agents"
              className={`flex items-center gap-1 px-2 py-1 rounded-md font-data text-[11px] transition-colors ${delegate ? "text-[#e0bd63] bg-[#e0bd63]/10" : "text-muted hover:text-ink hover:bg-concrete-2"}`}
            >
              <Sparkles className="w-3 h-3" />
            </button>

            {/* Effort selector */}
            <div className="relative" ref={effortMenuRef}>
              <button
                onClick={() => { setShowEffortMenu((v) => !v); setShowModelMenu(false); }}
                className="flex items-center gap-1 px-2 py-1 rounded-md font-data text-[11px] text-muted hover:text-ink hover:bg-concrete-2 transition-colors"
              >
                <Zap className="w-3 h-3" />
                {effortLabel}
              </button>
              {showEffortMenu && (
                <div className="absolute bottom-full mb-1 left-0 min-w-[120px] rounded-lg border border-[rgba(255,255,255,0.09)] bg-paper shadow-lg z-30 py-1">
                  {EFFORTS.map((e) => (
                    <button
                      key={e.value}
                      onClick={() => { setEffort(e.value); setShowEffortMenu(false); }}
                      className={`w-full text-left px-3 py-1.5 font-data text-[11px] transition-colors ${effort === e.value ? "text-ink bg-concrete-2" : "text-muted hover:text-ink hover:bg-concrete-2"}`}
                    >
                      {e.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Plan mode toggle */}
            <button
              onClick={() => setMode("plan")}
              title="Plan it yourself"
              className="flex items-center gap-1 px-2 py-1 rounded-md font-data text-[11px] text-muted hover:text-ink hover:bg-concrete-2 transition-colors"
            >
              <ListTree className="w-3 h-3" />
            </button>

            {/* Separator */}
            <div className="w-px h-4 bg-[rgba(255,255,255,0.08)] mx-0.5" />

            {/* Attach file */}
            <button
              onClick={() => fileRef.current?.click()}
              title="Attach files"
              className="flex items-center gap-1 px-2 py-1 rounded-md text-muted hover:text-ink hover:bg-concrete-2 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => e.target.files && addFiles(e.target.files)} />

            {/* Screenshot */}
            <button
              onClick={captureScreen}
              title="Screenshot"
              className="flex items-center gap-1 px-2 py-1 rounded-md text-muted hover:text-ink hover:bg-concrete-2 transition-colors"
            >
              <Monitor className="w-3.5 h-3.5" />
            </button>

          </div>

          {/* Send button */}
          <button
            onClick={submit}
            disabled={!prompt.trim() || loading}
            className="flex items-center justify-center w-7 h-7 rounded-lg bg-ink text-concrete transition-all hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Auto-run indicator */}
      <div className="flex items-center justify-between mt-2 px-1">
        <button
          onClick={() => setAutoRun((v) => !v)}
          className={`font-data text-[10px] flex items-center gap-1.5 transition-colors ${autoRun ? "text-[#4ade80]/80" : "text-muted/60"}`}
        >
          <span className={`w-[5px] h-[5px] rounded-full ${autoRun ? "bg-[#4ade80]" : "bg-muted/40"}`} />
          Auto-run {autoRun ? "on" : "off"}
        </button>
        <span className="font-data text-[10px] text-muted/40">
          {delegate ? "Delegate mode" : "Cmd+Enter to send"}
        </span>
      </div>
    </div>
  );
}
