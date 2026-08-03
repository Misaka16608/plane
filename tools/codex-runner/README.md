# Codex Runner

Plane → Codex 自动化 runner：监听工作区 webhook + 定时扫描，按"assignee + 状态"触发对应角色 Codex 执行，并回写状态/评论。

## 配置

1. `copy .env.example .env`，按本机填写（仓库绝对路径、默认仓库、端口等）；
2. token 自动从 `apps/api/.env` 读取（`CODEX_EVAL/SPLIT/EXEC/VERIFY_TOKEN` 与 `_USER_ID`）；
3. 创建 webhook 后把 `secret_key` 填入 `.env` 的 `WEBHOOK_SECRET`。

## 运行

```powershell
node src/runner.mjs          # 常驻：webhook + 扫描
node src/runner.mjs --once   # 单次扫描后退出
node src/runner.mjs --task <issue-id>  # 处理指定任务后退出
```

## 触发条件

- 评估：`assignee=codex_eval` 且状态=待评估
- 拆分：`assignee=codex_split` 且状态=待拆分
- 执行：`assignee=codex_exec` 且状态=待执行
- 验收：`assignee=codex_verify` 且状态=待验收（黑盒验收，PASS→已完成；REJECT→回"待执行"返工，连续 3 轮→转人工）
- 父任务收尾：全部子任务进入终态后——全部完成→"已完成"；部分完成+部分取消→"已完成"（部分交付）；未终态→继续等待

任务描述须写明目标仓库，格式：`仓库：WeatherPetUnity`（未写时用 `CODEX_DEFAULT_REPO`）。

## 单子绑定上下文（ticket-bound context）

- 每个单子有一条绑定的上下文记录：`contexts/<issue-id>.json`（gitignored），随流程累积；
- 每环节结束后，runner 把该环节的结构化结论写入记录（评估 verdict/summary、拆分方案/subtasks、执行 summary/分支/commit）；
- 每个角色处理时，prompt 由"单子基础信息（单子/仓库/需求/验收标准/描述全文）+ 前面环节结论 + 父单子信息 + 评论历史 + 角色指令"构成——上下文绑定在单子上，不依赖会话记忆；
- 每次 `codex exec` 仍是全新会话，但开场 prompt 携带该单子的完整快照；
- 调试：实际发送的 prompt 会落盘到 `logs/prompt-<时间戳>-<环节>.txt`。

## 会话绑定（v1.6）

- 每个单子最多绑定三个 Codex 会话：**评估会话**（评估+拆分共用）、**执行会话**、**验收会话**；子任务的拆分相关会话 = 父任务拆分会话（thread_id 共享）；
- 环节再进入时有历史（thread_id 存在）→ `codex exec resume`，否则新开；返工 resume 执行会话、二次验收 resume 验收会话；
- thread_id 从 `--json` 首事件 `thread.started` 捕获；resume 跟随进程 cwd（runner 用 spawn cwd 控制）；resume 沙箱用 `-c sandbox_mode="read-only|workspace-write"` 覆盖；**禁用 --last**（会误捡桌面会话）；
- 降级：resume 失败 → 新开会话 + 重注入单子上下文，不阻塞。

## 执行与验收隔离（v1.6）

- 每个单子在目标仓库旁建一个 **worktree**（`<仓库父目录>\.codex-wt\<单子id>`），执行 agent 在其中**只改文件**（不执行 git 命令），跑完后由 **runner 侧提交**到本地分支 `codex/<单号>`（如 `codex/2026080201-26`，单号 = 项目标识-序号，不 push）——避免 agent 沙箱无法写 worktree 外 `.git` 的问题；验收 agent 在同一 worktree 做黑盒验收（可构建/运行，禁改源码）；单子完成后自动清理 worktree；
- 子任务直接进入"待执行"（跳过评估/拆分），最多拆一次不递归。

## 护栏

- 执行只改指定仓库、自动 commit 到本地分支 `codex/<标识>`，不 push；
- 失败：评论说明 + 状态回退"待X"，不自动重试；
- in-flight 记录在 `state.json`，防重复触发；
- `RUNNER_DRY_RUN=1` 用于编排演练（不真正执行 codex exec）。
