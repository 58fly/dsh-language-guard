<!-- DSH-IDEMPOTENCY-KEY: deck-plan-dsh-language-guard-map-v1-child-research-orders -->
<!-- parentKey: 01 -->
<!-- created: 2026-10-18T13:16:25.033Z -->
# 调研：语言漂移的机制根因与 section order 的精确落点

确认「为什么规定了中文仍会漂移成英文或反复切换」的机制性解释，并给出各档位 section 的精确 order 数值。

需要回答：
1. 实测 system prompt 的最终拼装顺序与各段长度（尤其英文段占比），确认 order 50 与 -2000/11200 的实际差异。
2. 多 section 方案（-2000 / 5000 / 11200）中，5000 这个位置两侧是什么内容，是否会被 `TOOLS_SDK:5000` 之类的既有 section 冲突或挤开。
3. section 的 `text` 传函数时，`context` 参数里有哪些可用字段（是否含轮次/会话信息）。
4. 同一 name 重复注册会抛错（`prompt section "X" is already registered`），多档切换时如何安全地增删 section 而不冲突。

产出：写入 `docs/research/01-section-orders.md`，含实测数据与结论表。

完成标准：给出三档各自应注册的 section 名称与 order 清单，可直接被实现票照抄。

## 进度

- 2026-10-18 已读源码：`dsh-system-prompt/lib/index.js` 全 410 行、`dsh-agent/lib/index.js` assembleContextFor、`dsh-agent-loop/lib/index.js` preStep、`dsh-llm/lib/index.js` createSystemMessage、`dsh-tools/lib/index.js` sdkSection。
- 已实测 92 个历史会话的 system prompt 长度分布，提取 2 个基准样本（干净 5794 字符 / 当前 14604 字符）并逐段映射到源码注册点。
- 已核对本机 `dsh-context` 的首尾实现（-2000 / 11200）与 4 个占用 order 50–150 的第三方插件。
- 产出文档：`docs/research/01-section-orders.md`。结论已写入 Answer。

Status: completed
Type: task
Blocked by:
Labels: wayfinder:research, wayfinder:task

## Comments

## Answer

完整证据与实测数据见 `docs/research/01-section-orders.md`。以下为结论正文，实现票可直接照抄第 6 节清单。

### A. 排序机制（源码级）

- `SECTION_ORDERS` 常量表：`dsh-system-prompt/lib/index.js:10-43`。全量：`HARNESS_IDENTITY:-1e3`(-1000)、`DEPLOYMENT_PERSONA_PREFIX:0`、`PLAN_POLICY:500`、`TEAM_POLICY:600`、`PTC_ONLY:800`、`FILE_REFERENCE:900`、`TOOL_BASH:1e3`(1000)、`TOOL_PWSH:1010`、`TOOL_READ:1100`、`TOOL_WRITE:1200`、`TOOL_EDIT:1300`、`TOOL_GLOB:1400`、`TOOL_GREP:1500`、`TOOL_JOBS:1600`、`TOOL_PTY:1700`、`TOOL_WEB_SEARCH:2e3`(2000)、`TOOL_WEB_FETCH:2100`、`TOOL_LSP:2200`、`TOOL_SESSION_QUERY:2300`、`TOOL_GOAL:2400`、`TOOL_WORKFLOW:2600`、`TOOL_RALPH:2700`、`TOOL_SUBAGENT:2800`、`TOOL_REPORT:2900`、`TOOL_COMPUTER_USE:3e3`(3000)、`MCP_SERVERS:3100`、`TOOLS_SDK:5e3`(5000)、`DELIVERABLE_FILE_REFERENCES:9e3`(9000)、`STRUCTURED_OUTPUT:9900`、`HARNESS_SOURCE:1e4`(10000)、`WEB_SURFACE:10100`、`DEPLOYMENT_PERSONA_SUFFIX:10200`。
- 比较函数：`dsh-system-prompt/lib/index.js:101-103`
  ```js
  function comparePromptSections(a, b) {
  	return a.order - b.order || compareNames(a.name, b.name);
  }
  ```
  `compareNames`（`:97-99`）是 code-unit 比较，跨机器确定。**order 相同的两个 section 不冲突，按 name 字典序稳定排列**。
- `assemble()`：`:356-406`。第 380 行 `sectionDefinitions = [...sectionByName.values()].sort(comparePromptSections)` 是唯一排序点；第 388 行逐 section 求值 text；第 394 行 contexts 只按 order 排序（无 name 兜底）；**第 398 行 `this.ctx.waterfall(..., "system-prompt/assemble", ...)` 是 waterfall**，而 `references/practices.md:17` 明令禁止用它增删文本——本次复核确认禁令仍在，地图「放弃 waterfall」的决策成立。
- 渲染：`:117-119` 全部 section 用 `"\n\n"` 连接，且 `filter(text.length > 0)` 丢弃空段；`dsh-llm/lib/index.js:87-95` `createSystemMessage` 把它变成**一条** `role:"system"` 消息。**模型只看到文本顺序，没有 section 边界——位置即权重。**

### B. `section()` 校验规则

- `dsh-system-prompt/lib/index.js:253-256`：
  ```js
  section(section) {
  	if (!Number.isFinite(section.order)) throw new TypeError(`prompt section "${section.name}" order must be a finite number`);
  	return this.layers.effect(this.ctx, (layer) => layer.sections.insert(section.name, section), { label: "systemPrompt.section()" });
  }
  ```
  order 为 `NaN`/`Infinity`/`undefined`/字符串 → `TypeError: prompt section "X" order must be a finite number`。
- name 重复 → `Error: prompt section "X" is already registered (for a per-agent override, register through that agent's \`agent.ctx\` instead)`（`:203` 注入文案；scoped 层文案为 `... is already registered in this scope`；实际抛出点 `dsh-scope/lib/index.js:29`）。
- 返回值是 **Cordis effect disposer**，调用即注销，之后可重新注册同名。
- `text` 支持函数求值：`:388` `text: typeof section.text === "function" ? section.text(context) : section.text`；`context()` 走 `resolveContext`（`:184-190`）同理。
- `complete: true` 的 section 超过 1 个 → 抛 `multiple complete prompt sections are active: ...`（`:381-382`），且 `:399-405` 会把整个 assembly 替换成那一个 section。**语言守卫绝不能带 complete**。
- 建议全部加 `interpolate: false`，避免用户自定义语言名里的 `{{` 被当变量抛错（`:165-177`）。

### C. 核心论证：`order: 50` 为什么被稀释（实测）

竞品 `dsh-think-chinese@0.1.0` 单条 `order:50`。`SECTION_ORDERS` 里没有 50，它的邻居是 `DEPLOYMENT_PERSONA_PREFIX:0`（上）与 `FILE_REFERENCE:900`（下）；实际夹在中间的还有 `@wenaixi/dsh-ponytail`（order 50，`lib/ponytail.js:355`）、`agent-teams:usage`（117）、`michengai:pua`（120）、`tool:browser`（150，`lib/tool-browser/index.js:291-296`）。

实测两个基准样本（数据源：`~/.dsh/sessions/*/session.v4.jsonl.zstd` 的 `system/message` 事件）：

| 配置 | 总长 | order 50 插入 offset | 其前 | 其后 | 其后 ASCII 占比 |
|---|---|---|---|---|---|
| 干净基线（无 agent-teams/browser） | 5794 | **111** | 111 字符（1.9%） | **5683 字符（98.1%）** | **99.8%** |
| 当前会话（+dsh-context+agent-teams+browser） | 14604 | **325** | 325 字符（2.2%） | **14279 字符（97.8%）** | **99.4%** |

**「约 20K 字符」需要修正**：92 个历史会话实测 min 5794 / p25 5805 / median 7063 / p75 11423 / max 51247 / mean 12905，≥18000 的仅 15/86（17%）。典型配置是 **6–11K**，重度插件配置才到 14K–51K。但稀释结论不受影响：即便只有 5.8K，order 50 之后仍是 98.1% 的内容、99.8% 英文。

机制：约束夹在 persona 与工具说明之间，后面紧跟 5.7K–14.3K 字符、99% 以上是英文的工具协议/AgentTeams 协议/Web GUI 说明，中间无任何重申。首尾夹击改的是**边界条件**：`-2000` 是 offset 0（全篇第一句），`11200` 是 offset 14549（末段），占据长上下文位置效应最强的两处。

### D. 落点评估

- **`-2000` 最优**：`SECTION_ORDERS` 最小常量是 -1000，-2000 明确在其前，与最近常量距 1000。与 `dsh-context:prompt-prefix` 撞值但 name 不同（字典序 `d` < `l`，dsh-context 在前），共存无害但会重复占 token。
- **`11200` 最优**：最大常量是 10200，11200 在其后；实测位于末段。runtime context 快照是追加在 **user 消息**末尾（`dsh-agent-loop/lib/index.js:913-917`），不在 system prompt 内，所以 11200 确实是 system prompt 最后一段。
- **中间锚点：`5000` 可用，但建议改 `5100`**。`5000` = `TOOLS_SDK`，注册点 `dsh-tools/lib/index.js:2840-2854`，name 为 `"tools:sdk"`；native 模式返回 `""`（`:2846-2847`）被 filter 丢弃 → **实测 order 5000 处是空位**（当前会话 #23 subagent(2800) 直接接 #24 deliverables(9000)）。落点位置：干净配置 offset 3067（52.9%）、当前配置 offset 11912（81.6%），即「全部工具说明之后、收尾段之前」，语义正确。
  但同 order 时先后由 name 字典序决定，`"language-guard:mid" < "tools:sdk"`，**PTC 模式下约束会排在几千字 SDK 文档之前**，削弱中间锚点作用。改 `5100` 可同时获得：(1) 与所有内置常量不同值，消除 name 耦合；(2) 明确落在 TOOLS_SDK 之后；(3) 仍处 5000→9000 的 4000 宽空档，与两端常量距离 ≥100。此项是对地图 `## Decisions so far` 的细化，需决策票 #06 确认。
- **不要用 `getSectionOrder(...)` 拼自定义 order**：该函数只查 `SECTION_ORDERS`，未知键返回 `undefined`，随后被 `Number.isFinite` 校验抛 `TypeError`。`dsh-context` 的 `getSectionOrder('HARNESS_IDENTITY') - 1000` 是先取到 -1000 再减，安全；但直接写字面量更抗上游改名。

### E. `text` 函数的 context 参数

`assemble` 调用点 `dsh-agent-loop/lib/index.js:907`（在 `preStep` 内，**每个 step 一次**，不是每 turn 一次）；参数来自 `dsh-agent/lib/index.js:291-297`：

```js
function assembleContextFor(agent, signal) {
	return { agent, scope: agent, ...signal === void 0 ? {} : { signal } };
}
```

只有 `agent`、`scope`（恒等 agent）、`signal` 三个字段。`agent` 上可用 `id` / `session` / `options.provider` / `options.model` / `status` / `phase`（内部结构）。**轮次不在 context 里**：轮次状态在 `sessionProjections` 的 `turnBoundary`（`dsh-agent-loop/lib/index.js:782`）。官方取用范式见 `:1591-1592`（`context.agent?.options.provider`）。→ 周期档不能靠 section 计数（单位会是 step），应完全走 `agent.inject()`（票 #02 负责）。

### F. 多档切换（安全增删）

推荐**固定 3 个 name 一次性注册、永不 dispose，靠 text 函数返回 `""` 关闭**：

```js
ctx.systemPrompt.section({ name: "language-guard:prefix", order: -2000, interpolate: false,
  text: () => render(config.strength) });
ctx.systemPrompt.section({ name: "language-guard:mid", order: 5100, interpolate: false,
  text: () => config.strength === "strong" ? renderMid(config) : "" });
ctx.systemPrompt.section({ name: "language-guard:suffix", order: 11200, interpolate: false,
  text: () => renderSuffix(config) });
```

空串被 `renderPrompt` 的 filter 丢弃（`:118`），等价于该 section 不存在；配置用 `.volatile()`，切档 = 改配置，**无需重启、零重名风险**。先例：`dsh-context` 的 `xr` 包装器（trim 为空返回 `""`）。
备选（某档 section 数量不同）：先 dispose 全部再注册新集合，否则新旧同名会抛 `already registered`；缺点是切换瞬间可能有一次 assemble 读到半套 section。

### G. 三档 section 清单（可照抄）

| 档位 | name | order | text | 生效条件 |
|---|---|---|---|---|
| 基础 | `language-guard:prefix` | **-2000** | 主约束全文 | 始终 |
| 基础 | `language-guard:mid` | 5100 | — | 返回 `""` |
| 基础 | `language-guard:suffix` | **11200** | 复述约束 | 始终 |
| 强化 | `language-guard:prefix` | -2000 | 主约束全文 | 始终 |
| 强化 | `language-guard:mid` | **5100** | 中间重申（含「上文英文仅提供事实与流程」） | strength==="strong" |
| 强化 | `language-guard:suffix` | 11200 | 复述约束 | 始终 |
| 周期 | `language-guard:prefix` | -2000 | 主约束全文 | 始终 |
| 周期 | `language-guard:mid` | 5100 | — | 返回 `""` |
| 周期 | `language-guard:suffix` | 11200 | 复述约束 | 始终 |
| 周期 | `agent.inject()` 每 N 轮 | — | 周期提醒 | 见票 #02 |

### H. 证据索引

`dsh-system-prompt/lib/index.js:10-43`（常量表）、`:97-103`（排序）、`:117-119`（渲染）、`:184-190`（context 函数求值）、`:203`（重名文案）、`:253-256`（section 校验）、`:279-282`（context 校验）、`:380`（排序点）、`:381-382`（complete 冲突）、`:388`（text 求值）、`:398`（waterfall）、`:399-405`（complete 覆盖）；`dsh-agent/lib/index.js:291-297`（context 形状）；`dsh-agent-loop/lib/index.js:782`（轮次）、`:907`（assemble 调用点）、`:913-917`（runtime context 注入 user 侧）；`dsh-llm/lib/index.js:87-95`（system 消息）；`dsh-tools/lib/index.js:2840-2854`、`:2846-2847`（TOOLS_SDK/native 空段）；`dsh-scope/lib/index.js:27-38`（NamedEntries 重名）；`references/practices.md:17`（waterfall 禁令）；`~/.dsh/profiles/desktop/node_modules/dsh-context/lib/index.js` 内 `Cr` 函数（`Sr=1e3`，首尾 -2000/11200 先例）。