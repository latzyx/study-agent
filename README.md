# Study Agent

基于 **Bun + TypeScript + AI SDK + Elysia + Drizzle ORM + PostgreSQL** 的多 Agent 工程实践项目。

## 核心能力

- OpenAI、Anthropic、Google、LM Studio、vLLM Provider Registry
- `fast/general/reasoning/vision` 模型档位与请求级真实模型解析
- Agent 配置、Tool 白名单、多步 Tool 调用和运行时隔离
- 可组合意图分类器、候选排序、置信度和歧义检测
- JSON 与 SSE 流式聊天
- 标准 assistant tool-call / tool-result 历史链
- Bearer JWT、Refresh Token 轮换、复用检测和注销
- 用户与 session 级并发控制、限流、审计和请求日志
- PostgreSQL 版本化迁移、健康检查和优雅关闭
- Bun 单元测试、类型检查、构建和 PostgreSQL CI

## 环境要求

- Bun 1.3+
- PostgreSQL 14+
- 至少一个可用模型 Provider

## 初始化

```bash
bun install
cp .env.example .env
```

至少配置：

```dotenv
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/study_agent
JWT_SECRET=replace-with-a-long-random-secret-at-least-32-characters
LLM_MODEL_GENERAL=lmstudio:qwen-local
```

生产环境的 `JWT_SECRET` 少于 32 个字符时应用会拒绝启动。

## 数据库

新数据库：

```bash
bun run db:check
bun run db:migrate
bun run db:verify
```

开发环境可使用：

```bash
bun run db:push
```

`db:push` 不应替代生产迁移。已有数据库升级前请阅读：

```text
docs/database-migration-v2.md
```

迁移规则：

- 按四位版本号顺序执行。
- 使用 PostgreSQL advisory lock 防止并发迁移。
- 保存文件名和 SHA-256 checksum。
- 已执行迁移被修改时拒绝继续。
- 迁移失败时回滚当前事务。

## 运行

```bash
bun run dev
bun run start
bun run build
bun run start:prod
```

默认地址：

- API：`http://localhost:3000/api/v1`
- Swagger：`http://localhost:3000/docs`
- 存活检查：`GET /api/v1/health/live`
- 就绪检查：`GET /api/v1/health/ready`

## CLI

```bash
bun run cli -- "123 * 456 等于多少"
bun run cli
```

交互模式输入 `/exit` 或 `/quit` 退出。CLI 不依赖数据库。

## Agent 与 Tool 目录

专业 Tool 必须放在所属 Agent 目录：

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

- 一个 Tool 只能有一个 owner。
- 一个数据库 Agent 的 Tool 必须全部属于同一个内置 Agent。
- 混合 `calculator` 与 `current_time` 会返回 `MIXED_AGENT_TOOLS`。
- `catalog.ts` 是 Agent 定义和 Tool owner 的唯一聚合入口。
- `resolveAgentTools()` 会拒绝加载其他 Agent 的 Tool。
- `src/tools/builtin` 只保留兼容导出，不保存真实实现。

当前 Tool：

- `calculator`：归属 `math` Agent。
- `current_time`：归属 `time` Agent。

## 意图识别

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

- 多分类器并行执行
- 分类器权重
- 候选 Agent 排序
- 最低置信度阈值
- 第一、第二候选歧义判断
- 无匹配回退 `general`
- 显式 Agent 参数优先
- 非法权重、未知 Agent 和非有限分数显式失败

接入 MacBERT、Embedding Router 或 LLM 分类器时，只需实现 `IntentClassifier`。

当前 Chat API 仍使用数据库 `agentId` 作为执行目标。自动分发前必须建立明确的 `agentKey → agentId` 绑定，禁止找不到映射时偷偷使用默认 Agent。

## 会话规则

- Agent、会话和消息按用户隔离。
- 同一用户的 `sessionId` 全局唯一。
- 已绑定 Agent 的 session 不能切换 Agent。
- 同一 session 的模型执行默认串行化。
- 执行成功后，user、assistant 和 tool 消息在同一事务写入。
- 模型失败、Tool 失败或请求中止时，不写入不完整对话回合。
- Tool 历史按标准 assistant tool-call 和 tool-result 消息恢复。

## 认证

接口只接受：

```http
Authorization: Bearer <access-token>
```

默认有效期：

- Access Token：15 分钟
- Refresh Token：7 天

```dotenv
JWT_ISSUER=study-agent
JWT_AUDIENCE=study-agent-api
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_SECONDS=604800
```

刷新和注销：

```text
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
```

服务端只保存 Refresh Token 的 SHA-256 哈希。刷新成功后旧 Token 立即撤销。

## 限流与并发

注册、登录、Refresh Token 和 Chat 使用独立限流策略。Chat 同时按用户和 session 控制并发。

当前并发租约为进程内实现，水平扩容前应替换为 Redis 等共享后端。详见：

```text
docs/runtime-guardrails.md
```

## 管理与审计

管理员通过环境变量配置：

```dotenv
ADMIN_USER_IDS=uuid-1,uuid-2
ADMIN_USERNAMES=admin,lazy
```

管理接口：

```text
GET /api/v1/admin/audit-logs
GET /api/v1/admin/operation-logs
```

## 请求追踪和错误结构

客户端可传入：

```http
X-Request-Id: frontend-request-123
```

错误响应：

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

生产环境不会暴露 Provider、数据库和内部堆栈信息。

## 常用命令

```bash
bun run typecheck
bun test
bun run check
bun run build
bun run db:generate -- migration-name
bun run db:check
bun run db:migrate
bun run db:verify
bun run db:studio
```

GitHub Actions 执行：

```text
bun install --frozen-lockfile
bun run typecheck
bun test
bun run db:check
bun run build
PostgreSQL 16: db:migrate → db:migrate → db:verify
```

## 安全约束

- 业务接口仅接受 Bearer Token。
- Access Token 校验 issuer、audience、类型和有效期。
- Refresh Token 可撤销并执行轮换。
- Agent、会话、文件按用户隔离。
- Tool 使用注册白名单和 Agent owner 约束。
- 上传文件限制大小并校验路径边界。
- 管理日志需要管理员权限。
- 数据库外键、唯一索引和 CHECK 约束维护关键不变量。
- 生产数据库只使用向前追加的版本化迁移。