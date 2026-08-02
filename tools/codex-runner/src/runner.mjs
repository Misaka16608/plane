import http from "node:http";
import crypto from "node:crypto";
import cfg from "./config.mjs";
import { log } from "./log.mjs";
import { refreshStates, processIssue } from "./flow.mjs";
import * as plane from "./plane.mjs";

const queue = [];
let processing = false;
let scanTimer = null;

function enqueue(issueId) {
  if (!queue.includes(issueId)) queue.push(issueId);
  pump();
}

async function pump() {
  if (processing) return;
  while (queue.length) {
    const id = queue.shift();
    processing = true;
    try {
      await processIssue(id);
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
  let issues = [];
  try {
    issues = await plane.listIssues();
  } catch (err) {
    log(`listIssues failed: ${err.message}`);
    return;
  }
  for (const issue of issues) {
    if (!issue.parent_id) enqueue(issue.id);
    else enqueue(issue.id);
  }
  log(`scan done: ${issues.length} issues enqueued`);
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
          enqueue(issueId);
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
      log(`workspace=${cfg.workspace} project=${cfg.project}`);
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
