---
title: Huajingflow 的 Docker 部署使用记录
description: 从双镜像构建到 Compose 编排、数据持久化、迁移与蓝绿发布的项目实战复盘。
date: '2026-08-19'
slug: huajingflow-docker-deployment
tags:
  - Docker
  - Docker Compose
  - FastAPI
  - Next.js
  - PostgreSQL
  - Redis
  - Celery
  - Deployment
lang: zh
published: true
publicationId: c4cc09b3-de7c-49e8-b428-489b897fecaa
series: Engineering Notes
---
> \[!abstract] 这篇记录什么
> 这不是 Docker 命令速查表，而是从 Huajingflow 的实际部署配置出发，梳理它为什么需要多个容器、每个 Dockerfile 和 Compose 文件负责什么，以及从本地启动到生产蓝绿发布时真正需要守住的边界。

## 1. 先理解：Docker 在 Huajingflow 里解决了什么

Huajingflow 是一个 AI 图片生成与编辑工作流画布，仓库由两部分组成：

- `web/`：Next.js 前端，负责工作流画布、项目和素材交互。
- `api/`：FastAPI 后端，负责认证、工作流持久化、素材、模型调用和 SSE 推送。

但一个 API 进程不足以完成全部工作。图片生成是长任务，不能阻塞 HTTP 请求；数据库和缓存也不能随应用重启而丢失。因此运行时被拆成以下服务：

```text
Browser
  |
  v
web (Next.js :3001)
  |
  v
api (FastAPI :8000) ----> PostgreSQL
  |                         |
  |                         v
  +---------------------> Redis <----- worker (Celery)
                                  ^
                                  |
                               beat (Celery)

migrate: 在应用启动前执行 Alembic 数据库迁移
```

Docker 的价值不只是“把项目跑起来”。在这个项目中，它把 API、Web、异步任务、数据库和缓存分别封装成边界清晰的进程，并让本地与服务器使用同一类运行单元。

## 2. 两个 Dockerfile：API 与 Web 的镜像如何构建

### 2.1 API：Python 运行环境 + uv 锁定依赖

`api/Dockerfile` 使用 `python:3.12-slim` 作为基础镜像。它有几个关键选择：

```dockerfile
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
```

- `PYTHONDONTWRITEBYTECODE=1`：避免容器内生成大量 `.pyc` 文件。
- `PYTHONUNBUFFERED=1`：让日志立即输出，`docker logs` 与日志采集系统才能实时看到异常。
- `ffmpeg`、`libgl1`、`libglib2.0-0`：这是图像和多媒体处理常见的系统依赖。Python 包能安装不代表运行时不缺系统库。

依赖安装使用 `uv`，并通过 `uv.lock` 固定：

```dockerfile
COPY pyproject.toml uv.lock README.md alembic.ini ./
COPY .vendor ./.vendor
COPY alembic ./alembic
COPY config ./config
COPY src ./src

RUN uv sync --frozen --no-dev
```

`--frozen` 的含义是构建只能使用锁文件中已经确定的依赖版本；锁文件与项目声明不一致时直接失败。这样 CI、开发机与服务器不会因为“今天安装到了另一个小版本”而表现不同。

镜像最后把虚拟环境加入 `PATH`，默认以 Uvicorn 对外监听：

```dockerfile
ENV PATH="/app/.venv/bin:${PATH}"
EXPOSE 8000
CMD ["uvicorn", "HuajingflowApi.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

这里 `--host 0.0.0.0` 很关键。容器内若只监听 `127.0.0.1`，同一 Docker 网络里的其他容器也无法访问它。

### 2.2 Web：多阶段构建避免把开发依赖带进生产

`web/Dockerfile` 的核心是四个阶段：`base`、`dependencies`、`production-dependencies`、`builder`、`runner`。

```text
base
 ├─ dependencies            # 完整依赖，用于执行 pnpm build
 ├─ production-dependencies # 仅生产依赖
 └─ builder                 # 构建 .next
      └─ runner             # 最终运行镜像
```

最终 `runner` 只复制必要的产物：

```dockerfile
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY package.json ./

EXPOSE 3001
CMD ["node", "node_modules/next/dist/bin/next", "start", "--port", "3001", "--hostname", "0.0.0.0"]
```

这样不会把源码、测试依赖和构建缓存全部塞进生产镜像。镜像更小，攻击面更少，发布时拉取也更快。

项目依赖 GitHub Packages 的私有包，因此安装阶段通过 BuildKit secret 临时写入 `.npmrc`：

```dockerfile
RUN --mount=type=secret,id=node_auth_token \
    sh -c '... pnpm install --frozen-lockfile ... && rm /root/.npmrc'
```

重点是 Token 不写进 Dockerfile、环境变量或最终镜像层。构建结束后 `.npmrc` 被删除，运行中的 Web 容器不应持有下载依赖所需的凭据。

## 3. `.dockerignore`：让构建上下文保持干净

API 和 Web 都有各自的 `.dockerignore`：

- API 忽略 `.venv`、缓存、测试、`dist` 与 `.env*`。
- Web 忽略 `.next`、`node_modules`、coverage 与 `.env*`。

它的作用有两层：

1. 缩小发送给 Docker daemon 的构建上下文，提升构建速度。
2. 防止本地依赖、构建产物或密钥文件被意外 `COPY` 进镜像。

特别是 `.env*`：镜像应是可公开分发的构建产物；运行参数应在启动时注入，而不是固化进镜像。

## 4. 本地 Compose：服务依赖不只是启动顺序

根目录 `docker-compose.yml` 是本地或单机部署的完整编排。它同时定义：服务、端口、卷、依赖条件、重启策略、健康检查和资源上限。

### 4.1 数据库迁移作为一次性服务

`migrate` 与 API 使用同一 API 镜像，但覆盖启动命令：

```yaml
migrate:
  image: ghcr.io/sancai-aigc/huajingflow:${API_IMAGE_TAG:-latest}
  command: alembic upgrade head
  depends_on:
    postgres:
      condition: service_healthy
  restart: "no"
```

它只在 PostgreSQL 健康后执行一次，然后退出。`api` 与 `worker` 再使用：

```yaml
depends_on:
  migrate:
    condition: service_completed_successfully
```

这比“数据库容器先启动，应用稍等两秒”可靠得多。端口可用不等于数据库已就绪，更不等于 schema 已升级。

### 4.2 Healthcheck 是依赖的真正信号

PostgreSQL 的健康检查：

```yaml
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U huajingflow -d huajingflow"]
  interval: 10s
  timeout: 5s
  retries: 5
```

生产 `compose.app.yml` 又为 Web、API、Worker 增加了各自的检查：

- Web 请求自身的 release status 接口。
- API 请求 `/api/v1/health/ready`。
- Worker 用 `celery inspect ping` 精确检查指定 worker 实例。

这说明健康检查不该只有“进程还活着”。它应该尽量接近这个服务真正能否提供职责。

### 4.3 一个 API 镜像，三个不同进程

同一个 API 镜像被以不同命令运行：

```yaml
api:
  command: uvicorn HuajingflowApi.main:app --host 0.0.0.0 --port 8000

worker:
  command: celery -A HuajingflowApi.worker.celery_app.celery_app worker --loglevel=info

beat:
  command: celery -A HuajingflowApi.worker.celery_app.celery_app beat --loglevel=info
```

- `api`：处理同步 HTTP / SSE 请求。
- `worker`：消费 Redis 中的异步任务，例如图片生成。
- `beat`：只负责定时调度，不能和 worker 合并，否则多实例下可能重复触发定时任务。

镜像是运行环境；容器命令才决定进程角色。这是将构建与运行职责分离的一个实际例子。

## 5. 卷、网络、环境变量：状态与密钥放在哪里

### 5.1 Named volume 保存必须跨重启存在的数据

```yaml
volumes:
  postgres-data:
    name: ${POSTGRES_VOLUME_NAME:-api_postgres-data}
  asset-data:
    name: ${ASSET_VOLUME_NAME:-api_asset-data}
```

- `postgres-data` 挂载到 `/var/lib/postgresql/data`，保存数据库文件。
- `asset-data` 挂载到 `/app/.data/storage`，由 API 与 Worker 共同使用，保存本地素材。

容器是可替换的，卷不是。执行 `docker compose down` 不加 `-v` 时，容器会删除但命名卷保留；这也是数据库不会因为重建容器而丢失的原因。反过来，生产环境不能随意执行 `docker compose down -v`。

### 5.2 环境变量只在启动时注入

服务通过 `env_file: .env` 读取运行配置。这里通常有数据库连接、Redis、JWT、模型 Key、对象存储信息等敏感内容。

原则是：

- 提交 `.env.example`，不提交真实 `.env`。
- `NEXT_PUBLIC_*` 会进入浏览器 bundle，永远不能放密钥。
- 生产环境文件放在服务器受限目录，例如 `/etc/huajingflow-release/app.env`，并设置 `chmod 600`。
- 私有 npm 包 Token 使用 BuildKit secret，仅存在于构建步骤。

### 5.3 代理与 DNS 是 Worker 的运行条件

Worker 需要请求外部模型服务，因此配置了 `HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY`，并用：

```yaml
extra_hosts:
  - host.docker.internal:host-gateway
```

让 Linux 容器可用 `host.docker.internal` 找到宿主机代理。`NO_PROXY` 必须列出内部服务名，例如 `api`、`postgres`、`redis`；否则容器间流量也会绕到代理，带来故障或延迟。

## 6. Compose 的生产拆分：应用、迁移、数据库不是同一件事

生产目录没有沿用一份巨大的 Compose 文件，而是拆为：

```text
deploy/
├── compose.app.yml       # 某一颜色的 Web / API / Worker / Beat
├── compose.migrate.yml   # 一次性 Alembic 迁移
└── compose.database.yml  # PostgreSQL 实例
```

这样拆分是为了让不同生命周期的资源独立管理：

- 应用可以频繁替换镜像。
- 迁移是可审计的一次性动作。
- 数据库和卷是最需要谨慎保护的状态资源。

生产 Compose 用 `${VAR:?message}` 强制关键变量存在，例如 `API_IMAGE`、`WEB_IMAGE`、`RELEASE_COLOR`。变量缺失时，`docker compose config` 就会失败，而不是默默使用空值启动一个错误服务。

## 7. 蓝绿发布：不是同时启动两套容器就结束了

Huajingflow 的发布脚本使用蓝绿两种颜色。蓝色对外服务时，绿色是下一次发布目标；反之亦然。

```text
公网请求
  |
1Panel / OpenResty 反向代理
  |                 \
  v                  v
blue:3001         green:3002
  |                  |
api-blue         api-green
  |                  |
各自 app 网络，避免跨色 DNS 路由

共享：session 网络（Web + Redis）与 data 网络（API/Worker + PostgreSQL/Redis）
```

这里的重点是“隔离”，而不只是“双份”。每种颜色使用独立 Compose project、独立 app 网络和 `api-blue` / `api-green` 别名，避免新 Web 意外连到旧 API。

项目还在业务请求中携带 `X-Expected-Release-Color` 与 `X-Expected-Release-Id`。如果请求落到了错误颜色或错误发布版本，API 在产生业务副作用前返回 `503 release_route_mismatch`。这属于运行时握手：Docker 网络隔离负责减少错误路径，应用层身份校验负责在错误发生时 fail closed。

### 发布前后必须经过的检查

生产脚本要求镜像使用不可变 digest，而不是只传 `latest`：

```bash
sudo bash /app/Huajingflow/deploy/linux/blue-green-release.sh \
  --config /etc/huajingflow-release/release.env \
  --dry-run \
  deploy \
  --release-id 2026.07.28-1 \
  --api-image ghcr.io/org/huajingflow-api@sha256:... \
  --web-image ghcr.io/org/huajingflow-web@sha256:...
```

先 `--dry-run`，确认活动颜色、目标颜色和镜像摘要；确认无误后才替换成 `--apply`。脚本还会：

1. 启动目标颜色并检查容器健康。
2. 连续检查目标 Web 的发布身份。
3. 通过 1Panel API 原子切换 `3001` / `3002` 上游。
4. 从真实公网入口连续验证目标颜色与发布 ID。
5. 保留旧 Web/API 一段回滚窗口；旧 Worker 只有队列排空后才停止。

数据库 schema 变化比应用替换更危险。Huajingflow 的策略是先以物理副本演练迁移，再在写入排空、源库冻结、目标副本追平并提升后执行迁移与切流。新数据库产生写入并到达 `COMMITTED` 后，不再允许普通回滚，避免双主和数据分叉。

## 8. CI/CD：从代码变更到可部署镜像

GitHub Actions 分别构建 API 和 Web 镜像：

```text
api/** 变更  -> lint + pytest -> Buildx -> GHCR API image
web/** 变更  -> lint + build  -> Buildx -> GHCR Web image
```

两个 workflow 都有三个值得保留的点：

- **先测试后推镜像**：失败的源码不应该被包装为部署产物。
- **按路径触发**：只改 API 不重建 Web，减少无效 CI。
- **`type=sha,format=long` 标签**：每个镜像可追溯到具体 Git commit；生产发布再用 digest 锁定内容。

Buildx 同时使用 GitHub Actions Cache：

```yaml
cache-from: type=gha
cache-to: type=gha,mode=max
```

缓存不改变构建结果，但能显著减少重复安装依赖的时间。

## 9. 我会如何在本地排查 Docker 问题

先不要急着删容器。顺序比命令更重要：

```bash
# 1. 先把最终 Compose 配置渲染出来，检查变量和服务依赖
docker compose config

# 2. 查看服务、端口与退出状态
docker compose ps

# 3. 按服务看日志，而不是只看总日志
docker compose logs -f api
docker compose logs -f worker
docker compose logs -f migrate

# 4. 确认健康检查与迁移状态
docker compose ps
docker compose exec postgres pg_isready -U huajingflow -d huajingflow

# 5. 进入容器验证网络、环境变量和挂载路径
docker compose exec api sh
```

常见现象与优先检查方向：

| 现象 | 首先检查 |
| --- | --- |
| API 一直未启动 | `migrate` 是否成功结束、PostgreSQL 是否 healthy、`DATABASE_URL` 是否正确 |
| 页面打开但请求失败 | `BACKEND_BASE_URL`、Web 到 API 的 Docker 网络、API ready endpoint |
| 任务一直 pending | Redis 地址、Worker 日志、Celery queue 名称、Worker healthcheck |
| 重建后素材或数据没了 | 是否误删卷、是否使用了正确的 `ASSET_VOLUME_NAME` / 数据库卷 |
| Worker 无法请求外部模型 | `PROXY_URL`、`host.docker.internal`、DNS、`NO_PROXY` 是否正确 |
| 新版部署后偶发访问旧 API | 蓝绿 app 网络、release header、反向代理上游切换是否一致 |

## 10. 这次整理后的部署原则

1. **镜像不可变，配置可注入。** 镜像用 commit tag / digest 追踪；密钥和环境差异在运行时注入。
2. **进程职责单一。** API、Worker、Beat、迁移各自独立，才能分别扩缩容、重启和观测。
3. **依赖以健康状态表达。** 不依赖 sleep；数据库 ready、迁移完成、API ready 都应是明确条件。
4. **数据比应用更重要。** 卷、数据库、副本和迁移必须有独立生命周期，不能被一次 `down -v` 或错误回滚带走。
5. **生产部署要能证明正确。** 健康检查、发布身份、不可变镜像、干跑和状态机，都是在切流前后缩小不确定性的手段。

***

## 参考配置

- `D:\Desktop\Huajingflow\api\Dockerfile`
- `D:\Desktop\Huajingflow\web\Dockerfile`
- `D:\Desktop\Huajingflow\docker-compose.yml`
- `D:\Desktop\Huajingflow\deploy\compose.app.yml`
- `D:\Desktop\Huajingflow\deploy\README.md`
- `D:\Desktop\Huajingflow\.github\workflows\build-api-image.yml`
- `D:\Desktop\Huajingflow\.github\workflows\publish-web-image.yml`
