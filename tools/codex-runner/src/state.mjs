import fs from "node:fs";
import cfg from "./config.mjs";

let data = {};
try {
  data = JSON.parse(fs.readFileSync(cfg.stateFile, "utf8"));
} catch {
  /* fresh start */
}

function save() {
  try {
    fs.writeFileSync(cfg.stateFile, JSON.stringify(data, null, 2));
  } catch {
    /* ignore */
  }
}

export function isInFlight(id) {
  return !!data[id];
}

export function setInFlight(id, info) {
  data[id] = info;
  save();
}

export function clearInFlight(id) {
  delete data[id];
  save();
}

// 处理冷却：防止 runner 自身事件造成同环节重复触发
const processed = {}; // issueId -> { stage, at }

export function recentlyProcessed(id, stage, cooldownMs) {
  const p = processed[id];
  return !!p && p.stage === stage && Date.now() - p.at < cooldownMs;
}

export function markProcessed(id, stage) {
  processed[id] = { stage, at: Date.now() };
}
