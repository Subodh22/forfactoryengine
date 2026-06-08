import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, GitBranch, Clock, Coins, Paperclip, X, RotateCcw, Plus, Send, Monitor, Play, ChevronDown, ChevronUp } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { DelegatorPanel } from "./DelegatorPanel";
import { AttachmentPreview } from "./AttachmentPreview";
import { useJob, useJobOutput, useJobChat } from "@/lib/data";
import { appendPrompt, redoJob, sendReply, approvePlan } from "@/lib/mutations";
import { uploadFiles } from "@/lib/api";

interface Props {
  jobId: string;
  onRedo?: (newJobId: string) => void;
}

type LineType = "tool" | "bash" | "stderr" | "factory" | "error" | "divider" | "text";

function parseLine(raw: string): { type: LineType; text: string } {
  if (raw.startsWith("\x00tool\x00")) return { type: "tool", text: raw.slice(7) };
  if (raw.startsWith("\x00bash\x00")) return { type: "bash", text: raw.slice(7) };
  if (raw.startsWith("\x00stderr\x00")) return { type: "stderr", text: raw.slice(9) };
  if (raw.startsWith("[factory]")) return { type: "factory", text: raw };
  if (/^─+$/.test(raw.trim())) return { type: "divider", text: raw };
  if (/ERROR|FATAL/.test(raw)) return { type: "error", text: raw };
  return { type: "text", text: raw };
}

function lineClass(type: LineType): string {
  switch (type) {
    case "tool": return "text-cyan-400";
    case "bash": return "text-amber-300";
    case "stderr": return "text-[#6b8a6b]";
    case "factory": return "text-[#3bd16f]";
    case "error": return "text-red-400";
    case "divider": return "text-[#4a4a44]";
    case "text": return "text-[#cfe8cf]";
  }
}

export function JobDetail({ jobId, onRedo }: Props) {
  const job = useJob(jobId);
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);
  const [promptDraft, setPromptDraft] = useState("");
  const [addingPrompt, setAddingPrompt] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isRunning = job?.status === "running";
  const isWaiting = job?.status === "waiting_for_input";
  const isClarifying = job?.status === "clarifying";
  const isPlanReview = job?.status === "plan_review";
  const isDelegating = job?.status === "delegating";
  const isEpic = job?.kind === "epic";
  const isPending = job?.status === "pending" || job?.status === "queued";
  const isFinished = job?.status === "completed" || job?.status === "failed" || job?.status === "cancelled";
  const streamActive = isRunning || isWaiting || isClarifying || isDelegating;

  const output = useJobOutput(jobId, streamActive);
  const [messages, addMessage] = useJobChat(jobId, streamActive);

  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [approving, setApproving] = useState(false);
  const [showError, setShowError] = useState(false);

  async function handleApprove() {
    if (approving) return;
    setApproving(true);
    try { await approvePlan(jobId); toast.success("Approved — agents are starting"); }
    catch (err) { toast.error(String(err instanceof Error ? err.message : err) || "Could not approve"); }
    finally { setApproving(false); }
  }

  const [activeTab, setActiveTab] = useState<"output" | "chat">("output");
  const [unseenChat, setUnseenChat] = useState(false);
  const [unseenOutput, setUnseenOutput] = useState(false);
  const prevMessagesLen = useRef(messages.length);
  const prevOutputLen2 = useRef(output.length);

  useEffect(() => {
    if (messages.length > prevMessagesLen.current && activeTab !== "chat") {
      setUnseenChat(true);
    }
    prevMessagesLen.current = messages.length;
  }, [messages.length, activeTab]);

  useEffect(() => {
    if (output.length > prevOutputLen2.current && activeTab !== "output") {
      setUnseenOutput(true);
    }
    prevOutputLen2.current = output.length;
  }, [output.length, activeTab]);

  useEffect(() => {
    if (activeTab === "chat") setUnseenChat(false);
    if (activeTab === "output") setUnseenOutput(false);
  }, [activeTab]);

  const [redoOpen, setRedoOpen] = useState(false);
  const [redoPrompt, setRedoPrompt] = useState("");
  const [redoImages, setRedoImages] = useState<string[]>([]);
  const [redoing, setRedoing] = useState(false);
  const redoFileInputRef = useRef<HTMLInputElement>(null);
  const [now, setNow] = useState(() => Date.now());

  const addFiles = useCallback(async (files: FileList | File[], target: React.Dispatch<React.SetStateAction<string[]>> = setAttachedFiles) => {
    const { images, skipped } = await uploadFiles(files);
    target((prev) => [...prev, ...images]);
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

  const captureScreen = useCallback(async (target: React.Dispatch<React.SetStateAction<string[]>>) => {
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
      target((prev) => [...prev, canvas.toDataURL("image/png")]);
    } catch { /* cancelled */ }
  }, []);

  useEffect(() => {
    if (!isRunning) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isRunning]);

  const lastOutputAt = useRef(Date.now());
  const prevOutputLen = useRef(0);
  if (output.length !== prevOutputLen.current) {
    lastOutputAt.current = Date.now();
    prevOutputLen.current = output.length;
  }
  const silentSecs = isRunning ? Math.floor((now - lastOutputAt.current) / 1000) : 0;

  const lines = output.split("\n").filter(Boolean);
  const lastToolLine = [...lines].reverse().find((l) => l.startsWith("\x00tool\x00") || l.startsWith("\x00bash\x00"));
  const activeTool = isRunning && lastToolLine ? lastToolLine.slice(7) : null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [output, messages]);

  const canChat = !!job && !isPending && !isPlanReview;

  async function handleRedo(e: React.FormEvent) {
    e.preventDefault();
    if (redoing) return;
    setRedoing(true);
    try {
      const newJob = await redoJob(jobId, redoPrompt.trim() || undefined, redoImages.length ? redoImages : undefined);
      setRedoOpen(false);
      setRedoPrompt("");
      setRedoImages([]);
      toast.success("Re-running — queued a fresh agent");
      onRedo?.(newJob.id);
    } finally {
      setRedoing(false);
    }
  }

  async function handleReply(e: React.FormEvent) {
    e.preventDefault();
    if ((!reply.trim() && !attachedFiles.length) || sending) return;
    setSending(true);
    const text = reply.trim();
    const images = attachedFiles;
    setReply("");
    setAttachedFiles([]);
    try {
      if (isPending) {
        await appendPrompt(jobId, text, images.length ? images : undefined);
        toast.success("Added to prompt");
      } else {
        addMessage({ id: `${Date.now()}-u`, role: "user", text, images: images.length ? images : undefined });
        await sendReply(jobId, text, images);
      }
    } catch (err) {
      toast.error(String(err instanceof Error ? err.message : err) || "Could not reach the engine");
    } finally {
      setSending(false);
    }
  }

  async function handleAddPrompt(e: React.FormEvent) {
    e.preventDefault();
    if ((!promptDraft.trim() && !attachedFiles.length) || addingPrompt) return;
    setAddingPrompt(true);
    try {
      await appendPrompt(jobId, promptDraft.trim(), attachedFiles.length ? attachedFiles : undefined);
      setPromptDraft("");
      setAttachedFiles([]);
      toast.success("Added to prompt");
    } finally {
      setAddingPrompt(false);
    }
  }

  if (!job) return <div className="p-6 text-muted font-data text-xs uppercase">Loading...</div>;

  const elapsed = job.startedAt > 0 ? Math.round(((isRunning ? now : (job.completedAt || now)) - job.startedAt) / 1000) : null;
  const isThinking = isRunning && silentSecs >= 8;
  const isStuck = isRunning && silentSecs >= 30;

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b-4 border-ink flex-shrink-0 bg-concrete">
        <div className="flex items-start justify-between gap-3 mb-2">
          <h2 className="text-sm font-bold uppercase text-ink leading-snug">{job.title}</h2>
          <StatusBadge status={job.status} />
        </div>
        <p className={`font-data text-[11px] text-muted mb-3 whitespace-pre-wrap ${isPending ? "" : "line-clamp-2"}`}>{job.prompt}</p>

        <div className="flex items-center gap-3 font-data text-[10px] uppercase text-muted flex-wrap">
          {job.branch && (
            <span className="flex items-center gap-1"><GitBranch className="w-2.5 h-2.5" />{job.branch}</span>
          )}
          {elapsed !== null && (
            <span className={`flex items-center gap-1 ${isRunning ? "text-ink font-bold" : ""}`}><Clock className="w-2.5 h-2.5" />{elapsed}s</span>
          )}
          {job.costUsd > 0 && (
            <span className="flex items-center gap-1 text-ink" title={`Input: ${job.inputTokens.toLocaleString()} · Output: ${job.outputTokens.toLocaleString()}`}>
              <Coins className="w-2.5 h-2.5" />${job.costUsd.toFixed(4)} · {(job.inputTokens + job.outputTokens).toLocaleString()} tok
            </span>
          )}
          {job.prUrl && (
            <a href={job.prUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-ink underline hover:no-underline">
              <ExternalLink className="w-2.5 h-2.5" />View PR #{job.prNumber}
            </a>
          )}
          {isFinished && (
            <button onClick={() => setRedoOpen((o) => !o)} className="flex items-center gap-1 px-2 py-0.5 ml-auto font-data text-[10px] uppercase border-2 border-ink text-ink hover:bg-ink hover:text-concrete transition-colors" title="Re-run this job from scratch">
              <RotateCcw className="w-2.5 h-2.5" />Redo
            </button>
          )}
        </div>

        {isFinished && redoOpen && (
          <form onSubmit={handleRedo} className="mt-3 p-3 border-2 border-ink bg-paper space-y-2" onDrop={(e) => { e.preventDefault(); const files = Array.from(e.dataTransfer.files); if (files.length) addFiles(files, setRedoImages); }} onDragOver={(e) => e.preventDefault()}>
            <p className="font-data text-[10px] uppercase text-muted">Re-runs in a fresh worktree. Add extra instructions or images below (optional).</p>
            <textarea
              value={redoPrompt}
              onChange={(e) => setRedoPrompt(e.target.value)}
              placeholder="Anything to change or add this time… (paste screenshots, optional)"
              rows={2}
              onPaste={(e) => { const files = Array.from(e.clipboardData.files); if (files.length) addFiles(files, setRedoImages); }}
              className="w-full bg-concrete border-2 border-ink px-3 py-2 font-mono text-xs text-ink placeholder:text-muted focus:outline-none focus:shadow-[inset_0_0_0_2px_var(--ink)] resize-none"
            />
            {redoImages.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {redoImages.map((src, i) => (
                  <AttachmentPreview key={i} src={src} size={56} onRemove={() => setRedoImages((prev) => prev.filter((_, j) => j !== i))} />
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <input ref={redoFileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files, setRedoImages); e.target.value = ""; }} />
              <button type="button" onClick={() => redoFileInputRef.current?.click()} className="px-2 py-1.5 bg-concrete border-2 border-ink text-ink hover:bg-ink hover:text-concrete transition-colors" title="Attach image"><Paperclip className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={() => captureScreen(setRedoImages)} className="px-2 py-1.5 bg-concrete border-2 border-ink text-ink hover:bg-ink hover:text-concrete transition-colors" title="Capture screenshot"><Monitor className="w-3.5 h-3.5" /></button>
              <button type="submit" disabled={redoing} className="px-3 py-1.5 bg-ink text-concrete border-2 border-ink disabled:opacity-40 font-data text-[10px] uppercase flex items-center gap-1 brutal-press"><RotateCcw className="w-3 h-3" />{redoing ? "Queuing…" : "Run again"}</button>
              <button type="button" onClick={() => setRedoOpen(false)} className="px-2 py-1.5 font-data text-[10px] uppercase text-muted hover:text-ink transition-colors">Cancel</button>
            </div>
          </form>
        )}
      </div>

      {/* Tabbed output / chat area */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {isRunning && (
          <div className="h-1 w-full bg-[#2a2722] flex-shrink-0 overflow-hidden relative">
            <style>{`@keyframes slide{from{transform:translateX(-100%)}to{transform:translateX(350%)}}`}</style>
            <div className={`absolute h-full w-1/3 ${isStuck ? "bg-red-500" : isThinking ? "bg-amber-500" : "bg-[#3bd16f]"}`} style={{ animation: "slide 2s linear infinite" }} />
          </div>
        )}
        <div className="px-4 py-0 border-b-2 border-[#2a2722] flex items-center gap-0 flex-shrink-0 bg-ink">
          <button onClick={() => setActiveTab("output")} className={`px-3 py-2 font-data text-[10px] tracking-widest uppercase flex items-center gap-1.5 border-b-2 transition-colors ${activeTab === "output" ? "text-[#3bd16f] border-[#3bd16f]" : "text-[#6b8a6b] border-transparent hover:text-[#cfe8cf]"}`}>
            Agent Output
            {unseenOutput && <span className="w-1.5 h-1.5 bg-[#3bd16f] rounded-full flex-shrink-0" />}
          </button>
          <button onClick={() => setActiveTab("chat")} className={`px-3 py-2 font-data text-[10px] tracking-widest uppercase flex items-center gap-1.5 border-b-2 transition-colors ${activeTab === "chat" ? "text-[#3bd16f] border-[#3bd16f]" : "text-[#6b8a6b] border-transparent hover:text-[#cfe8cf]"}`}>
            Chat
            {unseenChat && <span className="w-1.5 h-1.5 bg-[#3bd16f] rounded-full flex-shrink-0" />}
          </button>
          <span className="flex-1" />
          {isRunning && isStuck ? (
            <span className="flex items-center gap-1.5 font-data text-[10px] text-red-400"><span className="w-1.5 h-1.5 bg-red-400 animate-pulse flex-shrink-0" />no output {silentSecs}s</span>
          ) : isRunning && isThinking ? (
            <span className="flex items-center gap-1.5 font-data text-[10px] text-amber-400"><span className="w-1.5 h-1.5 bg-amber-400 animate-pulse flex-shrink-0" />thinking...</span>
          ) : isRunning && activeTool ? (
            <span className="flex items-center gap-1.5 font-data text-[10px] text-cyan-400 max-w-[160px] truncate"><span className="w-1.5 h-1.5 bg-cyan-400 animate-pulse flex-shrink-0" />{activeTool}</span>
          ) : isRunning ? (
            <span className="flex items-center gap-1 font-data text-[10px] text-[#3bd16f]"><span className="w-1.5 h-1.5 bg-[#3bd16f] animate-pulse" />live</span>
          ) : null}
        </div>

        {activeTab === "output" ? (
          <div className="flex-1 overflow-y-auto bg-ink p-4 min-h-0">
            {output ? (
              <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed">
                {output.split("\n").map((raw, i) => {
                  if (!raw) return <span key={i}>{"\n"}</span>;
                  const { type, text } = parseLine(raw);
                  return <span key={i} className={lineClass(type)}>{text}{"\n"}</span>;
                })}
                {isRunning && <span className="inline-block w-2 h-3.5 bg-[#3bd16f] animate-pulse ml-0.5 align-middle opacity-60" />}
              </pre>
            ) : (
              <p className="text-xs text-[#6b8a6b] italic font-mono">{job.status === "pending" ? "Waiting to start… click Run on the card" : "No output yet…"}</p>
            )}
            <div ref={bottomRef} />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto bg-ink p-4 min-h-0">
            {messages.length > 0 ? (
              <div className="space-y-3">
                {messages.map((msg) => (
                  <div key={msg.id} className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                    <div className="font-data text-[10px] font-bold uppercase mt-0.5 flex-shrink-0 text-[#6b8a6b]">{msg.role === "assistant" ? "Claude" : "You"}</div>
                    <div className={`text-xs px-3 py-2 max-w-[85%] whitespace-pre-wrap border-2 ${msg.role === "assistant" ? "border-[#3a3a34] bg-[#1a1a16] text-[#cfe8cf]" : "border-[#3bd16f] bg-[#3bd16f]/10 text-[#cfe8cf]"}`}>
                      {msg.images && msg.images.length > 0 && (
                        <div className="flex gap-1.5 flex-wrap mb-1.5">{msg.images.map((src, i) => <AttachmentPreview key={i} src={src} size={64} />)}</div>
                      )}
                      {msg.text}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[#6b8a6b] italic font-mono">No chat messages yet…</p>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {isEpic && <DelegatorPanel epicId={jobId} />}

      {canChat && (
        <div className={`border-t-4 p-3 flex-shrink-0 ${isWaiting ? "border-ink bg-[#b8860b]/15" : "border-ink bg-concrete"}`} onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
          {isPending && <p className="font-data text-[10px] uppercase text-muted mb-2">Add instructions or images before this job runs</p>}
          {isWaiting && <p className="font-data text-[10px] uppercase text-[#b8860b] mb-2 font-bold">Claude has a question — reply to continue</p>}
          {isDelegating && <p className="font-data text-[10px] uppercase text-muted mb-2">Talk to Claude about this epic — opens a session in the integration branch</p>}
          {isRunning && <p className="font-data text-[10px] uppercase text-muted mb-2">Message will be delivered when Claude finishes this turn</p>}
          {isFinished && <p className="font-data text-[10px] uppercase text-muted mb-2">Continue the conversation — resumes this job&apos;s session</p>}
          {attachedFiles.length > 0 && (
            <div className="flex gap-2 mb-2 flex-wrap">{attachedFiles.map((src, i) => <AttachmentPreview key={i} src={src} size={56} onRemove={() => setAttachedFiles((prev) => prev.filter((_, j) => j !== i))} />)}</div>
          )}
          <form onSubmit={handleReply} className="flex gap-2">
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
            <button type="button" onClick={() => fileInputRef.current?.click()} className="px-2 py-2 bg-paper border-2 border-ink text-ink hover:bg-ink hover:text-concrete transition-colors flex-shrink-0" title="Attach files"><Paperclip className="w-3.5 h-3.5" /></button>
            <button type="button" onClick={() => captureScreen(setAttachedFiles)} className="px-2 py-2 bg-paper border-2 border-ink text-ink hover:bg-ink hover:text-concrete transition-colors flex-shrink-0" title="Capture screenshot"><Monitor className="w-3.5 h-3.5" /></button>
            <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder={isPending ? "Add to prompt… (paste screenshots)" : isWaiting ? "Reply to Claude… (paste screenshots)" : isRunning ? "Queue a message… (paste screenshots)" : "Message Claude… (paste screenshots)"} onPaste={onPaste} className="flex-1 bg-paper border-2 border-ink px-3 py-2 font-mono text-xs text-ink placeholder:text-muted focus:outline-none focus:shadow-[inset_0_0_0_2px_var(--ink)] transition-shadow" autoFocus={isWaiting} />
            <button type="submit" disabled={(!reply.trim() && !attachedFiles.length) || sending} className="px-3 py-2 bg-ink text-concrete border-2 border-ink disabled:opacity-40 font-data text-[10px] uppercase flex items-center gap-1 brutal-press"><Send className="w-3 h-3" />{sending ? "…" : "Send"}</button>
          </form>
        </div>
      )}

      {job.error && (
        <div className="border-t-4 border-[#d6210f] bg-[#d6210f]/15 flex-shrink-0">
          <button onClick={() => setShowError(v => !v)} className="w-full flex items-center justify-between px-4 py-2 font-data text-[10px] font-bold text-[#d6210f] uppercase tracking-widest hover:bg-[#d6210f]/10 transition-colors">
            <span>Error</span>
            {showError ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {showError && (
            <div className="px-4 pb-4">
              <pre className="text-xs text-[#a8190b] font-mono whitespace-pre-wrap">{job.error}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
