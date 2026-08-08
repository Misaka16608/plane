import path from "node:path";
import cfg, { resolveRepo, projectKey, findProject, projectDefaultRepo } from "./config.mjs";
import { log } from "./log.mjs";
import * as plane from "./plane.mjs";
import { runCodex, extractJson } from "./agent.mjs";
import { worktreeEnsure, worktreeRemove, commitWorktree } from "./git.mjs";
import { isInFlight, setInFlight, clearInFlight, recentlyProcessed, markProcessed } from "./state.mjs";
import { loadContext, saveContext, newContext, parseDescription, stageSummary } from "./ticket-context.mjs";

/** 状态映射按项目缓存：key = `workspace/project` */
const statesMap = new Map();

export async function refreshStates() {
  for (const p of cfg.projects) {
    try {
      statesMap.set(projectKey(p), await plane.getStates(cfg.roles.exec.token, p));
    } catch (err) {
      log(`refreshStates failed for ${projectKey(p)}: ${err.message}`);
    }
  }
  return statesMap;
}

export function stateName(p, id) {
  for (const [name, sid] of Object.entries(statesMap.get(projectKey(p)) || {})) {
    if (sid === id) return name;
  }
  return id || "";
}

/** 当前项目的状态名→id 映射（刷新后可用） */
function statesFor(p) {
  return statesMap.get(projectKey(p)) || {};
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

function parseRepo(issue, p) {
  return parseDescription(issue.description_html).repo || projectDefaultRepo(p) || "";
}

/** 单号：项目标识-序号（如 2026080201-25），用于分支名/提交信息 */
async function ticketRef(issue, p) {
  const pid = await plane.getProjectIdentifier(cfg.roles.exec.token, p);
  return issue.sequence_id ? `${pid ? `${pid}-` : ""}${issue.sequence_id}` : issue.id.slice(0, 8);
}

function worktreePath(repoPath, issueId) {
  return path.join(path.dirname(repoPath), ".codex-wt", issueId);
}

const ROLE_NAMES = { eval: "评估者", split: "拆分者", exec: "执行者", verify: "验收者" };

function buildBase(issue, parsed) {
  const lines = [
    `【单子】${issue.name}`,
    parsed.repo ? `【仓库】${parsed.repo}` : "",
    parsed.requirement ? `【需求】${parsed.requirement}` : "",
    parsed.acceptance ? `【验收标准】${parsed.acceptance}` : "",
  ];
  if (parsed.text) lines.push(`【描述全文】${parsed.text}`);
  return lines.filter(Boolean).join("\n");
}

function priorStagesText(ctx) {
  const parts = [];
  for (const stage of ["eval", "split", "exec", "verify"]) {
    if (ctx.stages?.[stage]) parts.push(stageSummary(stage, ctx.stages[stage]));
  }
  return parts.length ? parts.join("\n") : "（无）";
}

async function parentInfo(issue, p) {
  if (!issue.parent_id) return "";
  const parent = await plane.getIssue(issue.parent_id, p).catch(() => null);
  if (!parent) return "";
  const pd = parseDescription(parent.description_html);
  const pctx = loadContext(issue.parent_id);
  const lines = [
    `【父单子】${parent.name}`,
    pd.requirement ? `父单需求：${pd.requirement}` : "",
    pd.acceptance ? `父单验收标准：${pd.acceptance}` : "",
  ];
  const prior = priorStagesText(pctx);
  if (prior !== "（无）") lines.push(`父单结论：\n${prior}`);
  return lines.filter(Boolean).join("\n");
}

async function commentText(issue, p) {
  const cs = await plane.getComments(issue.id, cfg.roles.exec.token, p).catch(() => []);
  if (!cs.length) return "（无）";
  return cs
    .slice(-50)
    .map((c) => `${c.actor_detail?.display_name || c.actor || "?"}: ${stripHtml(c.comment_html)}`)
    .join("\n");
}

async function buildTicketPrompt(issue, role, instructions, p) {
  const ctx = loadContext(issue.id);
  const parsed = parseDescription(issue.description_html);
  const parts = [
    `你是流程中的"${ROLE_NAMES[role]}"（${role}）。`,
    "",
    buildBase(issue, parsed),
    "",
    `【前面环节结论】\n${priorStagesText(ctx)}`,
  ];
  const parent = await parentInfo(issue, p);
  if (parent) parts.push("", parent);
  parts.push("", `【评论历史】\n${await commentText(issue, p)}`, "", instructions);
  return parts.join("\n");
}

function rollbackState(stage) {
  return { eval: "待评估", split: "待拆分", exec: "待执行", verify: "待执行" }[stage];
}

export function stageFor(issue, p) {
  if (!issue || issue.archived_at || issue.deleted_at) return null;
  const name = stateName(p, issue.state_id);
  const assignees = issue.assignee_ids || [];
  if (name === "待评估" && assignees.includes(cfg.roles.eval.userId)) return "eval";
  if (name === "待拆分" && assignees.includes(cfg.roles.split.userId)) return "split";
  if (name === "待执行" && assignees.includes(cfg.roles.exec.userId)) return "exec";
  if (name === "待验收" && assignees.includes(cfg.roles.verify.userId)) return "verify";
  return null;
}

/** 运行环节 agent：会话槽有历史则 resume，否则新开；返回 {res, ctx} */
async function runAgent({ issue, sessionKey, threadIdOverride = "", sandbox, cwd, prompt, label }) {
  const ctx = loadContext(issue.id);
  const threadId = threadIdOverride || ctx.sessions?.[sessionKey] || "";
  const res = await runCodex({ mode: threadId ? "resume" : "create", threadId, cwd, sandbox, prompt, label });
  if (!res.dryRun && res.threadId && !threadId) {
    const fresh = loadContext(issue.id);
    fresh.sessions = fresh.sessions || {};
    fresh.sessions[sessionKey] = res.threadId;
    saveContext(fresh);
  }
  return { res, ctx: loadContext(issue.id) };
}

async function handleEval(issue, p) {
  const token = cfg.roles.eval.token;
  await plane.addComment(issue.id, "自动化：评估开始（codex_eval）。", token, p);
  await plane.updateIssue(issue.id, { state: statesFor(p)["评估中"] }, token, p);
  const repo = parseRepo(issue, p);
  const cwd = resolveRepo(p, repo) || process.cwd();
  const prompt = await buildTicketPrompt(
    issue,
    "eval",
    "请评估需求是否明确、范围是否清晰、能否进入拆分。只做分析，不要修改任何文件。\n在 summary 中先一句话复述任务要点，再给出评估结论。\n最后输出 JSON（不要有其他文字）：{\"verdict\":\"PASS 或 NEED_INFO\",\"summary\":\"复述要点 + 评估结论\"}",
    p
  );
  const { res, ctx } = await runAgent({ issue, sessionKey: "eval", sandbox: "read-only", cwd, prompt, label: "eval" });
  const j = extractJson(res.lastMessage);
  const summary = j?.summary || (res.dryRun ? "（演练）评估通过" : res.lastMessage.slice(0, 500) || "无结论");
  ctx.stages.eval = { verdict: j?.verdict || "NEED_INFO", summary, at: new Date().toISOString() };
  saveContext(ctx);
  if (res.ok && j?.verdict === "PASS") {
    await plane.addComment(issue.id, `评估通过：${escapeHtml(summary)}`, token, p);
    await plane.updateIssue(issue.id, { state: statesFor(p)["待拆分"], assignee_ids: [cfg.roles.split.userId] }, token, p);
    log(`issue ${issue.id} eval PASS -> 待拆分`);
  } else {
    await plane.addComment(issue.id, `评估未通过（信息不足/待补充）：${escapeHtml(summary)}`, token, p);
    await plane.updateIssue(issue.id, { state: statesFor(p)["待评估"] }, token, p);
    log(`issue ${issue.id} eval NEED_INFO -> 待评估`);
  }
}

async function handleSplit(issue, p) {
  const token = cfg.roles.split.token;
  const ctx = loadContext(issue.id);
  await plane.addComment(issue.id, "自动化：拆分判断开始（codex_split）。", token, p);
  await plane.updateIssue(issue.id, { state: statesFor(p)["拆分中"] }, token, p);
  const repo = parseRepo(issue, p);
  const cwd = resolveRepo(p, repo) || process.cwd();
  const isSubtask = ctx.depth >= 1;
  const prompt = await buildTicketPrompt(
    issue,
    "split",
    isSubtask
      ? "该任务为子任务（深度已达上限，不允许再递归拆分）。请判断是否确实需要调整拆分；只做分析，不要修改任何文件。\n最后输出 JSON（不要有其他文字）：\n{\"needs_split\":true或false,\"reason\":\"判断理由\",\"subtasks\":[]}\n若判断需要拆分，请说明理由（runner 会转人工处理）。"
      : "请判断任务是否需要拆分为多个子任务。只做分析，不要修改任何文件。\n若需要拆分，每个子任务的 description 必须包含 仓库、需求、验收标准 字段（供后续环节解析）。\n最后输出 JSON（不要有其他文字）：\n{\"needs_split\":true或false,\"reason\":\"判断理由\",\"subtasks\":[{\"name\":\"子任务名\",\"description\":\"仓库：xxx\\n需求：xxx\\n验收标准：xxx\"}]}\n不需要拆分时 subtasks 为空数组。",
    p
  );
  // 拆分共用评估会话；子任务走父任务拆分会话
  const { res, ctx: ctx2 } = await runAgent({
    issue,
    sessionKey: "eval",
    threadIdOverride: isSubtask ? ctx.parentSplitSession || "" : "",
    sandbox: "read-only",
    cwd,
    prompt,
    label: "split",
  });
  const j = extractJson(res.lastMessage);
  ctx2.stages.split = {
    needs_split: !!j?.needs_split,
    reason: j?.reason || "",
    subtasks: Array.isArray(j?.subtasks) ? j.subtasks : [],
    at: new Date().toISOString(),
  };
  saveContext(ctx2);

  if (isSubtask) {
    if (res.ok && j?.needs_split === true) {
      await plane.addComment(issue.id, `子任务已达拆分深度上限，不允许递归拆分：${escapeHtml(j.reason || "")}。请人工处理父任务的拆分。`, token, p);
      await plane.updateIssue(issue.id, { state: statesFor(p)["待拆分"] }, token, p);
      log(`issue ${issue.id} subtask split denied -> 待拆分 (人工)`);
    } else {
      await plane.addComment(issue.id, `无需再拆分：${escapeHtml(j.reason || "直接走执行")}`, token, p);
      await plane.updateIssue(issue.id, { state: statesFor(p)["待执行"], assignee_ids: [cfg.roles.exec.userId] }, token, p);
      log(`issue ${issue.id} subtask split no -> 待执行`);
    }
    return;
  }

  if (res.ok && j && j.needs_split === false) {
    await plane.addComment(issue.id, `无需拆分：${escapeHtml(j.reason || "直接走父任务")}`, token, p);
    await plane.updateIssue(issue.id, { state: statesFor(p)["待执行"], assignee_ids: [cfg.roles.exec.userId] }, token, p);
    log(`issue ${issue.id} split no -> 待执行`);
  } else if (res.ok && j && j.needs_split === true && Array.isArray(j.subtasks) && j.subtasks.length > 0) {
    const splitSession = ctx2.sessions?.eval || "";
    for (const st of j.subtasks) {
      let created = null;
      try {
        created = await plane.createIssue(
          {
            name: st.name,
            description_html: `<p>${escapeHtml(st.description || "")}</p>`,
            state: statesFor(p)["待执行"],
            assignee_ids: [cfg.roles.exec.userId],
            parent_id: issue.id,
          },
          token,
          p
        );
      } catch (err) {
        log(`createIssue(subtask) failed: ${err.message}; retry without parent`);
        created = await plane.createIssue(
          {
            name: st.name,
            description_html: `<p>${escapeHtml(st.description || "")}</p>`,
            state: statesFor(p)["待执行"],
            assignee_ids: [cfg.roles.exec.userId],
          },
          token,
          p
        );
        await plane.updateIssue(created.id, { parent_id: issue.id }, token, p);
      }
      saveContext(
        newContext(created.id, {
          depth: 1,
          parentId: issue.id,
          parentSplitSession: splitSession,
          workspace: p.workspace,
          project: p.project,
        })
      );
    }
    await plane.addComment(
      issue.id,
      `已拆分为 ${j.subtasks.length} 个子任务（直接进入执行）：${j.subtasks.map((s) => escapeHtml(s.name)).join("、")}。父任务停在拆分者处，等待子任务完成。`,
      token,
      p
    );
    log(`issue ${issue.id} split -> ${j.subtasks.length} subtasks (exec-ready)`);
  } else {
    const reason = res.lastMessage.slice(0, 500) || res.error || "无法解析输出";
    await plane.addComment(issue.id, `拆分判断失败：${escapeHtml(reason)}`, token, p);
    await plane.updateIssue(issue.id, { state: statesFor(p)["待拆分"] }, token, p);
    log(`issue ${issue.id} split failed -> 待拆分`);
  }
}

async function handleExec(issue, p) {
  const token = cfg.roles.exec.token;
  const repo = parseRepo(issue, p);
  const repoPath = resolveRepo(p, repo);
  if (!repoPath) {
    await plane.addComment(
      issue.id,
      `执行失败：无法定位目标仓库"${escapeHtml(repo)}"。请在任务描述中写明 仓库：<仓库名>，或检查 runner 配置。状态回退"待执行"。`,
      token,
      p
    );
    await plane.updateIssue(issue.id, { state: statesFor(p)["待执行"] }, token, p);
    return;
  }
  const ref = await ticketRef(issue, p);
  const branch = `codex/${ref}`;
  const wtPath = cfg.dryRun ? repoPath : worktreePath(repoPath, issue.id);
  if (!cfg.dryRun) {
    const ok = await worktreeEnsure(repoPath, branch, wtPath);
    if (!ok) {
      await plane.addComment(issue.id, '执行失败：无法创建单子 worktree。状态回退"待执行"。', token, p);
      await plane.updateIssue(issue.id, { state: statesFor(p)["待执行"] }, token, p);
      return;
    }
  }
  await plane.addComment(issue.id, "自动化：执行开始（codex_exec）。", token, p);
  await plane.updateIssue(issue.id, { state: statesFor(p)["执行中"] }, token, p);
  const prompt = await buildTicketPrompt(
    issue,
    "exec",
    `请：1) 在 ${wtPath} 中按任务需求修改代码；2) 自检（按仓库约定，如 tsc/lint/build）；3) **不要执行 git add/commit/push**（runner 会负责把改动提交到本地分支 ${branch}），只修改文件并确保改动完整；4) 给出黑盒验证步骤（验收人如何运行、如何验证）。\n最后输出 JSON（不要有其他文字）：{"status":"DONE 或 BLOCKED","summary":"改动说明","files_changed":["文件列表"],"verification":"黑盒验证步骤"}`,
    p
  );
  const { res, ctx: ctx2 } = await runAgent({ issue, sessionKey: "exec", sandbox: "workspace-write", cwd: wtPath, prompt, label: "exec" });
  const j = extractJson(res.lastMessage);
  let commitHash = "";
  if (res.ok && j?.status === "DONE" && !res.dryRun) {
    const c = await commitWorktree(wtPath, `codex(${ref}): ${j?.summary || issue.name}`.slice(0, 200));
    if (!c.ok) {
      await plane.addComment(issue.id, `执行失败：runner 提交失败（${escapeHtml(c.error || "")}）。状态回退"待执行"。`, token, p);
      await plane.updateIssue(issue.id, { state: statesFor(p)["待执行"] }, token, p);
      log(`issue ${issue.id} exec commit failed -> 待执行`);
      return;
    }
    commitHash = c.hash;
  }
  ctx2.stages.exec = {
    status: j?.status || "BLOCKED",
    summary: j?.summary || "",
    branch,
    commit: commitHash,
    files_changed: Array.isArray(j?.files_changed) ? j.files_changed : [],
    verification: j?.verification || "",
    at: new Date().toISOString(),
  };
  saveContext(ctx2);
  if (res.ok && j?.status === "DONE") {
    const verif = j?.verification ? `\n黑盒验证步骤：${j.verification}` : "";
    await plane.addComment(issue.id, `执行完成（分支 ${branch}）：${escapeHtml(j.summary || "")}${escapeHtml(verif)}`, token, p);
    await plane.updateIssue(issue.id, { state: statesFor(p)["待验收"], assignee_ids: [cfg.roles.verify.userId] }, token, p);
    log(`issue ${issue.id} exec DONE -> 待验收`);
  } else {
    const reason = j?.summary || res.lastMessage.slice(0, 500) || res.error || "执行失败";
    await plane.addComment(issue.id, `执行失败：${escapeHtml(reason)}。状态回退"待执行"。`, token, p);
    await plane.updateIssue(issue.id, { state: statesFor(p)["待执行"] }, token, p);
    log(`issue ${issue.id} exec failed -> 待执行`);
  }
}

async function handleVerify(issue, p) {
  const token = cfg.roles.verify.token;
  const repo = parseRepo(issue, p);
  const repoPath = resolveRepo(p, repo);
  const ref = await ticketRef(issue, p);
  const branch = `codex/${ref}`;
  const wtPath = cfg.dryRun ? repoPath || process.cwd() : worktreePath(repoPath || "", issue.id);
  if (!cfg.dryRun && !repoPath) {
    await plane.addComment(issue.id, '验收失败：无法定位目标仓库。状态回退"待执行"。', token, p);
    await plane.updateIssue(issue.id, { state: statesFor(p)["待执行"] }, token, p);
    return;
  }
  await plane.addComment(issue.id, "自动化：验收开始（codex_verify）。", token, p);
  await plane.updateIssue(issue.id, { state: statesFor(p)["验收中"] }, token, p);
  const prompt = await buildTicketPrompt(
    issue,
    "verify",
    `请对分支 ${branch} 的执行结果做**黑盒验收**：1) 在 ${wtPath} 中对照执行结论与【验收标准】检查实际文件/产物（避免依赖 git 命令，直接查看文件内容）；2) 逐条验证，能运行则构建/运行验证，不能运行则做静态核对；3) **禁止修改任何文件**（只可构建/运行/查看）；4) 给出问题清单。\n最后输出 JSON（不要有其他文字）：{"verdict":"PASS 或 REJECT","issues":["问题1","问题2"],"summary":"验收结论"}`,
    p
  );
  const { res, ctx: ctx2 } = await runAgent({ issue, sessionKey: "verify", sandbox: "workspace-write", cwd: wtPath, prompt, label: "verify" });
  const j = extractJson(res.lastMessage);
  ctx2.stages.verify = {
    verdict: j?.verdict || "REJECT",
    issues: Array.isArray(j?.issues) ? j.issues : [],
    summary: j?.summary || "",
    at: new Date().toISOString(),
  };
  saveContext(ctx2);
  if (res.ok && j?.verdict === "PASS") {
    await plane.addComment(issue.id, `黑盒验收通过：${escapeHtml(j.summary || "")}`, token, p);
    await plane.updateIssue(issue.id, { state: statesFor(p)["已完成"] }, token, p);
    if (!cfg.dryRun && repoPath) await worktreeRemove(repoPath, wtPath).catch(() => {});
    log(`issue ${issue.id} verify PASS -> 已完成`);
  } else {
    const issues = Array.isArray(j?.issues) && j.issues.length ? j.issues : [j?.summary || "验收未通过"];
    ctx2.rejectCount = (ctx2.rejectCount || 0) + 1;
    saveContext(ctx2);
    if (ctx2.rejectCount >= 3) {
      await plane.addComment(issue.id, `验收连续 ${ctx2.rejectCount} 轮未通过，需人工介入：\n${issues.map((x) => `- ${escapeHtml(x)}`).join("\n")}`, token, p);
      await plane.updateIssue(issue.id, { state: statesFor(p)["待评估"], assignee_ids: [cfg.roles.eval.userId] }, token, p);
      log(`issue ${issue.id} verify REJECT x${ctx2.rejectCount} -> 待评估 (人工)`);
    } else {
      await plane.addComment(issue.id, `验收未通过（第 ${ctx2.rejectCount} 轮）：\n${issues.map((x) => `- ${escapeHtml(x)}`).join("\n")}`, token, p);
      await plane.updateIssue(issue.id, { state: statesFor(p)["待执行"], assignee_ids: [cfg.roles.exec.userId] }, token, p);
      log(`issue ${issue.id} verify REJECT x${ctx2.rejectCount} -> 待执行 (返工)`);
    }
  }
}

async function checkParentCompletion(issue, p) {
  const name = stateName(p, issue.state_id);
  if (name !== "拆分中") return;
  const all = await plane.listIssues(p);
  const children = all.filter((c) => c.parent_id === issue.id);
  if (children.length === 0) return;
  const settled = children.every((c) => ["已完成", "取消"].includes(stateName(p, c.state_id)));
  if (!settled) return;
  const done = children.filter((c) => stateName(p, c.state_id) === "已完成").length;
  const cancelled = children.length - done;
  const token = cfg.roles.split.token;
  if (cancelled === 0) {
    await plane.addComment(issue.id, `自动化：全部 ${children.length} 个子任务已完成，父任务推进到"已完成"。`, token, p);
  } else {
    await plane.addComment(issue.id, `自动化：子任务部分交付（${done} 完成 / ${cancelled} 取消），父任务推进到"已完成"。取消原因见各子任务评论。`, token, p);
  }
  await plane.updateIssue(issue.id, { state: statesFor(p)["已完成"], assignee_ids: [cfg.roles.verify.userId] }, token, p);
  for (const c of children) {
    if (stateName(p, c.state_id) === "取消") {
      const crepoPath = resolveRepo(p, parseRepo(c, p));
      if (crepoPath && !cfg.dryRun) {
        await worktreeRemove(crepoPath, worktreePath(crepoPath, c.id)).catch(() => {});
      }
    }
  }
  log(`issue ${issue.id} parent settled (${done} done / ${cancelled} cancelled) -> 已完成`);
}

/**
 * 处理一个 issue。
 * hint（可选）：webhook/扫描携带的归属线索 { workspace?, project? }；
 * 无法唯一命中时遍历全部已配置项目兜底，最终以 issue 自带 project_id 为准。
 */
export async function processIssue(issueId, hint = null) {
  let p = hint ? findProject(hint.workspace, hint.project) : null;
  let issue = p ? await plane.getIssue(issueId, p) : null;
  if (!issue) {
    for (const cand of cfg.projects) {
      if (p && projectKey(cand) === projectKey(p)) continue;
      issue = await plane.getIssue(issueId, cand).catch(() => null);
      if (issue) {
        p = cand;
        break;
      }
    }
  }
  if (!issue) {
    log(`issue ${issueId} not found in any configured project, skip`);
    return;
  }
  if (issue.project_id) {
    const byIssue = findProject(null, issue.project_id);
    if (byIssue) p = byIssue;
  }
  if (!p) {
    log(`issue ${issue.id} belongs to unconfigured project ${issue.project_id || "?"}, skip`);
    return;
  }
  const stage = stageFor(issue, p);
  if (stage) {
    if (isInFlight(issue.id)) {
      log(`issue ${issue.id} in-flight, skip`);
      return;
    }
    if (recentlyProcessed(issue.id, stage, 60_000)) {
      log(`issue ${issue.id} recently processed (${stage}), skip`);
      return;
    }
    setInFlight(issue.id, { stage, at: new Date().toISOString(), workspace: p.workspace, project: p.project });
    try {
      const handlers = { eval: handleEval, split: handleSplit, exec: handleExec, verify: handleVerify };
      await handlers[stage](issue, p);
    } catch (err) {
      log(`issue ${issue.id} ${stage} handler error: ${err.message}`);
      try {
        await plane.addComment(issue.id, `自动化执行异常：${escapeHtml(err.message)}`, cfg.roles[stage].token, p);
        await plane.updateIssue(issue.id, { state: statesFor(p)[rollbackState(stage)] }, cfg.roles[stage].token, p);
      } catch {
        /* best effort */
      }
    } finally {
      clearInFlight(issue.id);
      markProcessed(issue.id, stage);
    }
  } else if (!issue.parent_id) {
    await checkParentCompletion(issue, p);
  }
}
