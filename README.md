# Study Agent

基于 **Bun + TypeScript + AI SDK + Elysia + Drizzle ORM + PostgreSQL** 的多 Agent 学习与实践项目。

## 当前能力

- 多模型 Provider Registry：OpenAI、Anthropic、LM Studio、vLLM
- Agent 配置与工具注册
- JSON 与 SSE 流式聊天接口
- JWT Access Token / Refresh Token
- Agent、会话、消息、文件和日志数据持久化
- Swagger API 文档

## 环境要求

- Bun 1.3+
- PostgreSQL 14+
- 至少配置一个可用的模型 Provider

## 初始化

```bash
bun install
cp .env.example .env
bun run db:push
```

请至少修改以下配置：

```dotenv
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/study_agent
JWT_SECRET=replace-with-a-long-random-secret
LLM_MODEL_GENERAL=lmstudio:qwen-local
```

生产环境启动时如果没有配置 `JWT_SECRET`，应用会直接拒绝启动。

## 运行

开发模式：

```bash
bun run dev
```

普通启动：

```bash
bun run start
```

默认地址：

- API：`http://localhost:3000/api/v1`
- Swagger：`http://localhost:3000/docs`

## 认证方式

项目只使用 Bearer Token，不使用 Cookie 保存登录状态。

注册或登录成功后，从响应中取得 `data.token`，调用业务接口时传入：

```http
Authorization: Bearer <access-token>
```

Access Token 默认有效期为 15 分钟，Refresh Token 默认有效期为 7 天。刷新接口：

```text
POST /api/v1/auth/refresh
```

## 管理员权限

管理日志接口不会默认开放给所有登录用户。通过环境变量配置管理员：

```dotenv
ADMIN_USER_IDS=uuid-1,uuid-2
ADMIN_USERNAMES=admin,lazy
```

对应用户才可以访问 `/api/v1/admin/*`。

## 常用命令

```bash
bun run typecheck     # TypeScript 类型检查
bun run db:generate   # 生成 Drizzle migration
bun run db:push       # 将 schema 推送到数据库
bun run db:studio     # 打开 Drizzle Studio
bun run cli           # 运行 CLI 示例
```

## 目录说明

```text
src/
├── agent/            # Agent 抽象、路由和多 Agent 编排
├── api/              # Elysia 路由、中间件和接口 Schema
├── app/              # HTTP 应用入口
├── db/               # Drizzle 数据库连接与表结构
├── llm/              # 模型领域接口、Provider 和模型注册表
└── tools/            # 工具定义、内置工具和工具注册表
```

## 安全约束

- 业务接口仅接受 `Authorization: Bearer ...`
- Agent、会话历史和文件元数据按当前用户隔离
- Refresh Token 不能访问业务接口
- 生产环境必须显式配置 JWT 密钥
- 上传文件默认限制为 10 MiB，可通过 `MAX_UPLOAD_BYTES` 调整
