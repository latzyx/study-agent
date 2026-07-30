# AI 链路追踪与 Agent 回滚

本项目使用 AI SDK 7 原生 telemetry 配置和生命周期回调，将 Agent 执行过程持久化到 PostgreSQL。追踪目标不是保存每个流式 token，而是以低写放大记录可定位问题的 generation、step、tool、usage、耗时和错误信息。

## 数据层次

### ai_runs

一次 Chat 请求对应一条 Run，记录：

- `trace_id`：对外暴露的链路 ID。
- `request_id`：与 HTTP operation log 关联。
- 用户、Agent、Conversation、session。
- functionId、Provider、模型。
- running/success/error/aborted 状态。
- 输入和输出快照。
- input/output/total tokens。
- Agent step 数和工具调用数。
- 错误名称、错误信息和总耗时。

### ai_spans

一条 Run 下包含多个 Span：

- `generation`：一次 AI SDK `streamText` 执行。
- `step`：AI SDK Provider 调用步骤。
- `tool`：工具执行。

Span 使用 `span_key` 和 `parent_span_key` 组成父子关系，可在前端展示为时间瀑布或执行树。

### agent_versions

每次 Agent 创建、修改和回滚都会保存不可变配置快照，包括：

- 名称和描述。
- System Prompt。
- model profile。
- maxSteps。
- 工具列表。

回滚不会修改旧版本，而是恢复目标快照并生成一个新的版本。例如：

```text
v1 create
v2 update
v3 rollback from v1
```

## Trace 查询

普通用户只能查看自己的 Trace：

```http
GET /api/v1/chat/traces?page=1&pageSize=20
GET /api/v1/chat/traces?sessionId=session-1&status=error
GET /api/v1/chat/traces/{traceId}
```

管理员可以跨用户查询：

```http
GET /api/v1/admin/ai-traces?requestId=request-123
GET /api/v1/admin/ai-traces?userId={userId}&status=error
GET /api/v1/admin/ai-traces?agentId={agentId}&startDate=2026-07-01
GET /api/v1/admin/ai-traces/{traceId}
```

排查一次请求时，使用同一个 `requestId` 查询：

```http
GET /api/v1/admin/operation-logs?requestId=request-123
GET /api/v1/admin/ai-traces?requestId=request-123
```

这样可以从 HTTP 状态码和接口耗时继续定位到模型步骤、工具调用、token 和具体错误。

## Chat 返回 traceId

JSON Chat 响应增加：

```json
{
  "success": true,
  "data": {
    "reply": "...",
    "sessionId": "...",
    "traceId": "...",
    "toolCalls": []
  }
}
```

SSE 在最后的 `done` 事件中返回：

```json
{
  "type": "done",
  "sessionId": "...",
  "traceId": "..."
}
```

前端应保存 `traceId`，错误反馈、客服工单和用户问题上报都应携带该值。

## Agent 版本和回滚

查询版本：

```http
GET /api/v1/agents/{agentId}/versions?page=1&pageSize=20
```

回滚：

```http
POST /api/v1/agents/{agentId}/rollback
Content-Type: application/json
Authorization: Bearer <access-token>
X-Request-Id: rollback-ticket-1001

{
  "targetVersion": 1
}
```

回滚使用数据库事务和 version 乐观锁。当前 Agent 在回滚期间被并发修改时，接口返回：

```json
{
  "success": false,
  "error": {
    "code": "AGENT_VERSION_CONFLICT",
    "message": "Agent was modified concurrently; reload it and retry"
  }
}
```

## 隐私与脱敏

配置：

```dotenv
AI_TRACE_ENABLED=true
AI_TRACE_RECORD_INPUTS=false
AI_TRACE_RECORD_OUTPUTS=false
AI_TRACE_MAX_SNAPSHOT_CHARS=20000
AI_TRACE_RETENTION_DAYS=30
```

默认策略：

- development/test：默认保存输入输出，便于调试。
- production：默认不保存输入输出正文，只保存模型、步骤、工具、token、耗时和错误。
- 可以通过环境变量显式覆盖。
- key 名包含 authorization、cookie、password、secret、token、apiKey 等内容会被替换为 `[redacted]`。
- 超长字符串会截断。
- 数组、对象键数量和嵌套深度有边界，避免日志放大。

不要将完整个人隐私、密钥或不允许持久化的业务数据主动放入 telemetry metadata。

## 性能策略

- 不持久化逐 token 的 `text-delta`。
- 一次 Run 只保存 generation、step 和 tool 级别 Span。
- Span 写入通过单 Run 串行队列完成，避免乱序和高并发写冲突。
- Trace 创建或写入失败时降级记录告警，不阻断 Chat 主响应。
- Run 完成前执行 flush，确保查询时链路完整。
- 管理列表只返回 Run 摘要；详细 Span 仅在详情接口加载。

## 异常恢复与保留期

应用启动后每小时执行维护：

- 超过 60 分钟仍处于 `running` 的 Run 标记为 `aborted`。
- 标记 `StaleRunRecovered`，表示上次进程可能异常退出。
- 删除超过 `AI_TRACE_RETENTION_DAYS` 的 Run。
- 删除 Run 时通过外键级联清理 Span。

维护任务使用 `unref()`，不会阻止 Bun 进程退出；SIGINT/SIGTERM 时会显式停止。

## 数据库升级

```bash
bun run db:check
bun run db:migrate
bun run db:verify
bun run db:verify:traceability
```

最后一条命令会在 PostgreSQL 中真实验证：

1. 创建 Agent v1。
2. 更新为 v2。
3. 回滚 v1 并生成 v3。
4. 写入 generation、step、tool Span。
5. 完成 Run 并查询 token、状态及执行树。
6. 清理测试数据。

## 回滚边界

当前自动回滚范围是 **Agent 配置**。以下内容不会自动反向执行：

- 已经发送的邮件或外部通知。
- 已经调用的第三方写接口。
- 已删除的外部文件。
- 已执行的支付、审批或业务事务。

未来接入有副作用的工具时，应为工具声明：

- `readOnly`：纯查询，可安全重放。
- `idempotencyKey`：幂等写操作。
- `compensate`：对应补偿动作。
- `rollbackPolicy`：自动、人工确认或禁止回滚。

在没有补偿语义前，不要通过 Trace 自动重放有副作用的工具调用。
