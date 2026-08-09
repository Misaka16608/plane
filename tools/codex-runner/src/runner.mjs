import http from "node:http";
import crypto from "node:crypto";
import cfg from "./config.mjs";
import { log } from "./log.mjs";
import { refreshStates, processIssue } from "./flow.mjs";
import * as plane from "./plane.mjs";

const queue = [];
let processing = false;
let scanTimer = null;

function enqueue(issueId, hint = null) {
  if (!queue.some((q) => q.id === issueId)) queue.push({ id: issueId, hint: hint || null });
  pump();
}

async function pump() {
  if (processing) return;
  while (queue.length) {
    const { id, hint } = queue.shift();
    processing = true;
    try {
      await processIssue(id, hint);
    } catch (err) {
      log(`process ${id} error: ${err.message}`);
    } finally {
      processing = false;
    }
  }
}

async function scan() {
  try {
    await refreshStates();
  } catch (err) {
    log(`states refresh failed: ${err.message}`);
    return;
  }
  let total = 0;
  for (const p of cfg.projects) {
    let issues = [];
    try {
      issues = await plane.listIssues(p);
    } catch (err) {
      log(`listIssues failed for ${p.workspace}/${p.project}: ${err.message}`);
      continue;
    }
    total += issues.length;
    for (const issue of issues) {
      enqueue(issue.id, { workspace: p.workspace, project: p.project });
    }
  }
  log(`scan done: ${total} issues enqueued across ${cfg.projects.length} project(s)`);
}

function scheduleScan(delayMs = 10000) {
  if (scanTimer) clearTimeout(scanTimer);
  scanTimer = setTimeout(() => {
    scanTimer = null;
    scan();
  }, delayMs);
}

function verifySignature(raw, sig) {
  if (!cfg.webhookSecret) return true;
  const expected = crypto.createHmac("sha256", cfg.webhookSecret).update(raw).digest("hex");
  return sig === expected;
}

function isBotActor(id) {
  if (!id) return false;
  return Object.values(cfg.roles).some((r) => r.userId && r.userId === id);
}

/**
 * 从 webhook payload 提取归属线索。
 * payload 顶层固定带 workspace_id / workspace_slug；
 * issue 事件 data 为完整 issue（含 project_id / workspace_id）；
 * issue_comment 事件 data 为评论（顶层 workspace 可用，project 缺省则交给 processIssue 遍历兜底）。
 */
function hintFromPayload(payload) {
  const data = payload?.data || {};
  const hint = {};
  const ws = payload.workspace_slug || payload.workspace_id || data.workspace_slug || data.workspace_id || "";
  if (ws) hint.workspace = ws;
  const pid =
    data.project_id ||
    data.project_detail?.id ||
    data.issue?.project_id ||
    data.project ||
    "";
  if (pid) hint.project = pid;
  return hint;
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    const url = (req.url || "").split("?")[0];
    try {
      if (req.method === "GET" && url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, queue: queue.length }));
        return;
      }
      if (req.method === "POST" && url === "/scan") {
        res.writeHead(202);
        res.end("ok");
        scan();
        return;
      }
      if (req.method === "POST" && url === "/webhook") {
        const sig = req.headers["x-plane-signature"] || "";
        if (!verifySignature(raw, sig)) {
          log("webhook signature mismatch");
          res.writeHead(401);
          res.end("bad signature");
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        let payload = null;
        try {
          payload = JSON.parse(raw);
        } catch {
          log("webhook bad json");
          return;
        }
        log(`webhook: event=${payload.event} action=${payload.action}`);
        const data = payload.data || {};
        let issueId = null;
        const hint = hintFromPayload(payload);
        if (payload.event === "issue") {
          issueId = data?.id;
        } else if (payload.event === "issue_comment") {
          const actorId = data?.actor_detail?.id || data?.created_by;
          if (isBotActor(actorId)) {
            log("skip own comment event");
            return;
          }
          issueId = data?.issue;
        }
        if (issueId) {
          enqueue(issueId, hint);
          scheduleScan();
        }
        return;
      }
      res.writeHead(404);
      res.end("not found");
    } catch (err) {
      log(`http handler error: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end("error");
      }
    }
  });
});

const args = process.argv.slice(2);

if (args.includes("--once")) {
  refreshStates()
    .then(scan)
    .then(() => process.exit(0))
    .catch((err) => {
      log(`scan failed: ${err.message}`);
      process.exit(1);
    });
} else {
  const taskIdx = args.indexOf("--task");
  if (taskIdx >= 0 && args[taskIdx + 1]) {
    refreshStates()
      .then(() => processIssue(args[taskIdx + 1]))
      .then(() => process.exit(0))
      .catch((err) => {
        log(`task failed: ${err.message}`);
        process.exit(1);
      });
  } else {
    server.listen(cfg.port, () => {
      log(`runner listening on :${cfg.port} (dryRun=${cfg.dryRun})`);
      log(`projects configured: ${cfg.projects.length} (${cfg.projects.map((p) => `${p.workspace}/${p.project}`).join(", ") || "none"})`);
    });
    refreshStates().then(scan).catch((err) => log(`initial scan failed: ${err.message}`));
    setInterval(scan, 5 * 60 * 1000);

    const shutdown = () => {
      log("shutting down");
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 3000);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }
}
