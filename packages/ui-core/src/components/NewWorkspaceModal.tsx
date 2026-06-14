"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { X, Paperclip, Monitor, ChevronDown, Play } from "lucide-react";
import { toast } from "sonner";
import { AttachmentPreview } from "@/components/AttachmentPreview";
import { useFactory, useProjects } from "@/lib/data";
import { createJob } from "@/lib/mutations";
import { uploadFiles } from "@/lib/api";

interface Props {
  projectId: string;
  onClose: () => void;
  onJobCreated?: (id: string) => void;
}

export function NewWorkspaceModal({ projectId, onClose, onJobCreated }: Props) {
  const projects = useProjects();
  const { addJob } = useFactory();
  const [selectedProjectId, setSelectedProjectId] = useState(projectId);
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [createMore, setCreateMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setShowProjectPicker(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
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

  async function submit() {
    if (!prompt.trim()) return;
    setLoading(true);
    try {
      const title = prompt.slice(0, 80).trim();
      const job = await createJob({
        projectId: selectedProjectId,
        title,
        prompt: prompt.trim(),
        images: attachments,
        model: model || undefined,
        effort: effort || undefined,
        autoRun: true,
      });
      addJob(job);
      toast.success("Queued — the engine will run it");
      onJobCreated?.(job.id);
      if (createMore) {
        setPrompt("");
        setAttachments([]);
        textareaRef.current?.focus();
      } else {
        onClose();
      }
    } catch (err) {
      toast.error("Failed to create job");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
    if (e.key === "Escape") onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center pt-[15vh] p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-paper border border-[#332f28] rounded-xl brutal-shadow w-full max-w-[560px]" onKeyDown={onKeyDown}>
        {/* Project selector row */}
        <div className="flex items-center gap-2 px-4 pt-4 pb-2">
          <div ref={pickerRef} className="relative">
            <button
              onClick={() => setShowProjectPicker((v) => !v)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-concrete border border-[#332f28] font-data text-[12px] text-ink hover:bg-concrete-2 transition-colors"
            >
              {selectedProject && <span className="w-2 h-2 rounded-[3px]" style={{ backgroundColor: selectedProject.color || "#b08a3e" }} />}
              {selectedProject?.name ?? "Select project"}
              <ChevronDown className="w-3 h-3 text-muted" />
            </button>
            {showProjectPicker && (
              <div className="absolute top-full left-0 mt-1 bg-paper border border-[#332f28] brutal-shadow-sm z-10 min-w-[200px] max-h-48 overflow-y-auto rounded-md">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => { setSelectedProjectId(p.id); setShowProjectPicker(false); }}
                    className={`w-full text-left px-3 py-2 flex items-center gap-2 text-[12px] font-data hover:bg-concrete-2 transition-colors ${p.id === selectedProjectId ? "bg-concrete-2 text-ink" : "text-muted"}`}
                  >
                    <span className="w-2 h-2 rounded-[3px]" style={{ backgroundColor: p.color || "#b08a3e" }} />
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex-1" />
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors p-1"><X className="w-4 h-4" /></button>
        </div>

        {/* Prompt input */}
        <div className="px-4 pb-2">
          {attachments.length > 0 && (
            <div className="flex gap-2 flex-wrap mb-2">
              {attachments.map((src, i) => <AttachmentPreview key={i} src={src} onRemove={() => setAttachments((prev) => prev.filter((_, j) => j !== i))} />)}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onPaste={onPaste}
            placeholder="What do you want to work on?"
            rows={2}
            className="w-full resize-none bg-transparent text-[14px] text-ink leading-[1.5] placeholder:text-muted focus:outline-none"
          />
        </div>

        {/* Bottom bar: controls + create */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-[#332f28]">
          <button onClick={() => fileRef.current?.click()} className="text-muted hover:text-ink transition-colors p-1" title="Attach files">
            <Paperclip className="w-4 h-4" />
          </button>
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => e.target.files && addFiles(e.target.files)} />
          <button onClick={captureScreen} className="text-muted hover:text-ink transition-colors p-1" title="Screenshot">
            <Monitor className="w-4 h-4" />
          </button>

          <span className="w-px h-4 bg-[#332f28] mx-1" />

          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="font-data text-[11px] uppercase bg-concrete border border-[#332f28] px-2 py-1 rounded-md focus:outline-none cursor-pointer text-ink"
            title="Model"
          >
            <option value="">Opus (latest)</option>
            <option value="claude-opus-4-6">Opus 4.6</option>
            <option value="claude-sonnet-4-6">Sonnet 4.6</option>
            <option value="claude-sonnet-4-5-20250514">Sonnet 4.5</option>
            <option value="claude-haiku-4-5-20251001">Haiku 4.5</option>
            <option value="sonnet">Sonnet (latest)</option>
            <option value="haiku">Haiku (latest)</option>
          </select>

          <select
            value={effort}
            onChange={(e) => setEffort(e.target.value)}
            className="font-data text-[11px] uppercase bg-concrete border border-[#332f28] px-2 py-1 rounded-md focus:outline-none cursor-pointer text-ink"
            title="Effort"
          >
            <option value="">Default</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="max">Max</option>
          </select>

          <div className="flex-1" />

          <label className="flex items-center gap-1.5 cursor-pointer select-none" title="Keep modal open after creating">
            <div
              onClick={() => setCreateMore((v) => !v)}
              className={`w-8 h-[18px] rounded-full border border-[#332f28] transition-colors relative cursor-pointer ${createMore ? "bg-[#b08a3e]" : "bg-concrete"}`}
            >
              <span className={`absolute top-[2px] w-3 h-3 rounded-full bg-ink transition-all ${createMore ? "left-[14px]" : "left-[2px]"}`} />
            </div>
            <span className="font-data text-[11px] text-muted uppercase">Create more</span>
          </label>

          <button
            onClick={submit}
            disabled={!prompt.trim() || loading}
            className="font-data text-[12px] uppercase bg-ink text-paper px-4 py-1.5 rounded-md inline-flex items-center gap-1.5 brutal-press disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Create <Play className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
