import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CTX_DIR = path.join(ROOT, "contexts");

function ctxFile(id) {
  return path.join(CTX_DIR, `${id}.json`);
}

export function loadContext(id) {
  try {
    return JSON.parse(fs.readFileSync(ctxFile(id), "utf8"));
  } catch {
    return { id, stages: {} };
  }
}

export function saveContext(ctx) {
  fs.mkdirSync(CTX_DIR, { recursive: true });
  fs.writeFileSync(ctxFile(ctx.id), JSON.stringify(ctx, null, 2), "utf8");
}

/** 把描述 HTML 转纯文本并结构化提取 仓库/需求/验收标准 */
export function parseDescription(html) {
  const text = String(html || "")
    .replace(/<[^>]*>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
  const plain = text.replace(/\s+/g, " ").trim();
  const repo = (text.match(/仓库\s*[：:]\s*([^\n，。;；]+)/) || [])[1]?.trim() || "";
  const requirement =
    (text.match(/需求\s*[：:]\s*([\s\S]*?)(?=\n\s*(?:验收标准|仓库)\s*[：:]|$)/) || [])[1]?.trim() || "";
  const acceptance =
    (text.match(/验收标准\s*[：:]\s*([\s\S]*?)(?=\n\s*(?:需求|仓库)\s*[：:]|$)/) || [])[1]?.trim() || "";
  return { repo, requirement, acceptance, text: plain };
}

/** 环节结论转可读文本 */
export function stageSummary(stage, v) {
  if (!v) return "";
  switch (stage) {
    case "eval":
      return `评估结论：${v.verdict}——${v.summary || ""}`;
    case "split":
      return `拆分结论：${v.needs_split ? `需要拆分（${v.subtasks?.length || 0} 个子任务）：${v.reason || ""}` : `无需拆分（${v.reason || ""}）`}`;
    case "exec":
      return `执行结论：${v.status}——${v.summary || ""}（分支 ${v.branch || "-"}）`;
    default:
      return "";
  }
}
