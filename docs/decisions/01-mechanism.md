# 决策 01：B/C/D 三档机制与配置 schema

- 状态：已定稿（#05、#02 均已关闭并完成源码实测核对；第 9.4 节原「待确认」已全部消解）
- 版本：**r2**（2026-10-18 修订 D 档实现路径：`agent.inject()` → `agent/pre-step` 改写 `messages`；变更记录见第 12 节）
- 对应 wayfinder 票：#06「决策：B/C/D 三档机制与配置 schema」（父票 #01）
- 上游依赖：#05（section order 精确落点）——已关闭，见 9.1；#02（D 档合规实现）——已关闭，见 9.4
- 下游消费者：#08（README 三档说明）、#09（包结构）、实现票、`docs/验收清单.md` 的 F3/F4/F5/F12/F15
- 本文是**唯一真源**：验收清单 F3「三档说明与 01-mechanism.md 一致」以此处措辞为准；实现代码里的 section 文案必须逐字照抄第 3 节。

---

## 0. 结论速览

| 档位 | 键 | 中文名 | 英文名 | 组成 | 相对成本 |
|---|---|---|---|---|---|
| 基础 | `B` | 基础 | Basic | head + tail 两段常驻 | 约 665 字符/步（head 552 + tail 113） |
| 强化 | `C` | 强化 | Strong | head + mid + tail 三段常驻 | 约 783 字符/步（比 B 多 mid 的 118） |
| 周期 | `D` | 周期 | Periodic | C 档三段 + 每 N 轮在 `agent/pre-step` 追加一条提醒消息 | 约 783 字符/步 + 每 N 轮约 99 字符（提醒正文 99 字符） |

> 上表数字为 `lib/text.js` 实测字符数（`headText({ language: 'zh-CN', preserveCodeTerms: true })`、无 `extraRules`/`overrideHead`）。复算命令：
> ```bash
> node --input-type=module -e 'import("./lib/text.js").then(m=>{const a=m.headText({language:"zh-CN"}),b=m.midText({language:"zh-CN"}),c=m.tailText({language:"zh-CN"}),d=m.reminderText({language:"zh-CN"});console.log(a.length,b.length,c.length,d.length)})'
> # → 552 118 113 99
> ```
> **注意**：`headText` 的形参名是 `language`，不是 `targetLanguage`（后者是 Config 字段名）。传错参数名会让 `⟨LANG⟩` 占位符未被替换，得到「语言代码 undefined」且长度变成 556——这是本条曾出现 556 与 552 两个数字的原因，**552 才是正确值**。
>
> 早期版本此处写的是估算值 200/350/110，与实现不符，已按实测更正；验收时以本表为准。

默认档位：**`C`（强化）**。默认目标语言：**`zh-CN`（简体中文）**。

三档的 section 注册表（`name` 固定、永不注销，只切文本）：

| section name | order | B 档文本 | C 档文本 | D 档文本 |
|---|---|---|---|---|
| `language-guard:head` | `-2000` | 第 3.1 节全文 | 同左 | 同左 |
| `language-guard:mid` | `5100` | `""`（空） | 第 3.2 节全文 | 同左 |
| `language-guard:tail` | `11200` | 第 3.3 节全文 | 同左 | 同左 |
| （非 section）`agent/pre-step` 改写 | — | 不注入 | 不注入 | 每 N 轮在当轮第一个 step 追加第 3.4 节全文 |

---

## 1. 硬约束与合规边界（不可协商）

1. **禁止监听 `system-prompt/assemble` 增删文本。** 官方 `practices.md` 原文：`Do not listen to 'system-prompt/assemble' to add or remove tools or text.` 因此强化档不使用 waterfall，改用**多个不同 name 的 section**。本插件**完全不注册** `system-prompt/assemble` 监听（验收 C4 会 grep 该字符串，必须为空）。
2. **禁止改写 `llm/stream` 的 `reasoning-delta`。** 改写会破坏 `assistant/message` 日志与 thinking signature 回放，触发 `INVALID_REPLAY_STATE`。因此「思考语言」只能**约束**，不能事后**改写**——这也是 D 档（周期再约束）存在的唯一理由。
3. **改写 `agent/pre-step` 的 `messages` 是允许的，但必须同时满足三条。** 官方 `practices.md:16` 原文只要求 spread：`When rewriting an agent/pre-step decision, spread it ({ ...decision, messages }) so fields such as startsRequestSeries survive.`
   - ① **先 `await next()`**：不拥有决策就原样 `return decision`（`kind === "reject"` 时尤其如此，绝不替换成自己的 `enter`）。
   - ② **必须 `{ ...decision, messages }` spread**：`startsRequestSeries` 由本插件之外决定（`dsh-agent-loop/lib/index.js:1057` 读它决定 `system/message` 的 `startsSeries`），丢字段会静默破坏请求序列语义。
   - ③ **必须有门禁且幂等**：只在 `step === 1 && turn % N === 0 && decision.messages.length > 0` 时插入，且本步 `decision.messages` 里已有本插件同款消息时直接返回原 decision。缺门禁会让每个 step 都追加消息，使 `inbox.hasPending` 永真、**turn 永不结束**。
4. **禁止 append 新 `type` 的 session 事件。** D 档的提醒走的是既有 `user/message` 类型（`dsh-agent-loop/lib/index.js:1072`），不新增事件类型，因此不触发「未知类型无法重开会话」的问题。
5. **禁止依赖第三方包**（如 `dsh-context`）。只用 `ctx.systemPrompt`、`agent/pre-step` waterfall、`ctx.settings`。
6. **section 文本在一次会话内必须稳定**：不得依赖轮次、时间、随机数等每步变化的值。原因见第 6 节（in-history 替换与 KV cache）。周期性变化**只允许**发生在 `agent/pre-step` 的 `messages` 追加里——那是一次性的消息，不是每步重渲染的 system 段。

---

## 2. 三档定义

### 2.1 命名（面板与文档统一使用）

- 中文：`基础` / `强化` / `周期`
- 英文：`Basic` / `Strong` / `Periodic`
- 配置值（schema 枚举，大小写敏感）：`B` / `C` / `D`

面板说明文案（三档各一句，验收 F3 判定「说明非空且与本文一致」）：

- `B` 基础：只在提示词首尾各放一段语言约束，成本最低，适合短会话。
- `C` 强化：在基础之上，于工具说明之后补一段重申，抵消英文工具说明带来的语言漂移，推荐默认。
- `D` 周期：在强化之上，每 N 轮在当轮开头追加一条语言自检提醒，适合长会话；提醒会作为一条会话记录出现，可在会话日志中看到。

### 2.2 section 注册表

| name | order | 说明 |
|---|---|---|
| `language-guard:head` | `-2000` | 位于 system prompt 最前，早于 `harness:identity`（`-1000`）与 `deployment:persona-prefix`（`0`） |
| `language-guard:mid` | `5100` | 位于 `tools:sdk`（`5000`）之后、`DELIVERABLE_FILE_REFERENCES`（`9000`）之前，即**全部工具说明之后、交付物与来源说明之前** |
| `language-guard:tail` | `11200` | 位于 `deployment:persona-suffix`（`10200`）之后，是 system prompt 的最后一段 |

三个 section 一律带 `interpolate: false`（见 7.3）。

### 2.3 order 取值的证据

`SECTION_ORDERS` 常量表（`/dsh/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js:10-43`）：

```
HARNESS_IDENTITY:-1000  DEPLOYMENT_PERSONA_PREFIX:0  PLAN_POLICY:500  TEAM_POLICY:600
PTC_ONLY:800  FILE_REFERENCE:900  TOOL_BASH:1000 … TOOL_SUBAGENT:2800  TOOL_REPORT:2900
TOOL_COMPUTER_USE:3000  MCP_SERVERS:3100  TOOLS_SDK:5000  DELIVERABLE_FILE_REFERENCES:9000
STRUCTURED_OUTPUT:9900  HARNESS_SOURCE:10000  WEB_SURFACE:10100  DEPLOYMENT_PERSONA_SUFFIX:10200
```

- `-2000`：低于表中最小值 `-1000`，无同序冲突；排序函数 `comparePromptSections`（同文件 `:100-103`）按 `order - order || compareNames` 排序，因此本段稳定居首。
- `5100`：**不用 5000**。`tools:sdk` 的 section 名是 `tools:sdk`、order 取自 `getSectionOrder("TOOLS_SDK")` 即 `5000`（`/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js:2840-2843`）。若本插件也用 `5000`，两者同序，将由 name 字典序决定先后（`language-guard:mid` 排在 `tools:sdk` 之前），中段重申会落到工具说明**之前**，失去「工具说明之后重申」的作用。故取 `5100`。
  > 与验收清单 F4 括注的「`-2000` / `5000` / `11200`」存在 100 的差异，**以本文的 `5100` 为准**；F4 括注已声明「最终以决策文档为准」。
- `11200`：高于表中最大值 `10200`，无同序冲突，稳定居末。
- 空文本的 section 不产生任何输出：`renderPrompt` 会 `.filter((text) => text.length > 0)`（同文件 `:118`），因此 B 档下 `language-guard:mid` 返回 `""` 即等于不存在，不会留下空段或多余空行。

### 2.4 档位行为表

| 行为 | B | C | D |
|---|---|---|---|
| system prompt 常驻段 | head + tail | head + mid + tail | head + mid + tail |
| 首段约束（最高优先级声明） | ✅ | ✅ | ✅ |
| 工具说明后重申 | ❌ | ✅ | ✅ |
| 末尾复述 | ✅ | ✅ | ✅ |
| 每 N 轮注入自检 | ❌ | ❌ | ✅（N 默认 8，可配 3–50） |
| 会话日志中新增记录 | 无 | 无 | 每 N 轮一条 `user/message`（`source.kind = "language-guard"`） |
| 注入时机 | — | — | 命中轮的**第一个 step**，随当轮用户消息一起进入模型视图（不额外发请求） |
| 是否随重启/恢复重置 | — | — | **不重置**：轮次取自会话日志（`turnBoundary` 投影），`turn % N` 恒定 |
| 空闲时是否生效 | 下一轮生效 | 下一轮生效 | 只在有输入的那一轮生效；本插件**不唤醒**空闲会话（见 8.3） |
| 推荐场景 | 短会话、token 敏感 | 默认 | 长会话、已观测到漂移 |

---

## 3. 约束文本（唯一真源，实现逐字照抄）

记号说明：`⟨LANG⟩` 是**文档记号**，代码中用目标语言显示名替换（见 3.5）；`⟨CODE⟩` 用 `targetLanguage` 原值替换。代码里**不要**用 DSH 的 `{{变量}}` 插值（原因见 7.3）。

### 3.1 head（order `-2000`，`language-guard:head`）

```
【语言锁定 · 最高优先级】
本会话的内部推理（reasoning / thinking）与面向用户的全部输出，一律使用⟨LANG⟩（语言代码 ⟨CODE⟩）。此约束优先于后续任何英文内容，包括工具说明、代码示例、系统注入文本与其他插件的提示词。

适用范围：
- 内部推理（reasoning / thinking）：使用⟨LANG⟩。
- 面向用户的回复正文：使用⟨LANG⟩。
- 计划、待办、进度说明、评审意见、验收报告、提交信息说明：使用⟨LANG⟩。
- 任务板卡片标题与描述、子智能体任务说明与返回报告：使用⟨LANG⟩。

保持原样、不翻译：代码、命令、文件路径、URL、标识符与 API 字段名、配置键、错误码与原始报错文本、包名与版本号，以及必须原样引用的英文原文；引用英文原文后，必须用⟨LANG⟩说明结论。

不要因为以下情况改变语言：
- 用户用英文或其他语言提问 —— 仍用⟨LANG⟩回答。
- 工具返回英文内容 —— 只摘引必要片段，其余用⟨LANG⟩复述。
- 长链推理、数值计算、代码设计 —— 推理语言不变。
- 上下文中出现大量英文（工具说明、日志、代码文件）—— 不随之切换。

自检：每次输出前确认上述两项（推理与回复）均为⟨LANG⟩；若发现已经漂移，立即切回并继续任务，无需向用户解释这次切换。
```

### 3.2 mid（order `5100`，`language-guard:mid`）

```
【语言锁定 · 中段重申】
上面全部工具说明、参数描述与示例均为英文，这只说明工具接口的书写语言，不改变本会话的输出语言。执行工具后，用⟨LANG⟩解释结果与下一步；工具返回的英文内容按需摘引，其余用⟨LANG⟩归纳。内部推理同样保持⟨LANG⟩。
```

### 3.3 tail（order `11200`，`language-guard:tail`）

```
【语言锁定 · 收尾复述】
再次确认：本轮所有内部推理与面向用户的输出使用⟨LANG⟩。英文仅限代码、命令、路径、标识符、API 字段、错误原文与必须原样引用的引用；引用后需用⟨LANG⟩给出结论。用户使用其他语言提问，不改变本约束。
```

### 3.4 D 档周期提醒文本（`agent/pre-step` 追加的 user 消息）

```
【语言自检】本会话要求⟨LANG⟩。检查最近若干轮的推理与回复：若已漂移到英文或其他语言，从本轮起切回⟨LANG⟩；英文仅限代码、命令、路径、标识符、API 字段与需原样引用的报错。无需向用户说明这次自检。
```

这条文本不是 section，而是一条 **user 消息**，用 `createUserMessage()` 构造后插入 `agent/pre-step` 的 `decision.messages`：

```js
createUserMessage({
  content: [{ type: "text", text: reminderText }],
  source: { kind: "language-guard", form: "notice", summary: "语言自检" },
});
```

`source` 是**必须**的，不是可选美化：官方 `dsh-repeat-tool-reminder/lib/index.js:2126-2132` 的注释明确写着「the label is load-bearing (an unlabeled context would render as a user prompt in derived history)」。三个字段的作用：

| 字段 | 值 | 作用 |
|---|---|---|
| `kind` | `"language-guard"` | 派生历史按它区分「插件注入」与「真实用户输入」。**绝不能写成 `"user"`**，也不能写成 `"runtime-context"`——后者会被 `dsh-agent-loop/lib/index.js:1067-1070` 当成 runtime context 特殊处理并替换成投影结果 |
| `form` | `"notice"` | 渲染形态标记，与 `dsh-plan-mode`、`dsh-repeat-tool-reminder` 保持一致 |
| `summary` | `"语言自检"` | 折叠显示用的一行摘要；**不参与模型输入**，用简体中文写死即可（不随 `targetLanguage` 变） |

#### 3.4.1 客户端渲染链核实（三个字段真的会这样显示吗）

结论：**会**。上面的取值能在官方 Chat UI 里渲染成「折叠的一行注入提示」，不会冒充用户发言。全链路证据（`app.asar` 内 `/dsh/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js`，共 13341 行）：

| 步骤 | 位置 | 行为 |
|---|---|---|
| 1. 事件分派 | `:9844-9852` `messageDefinition`（`kind: "input-message"`） | 只认 `event.type === "user/message"` 且 `isAppendSurfaceEvent(event)`。`agent/pre-step` 改写插入的消息以 `{ surfaceOp: "append" }` 落库（`dsh-agent-loop/lib/index.js:1072`），满足条件 |
| 2. 是否算「注入」 | `:9857` `event.data.source.kind !== "user"` | `language-guard` ≠ `user` → 走注入分支 |
| 3. 构造节点 | `:9832-9841` `contextMessage()` | `kind: "context"`、`producer: contextProducer(source)`、`form: contextForm(source)` |
| 4. `form` 解析 | `:7736-7740` `contextForm()` | 只接受 `KNOWN_FORMS`（`:7723-7730` = `instructions`/`catalog`/`snapshot`/`notice`/`relay`/`recall`）内的值，否则返回 `null` |
| 5. `producer` 解析 | `:7746-` `contextProducer()` | `default` 分支返回 `{ role: "inject", label: kind }`——**`label` 就是 `source.kind` 原字符串** |
| 6. body 分派 | `:4888-4932` `contextBody()` | `case "notice"`（`:4910-4917`）→ `NoticeBody`；`case null`（`:4928`）→ `opaque` |
| 7. `summary` 读取 | `:4872-4875` `noticeSummary()` | `source.summary` 必须是非空 string，否则返回 `null` → **退回 opaque** |
| 8. 行头标题 | `:4989` | `producer.role === "recall" ? "message.contextRecall" : "message.contextInjection"` → 固定「上下文注入 / Context injection」（字典在 ui-chat 内联 zh/en） |
| 9. 行内副标题 | `:4996-5005` | `producer.label === null` 时不渲染，否则渲染 `producer.label`，其后跟 `summary` |
| 10. 展开内容 | `:4530-4539` `OpaqueBody` / `:4767-4772` `NoticeBody` | `NoticeBody` 只渲染模型可见原文；`OpaqueBody` 额外渲染 `SourceFields`（`:4470-4490`，列出 `source` 里除 `kind` 外的**所有**字段） |

实际观感（折叠态一行）：`上下文注入 · language-guard · 语言自检`。

三条硬约束，实现时必须遵守（原表未写，属本次核实新增）：

1. **`summary` 不能是空串**。`noticeSummary()` 对空串返回 `null`（`:4872-4875`），`contextBody` 的 `case "notice"` 随之退回 `opaque`（`:4912`），观感从「一行提示」退化成「可展开的原始注入块」。
2. **`form` 拼写必须精确**。`contextForm()` 用 `KNOWN_FORMS.includes(form)` 严格比对（`:7739`），写成 `"reminder"`、`"notice "`（带空格）等都会返回 `null` → 静默降级为 `opaque`，**不报错、不告警**。更糟的是 `opaque` 分支会走 `SourceFields`，把 `source` 里除 `kind` 外的全部字段（含内部字段）摊到界面上。
3. **`kind` 里的 `language-guard` 会原样显示给用户**。`contextProducer` 的 `default` 分支把 `kind` 直接当 `label`（`:7746-`），且只有 `source` 不是对象或 `kind` 不是字符串时 `label` 才为 `null`——**改 `source` 无法隐藏它**。官方自己的 `agent-instructions`、`skill-invocation` 同样显示英文标识符，属既定观感，可接受；若将来要中文化，只能在 Client 侧自建 `conversation.chat.node` 渲染器覆盖 `context` 节点，属额外 UI 面，首版不做。

另附两条无害确认：文本截断上限 `MAX_CHARS = 2e4`（`:4416`，`boundedText()` `:4451-4453`），提醒文本远小于此；`isCompactionCheckpoint()`（`:9827-9830`）只排除 `compact-checkpoint`，不影响本 kind。

### 3.5 语言显示名映射

| `targetLanguage` | `⟨LANG⟩` |
|---|---|
| `zh-CN`、`zh-Hans`、`zh-SG` | 简体中文 |
| `zh-TW`、`zh-HK`、`zh-MO`、`zh-Hant` | 繁體中文 |
| `en`、`en-US`、`en-GB` | English |
| `ja`、`ja-JP` | 日本語 |
| `ko`、`ko-KR` | 한국어 |
| 其他合法标签 | 原样使用代码本身 |

实现方式：内置一张映射表；命中前缀即用映射值，未命中用 `targetLanguage` 原值。**不要**在映射表外做任何语言猜测。

### 3.6 `preserveCodeTerms: false` 时的文本变体

仅替换 3.1 与 3.3 中「保持原样、不翻译」那一段（其余段落不变）：

3.1 替换为：

```
尽量使用⟨LANG⟩表达技术概念：技术名词首次出现时给出⟨LANG⟩说法，可在括号内附英文原词。仅代码、命令、文件路径、URL、标识符与原始报错文本保持原样。
```

3.3 替换为：

```
英文仅限代码、命令、路径、标识符与原始报错文本；技术名词优先用⟨LANG⟩表达，必要时括号附英文。
```

`preserveCodeTerms: true`（默认）时使用 3.1 / 3.3 的原文。

---

## 4. 配置 schema

### 4.1 完整定义（照抄）

```js
import z from "@deepseek-ai/schemastery";

export const Config = z.object({
  targetLanguage: z.string()
    .default("zh-CN")
    .pattern(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/)
    .description("目标语言（BCP-47 语言标签）。默认 zh-CN。常见值：zh-CN 简体中文、zh-TW 繁體中文、en English、ja 日本語、ko 한국어。")
    .volatile(),

  strength: z.union([z.const("B"), z.const("C"), z.const("D")])
    .default("C")
    .description("强度档位。B=基础（提示词首尾两段约束）；C=强化（首尾两段 + 工具说明后重申，推荐）；D=周期（强化 + 每 N 轮注入一次语言自检）。")
    .volatile(),

  injectEveryNRounds: z.number().min(3).max(50).step(1)
    .default(8)
    .description("D 档每多少轮注入一次语言自检（3–50，默认 8）。仅 strength=D 时生效。")
    .volatile(),

  preserveCodeTerms: z.boolean()
    .default(true)
    .description("保持代码、命令、路径、标识符与英文报错原样，不翻译。默认开启。")
    .volatile(),

  extraRules: z.string()
    .default("")
    .description("附加约束，追加在内置规则之后（团队或项目自定义条款）。留空则只用内置规则。")
    .volatile(),

  overrideHead: z.string()
    .default("")
    .description("高级：完全替换首段内置规则文本。留空使用内置规则；非空时 extraRules 仍会追加在其后。")
    .volatile(),
});
```

### 4.2 字段表

| 字段 | 类型 | 默认 | 面板可改 | 作用 |
|---|---|---|---|---|
| `targetLanguage` | `string`（BCP-47 正则约束） | `"zh-CN"` | 是 | 目标语言；决定 `⟨LANG⟩` 与 `⟨CODE⟩` |
| `strength` | `"B" \| "C" \| "D"` | `"C"` | 是 | 档位选择 |
| `injectEveryNRounds` | `number`（3–50，整数） | `8` | 是 | D 档注入间隔（轮） |
| `preserveCodeTerms` | `boolean` | `true` | 是 | 是否保留代码与英文术语原样 |
| `extraRules` | `string` | `""` | 是 | 附加约束，追加在内置规则之后 |
| `overrideHead` | `string` | `""` | 是 | 完全替换 head 内置文本（高级） |

字段总数 **6**，全部 `.volatile()`，不新增其他字段（避免面板膨胀与实现分叉）。

### 4.3 关于「zod」

DSH 插件 `Config` 用的是 **`@deepseek-ai/schemastery`**（习惯性 `import z from "@deepseek-ai/schemastery"`），API 与 zod 同形但**不是** zod：

- **不要**把 `zod` 写进 `dependencies`。设置页表单只认 schemastery 的 schema 与 `meta.volatile`（`/dsh/node_modules/@deepseek-ai/dsh-settings/lib/index.js:118-133` 的 `volatileForm`），引入 zod 只会多一个依赖且面板不识别。
- schemastery 已提供本文用到的全部链式方法：`default` / `description` / `min` / `max` / `step` / `pattern` / `volatile`（`/dsh/node_modules/@deepseek-ai/schemastery/lib/index.mjs:216-238`），以及 `z.const` / `z.union` / `z.object`。

### 4.4 `.volatile()` 的硬性约束

1. **不能加在根对象上。** schemastery 校验器明确拒绝「volatile 字段被另一个 volatile 字段包住」：`volatile fields require a fixed object path without an enclosing volatile field`（同文件 `:246`）。必须逐字段 `.volatile()`。
2. volatile 值不能含函数、类实例或环（`cosmokit/src/volatile.ts` 的 `snapshot`）。本 schema 全为原始值，满足。
3. 运行时读取用 `config.<field>.get()`（`/dsh/node_modules/@deepseek-ai/dsh-agent-default-model/lib/index.js:34-40` 是官方范例）；**不要**缓存 `.get()` 的结果到闭包外。
4. 面板注册：`ctx.inject(["settings"], (child) => child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)))`，`auto: false` 表示不在设置页自动生成页面、只提供配置表单。

### 4.5 面板枚举渲染的兜底

`strength` 用 `z.union([z.const(...)])` 表达枚举，理想渲染是下拉框。若设置页把 union 渲染成文本框（待 #03/#04 确认），**不改 schema**，只在读取处做规范化：接受 `b`/`c`/`d` 大小写并 `toUpperCase()`，非法值回退 `"C"` 并 `ctx.logger.warn` 一次。

---

## 5. 默认值与理由

| 字段 | 默认 | 理由 |
|---|---|---|
| `targetLanguage` | `zh-CN` | 本项目定位与地图票一致（默认简体中文）；`zh-CN` 是 BCP-47 最通用的简体标签，映射到「简体中文」。 |
| `strength` | `C` | 默认必须「装完即有效」。B 只靠首尾两段，在工具输出密集的长会话中仍会漂移：实测 92 个历史会话的 system prompt 长度 min 5794 / median 7063 / p75 11423 / max 51247（典型 6–11K），其中 `500–5000` 段是全部工具说明与 AgentTeams / Web GUI 协议，99% 以上是英文，正是 head 与 tail 之间的空档。C 的 mid 段正对这个根因，成本约 +118 字符/步（实测 mid 正文长度），可忽略。D 会写会话日志，默认开启会打扰用户，故不设为默认。 |
| `injectEveryNRounds` | `8` | 范围 3–50。N 太小（≤3）会把提醒变成噪音并显著增加日志条数；N 太大（≥20）在漂移已发生后才有提醒。8 轮是「漂移可被观测到」的量级，且与一次长任务的典型轮数同阶。 |
| `preserveCodeTerms` | `true` | 目标用户是技术用户，代码与命令必须可复制执行；关掉会让输出不可运行。 |
| `extraRules` | `""` | 默认不注入任何用户自定义内容，保证开箱行为可预测、可复现。 |
| `overrideHead` | `""` | 默认不覆盖内置文案，避免用户一次误编辑就把最高优先级约束改坏；保留它是为了不锁死高级用户。 |

---

## 6. 切档策略与 D 档实现规格

### 6.1 切档：固定注册三个 section，只切文本

**固定注册三个 section，永不 dispose、永不重注册**；每个 section 的 `text` 是函数，按当前 `strength` 返回值或 `""`。

理由（三条都是硬事实）：

1. 同层重复注册同名 section 会抛错：`prompt section "${name}" is already registered`（`/dsh/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js:203`）。切档时先 dispose 再注册，若两次调用重叠（面板连续点击、HMR）就会撞上这个错误。
2. `section()` 返回的是 Cordis effect disposer；每次切档 dispose + 重注册会触发两次 `system-prompt/change`，让装配与设置页无谓重算。
3. 空字符串 section 会被渲染层过滤掉（同文件 `:118`），因此「返回 `""`」在语义上完全等于「该段不存在」，不需要真的注销。

切档生效时机：**下一次装配**（下一个 step）。无需重启，无需重新加载插件。`.volatile()` 保证面板改值后 `config.strength.get()` 立刻返回新值，section 的 `text(context)` 函数在每次装配时求值，因此下一 step 即生效（验收 F8）。

D 档**没有计数器**，所以不存在「切档要不要清空计数」的问题：`turn % N` 直接由会话日志推导（见 6.2）。从 C 切到 D 时，若当前轮次恰好命中 `turn % N === 0`，下一个有输入的轮次就会注入——这是预期行为，不需要额外处理。

### 6.2 D 档实现规格（代码级，逐条照做）

**为什么不用 `agent.inject()`**：`inject(input)` 等价于 `send(input, "next-step", false)`（`dsh-agent-loop/lib/index.js:812-814`），它把消息排进 **inbox**，要等到下一个 step 边界才被 `claim()` 取走，而且**不唤醒驱动器**（`practices.md:29`：`agent.inject() does not wake it`）。周期提醒的最佳时机是「当轮第一个 step 已经装配、模型还没开始写」——这正是 `agent/pre-step` waterfall 的位置。改走 pre-step 有四个直接收益：

| 收益 | 依据 |
|---|---|
| 本步即生效，不跨 step 排队 | `preStep` 在 `claim()` 之后、`assemble()` 之后调用 waterfall（`dsh-agent-loop/lib/index.js:902-921`） |
| 零额外请求 | 提醒作为当轮 step 1 的一条消息随行，不额外开一轮 |
| 日志完备（Model-visible ⟺ logged） | `step()` 把 `decision.messages` 逐条 `session.append("user/message", ...)`（同文件 `:1072`） |
| 无需任何插件内存状态 | `turn`/`step` 由 waterfall payload 直接给出（`:909-914`），`turn` 又来自 `turnBoundary` 投影（`:782`），重启/恢复后连续 |

**实现骨架**：

```js
ctx.on("agent/pre-step", async ({ agent, messages, turn, step }, next) => {
  const decision = await next();                       // ① 先拿下游决策

  // ② 不拥有决策就原样返回
  if (decision.kind === "reject") return decision;

  // ③ 门禁：只在命中轮的第一个 step、且有真实输入时插入
  if (step !== 1) return decision;
  if (decision.messages.length === 0) return decision;  // 否则会让本该结束的 turn 多跑一轮
  if (turn % injectEveryNRounds() !== 0) return decision;

  // ④ 幂等：本步已有同款消息就不重复
  if (decision.messages.some((m) => m.source?.kind === "language-guard")) return decision;

  // ⑤ 只对顶层会话注入（子代理的上下文已足够紧凑）
  if (delegationDepthOf(agent) !== 0) return decision;

  // ⑥ 插在「最后一个本步 claim 到的消息」之后、runtime context 之前
  const lastClaimed = decision.messages.findLastIndex((m) => messages.includes(m));
  const entered = decision.messages.toSpliced(lastClaimed + 1, 0, reminderMessage());

  return { ...decision, messages: entered };            // ⑦ 必须 spread
});
```

逐条理由：

- **① 先 `await next()`**：`agent/pre-step` 是 waterfall，最后一个参数是默认实现（`preStep` 里传入的 `() => ({kind:"enter", messages: claimed + context})`）。必须先拿到下游决策，才能在其基础上增补；直接返回自己的对象会**顶掉**其他插件的贡献（`dsh-agent-instructions` 也在改写这个决策）。
- **③ `decision.messages.length === 0` 必须挡**：`turn()` 里 `if (phase.step === 0 && decision.messages.length === 0) { turnEnds = {kind:"completed"}; return false; }`（`dsh-agent-loop/lib/index.js:965-968`）。step 1 的空决策意味着「本轮无事可做」，此时插入提醒会凭空造出一轮、让模型对着一条提醒自说自话。官方 `dsh-agent-instructions/lib/index.js:1412` 用的就是这个守卫（`step === 1 && decision.messages.length === 0` 时直接返回原决策）。
- **③ 只挡 `step !== 1`**：若在 step 2 也插入，会让本应结束的 turn 继续（`if (turnEnds && decision.messages.length === 0) break;` 永远不成立），**turn 永不结束**。这是本机制唯一能造成死循环的地方，必须死守。
- **④ 幂等用 `source.kind` 判断**，不用计数器：`decision.messages` 里已经带了本步 claim 到的历史消息，若同一步被重复进入（重试、resume 边界），同款消息已在数组里就不会再加一条。
- **⑤ `delegationDepthOf`**：子代理判定不能用 `agent.parent`（**`agent` 上没有这个字段**）。官方写法是 `Math.max(agent.session.header.delegationDepth ?? 0, agent.options.subagentDepth ?? 0)`（`dsh-subagent/lib/index.js:111-115`），`0` 即顶层。
- **⑥ 插入位置**：`lastClaimed` 是本步 claim 到的最后一条消息（payload 的 `messages`）；runtime context 由默认实现追加在其后，插在两者之间能让提醒紧跟用户输入、又不打乱 runtime context 的尾部位置。若 `lastClaimed === -1`（只有 runtime context），插到下标 0 即可。
- **⑦ spread**：见硬约束 3 的第 ② 条。

**监听注册位置**：注册在插件根 `ctx` 上（`ctx.on("agent/pre-step", ...)`），payload 自带 `agent`，由 ⑤ 过滤。**不要**用 `agent/created` + `agent.ctx.effect` 逐 agent 注册——那样需要按 agent 键控持有 disposer（验收 C7 的开销），而本监听**不持有任何 per-agent 状态**，根注册更简单且随插件卸载自动清理。

**`agent.inject()` 的定位（备选路径，默认不用）**：仅当需要「在会话尚未进入 step 时提前排入消息」时才用（例如某个外部事件触发的提醒）。用它必须知道两个语义：`inject = send(input, "next-step", false)`（`dsh-agent-loop/lib/index.js:812-814`），消息进 inbox、下一个 step 边界被 `claim()` 取走、**不唤醒**驱动器；日志证据是 `agent/inbox/spliced` 事件（`:204`），而消息本身要到被取用后才落 `user/message`。本插件的周期提醒**不需要**这条路径。

---

## 7. 自定义文案与内置模板的合并规则

### 7.1 head 的合并顺序

```
head 文本 = (overrideHead 非空 ? overrideHead : 内置 head（按 preserveCodeTerms 选变体）)
           + (extraRules 非空 ? "\n\n" + extraRules : "")
```

- `overrideHead` 只替换 **head**，不影响 mid / tail / D 档注入文本。理由：用户覆盖首段时，中段与末尾约束仍要保留，否则一次覆盖就退化成「单段方案」（竞品 order 50 的失败模式）。
- `extraRules` 追加在 head 之后、mid 之前（因为它属于 head 文本的一部分），语义是「在最高优先级约束区里补充条款」。
- 两字段都做 `trim()`；空白串视为空。

### 7.2 其他段的合并

- mid / tail / D 档注入文本**不受** `overrideHead` 与 `extraRules` 影响，始终使用内置文案。
- 三处文案里的 `⟨LANG⟩` / `⟨CODE⟩` 都由 `targetLanguage` 替换；替换发生在拼接之后，因此用户自定义文本里若写了 `⟨LANG⟩` 也会被替换（这是有意行为，写在 README 里）。

### 7.3 为什么用 `interpolate: false` + JS 字符串拼接

- section 声明 `interpolate: false`（与官方 `tools:sdk` 同做法，`/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js:2844`），渲染层会原样使用 `text`。
- 若改用 `ctx.systemPrompt.variable()` + `{{lang}}` 插值：`interpolate` 对未知或未定义引用会**抛错**（`/dsh/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js:177`），而 `extraRules` / `overrideHead` 是用户自由文本，出现 `{{` 就会让整个 system prompt 装配失败——这是不可接受的失效模式。
- 因此：**代码内用模板字符串做替换，section 一律 `interpolate: false`**。

---

## 8. 失效风险与回退策略

### 8.1 分档风险

| 档位 | 已知失效模式 | 观测信号 | 回退动作 |
|---|---|---|---|
| B | 中段衰减：`500–5000` 全是英文工具说明（实测 order 50 之后仍占 98.1% 的字符、99.8% 是 ASCII），head 与 tail 之间隔了 5.7K–14K 字符，长会话仍会漂移 | 会话中后段出现成段英文推理 | 升到 C（默认档） |
| C | mid 位置被未来插件新增的 section 挤压（若某插件在 5000–9000 之间插段，mid 的「工具说明之后」语义会被稀释） | 读会话日志 system 节点，mid 不再紧跟工具说明 | 把 mid 的 order 提到 `8900`（仍在 `DELIVERABLE_FILE_REFERENCES:9000` 之前）；仍无效则回退 B（B 不依赖 mid） |
| D | **门禁写错导致 turn 永不结束**：若在 `step !== 1` 也插入消息，`if (turnEnds && decision.messages.length === 0) break;`（`dsh-agent-loop/lib/index.js:964`）永不成立，每一轮都会多跑一步 | 会话里出现「模型对着提醒连续自说自话」、turn 不结束、token 消耗异常 | 门禁死守 `step === 1`（6.2 第 ③ 条）；这是本机制唯一能造成死循环的点，验收 F5 必须实测「一轮结束即停」 |
| D | 在空决策上插入，凭空造出一轮 | step 1 出现只有提醒、没有用户输入的 turn | 门禁加 `decision.messages.length > 0`（6.2 第 ③ 条，官方 `dsh-agent-instructions/lib/index.js:1412` 同款守卫） |
| D | 丢掉 `startsRequestSeries` 等决策字段，破坏请求序列语义 | `system/message` 的 `startsSeries` 异常，日志出现重复/缺失的请求序列起点 | 必须 `{ ...decision, messages }`（硬约束 3 第 ② 条） |
| D | 提醒在派生历史里被渲染成用户提示 | 会话界面出现用户从未输入过的一段话 | `source.kind` 用 `"language-guard"` + `form: "notice"`（3.4 节），**不能**用 `"user"` 或 `"runtime-context"` |
| D | 子代理（subagent）被注入，污染其紧凑上下文 | 子代理会话日志出现 `source.kind = "language-guard"` 的 `user/message` | 用 `delegationDepthOf(agent) !== 0` 过滤（6.2 第 ⑤ 条）；子代理继承父的 system prompt 约束已足够 |
| D | 用户把 N 设得极小（如 3）导致提醒过密 | 会话日志每 3 轮一条提醒，界面噪音 | 接受（schema 下限已限制为 3，且默认档不是 D）；README 说明「N 越小越吵」 |

### 8.2 全档共同风险

| 风险 | 处理 |
|---|---|
| 用户/项目 `AGENTS.md` 明确要求英文 | 冲突优先级：head 已声明「用户使用其他语言提问不改变本约束」，但**不硬顶用户的显式指令**。若用户在消息里明确要求英文，模型应遵从用户（插件只在 system 层声明默认语言，不覆盖当轮显式指令）。这条要在 README 写明。 |
| 插件被禁用 | 无任何 section、无注入，自然回退（验收 F13）。 |
| 配置值非法（如 `strength: "X"`） | schema 在激活时校验失败；`targetLanguage` 非法则被 `pattern` 拒绝（验收 F11）。代码内再兜底一次：非法档位回退 `"C"` 并 warn。 |
| 切档导致 system prompt 变化 | 会产生一次 in-history 的 system 节点替换（DSH 机制：system prompt 变化即追加替换节点）。这是**预期行为**，token 成本一次性，不影响日志一致性。 |
| 用户把 `overrideHead` 写成空白的纯空格 | `trim()` 后视为空，回退内置文案（验收 F12「清空后回退默认」）。 |

### 8.3 D 档的触发点与生效时机（实现与文档都要一致）

D 档挂在 **`agent/pre-step` waterfall** 上，判断条件是「命中轮的**第一个 step**」：

```js
step === 1 && turn % N === 0 && decision.messages.length > 0
```

- `turn` 与 `step` 由 waterfall payload 直接给出（`preStep` 里 `this.preStep(target, { turn, step })`，`/dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js:956-959`；payload 是 `{ messages: claimed, ...position, signal }`，同文件 `:909-914`），**不需要插件自己计数**。
- `turn` 的值来自 `turnBoundary` 投影的 `lastTurn`（同文件 `:782`），而该投影由 `turn/start` 事件维护（`:1365-1390`）。因此 `turn` 是**会话日志的函数**：重启、resume、fork 之后轮次连续，`turn % N` 不会归零。这是本设计相对「插件内存计数器」的关键改进。
- 生效时机：**当轮第一个 step 的请求**。提醒与当轮用户消息一起进入模型视图，不额外发请求，也不推迟到下一步。
- 空闲会话：`agent/pre-step` 只在有 turn 在跑时触发，插件**不会**唤醒空闲会话（也不调用 `followup()`——那会凭空多跑一轮）。用户不发消息就不会有提醒，这是刻意的：语言守卫不该自己产生对话。

对比 `agent.inject()` 路径：`inject = send(input, "next-step", false)`（同文件 `:812-814`），消息进 inbox、下一个 step 边界被 `claim()` 取走、**不唤醒**驱动器；日志证据是 `agent/inbox/spliced`（`:204`），消息本身要到被取用后才落 `user/message`。也就是说 inject 会晚一步、且多一条 inbox 事件。**本插件默认不使用它**（定位见 6.2 末尾）。

---

## 9. 调研核对结果

### 9.1 已由 #05 实测确认（不再是待确认项）

票 #05 已关闭，结论见 `docs/research/01-section-orders.md` 与票 #05 的 `## Answer`（A–H 八节）。以下三项原「待确认」已确认，本文数值**无需改动**：

| 原待确认项 | 实测结论 | 对本文的影响 |
|---|---|---|
| `section.text(context)` 是否含轮次字段 | **不含**。`assembleContextFor`（`dsh-agent/lib/index.js:291-297`）只给 `{ agent, scope, signal? }`；轮次状态在 `sessionProjections.turnBoundary`（`dsh-agent-loop/lib/index.js:782`）。且 `assemble` 在 `preStep` 内**每 step 调用一次**（`dsh-agent-loop/lib/index.js:907`），不是每 turn 一次 | 确认 B/C 档不使用 `context`；确认「周期」不能靠 section 计数（单位会是 step），必须走 `agent/pre-step` 改写 messages（见 6.2） |
| `11200` 之后是否还有第三方 section | **无冲突**。内置最大常量为 `DEPLOYMENT_PERSONA_SUFFIX:10200`；runtime context 快照追加在 **user 消息**末尾（`dsh-agent-loop/lib/index.js:913-917`），不在 system prompt 内，故 11200 确实是 system prompt 最后一段 | 确认 tail 落点 |
| head / mid / tail 的实测位置与长度 | 干净基线 5794 字符时 order 50 落 offset 111（其后 5683 字符 / 98.1%，ASCII 99.8%）；当前重度配置 14604 字符时 order 50 落 offset 325（其后 14279 字符 / 97.8%，ASCII 99.4%）。92 个会话 system prompt 长度 min 5794 / median 7063 / p75 11423 / max 51247 | 本文第 5、8.1 节原写的「约 20K 字符」已按实测改为「典型 6–11K，中位 7.1K，重度 14K–51K」；**结论不变**——即便只有 5.8K，order 50 之后仍是 98.1% 的内容、99.8% 英文 |

补充确认（`comparePromptSections`，`dsh-system-prompt/lib/index.js:101-103`）：

```js
function comparePromptSections(a, b) {
	return a.order - b.order || compareNames(a.name, b.name);
}
```

`compareNames`（同文件 `:97-99`）是 code-unit 比较、跨机器确定。`"language-guard:mid" < "tools:sdk"`，所以 **mid 用 5000 会排到工具说明之前**——本文的 `5100` 被实测确认，保持不变。

另两条从 #05 顺带确认的实现约束：

- **绝不能带 `complete: true`**：超过 1 个 complete section 会抛 `multiple complete prompt sections are active`（`dsh-system-prompt/lib/index.js:381-382`），且 `:399-405` 会把整个 assembly 替换成那一个 section。三个 section 都不带 complete。
- **order 必须是有限数字**：`Number.isFinite` 校验不过会抛 `prompt section "X" order must be a finite number`（同文件 `:253-256`）。不要用 `getSectionOrder("未知键")` 拼 order（返回 `undefined` 会被这里拒掉），直接写字面量。

### 9.2 与票 #05 的命名差异（以实现本文为准）

票 #05 的 G 节表格用 `language-guard:prefix` / `:mid` / `:suffix` 作为**草稿名**，且把「周期」档的 mid 画成返回 `""`。**实现以本文为准**：

- 三个 section 名固定为 `language-guard:head` / `language-guard:mid` / `language-guard:tail`（本文第 2.2 节）。
- 「周期」档 = head + mid + tail **三段全开** + 每 N 轮注入（本文第 2.4 节），不是「mid 关闭 + 注入」。

理由：D 档的定义是「在 C 之上加周期性自检」，若同时关掉 mid 就等于用低频提醒换掉高频常驻，反而更弱；两者叠加才是「周期」的语义。

### 9.3 与第三方 `dsh-context` 插件的 order 共存（重要）

本机 `dsh-context` 插件（用户此前手动配中文约束用的第三方插件）已占用 `-2000` 与 `11200` 两个 order 位置，与本插件**完全撞值**。

- **不会报错**：撞 order 不撞 name。排序是 `order - order || compareNames(name)`，`"dsh-context:prompt-prefix" < "language-guard:head"`（`d` < `l`），因此 dsh-context 的两段会排在本插件两段之前，共存稳定。
- **但会重复占 token**：两者都在做语言约束，等于同一段意思写两遍，且 dsh-context 的文案质量不可控。
- **建议**：装本插件后，把 dsh-context 的 `promptPrefix` / `promptSuffix` 清空（或直接停用 dsh-context），只保留本插件。这条要写进 README 的「与已有中文插件共存」一节，由票 #08 落实。
- 本插件**不检测、不改写** dsh-context 的配置（跨插件写配置违反最小惊讶原则，且 dsh-context 不是稳定依赖）。

### 9.4 D 档相关待确认项：已由 #02 与源码实测消解

票 #02 已关闭，结论见 `docs/research/03-mode-d.md` 与票 #02 的 `## Answer`。原六条「待确认」现状：

| # | 原待确认项 | 结论 | 证据 |
|---|---|---|---|
| 1 | `agent.inject(input)` 的 `input` 形状 | **不需要再回答**——D 档不走 inject，走 pre-step 改写 | 6.2 节；`dsh-agent-loop/lib/index.js:902-921` |
| 2 | `turn/end` 事件的订阅方式与 payload 字段 | **不需要再回答**——不再用 `turn/end` 计数，`turn`/`step` 直接来自 pre-step payload | `:956-959`、`:909-914` |
| 3 | 注入对 KV cache 的影响 | 提醒是一条追加在 messages 尾部的 `user/message`，**不改 system prompt**，只增加该轮的尾部 token；且每 N 轮才一次 | `:1072` |
| 4 | 子代理是否应注入、`agent` 上是否有 `parent` 字段 | **`agent` 上没有 `parent` 字段**（已确认）。官方判定用 `Math.max(agent.session.header.delegationDepth ?? 0, agent.options.subagentDepth ?? 0)`，`0` 即顶层 | `dsh-subagent/lib/index.js:111-115` |
| 5 | 设置页把 `z.union([z.const()])` 渲染成下拉还是文本框 | **仍未确认**（属 #03/#04 的 UI 调研），但**不阻塞实现**：按 4.5 节兜底即可 | `dsh-client-ui-settings/lib/client.js` 有 union 分支 |
| 6 | `meta.description` 在设置页是否原样显示为字段说明 | **仍未确认**，不阻塞实现：即便不显示，schema 里的说明也不会出错 | 同上 |

第 5、6 条只影响面板观感，不影响机制与文案；实现按 4.5 节写即可，若调研给出相反结论再回改本文。

### 9.5 本文路径记号的读法

本文（以及团队其他决策/调研文档）里的 `/dsh/node_modules/@deepseek-ai/...` 是 **DSH 安装包 `app.asar` 内的虚拟路径**，不是本机文件系统上的真实路径。要读原文，用仓库根的 asar 工具，去掉前导斜杠：

```bash
python3 asar_tool.py cat dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js | sed -n '900,930p'
python3 asar_tool.py grep 'agent/pre-step'
```

---

## 10. 实现者照抄清单

1. `Config` 用 4.1 的代码，6 个字段全部 `.volatile()`，不加 zod 依赖。
2. 在 `apply(ctx, config)` 内用 `ctx.effect()` 注册三个 section：
   - `language-guard:head` / order `-2000` / `interpolate: false` / `text: () => headText(...)`
   - `language-guard:mid` / order `5100` / `interpolate: false` / `text: () => strength() === "B" ? "" : MID_TEXT(...)`
   - `language-guard:tail` / order `11200` / `interpolate: false` / `text: () => TAIL_TEXT(...)`
3. 文本全部取自第 3 节，逐字照抄；`⟨LANG⟩` / `⟨CODE⟩` 用 3.5 的映射替换。
4. `strength()` 读取处做规范化与兜底（4.5）。
5. D 档：在**插件根 ctx** 上注册 `ctx.on("agent/pre-step", ...)`，按 6.2 的骨架逐条实现（`await next()` → 判 reject → `step===1` → `messages.length>0` → `turn%N===0` → 幂等 → `delegationDepthOf!==0` 跳过 → `toSpliced` 插入 → `{...decision, messages}`）。**不注册 `agent/created`、不维护计数器、不调用 `agent.inject()`。**
6. 不注册 `system-prompt/assemble`、不改写 `llm/stream` 的 `reasoning-delta`、不 append 新 `type` 的 session 事件。`agent/pre-step` **允许**改写，但必须满足硬约束 3 的三条。
7. 面板：`ctx.settings.configure({ auto: false }, ctx.fiber)`；三档中文说明用 2.1 的三句，一字不改。

---

## 11. 下游文档需要同步的差异（r2 修订引起）

本次修订只改 **D 档的实现路径**，三档的定义、文案、order 落点、schema 字段与默认值**全部未变**。以下位置需要跟着改措辞：

| 位置 | 旧说法 | 新说法 |
|---|---|---|
| `docs/验收清单.md` C5 | 「周期提醒用 `agent.inject()`，未在 `agent/pre-step` 改写 messages」 | 周期提醒**就是** `agent/pre-step` 改写 messages；判定改为：① 有 `await next()`；② 返回 `{...decision, messages}`；③ 门禁含 `step === 1`；④ 未 append 新 type 事件。chk 命令里的 `! grep -rq 'agent/pre-step' index.js` 必须**删除**（它与新决策相反） |
| `docs/验收清单.md` F5 | 「注入路径为 `agent.inject()`」「会话事件出现 `agent/inbox/spliced`」 | 注入路径为 `agent/pre-step`；证据改为「命中轮的 `user/message` 事件，其 `source.kind` 为 `language-guard`」；并补一条「非命中轮不出现该消息」 |
| 票 #08（README 三档说明） | 「每 N 轮注入一次语言自检提醒」 | 「每 N 轮在当轮开头追加一条语言自检提醒，会作为一条会话记录出现」；并删掉任何「注入不唤醒会话」的表述（本插件不唤醒空闲会话，因为它根本不主动触发） |
| 票 #09（包结构） | D 档需要 `lib/cycle.js` 监听 `turn/end` | `lib/cycle.js` 改为注册 `agent/pre-step`；不需要 per-agent disposer 键控 |
| 本文 2.1 面板文案 | — | 已就地更新（面板说明必须与此处逐字一致，验收 F3） |

## 12. 修订记录

| 版本 | 日期 | 变更 | 原因 |
|---|---|---|---|
| r1 | 2026-10-18 | 初稿：三档定义、文案、order、schema、风险 | 票 #06 交付 |
| r2 | 2026-10-18 | **D 档实现路径由 `agent.inject()` 改为 `agent/pre-step` 改写 `messages`**；硬约束 3 由「禁止改写」改为「允许但须满足三条」；删除计数器设计；9.4 待确认项消解；新增 6.2 实现规格与 9.5 路径读法 | r1 把 `agent/pre-step` 改写当成违规，是**判断错误**。官方 `practices.md:16` 明确允许改写、只要求 spread；`agent/pre-step` payload 自带 `turn`/`step`，改写后的消息也确实落 `user/message` 日志（`dsh-agent-loop/lib/index.js:1072`），「Model-visible ⟺ logged」不变式**不破**。官方 `dsh-agent-instructions/lib/index.js:1406-1424` 就是同类先例 |
