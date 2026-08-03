import { spawn } from "node:child_process";
function runGit(cwd, args) {
  return new Promise((resolve) => {
    const child = spawn("git", args, { stdio: ["ignore", "pipe", "pipe"], cwd });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
    });
    child.stderr.on("data", (d) => {
      err += d.toString();
    });
    child.on("close", (code) => resolve({ ok: code === 0, code, out: out.trim(), err: err.trim() }));
    child.on("error", (e) => resolve({ ok: false, code: -1, out: "", err: e.message }));
  });
}

export async function branchExists(repoPath, branch) {
  const r = await runGit(repoPath, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
  return r.ok;
}

/** 确保单子 worktree 存在且位于目标分支（分支不存在时从 HEAD 创建） */
export async function worktreeEnsure(repoPath, branch, wtPath) {
  const list = await runGit(repoPath, ["worktree", "list", "--porcelain"]);
  if (list.out.includes(wtPath)) {
    await runGit(wtPath, ["checkout", branch]);
    return true;
  }
  const hasBranch = await branchExists(repoPath, branch);
  if (hasBranch) {
    return (await runGit(repoPath, ["worktree", "add", wtPath, branch])).ok;
  }
  return (await runGit(repoPath, ["worktree", "add", "-b", branch, wtPath, "HEAD"])).ok;
}

export async function worktreeRemove(repoPath, wtPath) {
  return (await runGit(repoPath, ["worktree", "remove", "--force", wtPath])).ok;
}

/** runner 侧提交 worktree 内全部改动（runner 不受沙箱限制，可写 .git） */
export async function commitWorktree(wtPath, message) {
  const add = await runGit(wtPath, ["add", "-A"]);
  if (!add.ok) return { ok: false, error: add.err };
  const commit = await runGit(wtPath, ["commit", "-m", message]);
  if (!commit.ok) return { ok: false, error: commit.err };
  const hash = commit.out.split("\n").filter(Boolean).pop() || "";
  return { ok: true, hash };
}
