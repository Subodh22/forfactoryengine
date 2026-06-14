"use client";
import { Fragment, type ReactNode } from "react";

// A small, dependency-free Markdown renderer tuned for Claude's output: fenced
// code blocks, headings, lists, blockquotes, rules, tables, and inline code /
// bold / italic / strikethrough / links. Styled for the dark Conductor theme.

// ── Inline ───────────────────────────────────────────────────────────────────
const INLINE_RE =
  /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(~~[^~]+~~)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\([^)]+\))/;

function renderInline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let i = 0;
  while (rest.length) {
    const m = INLINE_RE.exec(rest);
    if (!m) { out.push(<Fragment key={`${key}-${i++}`}>{rest}</Fragment>); break; }
    if (m.index > 0) out.push(<Fragment key={`${key}-${i++}`}>{rest.slice(0, m.index)}</Fragment>);
    const tok = m[0];
    const k = `${key}-${i++}`;
    if (tok.startsWith("`")) {
      out.push(<code key={k} className="font-mono text-[0.9em] px-1.5 py-0.5 rounded bg-[#0f0d0b] border border-[#2a2722] text-[#e6c98a]">{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("**") || tok.startsWith("__")) {
      out.push(<strong key={k} className="font-semibold text-ink">{renderInline(tok.slice(2, -2), k)}</strong>);
    } else if (tok.startsWith("~~")) {
      out.push(<span key={k} className="line-through opacity-60">{renderInline(tok.slice(2, -2), k)}</span>);
    } else if (tok.startsWith("[")) {
      const mm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok)!;
      out.push(<a key={k} href={mm[2]} target="_blank" rel="noopener noreferrer" className="text-[#d8b25e] underline underline-offset-2 hover:text-[#e8c97a]">{mm[1]}</a>);
    } else {
      out.push(<em key={k} className="italic">{renderInline(tok.slice(1, -1), k)}</em>);
    }
    rest = rest.slice(m.index + tok.length);
  }
  return out;
}

// ── Blocks ───────────────────────────────────────────────────────────────────
type Block =
  | { t: "code"; lang: string; lines: string[] }
  | { t: "heading"; level: number; text: string }
  | { t: "ul"; items: string[] }
  | { t: "ol"; items: string[] }
  | { t: "quote"; lines: string[] }
  | { t: "hr" }
  | { t: "table"; header: string[]; rows: string[][] }
  | { t: "p"; lines: string[] };

function splitRow(line: string): string[] {
  return line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
}

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1] || "";
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++; // closing fence
      blocks.push({ t: "code", lang, lines: body });
      continue;
    }

    if (!line.trim()) { i++; continue; }

    // heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { blocks.push({ t: "heading", level: h[1].length, text: h[2] }); i++; continue; }

    // horizontal rule
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { blocks.push({ t: "hr" }); i++; continue; }

    // table (header row + separator row of ---)
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(splitRow(lines[i++]));
      blocks.push({ t: "table", header, rows });
      continue;
    }

    // unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*+]\s+/, ""));
      blocks.push({ t: "ul", items });
      continue;
    }

    // ordered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ""));
      blocks.push({ t: "ol", items });
      continue;
    }

    // blockquote
    if (/^\s*>\s?/.test(line)) {
      const ql: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) ql.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push({ t: "quote", lines: ql });
      continue;
    }

    // paragraph
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^```/.test(lines[i]) && !/^(#{1,6})\s/.test(lines[i]) && !/^\s*[-*+]\s+/.test(lines[i]) && !/^\s*\d+[.)]\s+/.test(lines[i]) && !/^\s*>\s?/.test(lines[i])) {
      para.push(lines[i++]);
    }
    blocks.push({ t: "p", lines: para });
  }
  return blocks;
}

export function Markdown({ text, className = "" }: { text: string; className?: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className={`text-[13.5px] leading-[1.75] text-ink/90 space-y-4 ${className}`}>
      {blocks.map((b, i) => {
        const key = `b-${i}`;
        switch (b.t) {
          case "code":
            return (
              <pre key={key} className="overflow-x-auto rounded-md bg-[#0f0d0b] border border-[#2a2722] p-4 my-1">
                {b.lang && <div className="font-data text-[9px] uppercase tracking-wide text-muted mb-2">{b.lang}</div>}
                <code className="font-mono text-[12px] leading-relaxed text-[#cfe8cf] whitespace-pre">{b.lines.join("\n")}</code>
              </pre>
            );
          case "heading": {
            const sizes = ["text-[19px]", "text-[17px]", "text-[15px]", "text-[14px]", "text-[13.5px]", "text-[13px]"];
            const margins = ["mt-5 mb-2", "mt-4 mb-1.5", "mt-3 mb-1", "mt-2 mb-1", "mt-2 mb-0.5", "mt-1 mb-0.5"];
            return <div key={key} className={`font-bold text-ink ${sizes[b.level - 1]} ${margins[b.level - 1]} tracking-[-0.01em]`}>{renderInline(b.text, key)}</div>;
          }
          case "ul":
            return (
              <ul key={key} className="list-disc pl-5 space-y-1.5 marker:text-ink/40">
                {b.items.map((it, j) => <li key={j} className="pl-1">{renderInline(it, `${key}-${j}`)}</li>)}
              </ul>
            );
          case "ol":
            return (
              <ol key={key} className="list-decimal pl-5 space-y-1.5 marker:text-ink/40">
                {b.items.map((it, j) => <li key={j} className="pl-1">{renderInline(it, `${key}-${j}`)}</li>)}
              </ol>
            );
          case "quote":
            return (
              <blockquote key={key} className="border-l-2 border-[#4a453d] pl-4 py-0.5 text-ink/70 italic">
                {b.lines.map((l, j) => <div key={j}>{renderInline(l, `${key}-${j}`)}</div>)}
              </blockquote>
            );
          case "hr":
            return <hr key={key} className="border-t border-[#2a2722] my-3" />;
          case "table":
            return (
              <div key={key} className="overflow-x-auto my-1">
                <table className="text-[12.5px] border-collapse">
                  <thead>
                    <tr>{b.header.map((h, j) => <th key={j} className="border border-[#2a2722] px-3 py-1.5 text-left font-semibold text-ink bg-[#1a1714]">{renderInline(h, `${key}-h-${j}`)}</th>)}</tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, ri) => (
                      <tr key={ri}>{r.map((c, ci) => <td key={ci} className="border border-[#2a2722] px-3 py-1.5 align-top">{renderInline(c, `${key}-${ri}-${ci}`)}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "p":
            return <p key={key} className="whitespace-pre-wrap">{renderInline(b.lines.join("\n"), key)}</p>;
        }
      })}
    </div>
  );
}
