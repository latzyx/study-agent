# Study Agent

基于 **Bun + TypeScript + AI SDK + Elysia + Drizzle ORM + PostgreSQL** 的多 Agent 学习与实践项目。

当前项目已经从简单示例扩展为具备认证、会话、工具执行、意图路由、审计、文件管理、运行时保护和工程化部署能力的 Agent API。

## 核心能力

- OpenAI、Anthropic、LM Studio、vLLM Provider Registry
- 按 `fast/general/reasoning/vision` 配置模型档位
- 请求级模型解析，禁止传入 model 后仍使用构造默认模型
- 可组合的意图识别分类器、候选排序、置信度与歧义检测
- Agent 配置、工具白名单和多步工具执行
- Tool 按 Agent 目录归属，并校验唯一 owner
- JSON 与 SSE 流式聊天
- 最近 50 条会话消息上下文
- Bearer-only JWT 认证
- 服务端 Refresh Token 哈希存储、轮换、复用检测和注销
- 注册、登录、Token 和 Chat 请求限流
- 用户级与 session 级 Chat 并发控制
- Agent、会话、消息、文件、审计与请求日志持久化
- 请求 ID、统一异常响应和生产环境错误脱敏
- PostgreSQL 就绪检查、版本化迁移和优雅关闭
- Swagger API 文档
- Bun 单元测试、类型检查、构建和 PostgreSQL 迁移 CI

## Agent 与 Tool 目录约定

专业 Agent 的工具必须放在自己的目录下：

```text
src/agents/
├── general/
│   └── index.ts
├── math/
│   ├── index.ts
│   └── tools/
│       └── calculator.tool.ts
├── time/
│   ├── index.ts
│   └── tools/
│       └── current-time.tool.ts
├── catalog.ts
└── domain/
    └── agent-definition.ts
```

约束：

- 一个 Tool 只能属于一个内置 Agent。
- `catalog.ts` 是 Agent 定义和 Tool owner 的唯一聚合入口。
- `resolveAgentTools(agentKey, names)` 会拒绝加载其他 Agent 的工具。
- `src/tools/builtin` 仅作为旧代码兼容门面，不再保存 Tool 的真实实现。
- 新增 Agent 时应同时新增独立目录、定义文件、tools 子目录和意图标签。

## 意图识别

意图层位于：

```text
src/intent/
├── classifiers/
│   └── keyword-intent-classifier.ts
├── domain/
│   └── intent.ts
├── intent-router.ts
└── index.ts
```

`IntentRouter` 支持：

- 多分类器并行执行。
- 分类器权重。
- 候选 Agent 排序。
- 最低置信度阈值。
- 第一、第二候选的歧义判断。
- 无匹配时回退 `general`。
- 调用方显式指定 Agent 时，以显式参数为权威来源。

后续接入本地 MacBERT、Embedding Router 或 LLM 分类器时，只需实现 `IntentClassifier`，无需修改 Router 主流程。

## 环境要求

- Bun 1.3+
- PostgreSQL 14+
- 至少一个可用的模型 Provider

## 初始化

```bash
bun install
cp .env.example .env
```

至少修改：

```dotenv
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/study_agent
JWT_SECRET=replace-with-a-long-random-secret-at-least-32-characters
LLM_MODEL_GENERAL=lmstudio:qwen-local
```

生产环境的 `JWT_SECRET` 必须不少于 32 个字符，否则应用会拒绝启动。

### 新数据库

推荐直接执行版本化迁移：

```bash
bun run db:check
bun run db:migrate
bun run db:verify
```

开发阶段需要快速同步 Schema 时也可以使用：

```bash
bun run db:push
```

`db:push` 只适合本地开发，不应替代生产迁移。

### 已有数据库

不要直接对测试库或生产库执行 `db:push`。先阅读：

```text
docs/database-migration-v2.md
```

执行历史数据预检和备份后，再运行：

```bash
bun run db:check
bun run db:migrate
bun run db:verify
```

迁移系统会：

- 按文件名前四位版本号顺序执行 SQL。
- 使用 PostgreSQL advisory lock 防止多个实例同时迁移。
- 在 `study_agent_schema_migrations` 中记录文件名和 SHA-256 checksum。
- 已应用迁移内容被修改时拒绝继续执行。
- 整批迁移失败时回滚事务。

创建下一份迁移：

```bash
bun run db:generate -- add-agent-status
# 编辑生成的 src/db/migrations/0002_add-agent-status.sql
bun run db:check
```

迁移只允许向前追加。不要修改已经部署过的 SQL 文件。

## 运行

开发模式：

```bash
bun run dev
```

普通启动：

```bash
bun run start
```

构建并运行产物：

```bash
bun run build
bun run start:prod
```

默认地址：

- API：`http://localhost:3000/api/v1`
- Swagger：`http://localhost:3000/docs`
- 存活检查：`GET /api/v1/health/live`
- 就绪检查：`GET /api/v1/health/ready`

## CLI

单次提问：

```bash
bun run cli -- "123 * 456 等于多少"
```

交互模式：

```bash
bun run cli
```

输入 `/exit` 或 `/quit` 退出。CLI 只使用模型和工具，不要求配置数据库。

## 认证

项目只接受 Bearer Token，不读取或写入认证 Cookie。

注册或登录后取得：

```json
{
  "token": "access-token",
  "refreshToken": "refresh-token"
}
```

调用业务接口：

```http
Authorization: Bearer <access-token>
```

默认有效期：

- Access Token：15 分钟
- Refresh Token：7 天

可通过以下环境变量修改：

```dotenv
JWT_ISSUER=study-agent
JWT_AUDIENCE=study-agent-api
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_SECONDS=604800
```

### 刷新 Token

```http
POST /api/v1/auth/refresh
Content-Type: application/json

{
  "token": "<refresh-token>"
}
```

刷新成功后，旧 Refresh Token 会立即撤销。重复提交旧 Token 会返回 401。

### 注销

```http
POST /api/v1/auth/logout
Content-Type: application/json

{
  "token": "<refresh-token>"
}
```

服务端只保存 Refresh Token 的 SHA-256 哈希，不保存明文 Token。认证响应带有 `Cache-Control: no-store`。

## 限流与并发

注册、登录、Refresh Token 和 Chat 分别使用独立限流策略。Chat 同时按用户和 session 控制并发，默认同一个 session 只允许一个模型执行。

相关配置和多实例注意事项见：

```text
docs/runtime-guardrails.md
```

当前限流和并发租约是进程内实现。水平扩容前应替换为 Redis 等共享后端。

## Agent 工具

Agent 创建或更新时，`tools` 只能引用已注册的内置工具。未知工具会返回 `UNKNOWN_AGENT_TOOLS`，不会静默忽略。

当前工具：

- `calculator`：归属 `math` Agent，执行有限数字的加、减、乘、除。
- `current_time`：归属 `time` Agent，获取指定 IANA 时区的当前时间。
