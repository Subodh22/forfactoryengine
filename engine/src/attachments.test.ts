import { describe, expect, it } from "vitest";
import { buildDataUrl, inferMime, parseDataUrl, safeFilename } from "./attachments";

describe("inferMime", () => {
  it("prefers the provided mime", () => {
    expect(inferMime("notes.txt", "text/x-custom")).toBe("text/x-custom");
  });

  it("maps known extensions", () => {
    expect(inferMime("README.md")).toBe("text/markdown");
    expect(inferMime("data.JSON")).toBe("application/json");
  });

  it("falls back to octet-stream", () => {
    expect(inferMime("binary.xyz")).toBe("application/octet-stream");
    expect(inferMime("no-extension")).toBe("application/octet-stream");
  });
});

describe("buildDataUrl / parseDataUrl round trip", () => {
  it("keeps images as plain data URLs", () => {
    const url = buildDataUrl("image/png", "aGk=", "shot.png");
    expect(url).toBe("data:image/png;base64,aGk=");
    const parsed = parseDataUrl(url);
    expect(parsed).toMatchObject({ mime: "image/png", name: null, base64: "aGk=", isImage: true });
  });

  it("embeds and recovers the filename for non-images", () => {
    const url = buildDataUrl("text/plain", "aGk=", "my notes & más.txt");
    const parsed = parseDataUrl(url);
    expect(parsed).toMatchObject({
      mime: "text/plain",
      name: "my notes & más.txt",
      base64: "aGk=",
      isImage: false,
    });
  });

  it("defaults an empty mime to octet-stream", () => {
    const parsed = parseDataUrl("data:;base64,aGk=");
    expect(parsed?.mime).toBe("application/octet-stream");
  });

  it("returns null for non-data-URL input", () => {
    expect(parseDataUrl("https://example.com/x.png")).toBeNull();
    expect(parseDataUrl("data:image/png,not-base64-marker")).toBeNull();
  });
});

describe("safeFilename", () => {
  it("flattens path separators so names cannot escape the worktree", () => {
    const safe = safeFilename("../../../etc/passwd");
    expect(safe).not.toContain("/");
    expect(safe).not.toContain("\\");
    expect(safe.startsWith(".")).toBe(false);
  });

  it("strips leading dots", () => {
    expect(safeFilename(".env")).toBe("env");
  });

  it("never returns an empty name", () => {
    expect(safeFilename("")).toBe("attachment");
    expect(safeFilename("...")).toBe("attachment");
  });

  it("keeps ordinary names intact", () => {
    expect(safeFilename("design-spec_v2.pdf")).toBe("design-spec_v2.pdf");
  });
});
