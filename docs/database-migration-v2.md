# 数据库 V2 迁移说明

本轮改造增加了数据库约束、索引、请求日志字段和可撤销 Refresh Token 会话。已有数据库不能在未检查历史数据的情况下直接执行结构变更。

## 主要变化

- 新增 `refresh_tokens` 表。
- `agents.created_by` 改为非空，用户删除时级联删除 Agent。
- `conversations.agent_id` 改为非空，Agent 删除时级联删除会话。
- `(conversations.user_id, conversations.session_id)` 增加唯一约束。
- `files.user_id`、`files.size` 改为非空。
- `operation_logs.status_code`、`operation_logs.duration_ms` 改为非空。
- `operation_logs` 增加 `request_id`、`ip_address`、`user_agent`。
- 时间字段改为带时区的 PostgreSQL `timestamptz`。
- 增加常用查询组合索引和数据范围 CHECK 约束。

## 迁移前检查

先备份数据库，再执行以下只读检查：

```sql
select count(*) as orphan_agents
from agents
where created_by is null;

select count(*) as orphan_conversations
from conversations
where agent_id is null;

select user_id, session_id, count(*)
from conversations
group by user_id, session_id
having count(*) > 1;

select count(*) as invalid_messages
from messages
where content is null and tool_calls is null;

select count(*) as invalid_files
from files
where user_id is null or size is null or size < 0;

select count(*) as invalid_operation_logs
from operation_logs
where status_code is null
   or status_code not between 100 and 599
   or duration_ms is null
   or duration_ms < 0;
```

如果查询返回异常数据，需要先根据业务规则补齐、合并或删除。不要为了通过约束而随意填充伪造用户或会话。

## 推荐迁移流程

开发环境可以使用：

```bash
bun run db:push
```

已有测试库或生产库建议使用可审查的 SQL 迁移：

```bash
bun run db:generate -- --name=core-hardening-v2
```

生成后重点检查：

1. 可空列改为非空前是否已经完成数据清理。
2. 时间字段从 `timestamp` 到 `timestamptz` 的时区解释是否符合原数据语义。
3. 会话唯一索引创建前是否已经处理重复 session。
4. 外键删除策略是否符合保留策略。
5. 大表创建索引是否需要安排维护窗口或改为 `CREATE INDEX CONCURRENTLY`。

在测试数据库完整演练后再执行：

```bash
bun run db:migrate
```

## Refresh Token 升级影响

旧版本只签发 JWT，没有在数据库中保存 Refresh Token 会话。V2 发布后，这些旧 Refresh Token 没有对应的 `refresh_tokens` 记录，因此无法继续刷新。

建议发布时：

- 通知用户升级后需要重新登录一次。
- 不要尝试把旧 Refresh Token 明文导入数据库。
- 新版本登录后只保存 SHA-256 哈希。
- 每次刷新会原子撤销旧 Token 并签发新 Token。
- 注销接口会主动撤销对应 Token 会话。

## 回滚准备

上线前至少准备：

- 可恢复的数据库备份。
- 迁移前后行数与关键业务数据校验 SQL。
- 应用旧版本镜像或构建产物。
- Refresh Token 变更通知与重新登录方案。

## 上线后验证

```sql
select count(*) from refresh_tokens;
select count(*) from operation_logs where request_id is null;
select count(*) from agents where created_by is null;
select count(*) from conversations where agent_id is null;
```

同时检查：

- `GET /api/v1/health/ready` 返回 200。
- 登录后可以刷新一次 Token。
- 同一个旧 Refresh Token 第二次刷新返回 401。
- `/api/v1/auth/logout` 后该 Refresh Token 不能再次使用。
- 创建、修改和删除 Agent 后可以在审计日志中查询到对应事件。
