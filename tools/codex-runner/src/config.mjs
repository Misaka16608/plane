import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RUNNER_ENV = path.join(ROOT, ".env");
const API_ENV = path.join(ROOT, "..", "..", "apps", "api", ".env");

function parseEnvFile(file) {
  const out = {};
  try {
    const text = fs.readFileSync(file, "utf8");
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const i = line.indexOf("=");
      if (i < 0) continue;
      let val = line.slice(i + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      out[line.slice(0, i).trim()] = val;
    }
  } catch {
    /* missing file ok */
  }
  return out;
}

// 真实环境变量优先；.env 文件仅作默认值（dotenv 惯例）
const env = { ...parseEnvFile(RUNNER_ENV), ...process.env };
const apiEnv = parseEnvFile(API_ENV);

const cfg = {
  planeUrl: (env.PLANE_URL || "http://localhost").replace(/\/+$/, ""),
  workspace: env.PLANE_WORKSPACE || "workingcatpet",
  project: env.PLANE_PROJECT || "",
  port: parseInt(env.RUNNER_PORT || "9399", 10),
  webhookSecret: env.WEBHOOK_SECRET || "",
  adminToken: env.PLANE_ADMIN_TOKEN || "",
  defaultRepo: env.CODEX_DEFAULT_REPO || "",
  codexTimeoutMs: parseInt(env.CODEX_TIMEOUT_MIN || "15", 10) * 60_000,
  dryRun: env.RUNNER_DRY_RUN === "1",
  stateFile: env.STATE_FILE || path.join(ROOT, "state.json"),
  roles: {
    eval: { token: apiEnv.CODEX_EVAL_TOKEN || "", userId: apiEnv.CODEX_EVAL_USER_ID || "" },
    split: { token: apiEnv.CODEX_SPLIT_TOKEN || "", userId: apiEnv.CODEX_SPLIT_USER_ID || "" },
    exec: { token: apiEnv.CODEX_EXEC_TOKEN || "", userId: apiEnv.CODEX_EXEC_USER_ID || "" },
    verify: { token: apiEnv.CODEX_VERIFY_TOKEN || "", userId: apiEnv.CODEX_VERIFY_USER_ID || "" },
  },
  repoMap: {},
};

for (const [key, val] of Object.entries(env)) {
  if (key.startsWith("REPO_") && val) {
    cfg.repoMap[key.slice(5).toUpperCase()] = val;
  }
}

export function normalizeRepoName(name) {
  return String(name || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function resolveRepo(name) {
  const norm = normalizeRepoName(name);
  return cfg.repoMap[norm] || null;
}

export default cfg;
