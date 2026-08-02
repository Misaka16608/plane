import cfg from "./config.mjs";

const BASE = `/api/workspaces/${cfg.workspace}/projects/${cfg.project}`;

async function api(path, { method = "GET", token, body } = {}) {
  const headers = { "X-Api-Key": token, "Content-Type": "application/json" };
  let res;
  try {
    res = await fetch(`${cfg.planeUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
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

export async function getIssue(id) {
  const { ok, data } = await api(`${BASE}/issues/${id}/`, { token: cfg.roles.exec.token });
  return ok ? data : null;
}

export async function listIssues() {
  const out = [];
  let cursor = null;
  for (let i = 0; i < 100; i++) {
    const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const { ok, data } = await api(`${BASE}/issues/${suffix}`, { token: cfg.roles.exec.token });
    if (!ok) throw new Error("listIssues failed");
    const results = Array.isArray(data) ? data : data?.results || [];
    out.push(...results);
    if (!data?.next_cursor) break;
    cursor = data.next_cursor;
  }
  return out;
}

export async function updateIssue(id, patch, token) {
  const { ok, status, data } = await api(`${BASE}/issues/${id}/`, {
    method: "PATCH",
    token,
    body: patch,
  });
  if (!ok) throw new Error(`updateIssue ${id} -> ${status}: ${JSON.stringify(data || {}).slice(0, 200)}`);
  return data;
}

export async function addComment(issueId, html, token) {
  const { ok, status, data } = await api(`${BASE}/issues/${issueId}/comments/`, {
    method: "POST",
    token,
    body: { comment_html: html },
  });
  if (!ok) throw new Error(`addComment -> ${status}: ${JSON.stringify(data || {}).slice(0, 200)}`);
  return data;
}

export async function getComments(issueId, token) {
  const { ok, data } = await api(`${BASE}/issues/${issueId}/comments/`, { token });
  return ok ? data || [] : [];
}

export async function createIssue(data, token) {
  const { ok, status, data: body } = await api(`${BASE}/issues/`, {
    method: "POST",
    token,
    body: data,
  });
  if (!ok) throw new Error(`createIssue -> ${status}: ${JSON.stringify(body || {}).slice(0, 200)}`);
  return body;
}

export async function getStates(token) {
  const { ok, data } = await api(`${BASE}/states/`, { token });
  const map = {};
  for (const s of data || []) map[s.name] = s.id;
  return map;
}

export async function createWebhook(token, url) {
  const { ok, status, data } = await api(`/api/workspaces/${cfg.workspace}/webhooks/`, {
    method: "POST",
    token,
    body: { url, issue: true, issue_comment: true, is_active: true },
  });
  if (!ok) throw new Error(`createWebhook -> ${status}: ${JSON.stringify(data || {}).slice(0, 300)}`);
  return data;
}
