import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cfg from "./config.mjs";
import { log } from "./log.mjs";

let codexBin = null;

function resolveCodexBin() {
  if (codexBin) return codexBin;
  // 1) 从 PATH 中的 codex shim（codex.cmd/codex.ps1）所在目录推导真实 js 入口
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
  // 2) 回退：npm 全局前缀
  try {
    const prefix = execSync("npm prefix -g", { encoding: "utf8" }).trim();
    const candidate = path.join(prefix, "node_modules", "@openai", "codex", "bin", "codex.js");
    if (fs.existsSync(candidate)) codexBin = candidate;
  } catch {
    /* fallback below */
  }
  return codexBin;
}

export async function runCodex({ cwd, sandbox = "read-only", prompt, timeoutMs = cfg.codexTimeoutMs, label = "agent" }) {
  if (cfg.dryRun) {
    log(`[${label}] [dry-run] skip codex exec`);
    const canned = {
      eval: '{"verdict":"PASS","summary":"（演练）需求明确，评估通过"}',
      split: '{"needs_split":false,"reason":"（演练）任务无需拆分"}',
      exec: '{"status":"DONE","summary":"（演练）执行完成，已提交本地分支"}',
    };
    return { ok: true, dryRun: true, lastMessage: canned[label] || "", error: null };
  }
  const outFile = path.join(
    os.tmpdir(),
    `codex-runner-${Date.now()}-${Math.random().toString(36).slice(2)}.md`
  );
  const args = ["exec", "-C", cwd, "-s", sandbox, "-o", outFile, "-"];
  const bin = resolveCodexBin();
  const cmd = bin ? process.execPath : "codex";
  const spawnArgs = bin ? [bin, ...args] : args;
  return await new Promise((resolve) => {
    log(`[${label}] codex exec start (cwd=${cwd}, sandbox=${sandbox})`);
    const timer = setTimeout(() => {
      log(`[${label}] timeout after ${timeoutMs}ms, killing`);
      child.kill();
    }, timeoutMs);
    let child;
    try {
      child = spawn(cmd, spawnArgs, { stdio: ["pipe", "pipe", "pipe"], cwd });
    } catch (err) {
      clearTimeout(timer);
      log(`[${label}] spawn error: ${err.message}`);
      resolve({ ok: false, error: err.message, lastMessage: "" });
      return;
    }
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      log(`[${label}] spawn error: ${err.message}`);
      resolve({ ok: false, error: err.message, lastMessage: "" });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      let lastMessage = "";
      try {
        lastMessage = fs.readFileSync(outFile, "utf8");
      } catch {
        /* no output file */
      }
      try {
        fs.unlinkSync(outFile);
      } catch {
        /* ignore */
      }
      log(`[${label}] codex exec exit=${code}`);
      if (stderr) log(`[${label}] stderr: ${stderr.slice(0, 500)}`);
      resolve({ ok: code === 0, exitCode: code, lastMessage: lastMessage.trim(), error: null, stderr: stderr.slice(0, 1000) });
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

export async function branchExists({ cwd, branch }) {
  return await new Promise((resolve) => {
    const child = spawn("git", ["branch", "--list", branch], { stdio: ["ignore", "pipe", "ignore"], cwd });
    let out = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
    });
    child.on("close", (code) => resolve(code === 0 && out.trim().length > 0));
    child.on("error", () => resolve(false));
  });
}
