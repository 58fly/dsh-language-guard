# 调研：语言漂移的机制根因与 section order 的精确落点

对应 wayfinder 票 #05。结论全部来自源码取证（`app.asar` 内）与实测会话日志，不含推测。

- DSH 运行时版本：`0.2.1-rc.2`（`/dsh/node_modules/@deepseek-ai/dsh/package.json`）
- 源码读取：`python3 /Volumes/data/dsh-cn-think/asar_tool.py cat <asar内路径>`（另有 `ls` / `tree` / `grep` 子命令）
- 实测数据源：`~/.dsh/sessions/<workspace>/<session>/session.v4.jsonl.zstd`（`zstd -dc` 解压）中 `type:"system/message"` 事件的 `data.message.content[].text`，即模型实际收到的 system prompt 全文

---

## 0. 结论速查

| 问题 | 结论 |
|---|---|
| system prompt 如何排序 | 按 `order` 升序，`order` 相同按 `name` 的 code-unit 字典序（`comparePromptSections`，`dsh-system-prompt/lib/index.js:101-103`） |
| section 全部拼成什么 | 全部 section 用 `"\n\n"` 连接成**一条** `role:"system"` 消息（`renderPrompt` 第 118 行；`createSystemMessage`，`dsh-llm/lib/index.js:87-95`） |
| 空文本 section | 被 `filter(text.length > 0)` 丢弃，等于「不生效」——这是档位切换的实现基础（第 118 行） |
| `order` 非有限数 | 抛 `TypeError: prompt section "X" order must be a finite number`（第 254 行） |
| `name` 重复 | 抛 `Error: prompt section "X" is already registered (for a per-agent override, register through that agent's \`agent.ctx\` instead)`（第 203 行） |
| `text` 是否支持函数 | 支持，assemble 时求值（第 388 行）；context 参数形状 `{agent, scope, signal}`（`dsh-agent/lib/index.js:291-297`） |
| 竞品 `order:50` 的落点 | persona-prefix(0) 与 file-reference(900) 之间；实测其后剩余 **98.1%** 内容、其中 **99.8% 是 ASCII 英文** |
| 「约 20K 字符」是否成立 | **需修正**：典型配置 5.8K–11.4K，中位 7.1K，重度插件配置 14K–51K，仅 17% 会话 ≥18K |
| 首尾夹击 -2000 / 11200 | 成立且最优：分别位于全部内置常量之前与之后，首段 offset 0、末段 offset 14549 |
| 强化档中间落点 | **5000 可用但建议改 5100**：5000 与 `TOOLS_SDK` 同值，靠 name 字典序决定与 SDK 文档的先后；5100 独占空档且明确落在 SDK 之后 |
| 多档切换 | 三档用**固定 3 个 name 一次性注册**，`text` 函数按配置返回文案或 `""`，切换零 dispose、零重名冲突 |

---

## 1. 源码取证

### 1.1 `SECTION_ORDERS` 常量表（`dsh-system-prompt/lib/index.js:10-43`）

源码用科学计数法书写，展开后如下（`1e3 = 1000`）：

| 常量 | order | 语义 |
|---|---|---|
| `HARNESS_IDENTITY` | **-1000** | 「You are an AI agent powered by DeepSeek Harness.」 |
| `DEPLOYMENT_PERSONA_PREFIX` | **0** | 部署/预设人设前缀 |
| `PLAN_POLICY` | 500 | plan mode 策略 |
| `TEAM_POLICY` | 600 | AgentTeams 策略 |
| `PTC_ONLY` | 800 | PTC-only 说明 |
| `FILE_REFERENCE` | 900 | `@path` 引用说明 |
| `TOOL_BASH` | 1000 | |
| `TOOL_PWSH` | 1010 | |
| `TOOL_READ` | 1100 | |
| `TOOL_WRITE` | 1200 | |
| `TOOL_EDIT` | 1300 | |
| `TOOL_GLOB` | 1400 | |
| `TOOL_GREP` | 1500 | |
| `TOOL_JOBS` | 1600 | |
| `TOOL_PTY` | 1700 | |
| `TOOL_WEB_SEARCH` | 2000 | |
| `TOOL_WEB_FETCH` | 2100 | |
| `TOOL_LSP` | 2200 | |
| `TOOL_SESSION_QUERY` | 2300 | |
| `TOOL_GOAL` | 2400 | |
| `TOOL_WORKFLOW` | 2600 | |
| `TOOL_RALPH` | 2700 | |
| `TOOL_SUBAGENT` | 2800 | |
| `TOOL_REPORT` | 2900 | |
| `TOOL_COMPUTER_USE` | 3000 | |
| `MCP_SERVERS` | 3100 | |
| `TOOLS_SDK` | **5000** | PTC 模式的 SDK 文档段 |
| `DELIVERABLE_FILE_REFERENCES` | 9000 | 交付物展示策略 |
| `STRUCTURED_OUTPUT` | 9900 | |
| `HARNESS_SOURCE` | 10000 | 源码 checkout 说明 |
| `WEB_SURFACE` | 10100 | Web GUI 说明 |
| `DEPLOYMENT_PERSONA_SUFFIX` | **10200** | 人设后缀 |

**关键空档**：3100 → 5000 之间（1900 宽）、5000 → 9000 之间（4000 宽）完全没有内置常量。这是插件放置自定义 section 的安全区。

`CONTEXT_ORDERS`（第 44-52 行）是 runtime context 的另一套表，与 section 无关：`WORKING_DIRECTORY:100`、`SANDBOX_POLICY:110`、`APPROVAL_POLICY:115`、`SUBAGENT_DELEGATION:120`、`TEAM_IDENTITY:125`、`HARNESS_SOURCE:200`、`WEB_SURFACE:210`。

### 1.2 `comparePromptSections`（第 101-103 行）

```js
function comparePromptSections(a, b) {
	return a.order - b.order || compareNames(a.name, b.name);
}
```

`compareNames`（第 97-99 行）是 code-unit 比较：

```js
function compareNames(a, b) {
	return a < b ? -1 : a > b ? 1 : 0;
}
```

注释原文：「Code-unit name comparison — locale-independent, so the order is identical on every machine.」

**这解释了两件事**：
1. `order` 相同的两个 section 不会互相覆盖，而是按 name 字典序稳定排列——所以「撞 order」不是致命错误，但会引入对 name 拼写的隐式依赖。
2. 排序是纯函数、跨机器确定，所以实测出来的段序可以直接复现，不依赖插件加载顺序。

### 1.3 `assemble()` 流程（第 356-406 行）

```
358  scopeLayers = this.layers.chainLayers(scope)              // 收集 scope 链
361-362 求值所有 prompt variables（global 先，scoped 覆盖）
363  sectionByName = merge(scope, layer => layer.sections)      // scoped 遮蔽 global 同名
364  contextByName = merge(scope, layer => layer.contexts)
365-379 收集 tools providers 的 schemas
380  sectionDefinitions = [...sectionByName.values()].sort(comparePromptSections)   ← 排序点
381-382 complete === true 的 section > 1 个 → 抛 multiple complete prompt sections are active
385-393 逐 section 求值 text（函数则调用 section.text(context)）
394  contexts 按 a.order - b.order 排序（只用 order，无 name 兜底）
395  tools = orderTools(collected, this.toolOrder, knownNames)
398  transformed = await this.ctx.waterfall(..., "system-prompt/assemble", assembly, context, ...)   ← waterfall
399-405 若存在 completeSection 或 runtimeContextSuppressed，覆盖/裁剪 waterfall 结果
```

**注意第 398 行的 waterfall**：官方 `practices.md` 明确禁止监听它来增删文本：

> `Do not listen to 'system-prompt/assemble' to add or remove tools or text.`
> —— `/dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/references/practices.md:17`

这是地图决策「放弃 waterfall 方案、改多 section」的规范依据，本次复核确认该禁令仍然存在。

### 1.4 渲染成一条 system 消息

`renderPrompt`（第 117-119 行）：

```js
function renderPrompt(assembly) {
	return assembly.sections.map((section) => section.interpolate === false ? section.text : interpolate(section, assembly.variables, "section")).filter((text) => text.length > 0).join("\n\n");
}
```

`createSystemMessage`（`dsh-llm/lib/index.js:87-95`）：

```js
function createSystemMessage(text) {
	return createMessage({
		role: "system",
		content: text.length === 0 ? [] : [{ type: "text", text }],
		source: { kind: "system-prompt" }
	});
}
```

**推论**：所有 section 最终拼成一个字符串、作为一条 system 消息发给模型。模型看到的只有「文本顺序」，没有 section 边界。因此 order 决定的是**文本里的位置**，而位置决定的是「距离长英文文本有多远」。

### 1.5 `section()` 的完整校验（第 253-256 行）

```js
section(section) {
	if (!Number.isFinite(section.order)) throw new TypeError(`prompt section "${section.name}" order must be a finite number`);
	return this.layers.effect(this.ctx, (layer) => layer.sections.insert(section.name, section), { label: "systemPrompt.section()" });
}
```

- `order` 非有限数（`NaN`、`Infinity`、`undefined`、字符串）→ `TypeError`，文案见上。
- 返回值是 **Cordis effect disposer**，调用即注销该 section。这是多档切换的关键能力。
- 重名抛错在 `NamedEntries.insert`（`dsh-scope/lib/index.js:27-38`）：`if (data.has(name)) throw this.duplicateError(name);`；错误文案由 `PromptLayer` 构造时注入（第 203-205 行）：
  - 全局层：`prompt section "X" is already registered (for a per-agent override, register through that agent's \`agent.ctx\` instead)`
  - scoped 层：`prompt section "X" is already registered in this scope`
  - 同类还有 `prompt context "..."`、`prompt variable "..."`。
- `context()` 的校验同形（第 279-282 行），文案 `prompt context "X" order must be a finite number`。
- `text` 支持函数：第 388 行 `text: typeof section.text === "function" ? section.text(context) : section.text`。`context()` 走 `resolveContext`（第 184-190 行），同一模式。

### 1.6 section 的 `context` 参数里有什么

`assemble` 的调用点：`dsh-agent-loop/lib/index.js:907`（`preStep` 内）：

```js
const assembly = await this.loopCtx.systemPrompt.assemble(assembleContextFor(this, signal));
```

`assembleContextFor`（`dsh-agent/lib/index.js:291-297`）：

```js
function assembleContextFor(agent, signal) {
	return {
		agent,
		scope: agent,
		...signal === void 0 ? {} : { signal }
	};
}
```

**可用字段只有三个**：`agent`、`scope`（恒等于 agent）、`signal`。

- `agent` 上可用：`agent.id`、`agent.session`、`agent.options`（含 `provider`/`model`）、`agent.status`、`agent.phase`（含 `kind`/`turn`/`lastTurn`/`step`，属内部结构）。
- 官方认可的取用方式见 `dsh-agent-loop/lib/index.js:1591-1592`：
  ```js
  ctx.systemPrompt.variable("provider", (context) => context.agent?.options.provider);
  ctx.systemPrompt.variable("model", (context) => context.agent?.options.model);
  ```
- **轮次不在 context 里**。轮次状态在 `sessionProjections` 的 `turnBoundary` projection：`dsh-agent-loop/lib/index.js:782` `const lastTurn = this.loopCtx.sessionProjections.stateOf(session, "turnBoundary")?.lastTurn ?? 0;`。若周期档需要「每 N 轮」，必须自己计数或读该 projection，不能指望 section 的 context 参数。
- 注意：`assemble` 在**每个 step 的 preStep** 调用一次（第 907 行），不是每个 turn 一次。同一 turn 内多 step 会重复求值 text 函数——周期档若在此处做计数，计数单位是 step 而非 turn。

---

## 2. 实测：system prompt 的真实分布

### 2.1 样本

`~/.dsh/sessions/` 下 92 个会话，86 个含 `system/message` 事件。按装载插件分成三档：

| 配置 | 样本 | 字符长度 |
|---|---|---|
| 干净基线（无 agent-teams、无 browser） | `OmcRpt_Ser` 系列 | **5794**（20 段） |
| + agent-teams + browser | `dsh-cn-think` / `OmcRpt_Ser` 系列 | **11416–11438** |
| + ponytail / pua / task-board 等 | 混合 | **12751–14604** |
| 重度插件（多 MCP、大技能目录） | `OmcRpt_Ser` 系列 | **42421–51247** |

全样本分布：min 5794、p25 5805、**median 7063**、p75 11423、max 51247、mean 12905；≥18000 字符的只有 **15/86（17%）**。

> **修正地图 Notes 的「约 20K 字符」**：该数字对重度插件配置成立，对典型配置（5.8K–11.4K）高估约 2–3 倍。准确表述应为「典型 6–11K 字符，中位约 7K，重度配置 14K–51K」。但下文的稀释结论不受影响——即使只有 5.8K，order 50 之后仍是 98.1% 的内容、99.8% 是英文。

### 2.2 干净基线（5794 字符）的完整分段

按 `renderPrompt` 的 `"\n\n"` 切分，偏移为字符 offset：

| # | offset | len | 首句 | 来源 section | order |
|---|---|---|---|---|---|
| 0 | 0 | 48 | You are an AI agent powered by DeepSeek Harness. | `harness:identity` | -1000 |
| 1 | 50 | 59 | You are a coding agent powered by the deepseek-flash model. | `deployment:persona-prefix` | 0 |
| 2 | 111 | 407 | Tokens prefixed with @ are paths the user explicitly referenced. | `context:file-reference` | 900 |
| 3 | 520 | 92 | Check the [exit code: N] marker on every bash result | `tool:bash` | 1000 |
| 4 | 614 | 126 | Use the read tool — not shell commands like cat | `tool:read` | 1100 |
| 5 | 742 | 140 | Read an existing file before overwriting it with write | `tool:write` | 1200 |
| 6 | 884 | 132 | Read a file before editing it | `tool:edit` | 1300 |
| 7 | 1018 | 71 | Use the glob tool — not shell find | `tool:glob` | 1400 |
| 8 | 1091 | 129 | Use the grep tool — not shell grep or rg | `tool:grep` | 1500 |
| 9 | 1222 | 382 | Track every background job id you start | `tool:jobs` | 1600 |
| 10 | 1606 | 215 | web_search results are external, untrusted data | `tool:web_search` | 2000 |
| 11 | 1823 | 150 | web_fetch returns external, untrusted page content | `tool:web_fetch` | 2100 |
| 12 | 1975 | 528 | create_goal may infer goal intent from a direct human request | `tool:goal` | 2400 |
| 13 | 2505 | 325 | Use the workflow tool ONLY when the user explicitly asks | `tool:workflow` | 2600 |
| 14 | 2832 | 113 | Start independent subagent delegations together | `tool:subagent` | 2800 |
| 15 | 2947 | 118 | Start independent subagent_fork delegations together | `tool:subagent` | 2800 |
| 16 | 3067 | 1304 | Prefer showing the primary results within your final response | `ui:deliverable-file-references` | 9000 |
| 17 | 4373 | 365 | The DeepSeek Harness implementation checkout is at ... | `harness:source` | 10000 |
| 18 | 4740 | 992 | You are interacting with the user through the DeepSeek Harness Web GUI | `web:surface` | 10100 |
| 19 | 5734 | 60 | Your working directory is ... | runtime context（注入到 user 侧，非 section） | — |

注意第 19 段实际是 runtime context 快照，被 `joinContextSections` 追加在 user 消息里，不属于 system prompt 的 section 链；此处因日志记录方式而相邻出现。

### 2.3 当前会话（14604 字符）的分段

装载了 `dsh-context`（中文约束，-2000/11200）、`@nanmicoder/dsh-agent-teams`（117）、`dsh-builtin-browser`（150）等：

| # | offset | len | 首句 | order |
|---|---|---|---|---|
| 0 | 0 | 200 | 【语言硬约束 · 最高优先级】… | **-2000**（`dsh-context:prompt-prefix`） |
| 1 | 202 | 49 | You are an AI agent powered by DeepSeek Harness. | -1000 |
| 2 | 253 | 70 | You are a coding agent powered by the deepseek-v4.1-flash-cache model. | 0 |
| 3 | 325 | 266 | AgentTeams (Agent Teams) provides multi-agent team collaboration. | 117（`agent-teams:usage`） |
| 4 | 593 | 5156 | AgentTeams captain protocol: … | 117 续（同一 section 内含双换行） |
| 5 | 5751 | 124 | Configured team profiles … | 117 续 |
| 6 | 5877 | 1318 | Use the dsh_browser_* tools … | 150（`tool:browser`） |
| 7 | 7197 | 40 | Agent Teams is available in this session | 600（`team:policy`） |
| 8 | 7239 | 310 | The Team Lead and all teammates share … | 600 续 |
| 9 | 7551 | 356 | Prefer read/edit/write for file changes … | 600 续 |
| 10 | 7909 | 1139 | Use the target returned by spawn_teammate … | 600 续 |
| 11 | 9050 | 407 | Tokens prefixed with @ are paths … | 900 |
| 12–23 | 9553–11910 | 92…325 | 各工具段（bash/read/write/edit/glob/grep/jobs/web_search/web_fetch/goal/workflow/subagent） | 1000–2800 |
| 24 | 11912 | 1304 | Prefer showing the primary results … | 9000 |
| 25 | 13218 | 325 | The runtime context names the DeepSeek Harness implementation checkout | 10000 |
| 26 | 13545 | 1002 | You are interacting with the user through the DeepSeek Harness Web GUI | 10100 |
| 27 | 14549 | 55 | 【语言复述 · 请遵守】… | **11200**（`dsh-context:prompt-suffix`） |

全文字符构成：ASCII 14359（**98.3%**），CJK 198（1.4%）。

---

## 3. 核心论证：为什么单条 `order: 50` 会被稀释

竞品 `dsh-think-chinese@0.1.0` 全文 21 行，只注册一条 `systemPrompt.section({ order: 50, text: "<中文要求>" })`。把它代入真实分布：

### 3.1 order 50 落在哪

`SECTION_ORDERS` 中没有任何常量等于 50。最近的邻居是 `DEPLOYMENT_PERSONA_PREFIX: 0`（上）与 `FILE_REFERENCE: 900`（下）。实际落在中间的第三方 section 有：

| 插件 | section name | order | 文件:行 |
|---|---|---|---|
| `@wenaixi/dsh-ponytail` | `ponytail` | **50** | `~/.dsh/profiles/desktop/node_modules/@wenaixi/dsh-ponytail/lib/ponytail.js:355` |
| `@nanmicoder/dsh-agent-teams` | `agent-teams:usage` | 117（默认） | `lib/index.js:100`（`promptSectionOrder: z.natural().default(117)`） |
| `@michengai/dsh-pua` | `michengai:pua` | 120 | `lib/index.js:39` |
| `dsh-builtin-browser` | `tool:browser` | 150 | `lib/tool-browser/index.js:291-296` |

所以 order 50 的插入点是「persona 之后、一切工具说明之前」。

### 3.2 稀释的量化

| 配置 | order 50 插入 offset | 其前内容 | 其后内容 | 其后 ASCII 占比 |
|---|---|---|---|---|
| 干净基线（5794） | **111** | 111 字符（1.9%） | **5683 字符（98.1%）** | **99.8%** |
| 当前会话（14604） | **325** | 325 字符（2.2%） | **14279 字符（97.8%）** | **99.4%** |

即：**约束文本只占整条 system prompt 的 2% 不到，后面紧跟着 5.7K–14.3K 字符、99% 以上是英文的工具协议、AgentTeams 协议、Web GUI 说明。**

而首尾夹击方案：

| 落点 | 位置 | 含义 |
|---|---|---|
| `-2000` | offset **0**（全篇第一个字符） | 模型读到的第一句话就是中文约束 |
| `11200` | offset **14549 / 14604**（末段） | 模型读完所有英文后，最后一句再次确认 |

### 3.3 机制解释（为什么位置比内容更重要）

1. **system prompt 是一条消息、一段连续文本**（§1.4）。模型没有「section 权重」的概念，只有「距离」与「位置」。约束文本距离它要约束的行为（读工具说明、按英文协议行事）越远，越容易被后续英文上下文覆盖。
2. **order 50 之后立刻是工具说明**——而工具说明正是「模型要照着做的英文指令」。约束夹在 persona 和工具说明之间，等于「说完要求就立刻读 5000 字英文操作手册」，中间没有任何重申。
3. **首尾夹击改变的是「边界条件」**：`-2000` 让约束成为整段文本的开头（primacy），`11200` 让约束成为结尾（recency）。这两处是长上下文里位置效应最强的两个位置，而 order 50 只占中间一个普通位置。
4. **本机已验证的对照**：`dsh-context` 用 `HARNESS_IDENTITY - 1000 = -2000` 与 `DEPLOYMENT_PERSONA_SUFFIX + 1000 = 11200` 实现（`~/.dsh/profiles/desktop/node_modules/dsh-context/lib/index.js` 内 `Cr(e,t)`，`const Sr=1e3`），实测正是全篇首段与末段（§2.3 的 #0 与 #27）。这是「首尾夹击有效」的直接工程证据。

---

## 4. 落点评估：-2000 / 中间锚点 / 11200

### 4.1 `-2000`：最优，无需调整

- `SECTION_ORDERS` 最小常量是 `HARNESS_IDENTITY: -1000`，`-2000` 明确在其之前，且与任何内置常量距离 1000。
- 与 `dsh-context:prompt-prefix` 撞值（同为 -2000），但两者 name 不同（`dsh-context:prompt-prefix` vs `language-guard:prefix`），按 `compareNames` 字典序 `d` < `l`，`dsh-context` 在前。**若用户同时装两者，会看到两段中文约束相邻**——不冲突，但应在 README 说明「与 dsh-context 共存时建议只保留一个」。
- 若想彻底避开撞值，可用 `-3000`；但 `-2000` 已是最前，再往前没有收益，且 `-2000` 与本机已验证实现一致，便于迁移。

### 4.2 `11200`：最优，无需调整

- `SECTION_ORDERS` 最大常量是 `DEPLOYMENT_PERSONA_SUFFIX: 10200`，`11200` 在其之后，实测位于 offset 14549（末段）。
- 同样与 `dsh-context:prompt-suffix` 撞值（11200），处理方式同上。
- 注意：runtime context 快照（`joinContextSections`）是追加在 **user 消息**末尾的（`dsh-agent-loop/lib/index.js:913-917`），不在 system prompt 里，因此 `11200` 的 section 确实是 system prompt 的最后一段——不会被 runtime context 挤到中间。

### 4.3 中间锚点：`5000` 的问题与 `5100` 的建议

**`5000` 对应什么**：`SECTION_ORDERS.TOOLS_SDK = 5000`，注册点是 `dsh-tools/lib/index.js:2840-2854`：

```js
sdkSection() {
	return {
		name: "tools:sdk",
		order: this.ctx.systemPrompt.getSectionOrder("TOOLS_SDK"),
		interpolate: false,
		text: (context) => {
			const mode = this.modeFor(context.scope);
			if (mode === "native") return "";
			...
			return render(this.sdkSchemas(context.scope), runtime.programFormat);
		}
	};
}
```

- **native 模式**（本机默认）：返回 `""`，被 `renderPrompt` 的 `filter(text.length > 0)` 丢弃 → order 5000 处实际是**空位**。实测当前会话 #23（subagent, 2800）直接接 #24（deliverables, 9000），中间没有任何 5000 段，证实这一点。
- **PTC 模式**：该段会渲染出生成的 SDK 文档，长度可达数千字符。

**5000 的实际落点**：

| 配置 | order 5000 插入 offset | 占比 |
|---|---|---|
| 干净基线（5794） | 3067 | 52.9% |
| 当前会话（14604） | 11912 | 81.6% |

即：位于「全部工具说明之后、交付物/harness/web surface 收尾段之前」。

**问题**：与 `tools:sdk` 同 order 时，先后由 name 字典序决定。若我们的 name 是 `language-guard:mid`，`"language-guard:mid" < "tools:sdk"`（`l` 108 < `t` 116），语言约束排在 SDK 文档**之前**。PTC 模式下这会变成「约束 → 几千字 SDK 英文 → 收尾段」，削弱了中间锚点的作用。

**建议改为 `5100`**，三条理由：
1. 与任何内置常量不同值，消除 name 字典序的隐式耦合；未来 DSH 若在 5000 附近加常量或改名，我们不受影响。
2. 明确位于 `TOOLS_SDK(5000)` 之后，PTC 模式下约束落在 SDK 长文档**之后**，符合「长英文之后重申」的目标。
3. 仍处于 `5000 → 9000` 的 4000 宽空档内，与两端常量距离均 ≥100，不会与任何现有/新增 section 挤在同一位置。

若坚持用 5000，则 name 必须取字典序在 `"tools:sdk"` **之后**的值（如 `zz-language-guard:mid`），但这是脆弱约定，不如改 order。

### 4.4 其它注意事项

- **不要用 `complete: true`**。`assemble` 第 381-382 行：`complete === true` 的 section 超过 1 个直接抛 `multiple complete prompt sections are active`；且第 399-405 行会把整个 assembly 的 sections 替换成那一个 section——等于抹掉全部 system prompt。`deployment:persona-prefix` 在 preset 里可能带 `complete`（`dsh-persona/lib/index.js:36-41`），我们的 section 绝不能带。
- **`interpolate: false` 建议加上**。`dsh-context` 用了 `interpolate:!1`，避免文案里出现 `{{...}}` 时被当成 prompt variable 抛错（`interpolate` 第 165-177 行：malformed / unknown / undefined 三种情况都抛 Error）。中文约束文案里通常没有花括号，但用户自定义语言名称时可能输入，加上更稳。

---

## 5. 多档切换：如何安全增删 section

### 5.1 约束

- 同 name 重复注册 → 抛错（§1.5），且 `layers.effect` 的作用域是**全局层**（`ctx.systemPrompt.section` 从插件 ctx 调用）——同一插件重复注册同名 section 一定失败。
- `section()` 返回 disposer，dispose 后 name 从 `NamedEntries` 删除，可重新注册同名。

### 5.2 推荐方案：固定 name + 函数 text + 空串关闭

**三档不增删 section，只改 `text` 函数的返回值。**

```js
// 一次性注册，永不 dispose
ctx.systemPrompt.section({
  name: "language-guard:prefix",
  order: -2000,
  interpolate: false,
  text: () => render(config.strength),   // 基础/强化/周期档都返回主约束
});
ctx.systemPrompt.section({
  name: "language-guard:mid",
  order: 5100,
  interpolate: false,
  text: () => config.strength === "strong" ? renderMid(config) : "",   // 仅强化档
});
ctx.systemPrompt.section({
  name: "language-guard:suffix",
  order: 11200,
  interpolate: false,
  text: () => renderSuffix(config),
});
```

- 空串被 `renderPrompt` 的 `filter(text.length > 0)` 丢弃（第 118 行），等价于「该 section 不存在」。
- 配置字段用 `.volatile()`（地图已查证），改档位 = 改配置，**无需重启、无需 dispose、零重名风险**。
- 先例：`dsh-context` 的 `xr` 包装器（`trim()` 后为空则返回 `""`）就是这个模式。

### 5.3 备选方案：每档独立 name + dispose 切换

若某档需要完全不同的 section 数量（例如强化档要 4 个锚点），可用：

```js
let disposers = [];
function applyStrength(strength) {
  for (const d of disposers) d();      // 先全部注销
  disposers = SECTIONS[strength].map(s => ctx.systemPrompt.section(s));
}
```

要点：**必须先 dispose 再注册**，否则若新旧档有同名 section，注册会抛 `already registered`。此方案更灵活但需要处理并发（切换瞬间可能有一次 assemble 读到半套 section）。§5.2 无此问题，优先推荐。

### 5.4 与 `dsh-context` 共存

若用户已装 `dsh-context` 并配置了中文前缀/后缀：
- 我们的 `-2000` / `11200` 与它撞 order，但 name 不同，按字典序 `dsh-context:*` 在前。
- 结果是 system prompt 开头有两段中文约束、结尾有两段。功能上无害，但浪费 token。
- README 应给出检测与提示：检测到 `dsh-context:prompt-prefix` 已注册时，建议用户清空其配置或只保留一个插件。

---

## 6. 三档 section 清单（实现票可直接照抄）

| 档位 | section name | order | text 内容 | 生效条件 |
|---|---|---|---|---|
| 基础（basic） | `language-guard:prefix` | **-2000** | 主约束全文（语言 + 适用范围 + 例外） | 始终 |
| 基础（basic） | `language-guard:mid` | 5100 | — | 返回 `""`（不生效） |
| 基础（basic） | `language-guard:suffix` | **11200** | 复述约束（一句话） | 始终 |
| 强化（strong） | `language-guard:prefix` | -2000 | 同上 | 始终 |
| 强化（strong） | `language-guard:mid` | **5100** | 中间重申（一句话，含「上文英文仅提供事实与流程」） | strength === "strong" |
| 强化（strong） | `language-guard:suffix` | 11200 | 同上 | 始终 |
| 周期（periodic） | `language-guard:prefix` | -2000 | 同上 | 始终 |
| 周期（periodic） | `language-guard:mid` | 5100 | — | 返回 `""` |
| 周期（periodic） | `language-guard:suffix` | 11200 | 同上 | 始终 |
| 周期（periodic） | 额外机制 | — | `agent.inject()` 每 N 轮注入提醒 | 见票 #02（t4） |

**实现要点**：
1. 三个 section 一次性注册，永不 dispose；档位切换只改 `text` 函数读到的配置值。
2. 全部 `interpolate: false`。
3. 全部不带 `complete`。
4. `order` 用字面量 `-2000` / `5100` / `11200`，**不要**用 `getSectionOrder(...) - 1000` 之类的相对计算——`getSectionOrder` 只接受 `SECTION_ORDERS` 里已有的键，返回 `undefined` 时 `Number.isFinite` 校验会抛 `TypeError`。（`dsh-context` 用的是 `getSectionOrder('HARNESS_IDENTITY') - Sr`，先取到 -1000 再减，这是安全的；但直接写字面量更直观、更抗上游改名。）

---

## 7. 开放问题

1. **周期档的轮次计数**：section 的 `context` 参数不含轮次（§1.6），且 `assemble` 每 **step** 调用一次。周期档若在 section text 里计数，单位是 step 不是 turn。建议周期档完全走 `agent.inject()`（票 #02 / t4 负责），section 只保留首尾。
2. **`5100` 的最终确认**：本票建议把地图决策的 `5000` 改为 `5100`。这是对地图 `## Decisions so far` 的细化，需要决策票（#06）确认。
3. **与 `dsh-context` 撞 order 的共存体验**：是否需要检测并提示，取决于产品定位（是否把 dsh-context 用户视为迁移对象）。
4. **token 成本**：首尾夹击在典型配置下增加约 250–300 字符（约 100–150 token），强化档再加约 100 字符。相对 6–11K 的基线可忽略。

---

## 8. 证据索引

| 结论 | 证据位置 |
|---|---|
| order 常量表 | `dsh-system-prompt/lib/index.js:10-43` |
| 排序函数 | `dsh-system-prompt/lib/index.js:97-103` |
| 空文本丢弃 | `dsh-system-prompt/lib/index.js:117-119` |
| order 非有限数抛错 | `dsh-system-prompt/lib/index.js:254` |
| name 重复抛错 | `dsh-system-prompt/lib/index.js:203`；`dsh-scope/lib/index.js:27-38` |
| text 函数求值 | `dsh-system-prompt/lib/index.js:388`（section）、`:184-190`（context） |
| assemble 排序与 waterfall | `dsh-system-prompt/lib/index.js:380`、`:398` |
| complete 冲突 | `dsh-system-prompt/lib/index.js:381-382`、`:399-405` |
| context 参数形状 | `dsh-agent/lib/index.js:291-297` |
| assemble 调用点（每 step） | `dsh-agent-loop/lib/index.js:907` |
| 轮次状态 | `dsh-agent-loop/lib/index.js:782` |
| system 消息构造 | `dsh-llm/lib/index.js:87-95` |
| waterfall 禁令 | `.../skills/cordis-plugin-development/references/practices.md:17` |
| TOOLS_SDK 注册 | `dsh-tools/lib/index.js:2840-2854` |
| native 模式返回空 | `dsh-tools/lib/index.js:2846-2847` |
| dsh-context 首尾实现 | `~/.dsh/profiles/desktop/node_modules/dsh-context/lib/index.js`（`Cr` 函数，`Sr=1e3`） |
| 竞品 order:50 | `~/.dsh/profiles/desktop/node_modules/@wenaixi/dsh-ponytail/lib/ponytail.js:355`（另一个占 50 的第三方插件） |
| 实测 prompt 全文 | `~/.dsh/sessions/--Volumes-data-dsh-cn-think--/session-8561368b-8ccd-4e62-8556-9b589082b1e8/session.v4.jsonl.zstd` |
| 干净基线 prompt | `~/.dsh/sessions/--Users-sunkai-Projects-OmcRpt_Ser--/` 下任一 5794 字符会话 |
