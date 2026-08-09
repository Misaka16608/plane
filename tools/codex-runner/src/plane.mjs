import cfg from "./config.mjs";

function base(p) {
  return `/api/workspaces/${p.workspace}/projects/${p.project}`;
}

async function api(path, { method = "GET", token, body } = {}) {
  const headers = { "X-Api-Key": token, "Content-Type": "application/json" };
  let res;
  try {
    res = await fetch(`${cfg.planeUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    throw new Error(`network error ${method} ${path}: ${err.message}`);
  }
  const text = await res.text().catch(() => "");
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  return { ok: res.ok, status: res.status, data };
}

export async function getIssue(id, p) {
  const { ok, data } = await api(`${base(p)}/issues/${id}/`, { token: cfg.roles.exec.token });
  return ok ? data : null;
}

export async function listIssues(p) {
  const out = [];
  let cursor = null;
  for (let i = 0; i < 100; i++) {
    const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const { ok, data } = await api(`${base(p)}/issues/${suffix}`, { token: cfg.roles.exec.token });
    if (!ok) throw new Error("listIssues failed");
    const results = Array.isArray(data) ? data : data?.results || [];
    out.push(...results);
    if (!data?.next_cursor) break;
    cursor = data.next_cursor;
  }
  return out;
}

export async function updateIssue(id, patch, token, p) {
  const { ok, status, data } = await api(`${base(p)}/issues/${id}/`, {
    method: "PATCH",
    token,
    body: patch,
  });
  if (!ok) throw new Error(`updateIssue ${id} -> ${status}: ${JSON.stringify(data || {}).slice(0, 200)}`);
  return data;
}

export async function addComment(issueId, html, token, p) {
  const { ok, status, data } = await api(`${base(p)}/issues/${issueId}/comments/`, {
    method: "POST",
    token,
    body: { comment_html: html },
  });
  if (!ok) throw new Error(`addComment -> ${status}: ${JSON.stringify(data || {}).slice(0, 200)}`);
  return data;
}

export async function getComments(issueId, token, p) {
  const { ok, data } = await api(`${base(p)}/issues/${issueId}/comments/`, { token });
  return ok ? data || [] : [];
}

export async function createIssue(data, token, p) {
  const { ok, status, data: body } = await api(`${base(p)}/issues/`, {
    method: "POST",
    token,
    body: data,
  });
  if (!ok) throw new Error(`createIssue -> ${status}: ${JSON.stringify(body || {}).slice(0, 200)}`);
  return body;
}

export async function getStates(token, p) {
  const { ok, data } = await api(`${base(p)}/states/`, { token });
  const map = {};
  for (const s of data || []) map[s.name] = s.id;
  return map;
}

const projectIdentifierCache = new Map();
export async function getProjectIdentifier(token, p) {
  const key = `${p.workspace}/${p.project}`;
  if (projectIdentifierCache.has(key)) return projectIdentifierCache.get(key);
  const { ok, data } = await api(`${base(p)}/`, { token });
  const identifier = ok && data?.identifier ? data.identifier : "";
  projectIdentifierCache.set(key, identifier);
  return identifier;
}

export async function createWebhook(token, p, url) {
  const { ok, status, data } = await api(`/api/workspaces/${p.workspace}/webhooks/`, {
    method: "POST",
    token,
    body: { url, issue: true, issue_comment: true, is_active: true },
  });
  if (!ok) throw new Error(`createWebhook -> ${status}: ${JSON.stringify(data || {}).slice(0, 300)}`);
  return data;
}
