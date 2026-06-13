"use client";
import { useEffect, useRef, useState } from "react";
import { File as FileIcon, Slash } from "lucide-react";
import { fetchJobFiles } from "@/lib/mutations";

// Composer input with two autocompletes:
//   @path  → insert a workspace file reference (Claude Code reads @-mentions)
//   /cmd   → insert a quick-prompt (only when the message starts with "/")
// Self-contained so it can't destabilize the surrounding reply form. Enter sends
// (unless a menu is open or Shift is held); Shift+Enter inserts a newline.

interface SlashCmd { cmd: string; label: string; insert: string }
const SLASH_COMMANDS: SlashCmd[] = [
  { cmd: "/review", label: "Review the changes so far", insert: "Review the changes you've made so far and flag any bugs or issues." },
  { cmd: "/test", label: "Run the tests", insert: "Run the test suite and fix anything that fails." },
  { cmd: "/fix", label: "Fix the build / failing checks", insert: "Fix the failing build and CI checks." },
  { cmd: "/commit", label: "Commit the current work", insert: "Commit the current changes with a clear conventional-commit message." },
  { cmd: "/explain", label: "Explain the changes", insert: "Explain what you changed and why." },
  { cmd: "/plan", label: "Plan before coding", insert: "Outline a short step-by-step plan before writing any code." },
];

interface Props {
  jobId: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onPaste?: (e: React.ClipboardEvent) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

interface FileItem { path: string }

// The whitespace-delimited token ending at the caret.
function activeToken(text: string, caret: number): { token: string; start: number } {
  let start = caret;
  while (start > 0 && !/\s/.test(text[start - 1])) start--;
  return { token: text.slice(start, caret), start };
}

export function MentionInput({ jobId, value, onChange, onSubmit, onPaste, placeholder, autoFocus }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [filesLoaded, setFilesLoaded] = useState(false);
  const [menu, setMenu] = useState<{ kind: "file" | "slash"; start: number; query: string } | null>(null);
  const [index, setIndex] = useState(0);

  // Auto-grow the textarea.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  function refreshMenu(text: string, caret: number) {
    const { token, start } = activeToken(text, caret);
    if (token.startsWith("@")) {
      if (!filesLoaded) {
        setFilesLoaded(true);
        fetchJobFiles(jobId).then((r) => setFiles(r.files.map((path) => ({ path })))).catch(() => setFiles([]));
      }
      setMenu({ kind: "file", start, query: token.slice(1).toLowerCase() });
      setIndex(0);
    } else if (token.startsWith("/") && start === 0) {
      setMenu({ kind: "slash", start, query: token.slice(1).toLowerCase() });
      setIndex(0);
    } else {
      setMenu(null);
    }
  }

  const fileMatches = menu?.kind === "file"
    ? files.filter((f) => f.path.toLowerCase().includes(menu.query)).slice(0, 8)
    : [];
  const slashMatches = menu?.kind === "slash"
    ? SLASH_COMMANDS.filter((c) => c.cmd.slice(1).startsWith(menu.query))
    : [];
  const itemCount = menu?.kind === "file" ? fileMatches.length : slashMatches.length;

  function applyFile(path: string) {
    if (!menu) return;
    const before = value.slice(0, menu.start);
    const after = value.slice((ref.current?.selectionStart ?? value.length));
    const next = `${before}@${path} ${after}`;
    onChange(next);
    setMenu(null);
    requestAnimationFrame(() => ref.current?.focus());
  }

  function applySlash(c: SlashCmd) {
    const after = value.slice((ref.current?.selectionStart ?? value.length));
    onChange(`${c.insert} ${after}`.trimStart());
    setMenu(null);
    requestAnimationFrame(() => ref.current?.focus());
  }

  function choose(i: number) {
    if (menu?.kind === "file" && fileMatches[i]) applyFile(fileMatches[i].path);
    else if (menu?.kind === "slash" && slashMatches[i]) applySlash(slashMatches[i]);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (menu && itemCount > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(i + 1, itemCount - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); choose(index); return; }
      if (e.key === "Escape") { e.preventDefault(); setMenu(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  }

  return (
    <div className="relative flex-1 min-w-0">
      {menu && itemCount > 0 && (
        <div className="absolute bottom-full mb-1 left-0 w-full max-w-[460px] max-h-[220px] overflow-y-auto rounded-lg border border-[#332f28] bg-paper shadow-lg z-20">
          {menu.kind === "file"
            ? fileMatches.map((f, i) => (
                <button
                  key={f.path}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => applyFile(f.path)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] ${i === index ? "bg-concrete-2 text-ink" : "text-muted"}`}
                >
                  <FileIcon className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
                  <span className="font-mono truncate">{f.path}</span>
                </button>
              ))
            : slashMatches.map((c, i) => (
                <button
                  key={c.cmd}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => applySlash(c)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] ${i === index ? "bg-concrete-2 text-ink" : "text-muted"}`}
                >
                  <Slash className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
                  <span className="font-mono text-ink/90">{c.cmd}</span>
                  <span className="truncate text-muted">{c.label}</span>
                </button>
              ))}
        </div>
      )}
      <textarea
        ref={ref}
        value={value}
        rows={1}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onPaste={onPaste}
        onChange={(e) => { onChange(e.target.value); refreshMenu(e.target.value, e.target.selectionStart); }}
        onKeyUp={(e) => refreshMenu((e.target as HTMLTextAreaElement).value, (e.target as HTMLTextAreaElement).selectionStart)}
        onClick={(e) => refreshMenu((e.target as HTMLTextAreaElement).value, (e.target as HTMLTextAreaElement).selectionStart)}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setMenu(null), 120)}
        className="w-full resize-none bg-paper border border-[#332f28] rounded-md px-3 py-2 font-mono text-xs text-ink placeholder:text-muted focus:outline-none focus:border-[#b08a3e] transition-colors leading-relaxed"
      />
    </div>
  );
}
