export interface ParsedAttachment {
  mime: string;
  name: string | null;
  base64: string;
  isImage: boolean;
}

export function parseDataUrl(dataUrl: string): ParsedAttachment | null {
  const m = dataUrl.match(/^data:([^;,]*)((?:;[^;,]+)*);base64,(.*)$/);
  if (!m) return null;
  const [, rawMime, params, base64] = m;
  const mime = rawMime || "application/octet-stream";
  const nameMatch = params.match(/;name=([^;]+)/);
  let name: string | null = null;
  if (nameMatch) {
    try { name = decodeURIComponent(nameMatch[1]); } catch { name = nameMatch[1]; }
  }
  return { mime, name, base64, isImage: mime.startsWith("image/") };
}

export function attachmentLabel(dataUrl: string): string {
  const parsed = parseDataUrl(dataUrl);
  if (parsed?.name) return parsed.name;
  const ext = parsed?.mime.split("/")[1] || "file";
  return `attachment.${ext}`;
}
