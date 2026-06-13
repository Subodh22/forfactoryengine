"use client";
import { useState, useCallback } from "react";
import { X, FileText } from "lucide-react";
import { parseDataUrl, attachmentLabel } from "@/lib/attachments";

interface Props {
  src: string;
  onRemove?: () => void;
  size?: number;
}

export function AttachmentPreview({ src, onRemove, size = 64 }: Props) {
  const parsed = parseDataUrl(src);
  const dim = { width: size, height: size };
  const [open, setOpen] = useState(false);

  const openPreview = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (parsed?.isImage) setOpen(true);
  }, [parsed?.isImage]);

  return (
    <>
      <div className="relative group">
        {parsed?.isImage ? (
          <img
            src={src}
            alt=""
            style={dim}
            className="object-cover border border-[#332f28] cursor-pointer hover:opacity-80 transition-opacity"
            onClick={openPreview}
          />
        ) : (
          <div style={dim} title={attachmentLabel(src)} className="flex flex-col items-center justify-center gap-1 border border-[#332f28] bg-paper px-1.5 text-center">
            <FileText className="w-4 h-4 text-ink shrink-0" />
            <span className="font-data text-[9px] leading-tight text-ink truncate w-full">{attachmentLabel(src)}</span>
          </div>
        )}
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="absolute -top-1.5 -right-1.5 bg-ink border border-[#332f28] p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <X className="w-2.5 h-2.5 text-concrete" />
          </button>
        )}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 cursor-pointer"
          onClick={() => setOpen(false)}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute top-4 right-4 bg-ink border border-[#332f28] p-1.5 hover:bg-[#444] transition-colors"
          >
            <X className="w-5 h-5 text-concrete" />
          </button>
          <img
            src={src}
            alt=""
            className="max-w-[90vw] max-h-[90vh] object-contain border border-[#332f28]"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
