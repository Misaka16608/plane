import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LOG_DIR = process.env.LOG_DIR || path.join(ROOT, "logs");

function ts() {
  return new Date().toISOString();
}

export function log(...args) {
  const line = `[${ts()}] ${args.join(" ")}`;
  console.log(line);
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    fs.appendFileSync(path.join(LOG_DIR, `runner-${day}.log`), line + "\n");
  } catch {
    /* ignore */
  }
}
