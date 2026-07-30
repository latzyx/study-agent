# 数据库 V2 迁移说明

本轮改造增加了数据库约束、索引、请求日志字段、可撤销 Refresh Token 会话和版本化 SQL 迁移。已有数据库不能在未检查历史数据的情况下直接执行结构变更。

## 主要变化

- 新增 `refresh_tokens` 表。
- 新增 `study_agent_schema_migrations` 迁移记录表。
- `agents.created_by` 改为非空，用户删除时级联删除 Agent。
- `conversations.agent_id` 改为非空，Agent 删除时级联删除会话。
- `(conversations.user_id, conversations.session_id)` 增加唯一约束。
- `files.user_id`、`files.size` 改为非空。
- `operation_logs.status_code`、`operation_logs.duration_ms` 改为非空。
- `operation_logs` 增加 `request_id`、`ip_address`、`user_agent`。
- 时间字段改为带时区的 PostgreSQL `timestamptz`。
- 增加常用查询组合索引和数据范围 CHECK 约束。

## 迁移前检查

先停止旧版本写入并备份数据库，再执行以下只读检查：

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

select storage_path, count(*)
from files
group by storage_path
having count(*) > 1;

select count(*) as invalid_operation_logs
from operation_logs
where status_code is null
   or status_code not between 100 and 599
   or duration_ms is null
   or duration_ms < 0;
```

如果查询返回异常数据，需要先根据业务规则补齐、合并或删除。不要为了通过约束而随意填充伪造用户、Agent 或会话。

## 迁移执行器

项目使用 `src/db/migrate.ts` 执行 `src/db/migrations/*.sql`：

- 文件名必须是 `0001_name.sql` 格式。
- 按前四位版本号升序执行。
- 使用 PostgreSQL transaction-level advisory lock，防止多个应用实例同时升级。
- 在 `study_agent_schema_migrations` 中保存文件名和 SHA-256 checksum。
- 已应用文件的名称或内容发生变化时会拒绝继续执行。
- 同一批未执行迁移在一个事务中执行，任意一步失败会整体回滚。

不要修改已在任何环境执行过的迁移文件。修复或扩展 Schema 时新增下一份迁移：

```bash
bun run db:generate -- add-agent-status
# 编辑 src/db/migrations/0002_add-agent-status.sql
bun run db:check
```

## 推荐迁移流程

### 新数据库

```bash
bun run db:check
bun run db:migrate
bun run db:verify
```

### 已有测试库或生产库

1. 停止旧版本应用写入。
2. 完成数据库备份。
3. 执行上面的历史数据预检。
4. 确认数据库 session 的 `TimeZone` 与旧 `timestamp` 数据语义一致。
5. 在生产数据副本上完整演练。
6. 执行正式迁移和验证：

```bash
bun run db:check
bun run db:migrate
bun run db:verify
```

当前 `0001_core_hardening.sql` 会主动阻止以下危险情况：

- Agent、会话或文件存在无法确定归属的空外键。
- 同一用户存在重复 sessionId。
- 消息既没有文本也没有工具调用。
- 文件路径重复、文件大小为负数。
- Agent 最大步数、操作日志状态码或耗时超出范围。
- Agent 的 tools 字段不是 JSON 数组。

迁移不会为这些数据自动伪造归属关系。

## 时间字段注意事项

旧 Schema 使用 `timestamp without time zone`，新 Schema 使用 `timestamptz`。迁移会按照迁移连接当前的 PostgreSQL `TimeZone` 解释旧时间值。

迁移前确认：

```sql
show timezone;
```

如果历史数据实际使用 UTC，但数据库 session 不是 UTC，应先在迁移连接中设置正确时区，或在生产副本中调整迁移 SQL 并作为新的、未执行版本提交。不要在迁移已经应用后修改原文件。

## 索引与维护窗口

当前迁移使用普通 `CREATE INDEX`，并在事务中保持原子性。对于数据量很大的生产表，普通索引创建可能持有较长时间的锁。

正式上线前评估：

- `messages`
- `operation_logs`
- `audit_logs`
- `conversations`

如果必须使用 `CREATE INDEX CONCURRENTLY`，应拆成单独的非事务迁移方案，而不是直接修改已应用的 `0001_core_hardening.sql`。

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

数据库 Schema 的破坏性变化不能只靠回滚应用代码撤销。需要恢复备份时，应先停止新版本写入，避免新数据丢失范围继续扩大。

## 上线后验证

```bash
bun run db:verify
```

并检查：

```sql
select version, filename, checksum, applied_at
from study_agent_schema_migrations
order by version;

select count(*) from refresh_tokens;
select count(*) from operation_logs where request_id is null;
select count(*) from agents where created_by is null;
select count(*) from conversations where agent_id is null;
```

同时验证：

- `GET /api/v1/health/ready` 返回 200。
- 登录后可以刷新一次 Token。
- 同一个旧 Refresh Token 第二次刷新返回 401。
- `/api/v1/auth/logout` 后该 Refresh Token 不能再次使用。
- 创建、修改和删除 Agent 后可以在审计日志中查询到对应事件。
- 再次执行 `bun run db:migrate` 只输出 skip，不重复修改 Schema。
