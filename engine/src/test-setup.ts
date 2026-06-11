import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// db.ts and output-log.ts resolve FACTORY_DATA_DIR at import time, so each test
// file (isolated worker) gets its own throwaway data dir before any src import.
process.env.FACTORY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-"));
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
