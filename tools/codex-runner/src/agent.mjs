import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cfg from "./config.mjs";
import { log } from "./log.mjs";

let codexBin = null;

function resolveCodexBin() {
  if (codexBin) return codexBin;
  const pathDirs = (process.env.PATH || "").split(";");
  for (const dir of pathDirs) {
    if (!dir) continue;
    const shim = ["codex.cmd", "codex.ps1"].find((s) => fs.existsSync(path.join(dir, s)));
    if (shim) {
      const js = path.join(dir, "node_modules", "@openai", "codex", "bin", "codex.js");
      if (fs.existsSync(js)) {
        codexBin = js;
        return codexBin;
      }
    }
  }
  try {
    const prefix = execSync("npm prefix -g", { encoding: "utf8" }).trim();
    const candidate = path.join(prefix, "node_modules", "@openai", "codex", "bin", "codex.js");
    if (fs.existsSync(candidate)) codexBin = candidate;
  } catch {
    /* fallback below */
  }
  return codexBin;
}

function parseEvents(stdout) {
  let threadId = "";
  let lastMessage = "";
  let hasError = false;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type === "thread.started" && e.thread_id) threadId = e.thread_id;
    if (e.type === "error") hasError = true;
    if (e.type === "item.completed" && e.item?.type === "agent_message" && e.item?.text) {
      lastMessage = e.item.text;
    }
  }
  return { threadId, lastMessage: lastMessage.trim(), hasError };
}

/**
 * 运行 codex agent。
 * mode=create：新开会话（-s 指定沙箱）；mode=resume：续接会话（-c sandbox_mode 覆盖沙箱，显式 thread_id）。
 * cwd 始终由 spawn 控制（resume 跟随进程 cwd）。
 */
export async function runCodex({
  mode = "create",
  threadId = "",
  cwd,
  sandbox = "read-only",
  prompt,
  timeoutMs = cfg.codexTimeoutMs,
  label = "agent",
}) {
  if (cfg.dryRun) {
    const canned = {
      eval: '{"verdict":"PASS","summary":"（演练）需求明确，评估通过"}',
      split: '{"needs_split":false,"reason":"（演练）任务无需拆分"}',
      exec: '{"status":"DONE","summary":"（演练）执行完成，已提交本地分支","verification":"（演练）运行应用验证音量入口"}',
      verify: '{"verdict":"PASS","issues":[],"summary":"（演练）黑盒验收通过"}',
    };
    log(`[${label}] [dry-run] skip codex exec${mode === "resume" ? " (resume)" : ""}`);
    return { ok: true, dryRun: true, threadId: "", lastMessage: canned[label] || "", error: null };
  }

  try {
    const promptDir = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "logs");
    fs.mkdirSync(promptDir, { recursive: true });
    fs.writeFileSync(path.join(promptDir, `prompt-${Date.now()}-${label}.txt`), prompt, "utf8");
  } catch {
    /* ignore */
  }

  const args =
    mode === "resume"
      ? ["exec", "resume", threadId, "--skip-git-repo-check", "-c", `sandbox_mode="${sandbox}"`, "--json", "-"]
      : ["exec", "-C", cwd, "-s", sandbox, "--json", "-"];

  const bin = resolveCodexBin();
  const cmd = bin ? process.execPath : "codex";
  const spawnArgs = bin ? [bin, ...args] : args;

  return await new Promise((resolve) => {
    log(`[${label}] codex ${mode} start (cwd=${cwd}, sandbox=${sandbox}${threadId ? `, resume=${threadId}` : ""})`);
    let child;
    const timer = setTimeout(() => {
      log(`[${label}] timeout after ${timeoutMs}ms, killing`);
      if (child) child.kill();
    }, timeoutMs);
    try {
      child = spawn(cmd, spawnArgs, { stdio: ["pipe", "pipe", "pipe"], cwd });
    } catch (err) {
      clearTimeout(timer);
      log(`[${label}] spawn error: ${err.message}`);
      resolve({ ok: false, error: err.message, threadId: "", lastMessage: "" });
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      log(`[${label}] spawn error: ${err.message}`);
      resolve({ ok: false, error: err.message, threadId: "", lastMessage: "" });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const { threadId: gotThread, lastMessage, hasError } = parseEvents(stdout);
      const ok = code === 0 && !hasError;
      log(`[${label}] codex exit=${code} thread=${gotThread || "-"} ok=${ok}`);
      if (stderr) log(`[${label}] stderr: ${stderr.slice(0, 500)}`);
      resolve({ ok, exitCode: code, threadId: gotThread, lastMessage, error: ok ? null : stderr.slice(0, 1000) });
    });
    child.stdin.end(prompt);
  });
}

export function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      /* fall through */
    }
  }
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}
