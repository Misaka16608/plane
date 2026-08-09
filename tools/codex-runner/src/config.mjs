import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RUNNER_ENV = path.join(ROOT, ".env");
const API_ENV = path.join(ROOT, "..", "..", "apps", "api", ".env");
const PROJECTS_FILE = process.env.PROJECTS_FILE || path.join(ROOT, "projects.json");

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

function normalizeRepoName(name) {
  return String(name || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** 加载多项目配置文件（projects.json）；不存在或解析失败返回 null */
function parseProjectsFile() {
  try {
    const data = JSON.parse(fs.readFileSync(PROJECTS_FILE, "utf8"));
    if (Array.isArray(data)) return { projects: data };
    return data || {};
  } catch {
    return null;
  }
}

// 真实环境变量优先；.env 文件仅作默认值（dotenv 惯例）
const env = { ...parseEnvFile(RUNNER_ENV), ...process.env };
const apiEnv = parseEnvFile(API_ENV);

const projectsCfg = parseProjectsFile() || {};

// 全局仓库池：projects.json 的 defaultRepos（缺省时回落旧 .env REPO_*，保证兼容）
const defaultRepos = {};
for (const [key, val] of Object.entries(projectsCfg.defaultRepos || {})) {
  if (val) defaultRepos[normalizeRepoName(key)] = val;
}
for (const [key, val] of Object.entries(env)) {
  if (key.startsWith("REPO_") && val && !(normalizeRepoName(key.slice(5)) in defaultRepos)) {
    defaultRepos[normalizeRepoName(key.slice(5))] = val;
  }
}

/**
 * 项目列表：
 * - 优先 projects.json 的 projects 数组；
 * - 无配置时回退旧单值模式（PLANE_WORKSPACE + PLANE_PROJECT + 全局 REPO_*）。
 */
function buildProjects() {
  const list = Array.isArray(projectsCfg.projects) ? projectsCfg.projects : [];
  if (list.length) {
    return list
      .filter((p) => p && p.workspace && p.project)
      .map((p) => ({
        workspace: p.workspace,
        project: p.project,
        defaultRepo: p.defaultRepo || "",
        repos: p.repos || {},
        webhookSecret: p.webhookSecret || "",
      }));
  }
  const workspace = env.PLANE_WORKSPACE || "workingcatpet";
  const project = env.PLANE_PROJECT || "";
  if (!project) return [];
  return [{ workspace, project, defaultRepo: env.CODEX_DEFAULT_REPO || "", repos: {}, webhookSecret: "" }];
}

const cfg = {
  planeUrl: (env.PLANE_URL || "http://localhost").replace(/\/+$/, ""),
  port: parseInt(env.RUNNER_PORT || "9399", 10),
  webhookSecret: env.WEBHOOK_SECRET || "",
  adminToken: env.PLANE_ADMIN_TOKEN || "",
  defaultRepo: env.CODEX_DEFAULT_REPO || "",
  codexBin: env.CODEX_BIN || "",
  codexTimeoutMs: parseInt(env.CODEX_TIMEOUT_MIN || "15", 10) * 60_000,
  resumeTimeoutMs: Math.round(parseFloat(env.RESUME_TIMEOUT_MIN || "1.5", 10) * 60_000),
  stepTimeoutMs: Math.round(parseFloat(env.STEP_TIMEOUT_MIN || "5", 10) * 60_000),
  dryRun: env.RUNNER_DRY_RUN === "1",
  stateFile: env.STATE_FILE || path.join(ROOT, "state.json"),
  projects: buildProjects(),
  defaultRepos,
  roles: {
    eval: { token: apiEnv.CODEX_EVAL_TOKEN || "", userId: apiEnv.CODEX_EVAL_USER_ID || "" },
    split: { token: apiEnv.CODEX_SPLIT_TOKEN || "", userId: apiEnv.CODEX_SPLIT_USER_ID || "" },
    exec: { token: apiEnv.CODEX_EXEC_TOKEN || "", userId: apiEnv.CODEX_EXEC_USER_ID || "" },
    verify: { token: apiEnv.CODEX_VERIFY_TOKEN || "", userId: apiEnv.CODEX_VERIFY_USER_ID || "" },
  },
};

/** 项目唯一键：`workspace/project` */
export function projectKey(p) {
  return `${p.workspace}/${p.project}`;
}

/**
 * 按工作区 + 项目定位配置。
 * 两个条件都给出时精确匹配；只给一个时仅在唯一命中时返回，否则 null（由调用方遍历兜底）。
 */
export function findProject(workspace, projectId) {
  const ws = workspace || "";
  const pid = projectId || "";
  const hits = cfg.projects.filter(
    (p) => (!ws || p.workspace === ws) && (!pid || p.project === pid)
  );
  return hits.length === 1 ? hits[0] : null;
}

/**
 * 解析仓库绝对路径：项目级 repos → 全局默认池。
 */
export function resolveRepo(project, name) {
  const norm = normalizeRepoName(name);
  if (!norm) return null;
  if (project?.repos) {
    for (const [key, val] of Object.entries(project.repos)) {
      if (normalizeRepoName(key) === norm && val) return val;
    }
  }
  return defaultRepos[norm] || null;
}

/** 项目默认仓库：项目级 defaultRepo → 全局 defaultRepo */
export function projectDefaultRepo(project) {
  return project?.defaultRepo || cfg.defaultRepo || "";
}

export default cfg;
