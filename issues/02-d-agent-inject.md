<!-- DSH-IDEMPOTENCY-KEY: deck-plan-dsh-language-guard-map-v1-child-research-mode-d -->
<!-- parentKey: 01 -->
<!-- created: 2026-10-18T13:16:24.998Z -->
# 调研：D 档周期提醒的 agent.inject 合规实现

确认 D 档（周期提醒）的正确实现，避开会污染会话历史的做法。

需要回答：
1. `agent.inject()` 的完整签名、调用时机限制，以及 `agent/inbox/spliced` 事件的语义。
2. 如何按「每 N 轮」触发：可用的事件（`turn/end` / `assistant/message` / `agent/created`）与计数器存放位置。
3. 注入的提醒文本如何避免破坏 KV cache（是插在 messages 末尾还是作为独立 context）。
4. 插件卸载时如何清理注入的定时器与计数状态。
5. 子代理（subagent）会话是否也会被注入，是否应该注入。

产出：写入 `docs/research/03-mode-d.md`，含签名、事件清单与推荐实现。

完成标准：给出 D 档可实现的明确结论，或明确判定「不可行」并说明原因。

## 进度

- 2026-10-18 已读源码：`dsh-agent-loop/lib/index.js`（`send`/`followup`/`steer`/`inject`、`ReactLoopInbox` 70-207、`preStep` 902-929、`turn` 938-1036、`step` 1043-1073）、`dsh-agent/lib/index.js` 的 `agentEvents`、`cordis/lib/index.js:262-263` 的 global 过滤、`dsh-tool-cordis/lib/types/api-catalog.js` 的 agent/* 事件签名、`practices.md`、官方先例 `dsh-repeat-tool-reminder` 与 `dsh-agent-instructions`、`dsh-client-ui-chat/lib/client.js` 的 source.kind 分流。
- 已实测真实会话日志：`--Volumes-data-DSH--/session-cf8dd2d7` 的 `agent/inbox/spliced`(inserted) → `agent/inbox/spliced`(removedCount:1) → `user/message` 同 id 链路（seq 5→7→10）。
- 产出文档：`docs/research/03-mode-d.md`（含结论速查表、12 节源码取证、D 档实现伪代码、风险清单、证据索引）。
- 纠正决策文档 3.4 面板文案「提醒会作为一条会话记录出现」的歧义（见 Answer D.3）。
- 统一 N 取值：默认 8、范围 3–50（与 `docs/decisions/01-mechanism.md` 一致），文档第 9 节伪代码已改为 `everyNTurns = 8` + 钳制。
- 结论已写入 Answer（A–F 六节）。

Status: resolved
Type: task
Blocked by:
Labels: wayfinder:research, wayfinder:task

## Answer

结论：**D 档可实现，且不需要定时器、不需要计数器、不需要 `agent.inject()` 也能做到**。推荐用 `agent/pre-step` 改写 `decision.messages`（官方允许，`practices.md:16`）。完整取证见 `docs/research/03-mode-d.md`。

### A. `agent.inject()` 的签名与「不唤醒」语义

`dsh-agent-loop/lib/index.js:800-814` 是全部答案：

```js
send(message, target, wakeup) {
    const wakingAfterAbort = wakeup && this.phase.kind !== "idle" && this.phase.abort.signal.aborted;
    const resolvedTarget = wakingAfterAbort ? "next-turn" : target;
    this.inbox.splice(resolvedTarget, Infinity, 0, [message]);
    if (wakeup) this.wakeDriver(wakingAfterAbort);
}
followup(input) { this.send(input, "next-turn", true); }
steer(input)    { this.send(input, "next-step", true); }
inject(input)   { this.send(input, "next-step", false); }
```

- 签名：`inject(input: UserMessage): void`，**同步、无返回值**（内部 `send` 只做 splice + 可选唤醒）。
- 三个入口只差两维：目标（`next-turn`/`next-step`）与是否唤醒。**`inject` = next-step + 不唤醒**。
- 不唤醒的后果（`dsh-agent/lib/README.zh.md:47`、`practices.md:29`）：agent 若已 idle，注入的消息会一直躺在 inbox，等下次用户输入才被消费——那时提醒往往已过时。**所以周期提醒必须在 turn 进行中注入。**

投递即记日志：`ReactLoopInbox.mutate` 在 `dsh-agent-loop/lib/index.js:204` `this.session.append("agent/inbox/spliced", splice)`。payload 字段：`{ target: "next-turn"|"next-step", start: number, removedCount: number, inserted: UserMessage[], outcome?: "canceled" }`（`:178-207`）。inbox 本身是持久投影（`key:"inbox"`，`stateVersion:1`，`:24-67`），重建时拒绝越界坐标与跨两表重复 `MessageId`（`:63-65` 抛 `invalid persisted inbox splice at session seq ${event.seq}`）。

被模型看到的确切时刻：`preStep` 在 `:906` 先 `this.inbox.claim(target, position.turn)`，**然后**才在 `:909-919` 跑 `agent/pre-step` waterfall。所以 pre-step 里 inject 的消息本步拿不到，只能进下一步。

### B. 三条路径对比与选型

| 路径 | 位置 | 生效时机 | 额外请求 | 官方依据 |
|---|---|---|---|---|
| A `agent.inject()` | 任意（须 turn 进行中） | **下一步** | 本步已答完时会多跑一步（`:1033-1037` 的 `hasPending` 续跑） | `practices.md:18` |
| **B 改写 `decision.messages`（推荐）** | `agent/pre-step` | **本步立即** | 0 | `practices.md:16` |
| C `agent/turn-stopping` + `steer` | 轮次关闭前 | 强行延长一轮 | 1 轮 | `api-catalog.js:4036-4041` |

官方先例 `dsh-agent-instructions/lib/index.js:1406-1424` 就是路径 B，四步：`await next()` → 去重 → `toSpliced(lastClaimedIndex + 1, 0, desired)` → `return { ...decision, messages: entered }`。

**选型：周期提醒走 B。** 理由：本步生效、零额外请求、日志完备、官方有先例。`agent.inject()` 留给「本步尚未开始、需提前排入」的场景（agent 刚创建，或 pre-step 被 reject 后的 fallback）。

改写后的消息由 `step()` 在 `dsh-agent-loop/lib/index.js:1072` 逐条 `session.append("user/message", message, { surfaceOp: "append" })` —— 与 inject 路径落同一类日志。

### C. 每 N 轮触发：`turn`/`step` 直接给，不需要计数器

`agent/pre-step` 载荷（`dsh-tool-cordis/lib/types/api-catalog.js:4004-4009`）：

```ts
payload: { agent: Agent; messages: UserMessage[]; turn: number; step: number; signal: AbortSignal }
next: () => Promise<PreStepDecision>
```

**`turn` 与 `step` 是载荷自带字段**，由 `turn()` 在 `dsh-agent-loop/lib/index.js:959` 以 `this.preStep(target, { turn, step })` 传入，`:911` 用 `...position` 展开进事件载荷。

- `turn` 从 `turnBoundary` 投影续接（`:781-782` 读 `lastTurn`；投影定义 `:1365-1400`），**恢复会话后仍连续递增**，不会重置为 0。
- 判定式：`step === 1 && turn % N === 0` —— `step === 1` 保证每轮只注入一次。
- **零状态、零定时器、零清理。**

若一定要外部读轮次：`ctx.sessionProjections.stateOf(session, "turnBoundary")?.lastTurn` 是公开 API（`api-catalog.js:2261`）。若需跨事件内存状态，用 `WeakMap<Agent, …>`（官方 `dsh-repeat-tool-reminder` 的 `chains` 就是这么做的，随 agent 回收自动释放，无需 `agent/disposed` 清理）。

**替代方案评估**（票里列的三个事件）：

| 方案 | 是否可用 | 问题 |
|---|---|---|
| `agent/pre-step` 读 `payload.turn` | ✅ **推荐** | 无 |
| 监听 `turn/end` 自己计数 | ⚠️ 可用但不必要 | `turn/end` 是 session 事件，不是 agent 事件；要挂 `session/event` 或投影，且计数需自己维护生命周期 |
| 监听 `assistant/message` 计数 | ❌ | 一步可能有 0 或多次，与「轮」不对齐 |
| `agent/created` 计数 | ❌ | 只在创建时触发一次 |

### D. 日志、不变式与「用户会不会看到」

#### D.1 日志层面：一定会有一条记录，且不应该绕过

被接纳的注入消息落 `user/message`（`dsh-agent-loop/lib/index.js:1072`），与其他消息同形，`source.kind` 为插件自定义值。这是 `dsh-session/README.md:100` 的要求：

> **Model-visible means logged**: anything that reaches a model request must be reconstructable from the log.

实测链路（`--Volumes-data-DSH--/session-cf8dd2d7`）：`agent/inbox/spliced`(seq 5, inserted id `0bf35015-…`) → `agent/inbox/spliced`(seq 7, `removedCount:1`，claim 消费) → `user/message`(seq 10, **同一 id**)。id 全程不变。

#### D.2 UI 层面：不会渲染成用户气泡

`dsh-client-ui-chat/lib/client.js` 按 `source.kind` 分流：

- `:9857` `if (event.data.source.kind !== "user")` → 返回 `contextMessage(...)`，`kind: "context"`；
- `:9831-9841` `contextMessage` 带 `producer: contextProducer(message.source)`；
- `:7746-7769` `contextProducer` 对**所有非 user 的 kind** 一律返回 `role: "inject"`（`default: return { role: "inject", label: kind }`）；
- 只有 `source.kind === "user"` 才走 `kind: "user"` 或 `kind: "steering"` 气泡。

**结论：注入内容在 UI 里是一条 context 节点（`role:"inject"`），label 取 `source.kind`，不是用户消息。**

#### D.3 纠正决策文档的措辞

`docs/decisions/01-mechanism.md:55` 现写「提醒会作为一条会话记录出现」。**这句话不准确**——它容易被读成「用户消息」。准确表述：

> 每 N 轮会往会话里追加一条注入上下文（UI 中显示为 inject 节点，不是用户消息），可在设置面板里调整 N 或关闭。

#### D.4 `source` 的两个坑

1. **必须带 `source.kind`**。官方注释（`dsh-repeat-tool-reminder/lib/index.js`）：`the label is load-bearing (an unlabeled context would render as a user prompt in derived history)`。
2. **不能取 `"runtime-context"`**。`step()` 在 `:1063` 对该 kind 有特殊分支（与每步 context 合并），取它会被当 runtime context 处理。
3. `source.form` 只认白名单 `["instructions","catalog","snapshot","notice","relay","recall"]`（`client.js:7723-7730`），取 `"notice"` 合法。

### E. KV cache：追加在末尾，不动前缀

物理布局：**一条 system 消息在最前**（`dsh-llm/lib/index.js:87-95`，全部 section 拼成一条），其后是历史消息，最后是本步批次。缓存按前缀匹配，**改动越靠前失效越多**。

| 做法 | 变化位置 | cache 影响 |
|---|---|---|
| 追加一条 user 消息（路径 A/B） | messages **末尾** | 前缀不变，命中 |
| 改 system prompt section 文本 | **最前面**的 system 消息 | 整条前缀变化，**全失效** |

这就是周期提醒必须走消息注入、不能靠 section 文本变化的根本原因（也是决策文档硬约束 6 的机制依据）。

两个附加要求：
- **措辞固定**：不要插入轮次号、时间戳等变化量，否则每次注入后前缀都不同。
- **保住 `startsRequestSeries`**：`practices.md:16` 要求 `{ ...decision, messages }` spread；该字段在 `dsh-agent-loop/lib/index.js:1056` 取值、`:1214-1245` 决定 `request/header` 的 `reason`（`initial`/`resume`/`change`/`series`）。丢了它会让请求序列声明错位。

### F. 风险清单

| 风险 | 后果 | 规避 |
|---|---|---|
| **无条件注入** | 每步都有新消息 → `inbox.hasPending` 永真 → `turn()` 在 `:1033-1037` 无限续跑，**turn 永不结束** | 严格 `step === 1 && turn % N === 0` |
| 注入消息缺 `source.kind` | 派生历史里被渲染成用户提示 | 必须带自定义 `source.kind` |
| `source.kind` 取 `"runtime-context"` | 被 `step()` 的 context 分支特殊处理 | 用独立 kind |
| 改写 decision 忘 spread | `startsRequestSeries` 丢失 | `{ ...decision, messages }` |
| `await next()` 后又调 `next()` | 决策链断裂 | 只 await 一次，之后 `return decision` |
| 在 `turn-stopping` 里 steer | 每 N 轮强行延长一轮，成本高 | 周期提醒不用这条 |
| `setInterval` + `inject` | idle 时消息躺着、过时消费；还要清定时器（`practices.md:29`） | 用 turn 取模 |
| 提醒文本带轮次号 | cache 全失效 | 措辞固定 |
| 子代理也用同一 N | 小上下文里提醒占比过高 | 子代理取更大 N 或更短文案 |

**子代理**：走同一 Agent 工厂（`dsh-subagent/lib/index.js:1061、1083、1458`），同样触发 `agent/*` 事件；能否收到取决于注册选项——`cordis/lib/index.js:262-263` 的过滤是 `hook.global || !filter || filter(...)`，`{ global: true }` 可收到全部 agent（含子代理）。**建议用 `{ global: true }`**，子代理同样会漂移。

**卸载清理**：`ctx.on(...)` 与 `ctx.systemPrompt.section(...)` 的 disposer 由 Cordis 随 fiber 自动 dispose；`WeakMap` 随 agent 回收；**唯一要手清的是定时器**（`practices.md:29`「Clear the timer in the owning effect」）。本方案无定时器，清理面为零。

### 推荐实现（`docs/research/03-mode-d.md` 第 9 节）

```js
const SOURCE = { kind: "language-guard", form: "notice", summary: "语言守卫周期提醒" };

function installPeriodic(ctx, { everyNTurns = 8, enabled = () => true }) {
  const n = Math.min(50, Math.max(3, Math.trunc(everyNTurns)));   // 默认 8，范围 3–50
  ctx.on("agent/pre-step", async ({ agent, turn, step }, next) => {
    const decision = await next();
    if (decision.kind !== "enter") return decision;
    if (step !== 1 || turn % n !== 0) return decision;
    if (!enabled(agent)) return decision;
    if (decision.messages.some((m) => m.source?.kind === SOURCE.kind)) return decision;
    const message = createUserMessage({
      content: [{ type: "text", text: REMINDER }],
      source: SOURCE,
    });
    return { ...decision, messages: [...decision.messages, message] };
  }, { global: true });
}
```

N 取值统一为**默认 8、范围 3–50**，与 `docs/decisions/01-mechanism.md` 一致（本文档第 9 节伪代码已同步改为 `everyNTurns = 8` 并加钳制）。

## Comments
