# Study Agent

基于 **Bun + TypeScript + AI SDK + Elysia + Drizzle ORM + PostgreSQL** 的多 Agent 学习与实践项目。

当前项目已经从简单示例扩展为具备认证、会话、工具执行、审计、文件管理、运行时保护和工程化部署能力的 Agent API。

## 核心能力

- OpenAI、Anthropic、LM Studio、vLLM Provider Registry
- 按 `fast/general/reasoning/vision` 配置模型档位
- Agent 配置、工具白名单和多步工具执行
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

- `calculator`：有限数字的加、减、乘、除
- `current_time`：指定 IANA 时区的当前时间，默认 UTC

## 会话规则

- Agent、会话和消息按当前用户隔离。
- 同一用户的 `sessionId` 全局唯一。
- 已绑定 Agent 的 session 不能切换到另一个 Agent。
- 并发创建同一 session 时通过数据库唯一约束收敛。
- 工具调用和结果会保存，并进入后续对话上下文。
- 同一 session 的模型执行默认串行化。

## 管理员权限

通过环境变量配置管理员：

```dotenv
ADMIN_USER_IDS=uuid-1,uuid-2
ADMIN_USERNAMES=admin,lazy
```

只有对应用户可以访问：

```text
GET /api/v1/admin/audit-logs
GET /api/v1/admin/operation-logs
```

操作日志支持用户、方法、路径、状态码、requestId 和时间范围筛选。

## 请求追踪与错误结构

客户端可以传入：

```http
X-Request-Id: frontend-request-123
```

服务端会在响应头返回 `X-Request-Id`。没有提供合法值时会自动生成 UUID。

错误响应统一为：

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "requestId": "..."
  }
}
```

生产环境不会向客户端暴露模型 Provider、数据库或内部堆栈信息。

## 常用命令

```bash
bun run typecheck          # TypeScript 类型检查
bun test                   # 单元测试
bun run check              # 类型检查 + 单元测试
bun run build              # 构建 Bun 生产产物
bun run db:generate -- 名称 # 创建下一份连续编号 SQL 迁移
bun run db:check           # 校验迁移文件命名、版本和 checksum
bun run db:migrate         # advisory lock 下应用未执行迁移
bun run db:verify          # 验证表、列、约束和索引
bun run db:push            # 仅开发环境直接同步 Schema
bun run db:studio          # Drizzle Studio
```

GitHub Actions 会执行：

```text
bun install --frozen-lockfile
bun run typecheck
bun test
bun run db:check
bun run build
PostgreSQL 16: db:migrate → 再次 db:migrate → db:verify
```

## 目录结构

```text
src/
├── agent/            # Agent 抽象、路由和多 Agent 编排
├── api/
│   ├── errors/       # 结构化 API 错误
│   ├── middleware/   # 认证、请求上下文、异常和日志
│   ├── routes/       # Elysia API 路由
│   └── schemas/      # 请求与响应 Schema
├── app/              # 应用构建与进程启动
├── config/           # 集中环境配置和校验
├── db/               # 连接、Schema、迁移执行器和 SQL migrations
├── llm/              # 模型领域接口、Provider 和注册表
├── services/         # Auth、Agent、Chat、文件、Token、限流和审计服务
└── tools/            # 工具定义、目录和执行注册表
```

## 安全约束

- 业务接口仅接受 `Authorization: Bearer ...`
- Access Token 校验 issuer、audience、类型和有效期
- Refresh Token 服务端可撤销，且一次刷新后立即失效
- Agent、会话历史和文件按当前用户隔离
- 生产环境必须显式配置强 JWT 密钥
- Agent 工具使用注册白名单
- 上传文件默认限制为 10 MiB，并校验存储路径边界
- 管理日志接口需要显式管理员权限
- 数据库通过外键、唯一索引和 CHECK 约束维护关键不变量
- 生产数据库使用版本化 SQL 迁移，不修改已应用迁移
