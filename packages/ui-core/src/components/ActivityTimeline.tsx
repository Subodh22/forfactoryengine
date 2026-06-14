"use client";
import { useState, useMemo } from "react";
import {
  FileText, Terminal, Search, PenLine, Eye, FolderSearch,
  ChevronDown, ChevronRight, Zap, CheckCircle2, FileCode,
  Globe, Bot, ListTodo, Download,
} from "lucide-react";
import { Markdown } from "./Markdown";
import { AttachmentPreview } from "./AttachmentPreview";
import type { ChatMsg } from "@/lib/types";

// ── Output parsing ──────────────────────────────────────────────────────────

interface ToolAction {
  kind: "read" | "write" | "edit" | "bash" | "glob" | "grep" | "todo" | "search" | "fetch" | "agent" | "other";
  label: string;
  detail: string;
}

interface ActivityBlock {
  type: "actions";
  actions: ToolAction[];
}

interface ChatBlock {
  type: "chat";
  msg: ChatMsg;
}

interface FactoryBlock {
  type: "factory";
  messages: string[];
}

interface ChangesBlock {
  type: "changes";
  files: string[];
}

type TimelineEntry = ActivityBlock | ChatBlock | FactoryBlock | ChangesBlock;

function parseToolAction(raw: string): ToolAction | null {
  if (raw.startsWith("\x00tool\x00")) {
    const text = raw.slice(7).trim();
    const spaceIdx = text.indexOf(" ");
    const tool = spaceIdx > 0 ? text.slice(0, spaceIdx).trim() : text;
    const detail = spaceIdx > 0 ? text.slice(spaceIdx).trim() : "";
    const toolLower = tool.toLowerCase();

    if (toolLower === "read") return { kind: "read", label: "Read", detail };
    if (toolLower === "write") return { kind: "write", label: "Write", detail };
    if (toolLower === "edit") return { kind: "edit", label: "Edit", detail };
    if (toolLower === "glob") return { kind: "glob", label: "Glob", detail };
    if (toolLower === "grep") return { kind: "grep", label: "Grep", detail };
    if (toolLower === "todo") return { kind: "todo", label: "Todo", detail };
    if (toolLower === "search") return { kind: "search", label: "Web Search", detail };
    if (toolLower === "fetch") return { kind: "fetch", label: "Fetch", detail };
    if (toolLower === "agent") return { kind: "agent", label: "Agent", detail };
    return { kind: "other", label: tool, detail };
  }
  if (raw.startsWith("\x00bash\x00")) {
    const text = raw.slice(7).trim();
    return { kind: "bash", label: "Bash", detail: text };
  }
  return null;
}

function iconForKind(kind: ToolAction["kind"]) {
  switch (kind) {
    case "read": return <Eye className="w-3 h-3" />;
    case "write": return <FileText className="w-3 h-3" />;
    case "edit": return <PenLine className="w-3 h-3" />;
    case "bash": return <Terminal className="w-3 h-3" />;
    case "glob": return <FolderSearch className="w-3 h-3" />;
    case "grep": return <Search className="w-3 h-3" />;
    case "todo": return <ListTodo className="w-3 h-3" />;
    case "search": return <Globe className="w-3 h-3" />;
    case "fetch": return <Download className="w-3 h-3" />;
    case "agent": return <Bot className="w-3 h-3" />;
    default: return <Zap className="w-3 h-3" />;
  }
}

/** Parse the output stream + chat messages into a unified timeline.
 *
 * The output stream uses divider lines (--------) to separate turns. Each turn
 * in the output corresponds to one assistant chat message. The pattern is:
 *   [factory] messages → divider → tool actions + text → divider → [factory] Changed files
 * After the second divider, an assistant chat message appears.
 *
 * We show: factory status → grouped tool actions → assistant response → changes. */
function buildTimeline(output: string, messages: ChatMsg[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const lines = output.split("\n").filter(Boolean);

  let currentActions: ToolAction[] = [];
  let currentFactory: string[] = [];
  let dividerCount = 0;
  let assistantIdx = 0;
  let userIdx = 0;

  // Separate messages by role for ordered insertion
  const assistantMsgs = messages.filter(m => m.role === "assistant");
  const userMsgs = messages.filter(m => m.role === "user");

  // Extract changed files from factory messages
  const changedFilesMatch = output.match(/\[factory\] Changed files: (.+)/);
  const changedFiles = changedFilesMatch && changedFilesMatch[1] !== "none"
    ? changedFilesMatch[1].split(", ").map(f => f.trim())
    : [];

  function flushActions() {
    if (currentActions.length > 0) {
      entries.push({ type: "actions", actions: [...currentActions] });
      currentActions = [];
    }
  }

  function flushFactory() {
    if (currentFactory.length > 0) {
      entries.push({ type: "factory", messages: [...currentFactory] });
      currentFactory = [];
    }
  }

  for (const raw of lines) {
    // Divider lines signal turn boundaries
    if (/^─+$/.test(raw.trim()) || /^-{20,}$/.test(raw.trim())) {
      dividerCount++;

      // After the second divider (end of a turn), insert the assistant response
      if (dividerCount % 2 === 0) {
        flushActions();
        flushFactory();
        // Insert the assistant chat message for this turn
        if (assistantIdx < assistantMsgs.length) {
          entries.push({ type: "chat", msg: assistantMsgs[assistantIdx] });
          assistantIdx++;
        }
      } else {
        // First divider — just flush what we have before tool actions start
        flushFactory();
      }
      continue;
    }

    const action = parseToolAction(raw);
    if (action) {
      flushFactory();
      currentActions.push(action);
      continue;
    }

    if (raw.startsWith("[factory]")) {
      flushActions();
      const text = raw.replace("[factory] ", "").trim();
      // Skip pure noise
      if (text.startsWith("-".repeat(10))) continue;
      if (text === "Launching Claude Code CLI...") continue;
      // User reply lines indicate a new user turn in the timeline
      if (text.startsWith("User replied:")) {
        flushFactory();
        if (userIdx < userMsgs.length) {
          entries.push({ type: "chat", msg: userMsgs[userIdx] });
          userIdx++;
        }
        continue;
      }
      currentFactory.push(text);
      continue;
    }

    // Skip stderr and other noise in the timeline view
    if (raw.startsWith("\x00stderr\x00")) continue;
  }

  flushActions();
  flushFactory();

  // Any remaining assistant messages not yet placed
  while (assistantIdx < assistantMsgs.length) {
    entries.push({ type: "chat", msg: assistantMsgs[assistantIdx] });
    assistantIdx++;
  }
  // Any remaining user messages not yet placed
  while (userIdx < userMsgs.length) {
    entries.push({ type: "chat", msg: userMsgs[userIdx] });
    userIdx++;
  }

  // Add file changes summary at the end if there are any
  if (changedFiles.length > 0) {
    entries.push({ type: "changes", files: changedFiles });
  }

  return entries;
}

// ── Components ──────────────────────────────────────────────────────────────

function ActionGroup({ actions }: { actions: ToolAction[] }) {
  const [expanded, setExpanded] = useState(false);

  // Group actions by kind for the summary
  const groups = useMemo(() => {
    const map = new Map<string, { kind: ToolAction["kind"]; count: number; files: string[] }>();
    for (const a of actions) {
      const existing = map.get(a.kind);
      if (existing) {
        existing.count++;
        if (a.detail && !existing.files.includes(a.detail)) existing.files.push(a.detail);
      } else {
        map.set(a.kind, { kind: a.kind, count: 1, files: a.detail ? [a.detail] : [] });
      }
    }
    return Array.from(map.values());
  }, [actions]);

  // Short summary: "Read 3 files, Edited 2 files, Ran 1 command"
  const summaryParts = groups.map(g => {
    if (g.kind === "bash") return `${g.count} command${g.count > 1 ? "s" : ""}`;
    if (g.kind === "read") return `read ${g.count} file${g.count > 1 ? "s" : ""}`;
    if (g.kind === "write") return `wrote ${g.count} file${g.count > 1 ? "s" : ""}`;
    if (g.kind === "edit") return `edited ${g.count} file${g.count > 1 ? "s" : ""}`;
    if (g.kind === "grep") return `${g.count} search${g.count > 1 ? "es" : ""}`;
    if (g.kind === "glob") return `${g.count} glob${g.count > 1 ? "s" : ""}`;
    if (g.kind === "agent") return `${g.count} subagent${g.count > 1 ? "s" : ""}`;
    return `${g.count} ${g.kind}`;
  });

  const hasEdits = groups.some(g => g.kind === "edit" || g.kind === "write");

  return (
    <div className="my-1.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-md bg-[#1a1714]/40 border border-[#2a2722]/60 hover:border-[#3a3530] transition-colors text-left group"
      >
        <span className="flex items-center gap-1.5 flex-shrink-0">
          {expanded ? <ChevronDown className="w-3 h-3 text-muted" /> : <ChevronRight className="w-3 h-3 text-muted" />}
          {hasEdits ? (
            <span className="w-4 h-4 rounded-[3px] bg-[#b08a3e]/20 flex items-center justify-center"><PenLine className="w-2.5 h-2.5 text-[#b08a3e]" /></span>
          ) : (
            <span className="w-4 h-4 rounded-[3px] bg-cyan-900/30 flex items-center justify-center"><Zap className="w-2.5 h-2.5 text-cyan-400/70" /></span>
          )}
        </span>
        <span className="font-data text-[11px] text-muted group-hover:text-ink/70 transition-colors truncate">
          {summaryParts.join(" · ")}
        </span>
        <span className="ml-auto font-data text-[10px] text-muted/50 flex-shrink-0">{actions.length} action{actions.length > 1 ? "s" : ""}</span>
      </button>

      {expanded && (
        <div className="mt-1 ml-5 border-l border-[#2a2722]/60 pl-3 space-y-0.5">
          {actions.map((a, i) => (
            <div key={i} className="flex items-center gap-2 py-0.5 font-mono text-[11px]">
              <span className={`flex-shrink-0 ${a.kind === "edit" || a.kind === "write" ? "text-[#b08a3e]" : a.kind === "bash" ? "text-amber-400/70" : "text-cyan-400/60"}`}>
                {iconForKind(a.kind)}
              </span>
              <span className="text-muted/80 truncate">{a.detail || a.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FactoryMessages({ messages: msgs }: { messages: string[] }) {
  // Filter to meaningful factory messages
  const meaningful = msgs.filter(m =>
    !m.startsWith("Repo:") && m.trim().length > 0
  );
  if (meaningful.length === 0) return null;

  return (
    <div className="my-1.5 flex flex-col gap-0.5">
      {meaningful.map((m, i) => (
        <div key={i} className="flex items-center gap-2 px-3 py-1 font-data text-[11px] text-[#3bd16f]/70">
          <Zap className="w-2.5 h-2.5 flex-shrink-0" />
          <span className="truncate">{m}</span>
        </div>
      ))}
    </div>
  );
}

function ChangedFilesSummary({ files }: { files: string[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-md bg-[#1f7a3d]/10 border border-[#1f7a3d]/20 hover:border-[#1f7a3d]/40 transition-colors text-left"
      >
        <CheckCircle2 className="w-3.5 h-3.5 text-[#3bd16f] flex-shrink-0" />
        <span className="font-data text-[11px] text-[#3bd16f]/80 uppercase">
          {files.length} file{files.length > 1 ? "s" : ""} changed
        </span>
        <span className="ml-auto">
          {expanded ? <ChevronDown className="w-3 h-3 text-muted" /> : <ChevronRight className="w-3 h-3 text-muted" />}
        </span>
      </button>

      {expanded && (
        <div className="mt-1 ml-5 border-l border-[#1f7a3d]/20 pl-3 space-y-0.5">
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-2 py-0.5 font-mono text-[11px] text-ink/60">
              <FileCode className="w-3 h-3 text-[#3bd16f]/50 flex-shrink-0" />
              <span className="truncate">{f}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

interface Props {
  messages: ChatMsg[];
  output: string;
  isRunning: boolean;
  isDelegating: boolean;
  isThinking: boolean;
  activeTool: string | null;
  isPending: boolean;
  onStartJob?: () => void;
}

export function ActivityTimeline({ messages, output, isRunning, isDelegating, isThinking, activeTool, isPending, onStartJob }: Props) {
  const timeline = useMemo(() => buildTimeline(output, messages), [output, messages]);

  // If no output and no messages, show empty state
  if (timeline.length === 0 && !isRunning && !isDelegating) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
        <p className="text-[13px] text-ink/70">{isPending ? "Ready to start" : "No activity yet"}</p>
        <p className="font-data text-[11px] text-muted">{isPending ? "This workspace hasn't started yet." : "Tool usage, file changes, and responses will appear here."}</p>
        {isPending && onStartJob && (
          <button
            onClick={onStartJob}
            className="mt-2 flex items-center gap-1.5 px-4 py-2 bg-[#b08a3e] text-[#14110e] font-bold font-data text-[11px] uppercase hover:brightness-110 transition-all brutal-press"
          >
            Run
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {timeline.map((entry, i) => {
        switch (entry.type) {
          case "actions":
            return <ActionGroup key={`a-${i}`} actions={entry.actions} />;
          case "factory":
            return <FactoryMessages key={`f-${i}`} messages={entry.messages} />;
          case "chat":
            return entry.msg.role === "assistant" ? (
              <div key={`c-${i}`} className="py-2">
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="w-5 h-5 rounded-[4px] bg-[#b08a3e] flex items-center justify-center flex-shrink-0">
                    <Bot className="w-3 h-3 text-[#14110e]" />
                  </span>
                  <span className="font-data text-[11px] font-medium text-ink/70 uppercase">Claude</span>
                </div>
                {entry.msg.images && entry.msg.images.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap mb-2 ml-7">{entry.msg.images.map((src, j) => <AttachmentPreview key={j} src={src} size={64} />)}</div>
                )}
                <div className="ml-7">
                  <Markdown text={entry.msg.text} />
                </div>
              </div>
            ) : (
              <div key={`c-${i}`} className="py-2 flex flex-col items-end gap-1.5">
                <span className="text-[11px] text-muted font-data uppercase">You</span>
                <div className="max-w-[85%] rounded-xl rounded-tr-sm bg-concrete-2 border border-[#332f28] px-3.5 py-2.5 text-[13px] text-ink/90 whitespace-pre-wrap leading-relaxed">
                  {entry.msg.images && entry.msg.images.length > 0 && (
                    <div className="flex gap-1.5 flex-wrap mb-1.5">{entry.msg.images.map((src, j) => <AttachmentPreview key={j} src={src} size={64} />)}</div>
                  )}
                  {entry.msg.text}
                </div>
              </div>
            );
          case "changes":
            return <ChangedFilesSummary key={`ch-${i}`} files={entry.files} />;
        }
      })}

      {/* Live working indicator */}
      {(isRunning || isDelegating) && (
        <div className="flex items-center gap-2 py-2 px-1">
          <span className="w-5 h-5 rounded-[4px] bg-[#b08a3e]/60 flex items-center justify-center animate-pulse flex-shrink-0">
            <Bot className="w-3 h-3 text-[#14110e]" />
          </span>
          <span className="flex gap-1 items-center">
            <span className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce" style={{ animationDelay: "0ms" }} />
            <span className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce" style={{ animationDelay: "150ms" }} />
            <span className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce" style={{ animationDelay: "300ms" }} />
          </span>
          <span className="text-[12px] text-muted">
            {isThinking ? "thinking..." : activeTool ? activeTool : "working..."}
          </span>
        </div>
      )}
    </div>
  );
}
