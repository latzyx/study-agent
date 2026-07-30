# 运行时保护与多实例说明

本项目内置了认证限流、聊天请求限流、聊天并发限制和文件删除补偿机制。这些能力用于保护单实例开发环境和中小规模部署，但部署多个应用实例时需要额外的共享基础设施。

## 请求限流

当前限流器采用进程内固定窗口实现，并设置最大键数量，避免攻击者通过不断制造新键导致限流器自身占满内存。

默认配置：

```dotenv
AUTH_LOGIN_RATE_LIMIT_MAX=5
AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS=900
AUTH_REGISTER_RATE_LIMIT_MAX=5
AUTH_REGISTER_RATE_LIMIT_WINDOW_SECONDS=3600
AUTH_REFRESH_RATE_LIMIT_MAX=30
AUTH_REFRESH_RATE_LIMIT_WINDOW_SECONDS=60
CHAT_RATE_LIMIT_MAX=30
CHAT_RATE_LIMIT_WINDOW_SECONDS=60
RATE_LIMIT_MAX_KEYS=10000
```

超过限制时返回 HTTP 429，并包含：

```text
Retry-After
X-RateLimit-Limit
X-RateLimit-Remaining
X-RateLimit-Reset
```

登录成功后会清除该账号和客户端组合的失败窗口；登录失败不会清除。

## 聊天并发限制

```dotenv
CHAT_MAX_CONCURRENT_PER_USER=2
CHAT_MAX_CONCURRENT_PER_SESSION=1
```

- 单个用户默认最多同时执行两个模型请求。
- 同一个 session 默认只允许一个请求执行，保证消息历史顺序稳定。
- 并发租约在正常完成、模型异常和客户端取消时都会释放。

## 多实例部署

进程内限流和并发计数不会在多个实例之间共享。水平扩容时，应把以下抽象替换为 Redis 或其他共享后端：

- `FixedWindowRateLimiter`
- `KeyedConcurrencyLimiter`

建议使用原子 Lua 脚本或 Redis 事务实现计数、过期和租约释放，避免多个实例分别放行导致总流量超过限制。

## 反向代理 IP

默认不信任客户端传入的代理头：

```dotenv
TRUST_PROXY_HEADERS=false
```

只有当应用始终位于受控 Nginx、Ingress 或负载均衡器之后时，才应启用：

```dotenv
TRUST_PROXY_HEADERS=true
```

启用后，限流、审计日志和操作日志会统一读取：

1. `CF-Connecting-IP`
2. `X-Forwarded-For` 的第一个地址
3. `X-Real-IP`

如果应用可以被绕过代理直接访问，不要启用该配置，否则客户端可以伪造来源 IP。

## 文件删除一致性

文件删除不再直接执行“删除数据库记录后删除磁盘文件”。当前流程为：

1. 校验数据库中的路径位于配置的上传目录内。
2. 在同一目录把文件原子重命名为 tombstone。
3. 删除数据库元数据。
4. 清理 tombstone。
5. 如果数据库删除失败，尝试把 tombstone 恢复为原文件。

该流程避免元数据已经删除但磁盘文件仍然残留。对于对象存储，应使用对象标签、延迟删除队列或生命周期规则实现相同的补偿语义。
