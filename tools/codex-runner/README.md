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
- 父任务收尾：全部子任务完成 → 父任务"已完成"；存在失败 → 父任务回"评估中"

任务描述须写明目标仓库，格式：`仓库：WeatherPetUnity`（未写时用 `CODEX_DEFAULT_REPO`）。

## 单子绑定上下文（ticket-bound context）

- 每个单子有一条绑定的上下文记录：`contexts/<issue-id>.json`（gitignored），随流程累积；
- 每环节结束后，runner 把该环节的结构化结论写入记录（评估 verdict/summary、拆分方案/subtasks、执行 summary/分支/commit）；
- 每个角色处理时，prompt 由"单子基础信息（单子/仓库/需求/验收标准/描述全文）+ 前面环节结论 + 父单子信息 + 评论历史 + 角色指令"构成——上下文绑定在单子上，不依赖会话记忆；
- 每次 `codex exec` 仍是全新会话，但开场 prompt 携带该单子的完整快照；
- 调试：实际发送的 prompt 会落盘到 `logs/prompt-<时间戳>-<环节>.txt`。

## 护栏

- 执行只改指定仓库、自动 commit 到本地分支 `codex/<标识>`，不 push；
- 失败：评论说明 + 状态回退"待X"，不自动重试；
- in-flight 记录在 `state.json`，防重复触发；
- `RUNNER_DRY_RUN=1` 用于编排演练（不真正执行 codex exec）。
