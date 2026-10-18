# 调研：D 档周期提醒的 agent.inject 合规实现

对应 wayfinder 票 #02。结论全部来自源码取证（`app.asar` 内）与真实会话日志，不含推测。

- DSH 运行时版本：`0.2.1-rc.2`
- 源码读取：`python3 /Volumes/data/dsh-cn-think/asar_tool.py cat <asar内路径>`
- 实测日志：`~/.dsh/sessions/<workspace>/<session>/session.v4.jsonl.zstd`（`zstd -dc` 解压）

---

## 0. 结论速查

| 问题 | 结论 |
|---|---|
| `agent.inject()` 签名 | `inject(input: UserMessage): void`，实现为 `send(input, "next-step", false)`（`dsh-agent-loop/lib/index.js:812-814`） |
| 它唤醒驱动器吗 | **不唤醒**。`followup` = next-turn + 唤醒，`steer` = next-step + 唤醒，`inject` = next-step + **不唤醒**（`:800-814`） |
| 什么时候被模型看到 | 下一个**被接纳**的 step；当前 step 已经 claim 过，拿不到 |
| 记什么日志 | 调用即记 `agent/inbox/spliced`（`ReactLoopInbox.mutate`，`:204`），被接纳后再记 `user/message`（`:1072`） |
| 会不会污染 messages | 不会。inbox 是独立持久投影（`:24-67`），消息在 claim 时才并入本步批次 |
| 每 N 轮怎么触发 | **不需要计数器**：`agent/pre-step` 载荷自带 `turn` 与 `step`（`api-catalog.js:4006`），判 `turn % N === 0 && step === 1` 即可 |
| 计数器要存哪 | 无需存。若确需跨事件状态，用 `WeakMap<Agent, …>`（官方 `dsh-repeat-tool-reminder` 的 `chains` 就是这么做的） |
| 卸载时清什么 | `ctx.on(...)` 返回的 disposer 由 Cordis 随 fiber 自动 dispose；`WeakMap` 随 agent 对象回收，无需手动清；**唯一要手清的是定时器**（`practices.md:29`） |
| KV cache 会不会坏 | 不会。注入消息追加在 messages **末尾**，前缀不变；相反，改 system prompt section 会让整条 system 消息变化、前缀全变 |
| 比改 messages 安全在哪 | 改 messages 走 `agent/pre-step` waterfall，是官方认可的改写点（`practices.md:16`），且同样落 `user/message` 日志，**两条路径都满足「Model-visible ⟺ logged」**；真正危险的是绕过两者直接改 session |
| 子代理会被注入吗 | 会，**前提是注册时带 `{global: true}`**；不带则被 scope 过滤掉（`cordis/lib/index.js:263`） |
| 官方最贴近的先例 | `dsh-agent-instructions` 的 `agent/pre-step` 处理器（`lib/index.js:1406-1424`）：`await next()` → 去重 → `toSpliced` 插到 claimed 之后 → `{...decision, messages}` |

---

## 1. `agent.inject()` 的签名与语义

### 1.1 实现

`dsh-agent-loop/lib/index.js:800-820`：

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

三个入口的差别只有两维：**投递目标**（`next-turn` / `next-step`）与**是否唤醒**。

| 方法 | target | 唤醒 | 适用 |
|---|---|---|---|
| `followup` | `next-turn` | 是 | 外部事件推动新一轮 |
| `steer` | `next-step` | 是 | 打断当前轮、插到最近一步 |
| `inject` | `next-step` | **否** | 只补上下文，不制造工作 |

`agent.inject()` 不唤醒的直接后果（`practices.md:29` 原文）：injected context **can wait in the inbox until other input arrives** —— 若 agent 已 idle，提醒会一直躺着，等用户下次说话才被消费，那时往往已过时。**所以周期提醒必须在 turn 进行中注入，不能靠定时器在 idle 时 inject。**

### 1.2 投递落点

`splice(target, start, deleteCount, inserted)` → `mutate(...)`（`:178-207`）：

```js
const event = this.session.append("agent/inbox/spliced", splice);   // :204
```

`agent/inbox/spliced` 是 **session 事件**，不是内存状态：inbox 由持久投影 `inboxProjectionDefinition`（`:24-67`，`key: "inbox"`，`stateVersion: 1`）从日志重放重建。重建时会拒绝越界坐标与跨 `next-turn`/`next-step` 重复的 `MessageId`（抛 `invalid persisted inbox splice at session seq ${event.seq}`，`:63-65`）。

`mutate` 还会发实时通知：`agent/inbox/discarded`（`:205`，仅当 `discardRemoved`）、`agent/inbox/inserted`（`:206`，逐条）。

### 1.3 何时被模型看到

`preStep(target, position)`（`:902-929`）：

```js
const claimed = this.inbox.claim(target, position.turn);            // :906
const assembly = await this.loopCtx.systemPrompt.assemble(...);     // :907
const decision = await this.dispatch.waterfall("agent/pre-step",
    { messages: claimed, ...position, signal }, () => ...);         // :909-919
```

`claim`（`:103-113`）把 pending 消息从 inbox 删掉（纯删除 splice，`discardRemoved = false`），并 emit `agent/inbox/claimed { message, turn }`。

关键：**claim 发生在 `agent/pre-step` waterfall 之前**。所以：

- 在 `agent/pre-step` 监听器里调 `agent.inject()` → 消息进 `next-step`，**本步拿不到**，下一步才拿到；
- 若本步就是本轮最后一步（模型直接答完），因为 `inbox.hasPending` 为真，`turn()` 会重置 phase 再跑一步（`:1033-1037`），提醒在**额外的一步**里才生效。

这就是「inject 有一步延迟 + 可能多一次请求」的机制来源。

### 1.4 真实日志佐证

会话 `session-cf8dd2d7`（`--Volumes-data-DSH--`）里 4 组用户输入，每组都是成对事件：

| seq | 事件 | 载荷 |
|---|---|---|
| 5 | `agent/inbox/spliced` | `target:"next-turn"`、`start:0`、`inserted:[user 消息 id 0bf35015-…]` |
| 7 | `agent/inbox/spliced` | `target:"next-turn"`、`start:0`、`removedCount:1`（claim 消费） |
| 10 | `user/message` | **同一个 id** `0bf35015-…`、`source.kind:"user"` |

即：`inject/用户提交 → agent/inbox/spliced(inserted) → claim → user/message`，id 全程不变。**这条链就是「Model-visible ⟺ logged」的物理形态。**

---

## 2. 三条可选的注入路径

### 路径 A：`agent.inject()`（官方点名的上下文注入）

- 位置：任意时机，但只在 turn 进行中有意义
- 延迟：一个 step
- 日志：`agent/inbox/spliced` → `user/message`
- 风险：模型本步已答完时会多跑一步

### 路径 B：改写 `agent/pre-step` 的 `decision.messages`（**推荐**）

`practices.md:16` 明确允许，且给出 spread 要求。官方先例 `dsh-agent-instructions/lib/index.js:1406-1424`：

```js
ctx.on("agent/pre-step", async ({ agent, messages, step, signal }, next) => {
  const decision = await next();
  ...
  const pending = agent.inbox.nextStep.filter(isAgentInstructionsMessage);
  const desired = await compose(agent, signal, messages, pending);
  signal.throwIfAborted();
  if (decision.kind === "reject" || step === 1 && decision.messages.length === 0) {
    syncInbox(agent, messages, desired);          // fallback：退回 inbox
    return decision;
  }
  for (const message of pending) agent.inbox.remove(message.id);   // 去重
  if (desired === void 0 || decision.messages.some((m) => sameContextPayload(m, desired))) return decision;
  const lastClaimedIndex = decision.messages.findLastIndex((m) => messages.includes(m));
  const entered = decision.messages.toSpliced(lastClaimedIndex + 1, 0, desired);
  return { ...decision, messages: entered };       // spread 保住 startsRequestSeries
});
```

三个要点：

1. **先 `await next()`**，在别人的决策上改，不抢决策权；
2. **`{ ...decision, messages }`** 保住 `startsRequestSeries`（丢了它会破坏请求序列语义，见 §6）；
3. 插入点 `lastClaimedIndex + 1` —— 紧贴最后一条 claimed 消息之后，位于循环自己的 runtime context 之前。

`step()` 随后会把这些消息全部落日志（`:1062-1073`）：

```js
if (firstAttempt) for (const message of decision.messages) if (message.source.kind === "runtime-context") {
    ...合并 context...
} else this.session.append("user/message", message, { surfaceOp: "append" });   // :1072
```

**所以路径 B 同样满足「Model-visible ⟺ logged」**，且零额外请求。

### 路径 C：`agent/turn-stopping` 里 `agent.steer()`

`api-catalog.js:4036-4041`：mode `serial`，轮次关闭前 await；「a listener that objects steers (`agent.steer(...)`) and the machine re-reads its inbox」。

- 效果：轮次不关闭，再跑一步
- 适合：**用户已停止、需要追一句**的场景
- 不适合：周期提醒（每 N 轮都会强行延长一轮，且 steer 是 next-step + 唤醒，成本比 inject 高）

### 选型

**周期提醒用路径 B**：本步即生效、零额外请求、日志完备、官方有先例。`agent.inject()` 保留给「本步尚未开始、需要提前排入」的场景（如 agent 刚创建、或 pre-step 被 reject 后的 fallback）。

---

## 3. 每 N 轮触发：不需要计数器

`agent/pre-step` 的载荷（`api-catalog.js:4006`）：

```ts
payload: { agent: Agent; messages: UserMessage[]; turn: number; step: number; signal: AbortSignal }
```

**`turn` 与 `step` 直接给了**。turn 号由 `turn()` 维护（`dsh-agent-loop/lib/index.js:938`），从 session projection 的 `lastTurn` 续接（`:782`），恢复会话后仍连续递增。

因此：

```js
ctx.on("agent/pre-step", async (payload, next) => {
  const decision = await next();
  if (decision.kind !== "enter") return decision;
  if (payload.turn % N !== 0 || payload.step !== 1) return decision;   // 每 N 轮的第一个 step
  ...
});
```

- `step === 1` 保证每轮只注入一次
- `turn % N === 0` 在第 N、2N、3N… 轮触发
- **零状态、零定时器、零清理**

### 若一定要存状态

官方 `dsh-repeat-tool-reminder/lib/index.js` 用 `const chains = new WeakMap();`，**以 agent 对象为 key**：agent 被回收即自动释放，不需要 `agent/disposed` 清理。若需要跨进程持久，则应走 session projection（`ctx.sessionProjections.register(...)`），而不是内存 Map。

---

## 4. 注入文本的生命周期

| 阶段 | 事件 | 说明 |
|---|---|---|
| 调用 inject | `agent/inbox/spliced`（`inserted`） | 持久，可重放 |
| 被 claim | `agent/inbox/spliced`（`removedCount`） | 纯删除 splice，`outcome` 为 `canceled` 时表示被丢弃（`:196-202`） |
| 进入请求 | `user/message`（同 id） | 与普通用户消息同形 |
| 之后 | 保留在历史里 | **不会自动消失**，成为后续每轮请求的前缀一部分 |

结论：**inject 的文本是持久的、累积的**。每 N 轮注入一次，N 小的话上下文会被同一段提醒反复占用。

对策（写进实现要求）：

- 提醒文本要**短**（建议 ≤ 200 字符），且不要每次换措辞——**措辞固定反而有利于 cache**；
- 周期档 N 取决策文档 `docs/decisions/01-mechanism.md` 的约定：**默认 8，合法范围 3–50**（由 `Config` schema 约束，越界时钳制到区间端点）；
- 若需要「只提醒一次」，用 `WeakMap` 记已提醒过的 turn，而不是靠文本自述。

---

## 5. 与「Model-visible ⟺ logged」不变式

不变式原文（`dsh-session/README.md:100`）：

> **Model-visible means logged**: anything that reaches a model request must be reconstructable from the log.

两条路径都满足：

- **inject**：`agent/inbox/spliced` 是日志事件，投影可重建 inbox，claim 后落 `user/message`；
- **改写 decision.messages**：`step()` 在 `:1072` 逐条 `session.append("user/message", message)`。

**为什么它比"改 messages"安全** —— 需要精确表述：危险的从来不是"改 messages"，而是**绕过这两个官方改写点**去动 `session`。`agent/request` 监听器就无法改请求消息（`practices.md:18` 原文：「`agent/request` listeners cannot change request messages」）。而 `agent/pre-step` 是官方指定的「replace the messages that enter it」入口，改它有日志兜底。

真正的风险在别处：**不标 `source.kind` 的注入消息会在派生历史里被渲染成用户提示**。官方注释（`dsh-repeat-tool-reminder/lib/index.js`）：

> the label is load-bearing (an unlabeled context would render as a user prompt in derived history)

所以必须构造带 `source` 的消息：

```js
createUserMessage({
  content: [{ type: "text", text: reminder }],
  source: { kind: "language-guard", form: "notice", summary: "周期中文提醒" },
});
```

注意 `source.kind` **不能取 `"runtime-context"`** —— `step()` 在 `:1063` 对该 kind 有特殊分支（与每步的 context 合并处理），取它会导致提醒被当成 runtime context 处理。

---

## 6. KV cache：注入消息 vs 改 system prompt

### 6.1 机制

请求的物理布局是：**一条 system 消息在最前**（`createSystemMessage`，`dsh-llm/lib/index.js:87-95`，全部 section 拼成一条），其后是历史消息，最后是本步批次。缓存按前缀匹配，**改动越靠前，失效越多**。

| 做法 | 变化位置 | cache 影响 |
|---|---|---|
| 追加一条 user 消息 | messages **末尾** | 前缀不变，命中 |
| 改 system prompt section 文本 | **最前面**的 system 消息 | 整条前缀变化，**全失效** |

这正是 D 档必须用 inject/追加消息、而不是靠 section 文本变化来做周期提醒的根本原因。

### 6.2 请求序列语义

`buildRequest`（`dsh-agent-loop/lib/index.js:1214-1245`）：

```js
const startsSeries = startsRequestSeries || this.requestSurfaceGeneration !== surfaceGeneration;
```

`request/header` 的 `reason` 为 `initial` / `resume` / `change` / `series`。`startsRequestSeries` 来自 `decision.startsRequestSeries`（`:1056`），用于声明「一个独立的模型消息序列」。

**这就是 `practices.md:16` 要求 spread 的原因**：若改写 decision 时丢掉 `startsRequestSeries`，外层信封的序列声明会错位，provider 侧的 prompt cache 与推理连续性都可能受影响。

### 6.3 措辞稳定性

固定措辞 + 固定位置 = 每次注入后前缀完全一致，第 2 次起可直接命中。**不要**在提醒文本里插入轮次号、时间戳等变化量。

---

## 7. 子代理

子代理由 `ctx.agents.create()` 创建（`dsh-subagent/lib/index.js:1061、1083、1458`），走同一个 Agent 工厂，因此**同样触发 `agent/*` 事件**。

能否收到，取决于注册选项。`cordis/lib/index.js:262-263`：

```js
return (this._hooks[name] || []).filter((hook) => hook.global || !filter || filter.call(thisArg, hook.ctx))...
```

`api-catalog.js:4009` 注明 `agent/pre-step` 是 **scope-filtered dispatch**：「agent-scoped listeners receive only that agent」。

| 注册方式 | 收到谁的事件 |
|---|---|
| `ctx.on("agent/pre-step", h)`（无 global） | 仅与插件 ctx 作用域匹配的 agent |
| `ctx.on("agent/pre-step", h, { global: true })` | **全部 agent，含子代理** |

`@xmanrui/dsh-im` 就是 `{global: true}`（其 `agent/pre-step` 与 `agent/disposed` 监听均带该选项）。

**建议**：语言守卫用 `{ global: true }`，让子代理也受约束（子代理同样是模型，也会漂移）。但要注意：

- 子代理上下文通常更小，提醒文本占比更高 —— 可考虑对子代理只发短版；
- 子代理数量多时注入总量上升，`turn % N` 的 N 可对子代理取更大值（`payload.agent.options` 可判断是否子代理）。

---

## 8. 卸载清理

| 资源 | 清理方式 | 依据 |
|---|---|---|
| `ctx.on(...)` 监听器 | 返回的 disposer，Cordis 随 fiber 自动 dispose | `cordis` 事件服务 |
| `ctx.systemPrompt.section(...)` | 同上（返回 Cordis disposer） | `dsh-system-prompt/lib/index.js:253-256` |
| 定时器 | **必须手动清**，`ctx.effect(() => { const t = setInterval(...); return () => clearInterval(t); })` | `practices.md:29`「Clear the timer in the owning effect」 |
| `WeakMap` 计数 | 无需清（随 agent 对象回收） | `dsh-repeat-tool-reminder` 的 `chains` |
| inbox 里未消费的注入消息 | **无需清**（agent 销毁时 inbox 随之消失；`cancel({keepInbox:false})` 会 `inbox.clear()`，`:815-820`） | `dsh-agent-loop/lib/index.js:815-820` |

**本方案（§3 的 turn 取模）不产生任何定时器**，因此清理面为零 —— 这是它相对"setInterval + inject"的最大优势。

---

## 9. 推荐实现

```js
const SOURCE = { kind: "language-guard", form: "notice", summary: "语言守卫周期提醒" };
const REMINDER = "【语言守卫·周期提醒】本轮起恢复简体中文思考与回复；代码/路径/命令/报错原文保持原样，引用后用中文说明结论。";

function installPeriodic(ctx, { everyNTurns = 8, enabled = () => true }) {
  // N 的合法范围 3–50，由 Config schema 约束（决策文档 docs/decisions/01-mechanism.md）
  const n = Math.min(50, Math.max(3, Math.trunc(everyNTurns)));
  ctx.on("agent/pre-step", async ({ agent, turn, step }, next) => {
    const decision = await next();
    if (decision.kind !== "enter") return decision;          // 不抢决策权
    if (step !== 1 || turn % n !== 0) return decision;
    if (!enabled(agent)) return decision;

    const message = createUserMessage({
      content: [{ type: "text", text: REMINDER }],
      source: SOURCE,
    });
    // 幂等：本步已有同款就不重复
    if (decision.messages.some((m) => m.source?.kind === SOURCE.kind)) return decision;

    return { ...decision, messages: [...decision.messages, message] };   // spread 保住 startsRequestSeries
  }, { global: true });
}
```

要点复盘：

1. `await next()` 先拿下游决策 —— 不拥有决策就不改变它（`practices.md:16`）；
2. `return decision`（原样）而不是 `next()` —— 已经 await 过，不能再调一次；
3. `{...decision, messages}` —— spread 保字段；
4. 追加在末尾 —— 与 claimed 消息顺序一致，KV cache 友好；
5. `{ global: true }` —— 覆盖子代理；
6. 无定时器、无计数器、无清理。

若必须提前排入（例如想在下一轮开始前就放好），改用 `agent.inject(message)`，但要接受一个 step 的延迟与可能的额外请求。

---

## 10. 风险清单

| 风险 | 后果 | 规避 |
|---|---|---|
| 在 `agent/pre-step` 里无条件注入 | 每步都有新消息 → `inbox.hasPending` 永真 → **turn 永不结束** | 严格用 `step === 1 && turn % N === 0` |
| 注入消息缺 `source.kind` | 派生历史里被渲染成用户提示，污染会话语义 | 必须带自定义 `source.kind` |
| `source.kind` 取 `"runtime-context"` | 被 `step()` 的 context 分支特殊处理 | 用独立 kind |
| 改写 decision 时忘记 spread | `startsRequestSeries` 丢失，请求序列声明错位 | `{ ...decision, messages }` |
| 在 `agent/turn-stopping` 里 steer | 每 N 轮强行延长一轮，成本高 | 周期提醒不用这条 |
| 用 `setInterval` + `inject` | idle 时消息躺着、过时消费；还要清定时器 | 用 turn 取模 |
| 提醒文本带轮次号/时间戳 | 每次前缀都变，cache 全失效 | 措辞固定 |
| 对子代理也用同样的 N | 小上下文里提醒占比过高 | 子代理取更大 N 或更短文案 |

---

## 11. 用户可见性：注入内容会不会被用户看到

决策文档 `docs/decisions/01-mechanism.md:55` 的面板文案写「提醒会作为一条会话记录出现」。**这句话需要精确化**——分两个层面：

### 11.1 日志层面：会，一定会有记录

注入的消息被接纳后落 `user/message` 事件（`dsh-agent-loop/lib/index.js:1072`），与其他消息同形，`source.kind` 为插件自定义值。所以「会话记录里有一条」是准确的，这正是「Model-visible ⟺ logged」的要求，**不可绕过、也不应该绕过**。

### 11.2 UI 层面：不会渲染成用户气泡

`dsh-client-ui-chat/lib/client.js` 按 `source.kind` 分流：

```js
// :9857
if (event.data.source.kind !== "user") {
    ...
    return { ...contextMessage(event, event.data), waking: ... };   // kind: "context"
}
// 只有 source.kind === "user" 才走 user / steering 气泡
```

```js
// :9831-9841 contextMessage
return { kind: "context", seq, time, content, source,
         producer: contextProducer(message.source), form: contextForm(message.source) };
```

```js
// :7746-7769 contextProducer：所有非 user 的 kind 一律 role: "inject"
switch (kind) {
    case "session-reference": return { role: "recall", label: ... };
    case "agent-instructions": return { role: "inject", label: ... };
    case "skill-invocation": return { role: "inject", label: ... };
    default: return { role: "inject", label: kind };
}
```

结论：**注入消息在 UI 中呈现为一条 context 节点（`role: "inject"`，label 取 `source.kind`），不是用户消息气泡**，用户不会误以为是自己说的话。

### 11.3 `source.form` 的合法值

`contextForm` 只认白名单（`client.js:7723-7730`）：

```js
const KNOWN_FORMS = ["instructions", "catalog", "snapshot", "notice", "relay", "recall"];
```

取 `"notice"` 是合法值；取白名单外的字符串会被当作 `null`（仍渲染，但失去 form 语义）。因此 `source: { kind: "language-guard", form: "notice", summary: ... }` 是安全选择。

### 11.4 对决策文档的建议措辞

把「提醒会作为一条会话记录出现」改为：

> 每 N 轮会往会话里追加一条注入上下文（UI 中显示为 inject 节点，不是用户消息），可在设置面板里调整 N 或关闭。

理由：原句「会话记录」容易被理解为「用户消息」，而实现层面它是 `source.kind` 非 `user` 的 context 记录。

---

## 12. 证据索引

| 结论 | 文件:行 |
|---|---|
| `inject = send(input,"next-step",false)` | `dsh-agent-loop/lib/index.js:812-814` |
| `send` 的 `wakingAfterAbort` 与 splice | `dsh-agent-loop/lib/index.js:800-810` |
| `followup` / `steer` 对照 | `dsh-agent-loop/lib/index.js:811-812` |
| `cancel` 的 `keepInbox` 与 `inbox.clear()` | `dsh-agent-loop/lib/index.js:815-820` |
| `ReactLoopInbox` 类与 `nextTurn/nextStep/hasPending` | `dsh-agent-loop/lib/index.js:70-96` |
| `clear()` 先清 next-step | `dsh-agent-loop/lib/index.js:98-101` |
| `claim()` 与 `agent/inbox/claimed` | `dsh-agent-loop/lib/index.js:103-113` |
| `mutate()` 与 `agent/inbox/spliced` | `dsh-agent-loop/lib/index.js:178-207`（append 在 `:204`） |
| inbox 持久投影 `stateVersion: 1` | `dsh-agent-loop/lib/index.js:24-67` |
| `preStep` claim 先于 waterfall | `dsh-agent-loop/lib/index.js:906-919` |
| `turn()` 的 `turn-stopping` 与 hasPending 续跑 | `dsh-agent-loop/lib/index.js:1001、1033-1037` |
| `step()` 落 `user/message` | `dsh-agent-loop/lib/index.js:1062-1073`（`:1072`） |
| `startsRequestSeries` 取值 | `dsh-agent-loop/lib/index.js:1056` |
| `buildRequest` 的 `startsSeries` 与 `request/header` | `dsh-agent-loop/lib/index.js:1214-1245` |
| `agent/pre-step` 签名与 scope 过滤 | `dsh-tool-cordis/lib/types/api-catalog.js:4004-4009` |
| `agent/turn-stopping` 签名 | `dsh-tool-cordis/lib/types/api-catalog.js:4036-4041` |
| 全部 agent/* 事件清单 | `dsh-tool-cordis/lib/types/api-catalog.js:3948-4038` |
| `agentEvents` 自动注入 `agent` 字段 | `dsh-agent/lib/index.js:242-272` |
| cordis `global` 过滤 | `cordis/lib/index.js:262-263` |
| practices 弱机制优先 | `dsh-agent-preset/skills/cordis-plugin-development/references/practices.md:10` |
| waterfall 必须 return next() + spread | 同上 `:16` |
| `agent.inject()` 记 `agent/inbox/spliced` | 同上 `:18` |
| 定时器在 owning effect 里清 | 同上 `:29` |
| `dsh-agent-instructions` pre-step 注入范式 | `dsh-agent-instructions/lib/index.js:1406-1424` |
| `dsh-repeat-tool-reminder` 的 WeakMap 与 source 注释 | `dsh-repeat-tool-reminder/lib/index.js`（`REMINDER_SOURCE`、`chains`） |
| 「Model-visible means logged」 | `dsh-session/README.md:100` |
| `createSystemMessage` 单条 system | `dsh-llm/lib/index.js:87-95` |
| `createUserMessage` | `dsh-llm/lib/index.js:55+` |
| 子代理走同一 Agent 工厂 | `dsh-subagent/lib/index.js:1061、1083、1458` |
| 实测 spliced→user/message 同 id | `~/.dsh/sessions/--Volumes-data-DSH--/session-cf8dd2d7-…/session.v4.jsonl.zstd`（seq 5→7→10） |
| 非 user 的 source.kind 渲染为 `kind:"context"` | `dsh-client-ui-chat/lib/client.js:9857、9831-9841` |
| `contextProducer` 的 `role:"inject"` 兜底 | `dsh-client-ui-chat/lib/client.js:7746-7769` |
| `KNOWN_FORMS` 含 `notice` | `dsh-client-ui-chat/lib/client.js:7723-7730` |
| `contextForm` 白名单外返回 null | `dsh-client-ui-chat/lib/client.js:7736-7740` |
| `sessionProjections.stateOf` 是公开 API | `dsh-tool-cordis/lib/types/api-catalog.js:2261` |
| `turnBoundary` 投影（`lastTurn`） | `dsh-agent-loop/lib/index.js:1365-1400` |
| 恢复会话时 `lastTurn` 续接 | `dsh-agent-loop/lib/index.js:781-782` |
