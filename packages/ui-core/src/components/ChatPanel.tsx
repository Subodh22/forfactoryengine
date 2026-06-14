"use client";
import { useState, useRef, useCallback } from "react";
import { Paperclip, Send, Plus, Camera, ListTree, ChevronDown } from "lucide-react";
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

const MODEL_LABELS: Record<string, string> = {
  "": "Default",
  "claude-opus-4-6": "Opus 4.6",
  "claude-sonnet-4-6": "Sonnet 4.6",
  "claude-sonnet-4-5-20250514": "Sonnet 4.5",
  "claude-haiku-4-5-20251001": "Haiku 4.5",
  "opus": "Opus (latest)",
  "sonnet": "Sonnet (latest)",
  "haiku": "Haiku (latest)",
};

const EFFORT_LABELS: Record<string, string> = {
  "": "Default",
  "low": "Low",
  "medium": "Medium",
  "high": "High",
  "max": "Max",
};

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
        <button
          onClick={() => setMode("describe")}
          className="font-data text-[11px] px-3 py-1.5 mb-3 flex items-center gap-1.5 text-muted hover:text-ink transition-colors"
        >
          ← Back to chat
        </button>
        <PlanBuilder projectId={projectId} />
      </div>
    );
  }

  return (
    <div ref={dropRef} onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      <div className="rounded-xl border border-[rgba(255,255,255,0.12)] bg-[#1e1b16] shadow-[0_4px_24px_rgba(0,0,0,0.5)] overflow-hidden">
        {/* Attachments preview */}
        {attachments.length > 0 && (
          <div className="flex gap-2 flex-wrap px-4 pt-3">
            {attachments.map((src, i) => <AttachmentPreview key={i} src={src} size={48} onRemove={() => setAttachments((prev) => prev.filter((_, j) => j !== i))} />)}
          </div>
        )}

        {/* Input area */}
        <div className="px-4 pt-3 pb-2">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            rows={3}
            placeholder="Ask to make changes, attach files, ⌘+Enter to send"
            className="w-full bg-transparent resize-none font-mono text-[13px] text-ink leading-[1.6] placeholder:text-[#6b6559] focus:outline-none"
          />
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between px-3 pb-3 pt-1">
          {/* Left: model, effort, toggles */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Model selector */}
            <div className="relative">
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="appearance-none font-data text-[11px] bg-[#2a2620] text-[#c4bfb4] border border-[rgba(255,255,255,0.08)] rounded-lg pl-2.5 pr-6 py-1.5 focus:outline-none cursor-pointer hover:bg-[#33302a] transition-colors"
              >
                {Object.entries(MODEL_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
              <ChevronDown className="w-3 h-3 text-[#6b6559] absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            {/* Effort selector */}
            <div className="relative">
              <select
                value={effort}
                onChange={(e) => setEffort(e.target.value)}
                className="appearance-none font-data text-[11px] bg-[#2a2620] text-[#c4bfb4] border border-[rgba(255,255,255,0.08)] rounded-lg pl-2.5 pr-6 py-1.5 focus:outline-none cursor-pointer hover:bg-[#33302a] transition-colors"
              >
                {Object.entries(EFFORT_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
              <ChevronDown className="w-3 h-3 text-[#6b6559] absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            {/* Delegate toggle */}
            <button
              className={`font-data text-[11px] px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 select-none transition-colors border ${delegate ? "bg-[#3d3520] text-[#e0bd63] border-[#e0bd63]/30" : "bg-[#2a2620] text-[#6b6559] border-[rgba(255,255,255,0.08)] hover:bg-[#33302a] hover:text-[#9a9388]"}`}
              onClick={() => setDelegate((v) => !v)}
              title="Delegate: plan and split into parallel sub-agents"
            >
              <ListTree className="w-3 h-3" />
              Delegate
            </button>

            {/* Auto-run toggle */}
            <button
              className={`font-data text-[11px] px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 select-none transition-colors border ${delegate ? "opacity-40 pointer-events-none" : ""} ${autoRun ? "bg-[#1e3325] text-[#4ade80] border-[#4ade80]/30" : "bg-[#2a2620] text-[#6b6559] border-[rgba(255,255,255,0.08)] hover:bg-[#33302a] hover:text-[#9a9388]"}`}
              onClick={() => setAutoRun((v) => !v)}
              title="Auto-run: start immediately"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${autoRun ? "bg-[#4ade80]" : "bg-[#6b6559]"}`} />
              Auto
            </button>
          </div>

          {/* Right: action buttons */}
          <div className="flex items-center gap-1">
            <button
              className="p-2 rounded-lg text-[#6b6559] hover:text-[#c4bfb4] hover:bg-[#2a2620] transition-colors"
              onClick={() => fileRef.current?.click()}
              title="Attach files"
            >
              <Paperclip className="w-4 h-4" />
            </button>
            <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => e.target.files && addFiles(e.target.files)} />
            <button
              className="p-2 rounded-lg text-[#6b6559] hover:text-[#c4bfb4] hover:bg-[#2a2620] transition-colors"
              onClick={captureScreen}
              title="Screenshot"
            >
              <Camera className="w-4 h-4" />
            </button>
            <button
              className="p-2 rounded-lg text-[#6b6559] hover:text-[#c4bfb4] hover:bg-[#2a2620] transition-colors"
              onClick={() => setMode("plan")}
              title="Plan mode"
            >
              <Plus className="w-4 h-4" />
            </button>

            {/* Submit */}
            <button
              onClick={submit}
              disabled={!prompt.trim() || loading}
              className="ml-1 p-2 rounded-lg bg-ink text-concrete hover:bg-[#f0ebe2] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Send (⌘+Enter)"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
