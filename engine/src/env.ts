import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Minimal .env loader (no dependency). Loads engine/.env and the cwd's .env so
// GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET etc. are available. Import this FIRST.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const candidates = [path.resolve(__dirname, "../.env"), path.resolve(process.cwd(), ".env")];

for (const file of candidates) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
