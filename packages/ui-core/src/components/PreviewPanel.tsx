"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { Globe, RotateCw, ExternalLink, ArrowLeft, ArrowRight, Smartphone, Monitor, Tablet } from "lucide-react";

interface Props {
  deployUrl?: string;
}

type Viewport = "desktop" | "tablet" | "mobile";

const VIEWPORT_WIDTHS: Record<Viewport, string> = {
  desktop: "100%",
  tablet: "768px",
  mobile: "375px",
};

export function PreviewPanel({ deployUrl }: Props) {
  const [url, setUrl] = useState(deployUrl || "");
  const [activeUrl, setActiveUrl] = useState(deployUrl || "");
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Update when deployUrl changes
  useEffect(() => {
    if (deployUrl && !activeUrl) {
      setUrl(deployUrl);
      setActiveUrl(deployUrl);
    }
  }, [deployUrl, activeUrl]);

  const navigate = useCallback(() => {
    let target = url.trim();
    if (!target) return;
    if (!/^https?:\/\//i.test(target)) target = "https://" + target;
    setUrl(target);
    setActiveUrl(target);
    setError(false);
    setLoading(true);
  }, [url]);

  const reload = useCallback(() => {
    if (!activeUrl) return;
    setLoading(true);
    setError(false);
    if (iframeRef.current) {
      iframeRef.current.src = activeUrl;
    }
  }, [activeUrl]);

  if (!activeUrl) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 p-6 text-muted">
        <Globe className="w-10 h-10 opacity-30" />
        <p className="text-[13px] text-center max-w-[280px]">
          Enter a URL below to preview, or deploy your changes to see them here automatically.
        </p>
        <div className="flex items-center gap-2 w-full max-w-[400px]">
          <input
            ref={inputRef}
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && navigate()}
            placeholder="https://..."
            className="flex-1 bg-concrete border border-[#332f28] rounded px-3 py-1.5 text-[12px] font-data text-ink placeholder:text-muted/50 outline-none focus:border-[#4ade80]/40"
          />
          <button
            onClick={navigate}
            className="px-3 py-1.5 text-[11px] uppercase font-data bg-concrete-2 border border-[#332f28] rounded text-ink hover:bg-concrete-2/80 transition-colors"
          >
            Go
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Browser toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[#332f28] bg-concrete flex-shrink-0">
        {/* Navigation buttons */}
        <button
          onClick={() => iframeRef.current?.contentWindow?.history.back()}
          className="p-1 rounded hover:bg-concrete-2 text-muted hover:text-ink transition-colors"
          title="Back"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => iframeRef.current?.contentWindow?.history.forward()}
          className="p-1 rounded hover:bg-concrete-2 text-muted hover:text-ink transition-colors"
          title="Forward"
        >
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={reload}
          className={`p-1 rounded hover:bg-concrete-2 text-muted hover:text-ink transition-colors ${loading ? "animate-spin" : ""}`}
          title="Reload"
        >
          <RotateCw className="w-3.5 h-3.5" />
        </button>

        {/* URL bar */}
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && navigate()}
          className="flex-1 min-w-0 bg-surface-deep border border-[#332f28] rounded px-2 py-0.5 text-[11px] font-data text-ink placeholder:text-muted/50 outline-none focus:border-[#4ade80]/40 mx-1"
        />

        {/* Viewport toggles */}
        <div className="flex items-center border border-[#332f28] rounded overflow-hidden">
          {([
            { key: "desktop" as Viewport, icon: Monitor },
            { key: "tablet" as Viewport, icon: Tablet },
            { key: "mobile" as Viewport, icon: Smartphone },
          ]).map(({ key, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setViewport(key)}
              className={`p-1 transition-colors ${viewport === key ? "bg-concrete-2 text-ink" : "text-muted hover:text-ink hover:bg-concrete-2/60"}`}
              title={key}
            >
              <Icon className="w-3 h-3" />
            </button>
          ))}
        </div>

        {/* Open externally */}
        <a
          href={activeUrl}
          target="_blank"
          rel="noreferrer"
          className="p-1 rounded hover:bg-concrete-2 text-muted hover:text-ink transition-colors"
          title="Open in browser"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* iframe container */}
      <div className="flex-1 min-h-0 flex items-start justify-center bg-[#1a1816] overflow-auto">
        {error ? (
          <div className="flex flex-col items-center justify-center gap-3 p-6 text-muted h-full">
            <Globe className="w-8 h-8 opacity-30" />
            <p className="text-[12px] text-center">
              Cannot embed this page. It may block iframe embedding.
            </p>
            <a
              href={activeUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] font-data uppercase text-[#4ade80] hover:underline"
            >
              Open in browser instead
            </a>
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            src={activeUrl}
            onLoad={() => setLoading(false)}
            onError={() => { setLoading(false); setError(true); }}
            className="bg-white border-0 h-full transition-all duration-200"
            style={{ width: VIEWPORT_WIDTHS[viewport], maxWidth: "100%" }}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            title="Preview"
          />
        )}
      </div>
    </div>
  );
}
