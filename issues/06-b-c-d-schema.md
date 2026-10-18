<!-- DSH-IDEMPOTENCY-KEY: deck-plan-dsh-language-guard-map-v1-child-decide-mechanism -->
<!-- parentKey: 01 -->
<!-- created: 2026-10-18T13:16:25.042Z -->
# 决策：B/C/D 三档机制与配置 schema

基于 `research-orders` 与 `research-mode-d` 的结论，定下三档机制的最终设计与配置 schema。

要定的事：
1. 三档的命名（面向用户的中文名与英文名）与各自精确行为。
2. 配置 schema 字段清单：目标语言、档位、是否保留英文技术名词、D 档的 N 值、自定义约束文案（覆盖默认）。
3. 默认值：默认语言 `zh-CN`，默认档位取哪一档。
4. 切换档位时 section 的增删策略（避免 name 冲突）。
5. 用户自定义文案与内置模板的合并规则。

产出：写入 `docs/decisions/01-mechanism.md`，含 schema 定义与三档行为表。

完成标准：实现者不需要再做任何机制层面的判断。

## 进度

- 2026-10-18：完成机制决策。产出已落盘 `/Volumes/data/dsh-cn-think/docs/decisions/01-mechanism.md`（唯一真源，含约束文本全文）。
- 依赖票 #05、#02 的 `## Answer` 在决策时仍为空（两票仍 open），故结论基于 DSH 运行时源码实测（app.asar 内 `dsh-system-prompt`、`dsh-agent-loop`、`dsh-tools`、`dsh-settings`、`schemastery`、`practices.md`）+ 官方 practices.md 硬约束给出；所有依赖调研的细节已列入 Answer 第 9 节「待确认清单」，未假装已确定。
- 已关闭本票。

Status: resolved
Type: task
Blocked by: #05, #02
Labels: wayfinder:task

## Comments

## Answer

**完整决策已落盘：`/Volumes/data/dsh-cn-think/docs/decisions/01-mechanism.md`。** 该文档是唯一真源（三档约束文本原文、order 落点、schema、默认值、合并规则、风险回退、待确认清单、实现者照抄清单）。以下为结论摘要，与文档一致；若两者不一致，以文档为准并回改本文。

### 1. 三档命名与精确行为

| 档位键 | 中文名 | 英文名 | 组成 | 相对成本 |
|---|---|---|---|---|
| `B` | 基础 | Basic | head + tail 两段常驻 | 约 200 字符/步 |
| `C` | 强化 | Strong | head + mid + tail 三段常驻 | 约 350 字符/步 |
| `D` | 周期 | Periodic | C 档三段 + 每 N 轮 `agent.inject()` 一条自检提醒 | 约 350 字符/步 + 每 N 轮约 110 字符 |

面板说明（验收 F3 以此为准，一字不改）：
- `B` 基础：只在提示词首尾各放一段语言约束，成本最低，适合短会话。
- `C` 强化：在基础之上，于工具说明之后补一段重申，抵消英文工具说明带来的语言漂移，推荐默认。
- `D` 周期：在强化之上，每 N 轮注入一次语言自检提醒，适合长会话；提醒会作为一条会话记录出现。

### 2. section 注册表（name 固定、order 固定、永不注销）

| section name | order | B | C | D |
|---|---|---|---|---|
| `language-guard:head` | `-2000` | 有文本 | 有文本 | 有文本 |
| `language-guard:mid` | `5100` | `""`（空） | 有文本 | 有文本 |
| `language-guard:tail` | `11200` | 有文本 | 有文本 | 有文本 |
| `agent.inject()`（非 section） | — | 不注入 | 不注入 | 每 N 轮注入 |

order 取值依据（源码实测）：
- `-2000`：低于 `SECTION_ORDERS` 最小值 `HARNESS_IDENTITY:-1000`，稳定居首。
- `5100`：**不用 5000**。`tools:sdk` 的 section 名为 `tools:sdk`、order 取 `getSectionOrder("TOOLS_SDK")` 即 5000（`dsh-tools/lib/index.js:2840-2843`）。同序时由 name 字典序决定先后，`language-guard:mid` 会排在 `tools:sdk` 之前，失去「工具说明之后重申」的作用。故取 5100（在 `DELIVERABLE_FILE_REFERENCES:9000` 之前）。
  - 注：本票 F4 括注曾写 `5000`，**以 5100 为准**；F4 已声明「最终以决策文档为准」。
- `11200`：高于 `DEPLOYMENT_PERSONA_SUFFIX:10200`，稳定居末。
- 空文本 section 会被渲染层 `.filter((text) => text.length > 0)` 过滤（`dsh-system-prompt/lib/index.js:118`），所以 B 档返回 `""` 等价于该段不存在，不留空行。

### 3. 配置 schema（6 字段，全部 `.volatile()`）

```js
import z from "@deepseek-ai/schemastery";

export const Config = z.object({
  targetLanguage: z.string().default("zh-CN")
    .pattern(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/)
    .description("目标语言（BCP-47 语言标签）。默认 zh-CN。常见值：zh-CN 简体中文、zh-TW 繁體中文、en English、ja 日本語、ko 한국어。")
    .volatile(),
  strength: z.union([z.const("B"), z.const("C"), z.const("D")]).default("C")
    .description("强度档位。B=基础（提示词首尾两段约束）；C=强化（首尾两段 + 工具说明后重申，推荐）；D=周期（强化 + 每 N 轮注入一次语言自检）。")
    .volatile(),
  injectEveryNRounds: z.number().min(3).max(50).step(1).default(8)
    .description("D 档每多少轮注入一次语言自检（3–50，默认 8）。仅 strength=D 时生效。")
    .volatile(),
  preserveCodeTerms: z.boolean().default(true)
    .description("保持代码、命令、路径、标识符与英文报错原样，不翻译。默认开启。")
    .volatile(),
  extraRules: z.string().default("")
    .description("附加约束，追加在内置规则之后（团队或项目自定义条款）。留空则只用内置规则。")
    .volatile(),
  overrideHead: z.string().default("")
    .description("高级：完全替换首段内置规则文本。留空使用内置规则；非空时 extraRules 仍会追加在其后。")
    .volatile(),
});
```

三条关键实现约束：
1. **不要引入 zod 依赖**。DSH 插件 Config 用 `@deepseek-ai/schemastery`，设置页表单只认它的 schema 与 `meta.volatile`（`dsh-settings/lib/index.js:118-133` 的 `volatileForm`）。schemastery 已提供 `default/description/min/max/step/pattern/volatile` 与 `z.const`/`z.union`（`schemastery/lib/index.mjs:216-238`）。
2. **`.volatile()` 不能加在根对象上**：校验器拒绝「volatile 被 volatile 包住」——`volatile fields require a fixed object path without an enclosing volatile field`（同文件 `:246`）。必须逐字段。
3. 运行时用 `config.<field>.get()` 读取，不缓存。

### 4. 默认值与理由

| 字段 | 默认 | 理由 |
|---|---|---|
| `targetLanguage` | `zh-CN` | 与地图票「默认简体中文」一致；映射为「简体中文」。 |
| `strength` | `C` | 默认必须「装完即有效」。B 只靠首尾两段，而 `500–5000` 是约 20K 字符的英文工具说明，正是 head 与 tail 之间的空档；C 的 mid 段正对这个根因，成本约 +150 字符/步。D 会写会话日志，默认开启会打扰用户，故不做默认。 |
| `injectEveryNRounds` | `8` | 范围 3–50。N≤3 变噪音且显著增加日志条数；N≥20 在漂移已发生后才提醒。8 轮与一次长任务的典型轮数同阶。 |
| `preserveCodeTerms` | `true` | 技术用户需要代码可复制执行。 |
| `extraRules` | `""` | 默认不注入用户内容，保证开箱行为可预测。 |
| `overrideHead` | `""` | 默认不覆盖，避免一次误编辑就改坏最高优先级约束。 |

### 5. 切档策略（回答原问题 4）

**固定注册三个 section，永不 dispose、永不重注册**；每个 section 的 `text` 是函数，按当前 `strength` 返回文本或 `""`。切档只改变函数返回值，下一次装配（下一 step）生效，无需重启。

理由：
1. 同层重复注册同名 section 抛错：`prompt section "${name}" is already registered`（`dsh-system-prompt/lib/index.js:203`）。先 dispose 再注册在连续点击/HMR 时会撞上它。
2. dispose + 重注册会触发两次 `system-prompt/change`，让装配与设置页无谓重算。
3. 空字符串已被渲染层过滤，语义上等于「不存在」。

另外：从 C 切到 D 时**不清零**注入计数，避免刚切就立刻注入。

### 6. 自定义文案合并规则（回答原问题 5）

```
head 文本 = (overrideHead.trim() 非空 ? overrideHead : 内置 head（按 preserveCodeTerms 选变体）)
           + (extraRules.trim() 非空 ? "\n\n" + extraRules : "")
```

- `overrideHead` **只替换 head**，mid / tail / D 档注入文本始终用内置文案。否则用户一次覆盖就退化成「单段方案」（竞品 order 50 的失败模式）。
- mid / tail / 注入文本不受 `extraRules` 影响。
- 所有段一律 `interpolate: false`，用 JS 模板字符串做 `⟨LANG⟩` / `⟨CODE⟩` 替换。**不要**用 `ctx.systemPrompt.variable()` + `{{...}}` 插值：未知/未定义引用会抛错（`dsh-system-prompt/lib/index.js:177`），而 `extraRules` 是用户自由文本，出现 `{{` 就会让整个 system prompt 装配失败。

### 7. 硬约束合规声明

- 未监听 `system-prompt/assemble`（强化档改为多 section 方案），源码中不应出现该字符串（验收 C4）。
- 未改写 `llm/stream` 的 `reasoning-delta`；「思考语言」只约束、不改写。
- D 档只用 `agent.inject()`，未在 `agent/pre-step` 改 messages，未 append 新 type 的 session 事件。
- section 文本在一次会话内保持稳定（不依赖轮次/时间/随机数），避免每步 system prompt 变化造成 in-history 替换与 KV cache 失效；唯一的周期性变化只走 `agent.inject()`。

### 8. 失效风险与回退策略（摘要）

| 档位 | 失效模式 | 回退 |
|---|---|---|
| B | 中段衰减：head 与 tail 之间隔约 20K 字符英文工具说明，长会话仍漂移 | 升 C |
| C | mid 位置被未来插件新增 section 挤压（若 5000–9000 之间被插段） | mid 提到 `8900`；仍无效回退 B |
| D | 注入不唤醒会话（`agent.inject()` 不 wake）——空闲时注入留到用户下次输入才被看到 | 无需回退；如需主动提醒须用 `followup()`（会多跑一轮），本插件不做 |
| D | 计数在 resume/fork 后归零（计数器只存内存，禁止写 Session） | 接受，README 说明「重启后计数重置」 |
| D | 注入作为 user 角色 notice 出现在会话日志，用户可见 | 接受（「Model-visible ⟺ logged」的代价），面板说明写明，默认档非 D |
| D | 子代理会话被注入会污染其紧凑上下文 | 默认只对顶层会话注入（`agent.parent === undefined`） |
| 全档 | 用户当轮显式要求英文 | 不硬顶用户显式指令：system 层只声明默认语言，README 写明 |
| 全档 | 插件禁用 | 无 section、无注入，自然回退 |
| 全档 | 非法配置 | schema 拒绝（`targetLanguage` 由 `pattern` 拒绝）；代码再兜底：非法档位回退 `C` 并 warn |

关于「注入不唤醒」的准确语义：`agent.inject(input)` 等价于 `send(input, "next-step", false)`（`dsh-agent-loop/lib/index.js:812-814`）；`next-step` 在下一个 step 边界被 `claim()` 取走，且**排在当轮新输入之前**（`claim` 先取完 `next-step` 再取一个 `next-turn`，同文件 `:103-118`）。因此 D 档的触发点选在 `turn/end` 之后，保证注入落在「下一轮第一次装配」之前。

### 9. 待确认清单（依赖 #05 / #02 的调研结论；不阻塞实现，冲突时以实测为准）

1. `section.text(context)` 的 `context` 是否含轮次/会话字段 —— 本文按「不含，只有 `{agent, scope, signal?}`」处理（依据 `dsh-agent/lib/index.js:289-296` 的 `assembleContextFor`），故 B/C 档不使用 `context`。（#05）
2. `11200` 之后是否还有第三方 section 会挤到 tail 之后 —— 本文按「内置最大 10200，无冲突」处理。（#05）
3. 实测 system prompt 中 head / mid / tail 的实际位置与各段长度 —— 本文按常量表推断。（#05）
4. `agent.inject(input)` 的 `input` 形状 —— 本文按 `createUserMessage({ content:[{type:"text",text}], source:{kind:"language-guard",form:"notice",summary:text} })`（来自 `@deepseek-ai/dsh-llm`）处理，参照官方同类写法 `dsh-plan-mode/lib/index.js:404-417`。（#02）
5. `turn/end` 在 agent 作用域上的订阅方式与 payload 字段 —— 本文按 `agent.ctx.on("turn/end", ...)` 计数、payload 取 `turn` 处理。（#02）
6. 注入对 KV cache 的实际影响 —— 本文按「追加在 messages 末尾、不改 system prompt，只增加尾部 token」处理。（#02）
7. 子代理是否应注入、`agent` 上是否有 `parent` 字段 —— 本文按「默认只对顶层注入」处理。（#02）
8. 设置页把 `z.union([z.const()])` 渲染成下拉还是文本框 —— 优先下拉；否则不改 schema，在读取处规范化（接受小写并 `toUpperCase()`，非法回退 `C` 并 warn 一次）。（#03/#04）
9. `meta.description` 是否在设置页原样显示为字段说明 —— 本文按「会显示」处理（表单读取 `meta.description`）。（#03）

### 10. 实现者不需要再判断的事项

三档文案（head/mid/tail/注入四段全文）、order 数值、section 命名、schema 字段与默认值、切档机制、合并规则、面板三句说明，全部已在 `docs/decisions/01-mechanism.md` 定死，实现只需照抄第 10 节「实现者照抄清单」。
