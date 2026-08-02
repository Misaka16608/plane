import cfg, { resolveRepo } from "./config.mjs";
import { log } from "./log.mjs";
import * as plane from "./plane.mjs";
import { runCodex, extractJson, branchExists } from "./agent.mjs";
import { isInFlight, setInFlight, clearInFlight, recentlyProcessed, markProcessed } from "./state.mjs";

let states = {};

export async function refreshStates() {
  states = await plane.getStates(cfg.roles.exec.token);
  return states;
}

export function stateName(id) {
  for (const [name, sid] of Object.entries(states)) {
    if (sid === id) return name;
  }
  return id || "";
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function parseRepo(issue) {
  const text = stripHtml(issue.description_html);
  const m = text.match(/仓库\s*[：:]\s*([^\s，。;；]+)/);
  return m ? m[1] : cfg.defaultRepo || "";
}

function rollbackState(stage) {
  return { eval: "待评估", split: "待拆分", exec: "待执行" }[stage];
}

export function stageFor(issue) {
  if (!issue || issue.archived_at || issue.deleted_at) return null;
  const name = stateName(issue.state_id);
  const assignees = issue.assignee_ids || [];
  if (name === "待评估" && assignees.includes(cfg.roles.eval.userId)) return "eval";
  if (name === "待拆分" && assignees.includes(cfg.roles.split.userId)) return "split";
  if (name === "待执行" && assignees.includes(cfg.roles.exec.userId)) return "exec";
  return null;
}

async function commentText(issue) {
  const cs = await plane.getComments(issue.id, cfg.roles.exec.token).catch(() => []);
  if (!cs.length) return "（无）";
  return cs
    .slice(-10)
    .map((c) => `${c.actor_detail?.display_name || c.actor || "?"}: ${stripHtml(c.comment_html)}`)
    .join("\n");
}

function buildPrompt(issue, body) {
  return `你是 Plane 任务流程中的 Codex 自动化执行器（角色账号）。请严格按指令执行，只做任务要求的事。\n\n${body}`;
}

async function handleEval(issue) {
  const token = cfg.roles.eval.token;
  await plane.addComment(issue.id, "自动化：评估开始（codex_eval）。", token);
  await plane.updateIssue(issue.id, { state: states["评估中"] }, token);
  const repo = parseRepo(issue);
  const prompt = buildPrompt(
    issue,
    `你是流程中的"评估者"（codex_eval）。\n任务：${issue.name}\n描述：${stripHtml(issue.description_html)}\n评论历史：\n${await commentText(issue)}\n目标代码仓库：${repo || "（未指定，将用默认）"}\n\n请评估需求是否明确、范围是否清晰、能否进入拆分。只做分析，不要修改任何文件。\n最后输出 JSON（不要有其他文字）：{"verdict":"PASS 或 NEED_INFO","summary":"评估结论"}`
  );
  const res = await runCodex({ cwd: resolveRepo(repo) || process.cwd(), sandbox: "read-only", prompt, label: "eval" });
  const j = extractJson(res.lastMessage);
  const summary = j?.summary || (res.dryRun ? "（演练）评估通过" : res.lastMessage.slice(0, 500) || "无结论");
  if (res.ok && j?.verdict === "PASS") {
    await plane.addComment(issue.id, `评估通过：${escapeHtml(summary)}`, token);
    await plane.updateIssue(issue.id, { state: states["待拆分"], assignee_ids: [cfg.roles.split.userId] }, token);
    log(`issue ${issue.id} eval PASS -> 待拆分`);
  } else {
    await plane.addComment(issue.id, `评估未通过（信息不足/待补充）：${escapeHtml(summary)}`, token);
    await plane.updateIssue(issue.id, { state: states["待评估"] }, token);
    log(`issue ${issue.id} eval NEED_INFO -> 待评估`);
  }
}

async function handleSplit(issue) {
  const token = cfg.roles.split.token;
  await plane.addComment(issue.id, "自动化：拆分判断开始（codex_split）。", token);
  await plane.updateIssue(issue.id, { state: states["拆分中"] }, token);
  const repo = parseRepo(issue);
  const prompt = buildPrompt(
    issue,
    `你是流程中的"拆分者"（codex_split）。\n任务：${issue.name}\n描述：${stripHtml(issue.description_html)}\n评论历史：\n${await commentText(issue)}\n目标代码仓库：${repo || "（未指定）"}\n\n请判断任务是否需要拆分为多个子任务。只做分析，不要修改任何文件。\n最后输出 JSON（不要有其他文字）：\n{"needs_split":true或false,"reason":"判断理由","subtasks":[{"name":"子任务名","description":"子任务需求说明"}]}\n不需要拆分时 subtasks 为空数组。`
  );
  const res = await runCodex({ cwd: resolveRepo(repo) || process.cwd(), sandbox: "read-only", prompt, label: "split" });
  const j = extractJson(res.lastMessage);
  if (res.ok && j && j.needs_split === false) {
    await plane.addComment(issue.id, `无需拆分：${escapeHtml(j.reason || "直接走父任务")}`, token);
    await plane.updateIssue(issue.id, { state: states["待执行"], assignee_ids: [cfg.roles.exec.userId] }, token);
    log(`issue ${issue.id} split no -> 待执行`);
  } else if (res.ok && j && j.needs_split === true && Array.isArray(j.subtasks) && j.subtasks.length > 0) {
    for (const st of j.subtasks) {
      try {
        await plane.createIssue(
          {
            name: st.name,
            description_html: `<p>${escapeHtml(st.description || "")}</p>`,
            state: states["待评估"],
            assignee_ids: [cfg.roles.eval.userId],
            parent_id: issue.id,
          },
          token
        );
      } catch (err) {
        log(`createIssue(subtask) failed: ${err.message}; retry without parent`);
        const created = await plane.createIssue(
          {
            name: st.name,
            description_html: `<p>${escapeHtml(st.description || "")}</p>`,
            state: states["待评估"],
            assignee_ids: [cfg.roles.eval.userId],
          },
          token
        );
        await plane.updateIssue(created.id, { parent_id: issue.id }, token);
      }
    }
    await plane.addComment(
      issue.id,
      `已拆分为 ${j.subtasks.length} 个子任务：${j.subtasks.map((s) => escapeHtml(s.name)).join("、")}。父任务停在拆分者处，等待子任务完成。`,
      token
    );
    log(`issue ${issue.id} split -> ${j.subtasks.length} subtasks`);
  } else {
    const reason = res.lastMessage.slice(0, 500) || res.error || "无法解析输出";
    await plane.addComment(issue.id, `拆分判断失败：${escapeHtml(reason)}`, token);
    await plane.updateIssue(issue.id, { state: states["待拆分"] }, token);
    log(`issue ${issue.id} split failed -> 待拆分`);
  }
}

async function handleExec(issue) {
  const token = cfg.roles.exec.token;
  await plane.addComment(issue.id, "自动化：执行开始（codex_exec）。", token);
  await plane.updateIssue(issue.id, { state: states["执行中"] }, token);
  const repo = parseRepo(issue);
  const repoPath = resolveRepo(repo);
  if (!repoPath) {
    await plane.addComment(
      issue.id,
      `执行失败：无法定位目标仓库"${escapeHtml(repo)}"。请在任务描述中写明 仓库：<仓库名>，或检查 runner 配置。状态回退"待执行"。`,
      token
    );
    await plane.updateIssue(issue.id, { state: states["待执行"] }, token);
    return;
  }
  const branch = `codex/${issue.sequence_id || issue.id.slice(0, 8)}`;
  const prompt = buildPrompt(
    issue,
    `你是流程中的"执行者"（codex_exec）。\n任务：${issue.name}\n描述：${stripHtml(issue.description_html)}\n评论历史：\n${await commentText(issue)}\n工作仓库：${repoPath}\n\n请：1) 按任务需求修改代码；2) 自检（按仓库约定，如 tsc/lint/build）；3) 把改动提交到本地分支 ${branch}（git checkout -b ${branch}，再 git add/commit，**不要 push**，不要提交无关改动）。\n最后输出 JSON（不要有其他文字）：{"status":"DONE 或 BLOCKED","summary":"改动说明","files_changed":["文件列表"],"commit":"提交哈希或略"}`
  );
  const res = await runCodex({ cwd: repoPath, sandbox: "workspace-write", prompt, label: "exec" });
  const j = extractJson(res.lastMessage);
  const branchOk = await branchExists({ cwd: repoPath, branch });
  if (res.ok && j?.status === "DONE" && (branchOk || res.dryRun)) {
    await plane.addComment(issue.id, `执行完成（分支 ${branch}）：${escapeHtml(j.summary || "")}`, token);
    await plane.updateIssue(issue.id, { state: states["待验收"], assignee_ids: [cfg.roles.verify.userId] }, token);
    log(`issue ${issue.id} exec DONE -> 待验收`);
  } else {
    const reason = j?.summary || res.lastMessage.slice(0, 500) || res.error || "执行失败";
    await plane.addComment(issue.id, `执行失败：${escapeHtml(reason)}。状态回退"待执行"。`, token);
    await plane.updateIssue(issue.id, { state: states["待执行"] }, token);
    log(`issue ${issue.id} exec failed -> 待执行`);
  }
}

async function checkParentCompletion(issue) {
  const name = stateName(issue.state_id);
  if (name !== "拆分中" && name !== "评估中") return;
  const all = await plane.listIssues();
  const children = all.filter((c) => c.parent_id === issue.id);
  if (children.length === 0) return;
  const settled = children.every((c) => ["已完成", "取消"].includes(stateName(c.state_id)));
  if (!settled) return;
  const allDone = children.every((c) => stateName(c.state_id) === "已完成");
  const token = cfg.roles.split.token;
  if (allDone) {
    await plane.addComment(issue.id, `自动化：全部 ${children.length} 个子任务已完成，父任务推进到"已完成"。`, token);
    await plane.updateIssue(issue.id, { state: states["已完成"], assignee_ids: [cfg.roles.verify.userId] }, token);
    log(`issue ${issue.id} parent all done -> 已完成`);
  } else {
    await plane.addComment(issue.id, "自动化：存在子任务失败/取消，父任务返回评估者重新评估。", token);
    await plane.updateIssue(issue.id, { state: states["评估中"], assignee_ids: [cfg.roles.eval.userId] }, token);
    log(`issue ${issue.id} parent has failure -> 评估中`);
  }
}

export async function processIssue(issueId) {
  const issue = await plane.getIssue(issueId);
  if (!issue) {
    log(`issue ${issueId} not found, skip`);
    return;
  }
  const stage = stageFor(issue);
  if (stage) {
    if (isInFlight(issue.id)) {
      log(`issue ${issue.id} in-flight, skip`);
      return;
    }
    if (recentlyProcessed(issue.id, stage, 60_000)) {
      log(`issue ${issue.id} recently processed (${stage}), skip`);
      return;
    }
    setInFlight(issue.id, { stage, at: new Date().toISOString() });
    try {
      const handlers = { eval: handleEval, split: handleSplit, exec: handleExec };
      await handlers[stage](issue);
    } catch (err) {
      log(`issue ${issue.id} ${stage} handler error: ${err.message}`);
      try {
        await plane.addComment(issue.id, `自动化执行异常：${escapeHtml(err.message)}`, cfg.roles[stage].token);
        await plane.updateIssue(issue.id, { state: states[rollbackState(stage)] }, cfg.roles[stage].token);
      } catch {
        /* best effort */
      }
    } finally {
      clearInFlight(issue.id);
      markProcessed(issue.id, stage);
    }
  } else if (!issue.parent_id) {
    await checkParentCompletion(issue);
  }
}
