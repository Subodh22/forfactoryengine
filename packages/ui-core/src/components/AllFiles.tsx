"use client";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, File as FileIcon, Folder, FolderOpen, ArrowLeft, Loader2 } from "lucide-react";
import { fetchJobFiles, fetchJobFile } from "@/lib/mutations";

// "All files" tab: the workspace's file tree (the job's worktree, or the repo on
// disk before a worktree exists). Click a file to preview its contents. Engine:
// GET /api/jobs/:id/files and /api/jobs/:id/file?path=...

interface TreeNode {
  name: string;
  path: string;
  isFile: boolean;
  children: Map<string, TreeNode>;
}

function buildTree(paths: string[]): TreeNode {
  const root: TreeNode = { name: "", path: "", isFile: false, children: new Map() };
  for (const p of paths) {
    const parts = p.split("/");
    let cur = root;
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1;
      let next = cur.children.get(part);
      if (!next) {
        next = { name: part, path: parts.slice(0, i + 1).join("/"), isFile, children: new Map() };
        cur.children.set(part, next);
      }
      cur = next;
    });
  }
  return root;
}

function sortedChildren(node: TreeNode): TreeNode[] {
  return [...node.children.values()].sort((a, b) => {
    if (a.isFile !== b.isFile) return a.isFile ? 1 : -1; // folders first
    return a.name.localeCompare(b.name);
  });
}

function Row({
  node, depth, expanded, onToggle, onOpen, selected,
}: {
  node: TreeNode; depth: number; expanded: Set<string>;
  onToggle: (p: string) => void; onOpen: (p: string) => void; selected: string | null;
}) {
  const isOpen = expanded.has(node.path);
  return (
    <>
      <button
        onClick={() => (node.isFile ? onOpen(node.path) : onToggle(node.path))}
        className={`w-full flex items-center gap-1.5 py-[3px] pr-2 rounded-md text-left text-[12.5px] transition-colors ${
          selected === node.path ? "bg-concrete-2 text-ink" : "text-muted hover:text-ink hover:bg-concrete-2/50"
        }`}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        {node.isFile ? (
          <FileIcon className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
        ) : (
          <>
            <ChevronRight className={`w-3 h-3 flex-shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`} />
            {isOpen ? <FolderOpen className="w-3.5 h-3.5 flex-shrink-0 opacity-70" /> : <Folder className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />}
          </>
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {!node.isFile && isOpen && sortedChildren(node).map((c) => (
        <Row key={c.path} node={c} depth={depth + 1} expanded={expanded} onToggle={onToggle} onOpen={onOpen} selected={selected} />
      ))}
    </>
  );
}

export function AllFiles({ jobId, refreshKey }: { jobId: string; refreshKey?: string }) {
  const [files, setFiles] = useState<string[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<{ content: string; truncated: boolean; binary: boolean } | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    fetchJobFiles(jobId)
      .then((r) => { if (live) { setFiles(r.files); setTruncated(r.truncated); } })
      .catch(() => { if (live) setFiles([]); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [jobId, refreshKey]);

  const tree = useMemo(() => buildTree(files), [files]);
  const topLevel = useMemo(() => sortedChildren(tree), [tree]);

  const toggle = (p: string) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(p) ? next.delete(p) : next.add(p);
    return next;
  });

  const open = (p: string) => {
    setSelected(p);
    setContent(null);
    setLoadingFile(true);
    fetchJobFile(jobId, p)
      .then((r) => setContent(r))
      .catch(() => setContent({ content: "Failed to load file.", truncated: false, binary: false }))
      .finally(() => setLoadingFile(false));
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full text-muted gap-2 text-[12px]"><Loader2 className="w-4 h-4 animate-spin" /> Loading files…</div>;
  }

  if (selected) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 h-9 border-b border-[#2a2722] flex-shrink-0 bg-concrete">
          <button onClick={() => { setSelected(null); setContent(null); }} className="text-muted hover:text-ink transition-colors flex-shrink-0"><ArrowLeft className="w-4 h-4" /></button>
          <span className="font-mono text-[11px] text-ink/90 truncate">{selected}</span>
          {content?.truncated && <span className="font-data text-[9px] uppercase text-amber-400 ml-auto flex-shrink-0">truncated</span>}
        </div>
        <div className="flex-1 overflow-auto">
          {loadingFile ? (
            <div className="flex items-center justify-center h-full text-muted gap-2 text-[12px]"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
          ) : content?.binary ? (
            <div className="flex items-center justify-center h-full text-muted text-[12px] font-data">Binary file — preview unavailable</div>
          ) : (
            <pre className="text-[11.5px] font-mono leading-relaxed text-[#cfe8cf] p-3 whitespace-pre-wrap">{content?.content}</pre>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto py-1">
        {topLevel.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted text-[12px] font-data px-6 text-center">No files found for this workspace.</div>
        ) : (
          topLevel.map((c) => (
            <Row key={c.path} node={c} depth={0} expanded={expanded} onToggle={toggle} onOpen={open} selected={selected} />
          ))
        )}
      </div>
      {truncated && (
        <div className="flex-shrink-0 px-3 py-1.5 border-t border-[#2a2722] font-data text-[9px] uppercase text-muted">File list truncated — showing first 4000</div>
      )}
    </div>
  );
}
