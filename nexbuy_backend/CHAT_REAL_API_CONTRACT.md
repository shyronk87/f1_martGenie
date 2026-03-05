# Nexbuy Chat Real 模式最小接口契约（v1）

本文档用于前端（Next.js）与后端 Agent 编排服务联调。目标是先跑通：

`发送用户消息 -> Agent 执行 -> 时间线流式返回 -> 方案返回`

---

## 1. 通用约定

- Base URL: `http://localhost:8000/api`
- 认证：除 OAuth 登录外，以下接口都要求 `Authorization: Bearer <access_token>`
- 内容类型：
  - 普通 API: `application/json`
  - 实时流: `text/event-stream`（SSE）
- 时间字段：统一 ISO8601（UTC），例如 `2026-03-05T02:30:00.000Z`

---

## 2. 核心实体

## 2.1 Message
```json
{
  "id": "msg_123",
  "role": "user",
  "content": "预算3000，帮我配客厅",
  "createdAt": "2026-03-05T02:30:00.000Z"
}
```

`role` 可选：`user | assistant | system`

## 2.2 TimelineEvent
```json
{
  "id": "evt_123",
  "type": "scan_progress",
  "message": "已过滤 3200 个不匹配商品",
  "createdAt": "2026-03-05T02:30:03.000Z"
}
```

`type` 可选：
- `scan_started`
- `scan_progress`
- `candidate_found`
- `bundle_built`
- `negotiation_mocked`
- `plan_ready`
- `done`
- `error`

## 2.3 PlanOption
```json
{
  "id": "plan_a",
  "title": "Balanced Natural Set",
  "summary": "耐抓、原木风、预算内",
  "totalPrice": 2860,
  "confidence": 0.92,
  "items": [
    {
      "sku": "JJ77311M4I",
      "title": "Nimbus Sectional",
      "price": 1299.99,
      "reason": "猫家庭耐抓"
    }
  ]
}
```

---

## 3. REST 接口

## 3.1 创建会话

`POST /chat/sessions`

### Request
```json
{}
```

### Response 200
```json
{
  "session_id": "sess_abc123"
}
```

---

## 3.2 发送消息（触发 Agent 任务）

`POST /chat/sessions/{session_id}/messages`

### Request
```json
{
  "content": "预算3000，帮我配齐原木风客厅，家里有两只猫"
}
```

### Response 202
```json
{
  "message_id": "msg_abc123",
  "task_id": "task_abc123",
  "status": "accepted"
}
```

说明：
- 后端应快速返回，不阻塞长任务
- 真正执行结果通过 SSE 推送

---

## 3.3 拉取历史（可选但建议）

`GET /chat/sessions/{session_id}`

### Response 200
```json
{
  "session_id": "sess_abc123",
  "messages": [],
  "timeline": [],
  "plans": []
}
```

---

## 4. SSE 流接口

## 4.1 订阅任务流

`GET /chat/sessions/{session_id}/stream?task_id={task_id}`

Header:
- `Authorization: Bearer <token>`
- `Accept: text/event-stream`

---

## 4.2 SSE 事件格式

后端每条使用标准 SSE 输出：

```text
event: message
data: {"type":"message_delta","delta":"正在整理三套方案..."}

```

前端只解析 `data` JSON，`type` 字段定义如下：

### `message_delta`
```json
{
  "type": "message_delta",
  "delta": "正在扫描商品..."
}
```

### `message`
```json
{
  "type": "message",
  "message": {
    "id": "msg_ai_1",
    "role": "assistant",
    "content": "我整理了三套方案",
    "createdAt": "2026-03-05T02:31:10.000Z"
  }
}
```

### `timeline_event`
```json
{
  "type": "timeline_event",
  "event": {
    "id": "evt_1",
    "type": "scan_progress",
    "message": "已过滤3200件不匹配商品",
    "createdAt": "2026-03-05T02:31:00.000Z"
  }
}
```

### `plan_ready`
```json
{
  "type": "plan_ready",
  "plans": []
}
```

### `error`
```json
{
  "type": "error",
  "error": "Agent execution failed."
}
```

### `done`
```json
{
  "type": "done"
}
```

---

## 5. 错误码（最小集）

HTTP + `detail` 字段：

- `400` 参数错误
- `401` 未认证或 token 失效
- `403` 权限不足
- `404` session 不存在
- `409` session 当前已有任务在执行
- `422` 请求体校验失败
- `500` 内部错误

示例：
```json
{
  "detail": "Session is busy with another task."
}
```

---

## 6. 前端对接规则（强约束）

- 每次用户发送消息都调用一次 `POST /messages`
- 不重复提交整段历史，只提交当前消息；历史由后端按 `session_id` 管理
- 同一个 `session_id` 同时只允许一个活跃 `task_id`
- 前端在任务结束（`done` 或 `error`）后才允许下一次发送
- 流断开时前端可提示重试并允许重新订阅

---

## 7. MVP 验收标准

- `POST /messages` 500ms 内返回 `accepted`
- SSE 在 2s 内至少返回 1 条 `timeline_event` 或 `message_delta`
- 最终返回 `plan_ready`（至少 1 套方案）+ `done`
- 任何失败都有 `error` 事件或标准 HTTP 错误响应

---

## 8. 版本策略

- 当前版本：`v1-minimal`
- 新增字段保持向后兼容（前端忽略未知字段）
- 破坏性变更需升级版本并同步前端

