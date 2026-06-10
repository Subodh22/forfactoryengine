import { useState, useRef, useCallback } from "react";
import { Paperclip, Play, Monitor } from "lucide-react";
import { toast } from "sonner";
import { AttachmentPreview } from "@/components/AttachmentPreview";
import { useFactory, useProject } from "@/lib/data";
import { createJob } from "@/lib/mutations";
import { uploadFiles } from "@/lib/api";

interface Props {
  projectId: string;
  onJobCreated?: (id: string) => void;
}

export function ChatPanel({ projectId, onJobCreated }: Props) {
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

  return (
    <div ref={dropRef} onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      <div className="bg-paper border-2 border-ink/20 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
        {attachments.length > 0 && (
          <div className="flex gap-2 flex-wrap px-4 pt-3">
            {attachments.map((src, i) => <AttachmentPreview key={i} src={src} onRemove={() => setAttachments((prev) => prev.filter((_, j) => j !== i))} />)}
          </div>
        )}

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder="What do you want to build?"
          className="w-full min-h-[120px] max-h-[320px] resize-none bg-transparent px-4 pt-4 pb-2 font-mono text-[14px] text-ink leading-[1.6] placeholder:text-muted/60 focus:outline-none"
        />

        <div className="flex items-center justify-between px-3 py-2.5 border-t border-ink/10">
          <div className="flex items-center gap-1">
            <button
              className="p-2 text-muted hover:text-ink hover:bg-concrete transition-colors"
              onClick={() => fileRef.current?.click()}
              title="Attach files"
            >
              <Paperclip className="w-4 h-4" />
            </button>
            <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => e.target.files && addFiles(e.target.files)} />
            <button
              className="p-2 text-muted hover:text-ink hover:bg-concrete transition-colors"
              onClick={captureScreen}
              title="Capture screenshot"
            >
              <Monitor className="w-4 h-4" />
            </button>

            <span className="w-px h-5 bg-ink/10 mx-1" />

            <select value={model} onChange={(e) => setModel(e.target.value)} className="font-data text-[11px] uppercase bg-transparent text-muted hover:text-ink px-1.5 py-1 focus:outline-none cursor-pointer" title="Model">
              <option value="">Model</option>
              <option value="opus">Opus</option>
              <option value="sonnet">Sonnet</option>
              <option value="haiku">Haiku</option>
            </select>
            <select value={effort} onChange={(e) => setEffort(e.target.value)} className="font-data text-[11px] uppercase bg-transparent text-muted hover:text-ink px-1.5 py-1 focus:outline-none cursor-pointer" title="Effort">
              <option value="">Effort</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="max">Max</option>
            </select>

            <span className="w-px h-5 bg-ink/10 mx-1" />

            <button
              className={`font-data text-[11px] px-2 py-1 uppercase flex items-center gap-1.5 select-none transition-colors ${delegate ? "bg-ink text-paper" : "text-muted hover:text-ink"}`}
              onClick={() => setDelegate((v) => !v)}
              title="Delegate: split into parallel sub-agents"
            >
              <span className={`w-[6px] h-[6px] rounded-full ${delegate ? "bg-[#e0a32e]" : "bg-current opacity-40"}`} />
              Delegate
            </button>
            <button
              className={`font-data text-[11px] px-2 py-1 uppercase flex items-center gap-1.5 select-none transition-colors ${autoRun ? "bg-ink text-paper" : "text-muted hover:text-ink"} ${delegate ? "opacity-30 pointer-events-none" : ""}`}
              onClick={() => setAutoRun((v) => !v)}
              title="Auto-run: start immediately"
            >
              <span className={`w-[6px] h-[6px] rounded-full ${autoRun ? "bg-[#3bd16f]" : "bg-current opacity-40"}`} />
              Auto
            </button>
          </div>

          <button
            onClick={submit}
            disabled={!prompt.trim() || loading}
            className="bg-ink text-paper p-2 transition-opacity disabled:opacity-20 disabled:cursor-not-allowed hover:opacity-80"
            title={`${delegate ? "Delegate" : autoRun ? "Run" : "Queue"} · Cmd+Enter`}
          >
            <Play className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
