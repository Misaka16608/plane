# Plane 本地部署说明（Docker）

> 仓库：`D:\_Code\Server\plane`（fork 自 `Misaka16608/plane`，即 makeplane/plane 的 `preview` 分支）
> 版本：Plane Community Edition 1.4.0
> 部署日期：2026-08-02
> 访问地址：http://localhost

---

## 一、项目简介

Plane 是一个开源的项目管理工具，用来跟踪工作项（Issue）、管理周期（Cycle）、模块（Module）、
项目路线图等，可以替代 Jira 类的商业产品。本仓库是社区版（CE）的完整源码，
包含 Web 主应用、管理员后台（god-mode）、公开分享页（space）、实时协作服务（live）和
Python/Django 后端 API。

### 部署架构（容器组成）

整个系统通过 `docker-compose.yml` 编排，共 13 个容器：

| 容器 | 说明 | 内部端口 |
|---|---|---|
| `proxy` | Caddy 反向代理，统一入口 | 80 / 443（映射到宿主机） |
| `web` | 主应用前端（React SPA + nginx） | 3000 |
| `admin` | 管理员后台 /god-mode | 3000 |
| `space` | 公开分享页 /spaces | 3000 |
| `live` | 实时协作服务 | 3000 |
| `api` | Django 后端 API | 8000 |
| `bgworker` / `beatworker` | 异步任务 Worker（与 api 同一镜像） | 8000 |
| `plane-migrator` | 数据库迁移（启动时执行一次后退出） | — |
| `plane-db` | PostgreSQL 15.7 | 5432 |
| `plane-redis` | Valkey 7.2.11（Redis 兼容） | 6379 |
| `plane-mq` | RabbitMQ 3.13.6 消息队列 | 5672 |
| `plane-minio` | MinIO 对象存储（附件/文件） | 9000 |

数据持久化在 Docker 命名卷中：`pgdata`、`redisdata`、`uploads`、`rabbitmq_data`。

### 访问入口

- http://localhost/ —— 主应用（日常工作区）
- http://localhost/god-mode/ —— 管理员设置（**首次部署在这里创建管理员账号**）
- http://localhost/spaces/ —— 公开分享页

---

## 二、日常启动 / 停止（下次怎么用）

### 启动

1. 启动 **Docker Desktop**（开始菜单搜索 Docker Desktop，等待鲸鱼图标稳定、不再转圈）。
2. 打开 PowerShell，进入项目目录并启动：

```powershell
cd D:\_Code\Server\plane
docker compose up -d
```

3. 浏览器打开 **http://localhost** 即可使用。

> 镜像已经构建好，正常启动只需要几十秒。数据库等数据都存在 Docker 卷里，重启不会丢。

### 停止 / 重启

```powershell
docker compose stop        # 停止所有容器（数据保留）
docker compose restart     # 重启所有容器
docker compose down        # 停止并删除容器（数据卷保留）
docker compose down -v     # ⚠️ 危险：连数据卷一起删除，所有数据丢失！
```

### 常用命令

```powershell
docker compose ps                  # 查看容器状态
docker compose logs -f api         # 跟随查看 API 日志
docker compose logs -f proxy       # 查看 Caddy 日志
docker compose up -d api           # 只重建/启动某个服务
```

### 注意事项

- 80/443 端口被占用时（IIS、其他服务），需改 `.env` 里的 `LISTEN_HTTP_PORT` / `LISTEN_HTTPS_PORT`。
- Docker Desktop 需要联网（本地代理 7890 需保持运行，见下文"网络与代理"）。

---

## 三、从零构建流程（重建整个系统）

以下步骤在镜像不存在或需要完全重建时使用。

### 1. 环境要求

- Windows + Docker Desktop（WSL2 后端），本机为 28.1.1 / 4.41.2
- Git
- 本地代理运行在 `127.0.0.1:7890`（mihomo/Clash 类工具，必须开启）

### 2. 网络与代理（重要）

这台机器直连 `github.com`、`auth.docker.io`（Docker Hub 认证服务）、`sum.golang.org` 均不通，
必须走本地代理。当前 Docker 已配置好两处代理（**不要随意改动**）：

- Docker Desktop 设置（`%APPDATA%\Docker\settings-store.json`）：
  `ProxyHTTPMode=manual`，`OverrideProxyHTTP/HTTPS=http://127.0.0.1:7890`
- Docker 守护进程（`%USERPROFILE%\.docker\daemon.json`）：`proxies` 指向同一代理

克隆仓库时 HTTPS 也不通，需用 SSH（本机已配置 `ssh.github.com:443` 替代规则）：

```powershell
git clone --depth 1 --branch preview git@github.com:Misaka16608/plane.git D:\_Code\Server\plane
```

### 3. 配置环境变量

```powershell
Copy-Item .env.example .env
Copy-Item apps/api/.env.example apps/api/.env
```

`apps/api/.env` 需要按 Compose 部署模式修改：

- `USE_MINIO=1`
- `AWS_S3_ENDPOINT_URL="http://plane-minio:9000"`
- `WEB_URL` / `ADMIN_BASE_URL` / `SPACE_BASE_URL` / `APP_BASE_URL` / `LIVE_BASE_URL` 全部设为 `http://localhost`
- 追加固定 `SECRET_KEY="<随机50位字符串>"`（防止重启后会话失效）

（当前仓库里这些文件已配置好，重装环境时按上述内容核对即可。）

### 4. 开启系统全局代理（关键前提）

`docker compose build` 时 BuildKit 会直接从 Docker 虚拟机内拉取基础镜像，
**必须让虚拟机的流量也走代理**，否则会卡在 `auth.docker.io` 拉取 token 失败。

- 构建前把代理工具（mihomo/Clash）切换到**系统全局模式（TUN）**，确保
  WSL2 / Docker 虚拟机的直连流量也经过代理。
- 如果构建时仍报 `auth.docker.io` / `registry-1.docker.io` 连接失败，说明
  全局代理未生效，请检查代理工具的 TUN / 全局开关后再重试。
- 开启全局代理后**无需任何预拉镜像步骤**，直接构建即可。

### 5. 构建并启动

```powershell
docker compose build     # 构建 9 个应用镜像（约 30-60 分钟）
docker compose up -d     # 启动全部服务（自动跑数据库迁移）
```

### 6. 验证与初始化

```powershell
curl.exe http://localhost/api/instances/   # 应返回实例配置 JSON
docker compose ps                          # 全部 Up / healthy
```

首次使用：打开 http://localhost/god-mode/ → 创建管理员账号
（**密码强度要求：zxcvbn 评分 ≥ 3，建议 16 位以上随机密码，如 `Kx9#mP2vL8qWz4!T`**）
→ 回 http://localhost/ 登录 → 顶部搜索框（Power-K）里 Preferences → Update language 切换中文。

---

## 四、本次部署踩过的坑（历史记录）

| 问题 | 根因 | 解决方案 |
|---|---|---|
| GitHub HTTPS 克隆失败 | 直连被墙 | 用 SSH over 443（`ssh.github.com:443`）克隆 |
| `auth.docker.io` 拉取 token 失败 | Docker Hub 认证域名被墙 | Docker Desktop 设置里配置手动代理 7890 |
| 旧 Docker Desktop 反复崩溃（`com.docker.build` exit 1） | 系统状态损坏 + daemon.json 带 UTF-8 BOM | 完全卸载重装 Docker Desktop；配置文件一律用无 BOM 的 UTF-8 写入 |
| BuildKit 构建时拉基础镜像失败 | Docker 虚拟机内 BuildKit 的直连流量没走代理 | 构建前开启代理的**系统全局模式（TUN）**（见第三节第 4 步） |
| proxy 镜像构建失败（`sum.golang.org` TLS 超时） | Go 校验数据库被墙 | `apps/proxy/Dockerfile.ce` 加 `ENV GOSUMDB=off` |
| proxy 容器无限重启（Caddyfile 解析错误） | compose 没给 Caddy 传 `SITE_ADDRESS` 等变量 | `docker-compose.yml` 的 proxy 服务补上 `SITE_ADDRESS`、`CERT_*`、`TRUSTED_PROXIES` |
| live 容器崩溃（缺 env） | live 服务需要 `API_BASE_URL`、`LIVE_SERVER_SECRET_KEY`、`REDIS_URL` | compose 的 live 服务补上三个环境变量 |
| 界面显示 `auth.common.email.label` 等原始 key | i18n 包预编译后运行时动态导入失效（导入映射为空） | 改为运行时 fetch 加载 `/locales/*.json`，语言目录以卷挂载进 web 容器 |
| 首页问候语显示"早上 早上" | zh-CN 翻译把 `good` 和 `morning` 都译成"早上" | 新增 `greeting` key，中文为"早上好，{name}" |

---

## 五、本地自定义开发

### 翻译热更新（无需重建镜像）

语言文件通过卷挂载到 web 容器（`./packages/i18n/src/locales` → `/usr/share/nginx/html/locales`），
**改文件立即生效**：

```powershell
# 编辑对应语言/命名空间文件，例如：
# D:\_Code\Server\plane\packages\i18n\src\locales\zh-CN\common.json
```

改完浏览器刷新即可（未生效就 Ctrl+F5 强刷）。

### 修改代码后重建

```powershell
# 只改前端（web）代码或 i18n 包
docker compose build web && docker compose up -d web

# 改后端（api）
docker compose build api worker beat-worker migrator && docker compose up -d api worker beat-worker migrator

# 全量重建
docker compose build && docker compose up -d
```

### 当前未提交的本地改动（建议先提交基线 commit）

```text
M apps/proxy/Dockerfile.ce                                   # GOSUMDB=off（绕过被墙的 Go 校验库）
M apps/web/core/components/home/user-greetings.tsx           # 问候语改用 greeting key
M apps/web/core/components/user/user-greetings.tsx           # 同上
M docker-compose.yml                                         # proxy/live 环境变量、web 语言卷挂载
M packages/i18n/src/core/instance.ts                         # 翻译改为运行时 fetch 加载
M packages/i18n/src/locales/en/common.json                   # 新增 greeting
M packages/i18n/src/locales/zh-CN/common.json                # 新增 greeting（早上好，{name}）
```

提交建议：

```powershell
cd D:\_Code\Server\plane
git add -A && git commit -m "fix(deploy): proxy/live env, GOSUMDB, i18n runtime loading and zh greeting"
```

---

## 六、常见问题

**Q：打开页面提示连接不上 / 容器没起来？**
先 `docker compose ps` 看状态，再 `docker compose logs -f <服务名>` 看日志；最常见原因是 Docker Desktop 没启动或代理没开。

**Q：创建管理员提示密码太弱？**
见第三节第 6 步的密码要求（zxcvbn ≥ 3 分），用长随机密码。

**Q：界面语言怎么切换？**
登录后点顶部搜索框（Power-K 命令面板，`Ctrl+K`）→ Preferences → Update language → 简体中文。

**Q：翻译改了没生效？**
确认改的是 `packages/i18n/src/locales/` 下的文件（web 容器内是同一份，卷挂载）；浏览器强刷（Ctrl+F5）。

**Q：想重置所有数据？**
`docker compose down -v`（⚠️ 会清空数据库、文件、队列全部数据），然后重新 `docker compose up -d`，再走一遍初始化。
