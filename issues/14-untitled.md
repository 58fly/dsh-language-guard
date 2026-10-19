<!-- DSH-IDEMPOTENCY-KEY: deck-579c0124-5974648 -->
<!-- parentKey: 01 -->
<!-- created: 2026-10-19T07:20:43.911Z -->
# 实现：自动语言模式（识别语言环境，自动选择目标语言）

## Question

实现「自动识别语言环境，语言模式自动选择」这个功能，落在 `dsh-language-guard` 0.2.0。

用户定案：界面语言为主；只自动选**目标语言**；自动 / 手动两态，**默认自动**。

> **#13 调研修正（2026-10-19）**：原定「系统语言兜底」**已废弃**。Host 是 `ELECTRON_RUN_AS_NODE=1` 子进程，`require("electron")` 抛 `Cannot find module 'electron'`；`Intl.DateTimeFormat().resolvedOptions().locale` 恒为 `en-US`（本机系统实为 `zh-Hans-CN`），会把中文用户误判成英文。**Host 侧没有任何可靠的系统语言信号，禁止硬编假信号。** 解析链最终定为：`locale.preference` → `targetLanguage` 配置值（默认 `zh-CN`）。详见 `docs/research/04-auto-language.md` §4.4 与票 #13 的 Answer D 节。

前置：#13 调研（信号来源与 BCP-47 映射规则）。本票依赖其结论，**不得在 #13 结论出来前凭猜测动手**。

## 必须做到

### 一、配置层

- 新增**唯一**一个模式字段 `languageMode`，取值三态 `'' | 'auto' | 'manual'`，`.volatile()`。
- **不新增 `detectedLanguage`**（captain 裁决：路径 B 在 0.2.0 完全不实现，理由是每次写都改用户手写的 `cordis.patch.yml`、多端共享 `$DSH_HOME` 会互相覆盖、检测值会伪装成用户偏好）。**字段总数 6 → 7，不是 8。**
- **默认值必须是空串 `''`（不是 `'auto'`）**，语义是「用户未选择，按迁移规则推断」。若默认 `'auto'`，schema 会把「用户没设过」与「用户选了自动」抹成同一状态，导致老用户手选的 `targetLanguage` 被静默覆盖。
- 三态判定（Host 与 Client 必须共用同一个纯函数 `effectiveMode({ languageMode, targetLanguage, defaultLanguage })`）：
  | `languageMode` | `targetLanguage` | 有效模式 |
  |---|---|---|
  | `'auto'` | 任意 | auto |
  | `'manual'` | 任意 | manual |
  | `''` | `=== 'zh-CN'`（默认值） | auto |
  | `''` | `!== 'zh-CN'` | **manual**（尊重老用户既有选择，绝不覆盖） |
- 该字段必须 `.volatile()`，且**自动模式的解析结果变化不需要重启**。
- 既有 6 个字段（`targetLanguage` / `strength` / `injectEveryNRounds` / `preserveCodeTerms` / `extraRules` / `overrideHead`）语义不变，已装用户的配置不能被破坏。
- 注意 `@deepseek-ai/schemastery` 的坑：`.volatile()` 必须逐字段加，不能加在根对象上（否则报 `volatile fields require a fixed object path without an enclosing volatile field`）。

### 二、Host 解析层

- `lib/` 里新增语言解析模块 `lib/language.js`（纯函数，不依赖 ctx、不读磁盘），按 #13 定稿的优先级产出最终语言：`locale.preference`（界面语言）→ `targetLanguage` 兜底。**不读系统语言**（Host 侧无此信号）。
- 解析结果必须是合法 BCP-47，且能通过现有 `targetLanguage` 的同一条正则。
- 解析逻辑要能被单测直接调用（导出纯函数，不依赖 ctx），便于验收脚本断言。
- 现有三个 section 的 `text()` 取值函数改为走解析器；`interpolate: false` 与 order（`-2000` / `5100` / `11200`）**保持不变**。

### 三、Client 层

- 设置卡片：自动 / 手动两态可切换。**自动态下必须显示「当前解析成哪种语言」**，让人一眼看懂，不能像 0.1.0 那样「点了没反应」。
- 手动态下才可编辑 `targetLanguage`（chip + 自定义文本框）。自动态下目标语言控件置 `disabled`（用 disabled 不隐藏，避免布局跳动——与 `injectEveryNRounds` 随 `strength !== 'D'` 置灰的既有做法一致）。
- 侧栏快速切换菜单：要能看出当前是自动还是手动；菜单里要有「自动」项，以及「当前自动解析为 X」的说明。
- 语言解析结果的来源（界面语言 / 配置兜底）最好也能在卡片里显示一行，让用户知道「为什么是这个语言」。**只有这两种来源**，不要为不存在的系统语言信号写文案。
- 遵守既有 UI 红线：只用 `--dsw-alias-*` token；不引 Client primitives；不 iframe；组件外不写 DOM；文案走 `ctx.locale.register(NS, {zh, en})` 字典（zh / en 键必须完全一致）。

### 四、文档与数字

- README 中英双语同步：新增「自动语言模式」章节，说明默认 auto、识别顺序、怎么切手动、怎么知道当前解析成什么。
- `docs/decisions/01-mechanism.md` 的字符数表若因文案变化而变动，必须**实测复算**并同步（README 两版 + 决策文档三处一致）。
- `docs/实现说明.md` 的 `client.js` 行数、字典键数、`npm pack` 尺寸全部重新取值同步。
- `package.json` version 升到 **0.2.0**（新增功能，不是 patch）。

### 五、验收

- `bash scripts/verify-checklist.sh` 必须全 PASS，新增判据覆盖：模式字段存在且 volatile、默认 auto、解析器可被单测调用、自动态 UI 有解析结果显示、字典 zh/en 键数一致。
- `node scripts/verify-manifest.mjs` 必须全通过。
- 新增一个可执行的解析器单测（或脚本），覆盖 #13 定下的每条映射规则。

## 禁止

- 不得监听 `system-prompt/assemble` 增删文本（官方 `practices.md` 明令）。
- 不得改写 `llm/stream` 的 `reasoning-delta`。
- 不得把「自动」实现成「每次启动猜一次就写死」——必须是运行时跟随。
- 不得让自动模式静默覆盖用户的手动选择。

## 进度

- 2026-10-19 读完 #13 调研（`docs/research/04-auto-language.md`）与两条 captain 裁决（不实现 `detectedLanguage`、解析链只有两环）。
- `lib/language.js` 落盘（151 行纯函数）+ `scripts/verify-language.mjs` 33 项单测全过。
- `lib/index.js`：Config 加 `languageMode`（默认 `''`、`.volatile()`），apply 期缓存界面语言 + 订阅 `settings/document-updated`。
- `client.js`：镜像解析纯函数、模式 radio group、两行回显（当前结果 + 来源）、自动态禁用语言控件、快速切换菜单加「自动」项 + `form.mutate` 同批写。
- `scripts/verify-checklist.sh` 新增 M1–M10；C9 字段数 6→7；R1 期望集合加 `lib/language.js`。结果 **69 PASS / 0 FAIL**。
- `scripts/verify-manifest.mjs` **43/43 PASS**；`node --check` 全部通过。
- README 中英双语补「自动语言模式」章节；`docs/实现说明.md` 全部数字重取；`version` 0.1.2 → **0.2.0**。

Status: resolved
Type: task
Blocked by: #13
Labels: wayfinder:task

## Comments

### local — 2026-10-19T08:26:18.248Z
## 补充修复（2026-10-19，票关闭后）：Client 界面语言数据源缺陷

Answer 的 D 节「两侧一致性」只讲了**镜像纯函数**的一致性，漏掉了**输入信号**的一致性——这是真实缺陷，已修。

### 缺陷

| 侧 | 原实现 | 用户从未在 DSH 设置里选过界面语言时 |
| --- | --- | --- |
| Host | `settings.describe()` → `ns === 'locale'` → `value.preference` | `undefined` → 兜底 `targetLanguage`（默认 `zh-CN`）→ 注入简体中文 |
| Client | `ctx.locale.getSnapshot().active` | `provisional`（浏览器/系统语言派生）→ 显示「English」 |

源码依据：`dsh-client-locale/lib/client.js` 的 `resolveActive()` 是 `if (this.preference === void 0) return this.provisional;`，且快照构造为 `{ active: this.resolveActive(), locales, revision: 0 }`——**快照根本不带 `preference`**。所以英文系统用户首次安装时，面板显示「当前解析为 English · 来自界面语言」，实际注入简体中文，**面板撒谎**。

### 修法

Client 改读 `ctx.configForms.get('locale').getSnapshot().value.preference`——`ConfigFormController` 是 Host `describe()` 的镜像投影，与 Host 读同一份 remote settings 镜像，从根上同源。

- 命名空间写成常量 `UI_LOCALE_NS = 'locale'`（既是 `dsh-client-locale` 的 entry id，也是 Host `describe()` 返回行里的 `ns`）；
- **不再**包 `whileServed(['locale'])`：`configForms.get()` 无条件创建 controller，再嵌一层会把「locale 未装配」变成整块不渲染；
- `get()` 抛错时 `try/catch` 吞掉返 `null`，来源行如实写「未识别到」，不因读别人的命名空间炸掉整张卡片；
- 两个 slot 的 `inject` 里 `localeFace: ctx.locale` → `configForms: ctx.configForms`。

### 连带改动

| 文件 | 改动 |
| --- | --- |
| `client.js` | `useUiLanguage(localeFace)` → `useUiPreference(configForms)`；1354 行 / 59323 B |
| `scripts/verify-language.mjs` | 新增「【分叉防护】preference 为 null 时两侧必须都走兜底」4 个断言；33 → **34 项** |
| `scripts/verify-checklist.sh` | 新增 **M12**（五条正则联合断言：必须出现 `configForms.get(UI_LOCALE_NS)` / `UI_LOCALE_NS = 'locale'` / `preference`，禁止 `locale.getSnapshot` / `localeFace`）、**M13**（清单不得再嵌脚本全文）；70 → **72 项**（captain 复核后又加 R23，见 I 节） |
| `README.md` / `README.zh.md` | 「怎么知道现在解析成什么」补限定句：「来自界面语言」指**你在 DSH 设置里显式选过的**，没选过显示兜底，两侧读同一个值不会分叉 |
| `docs/实现说明.md` | 4.3.1 节「界面语言从哪来」整段重写为 0.2.1 修正版（含 `resolveActive()` 缺陷原理与三条改法要点） |

### 验证

| 命令 | 结果 |
| --- | --- |
| `node --check lib/*.js client.js` | 全部通过 |
| `node scripts/verify-language.mjs` | **34 项全过** |
| `node scripts/verify-manifest.mjs` | **43/43 PASS** |
| `bash scripts/verify-checklist.sh` | **73 PASS / 0 FAIL / 0 TODO** |
| `npm pack --dry-run` | 15 文件 / 53657 B / unpacked 163552 B |

**反向变异测试（证明 M12 有效）**：把 `client.js` 改回读 `ctx.locale.getSnapshot().active` → Client 渲染测试报 `AssertionError: preference 未设置时必须显示配置兜底语言`，M12 判 FAIL；恢复后全绿。

### 教训

「两侧一致性」不能只查**逻辑**一致，还要查**输入**一致。镜像纯函数防的是「算错」，防不了「喂错」。凡两侧都要显示同一个值的场景，必须先确认两侧的数据源是同一次读取。


## Answer

### A. 交付清单

| 文件 | 变更 | 说明 |
| --- | --- | --- |
| `lib/language.js` | 新增 151 行 | 纯函数：`effectiveMode` / `mapPreference` / `resolveSource` / `normalizeLocaleId` / 常量 `MODE_AUTO` / `MODE_MANUAL` / `MODE_UNSET` |
| `lib/index.js` | 331 行 | `Config` 加 `languageMode`；`apply` 期缓存界面语言 + `settings/document-updated` 订阅；`configuredLanguage()` 走 `resolveTargetLanguage` |
| `lib/state.js` | 122 行 | 移除已迁走的解析逻辑，只留配置规范化与 `/language` 内存覆盖 |
| `lib/commands.js` | 96 行 | 报告文案按模式区分，新增 `sourceHint(source)` |
| `client.js` | 1321 行 | 镜像解析纯函数；模式 radio group + 两行回显；自动态禁用语言控件；菜单加「自动」项 |
| `package.json` | version | `0.1.2` → **`0.2.0`** |
| `README.md` / `README.zh.md` | 各 +1 章节 | 「自动语言模式」；配置项表 6 → 7 字段；卡片清单加模式组；快速切换说明加自动项；已知限制加两条 |
| `scripts/verify-language.mjs` | 新增 | 33 项解析器单测 |
| `scripts/verify-checklist.sh` | +M1–M10 | 69 项，全 PASS |
| `scripts/verify-manifest.mjs` | C9 改判据 | 43 项，全 PASS |
| `docs/实现说明.md` | 重取数字 | 新增 3.2.1 / 4.3.1 / 第 9 节 |

### B. 三态模式与默认值

`Config.languageMode = z.union([z.const(''), z.const('auto'), z.const('manual')]).default('').volatile()`。

**默认空串，不是 `'auto'`**。理由：默认 `'auto'` 会把「用户没设过」与「用户显式选自动」抹成同一状态，老用户手选的 `targetLanguage`（如 `ja`）升级后会被界面语言静默覆盖——正是票面明令禁止的。空串语义是「未选择，按迁移规则推断」：

| `languageMode` | `targetLanguage` | 有效模式 |
|---|---|---|
| `'auto'` | 任意 | auto |
| `'manual'` | 任意 | manual |
| `''` | `=== 'zh-CN'` | auto |
| `''` | `!== 'zh-CN'` | **manual** |

用户一旦显式选过模式，`languageMode` 不再是空串，迁移规则永久失效。

### C. 解析链

`locale.preference`（界面语言）→ `targetLanguage` 配置值。**无系统语言这一档**：Host 是 `ELECTRON_RUN_AS_NODE=1` 子进程，`require("electron")` 抛 `Cannot find module 'electron'`，`Intl.DateTimeFormat().resolvedOptions().locale` 恒返回 `en-US`，会把中文用户误判成英文。映射：`zh` → `zh-CN`、`en` → `en`、其余取原样的合法 BCP-47。

**界面语言不在 `text()` 里读**：`apply` 期在 `ctx.inject(['settings'], …)` 里调一次 `describe()` 缓存 `locale` 的 `value.preference`，并 `child.on('settings/document-updated', ns => …)` 在 `ns` 为 `locale` 或 `language-guard` 时刷新。理由：`describe()` 单次约 2–5 ms 且要遍历全部 entry 做 schema 投影，而 system prompt 每步装配。不会自触发：`dsh-settings` 的 emit 受 `previous?.raw !== raw` 保护。`describe()` 抛错时 `try/catch` 退回 `null`，解析链落到 `targetLanguage`（有单测覆盖）。

### D. 两侧一致性

Client 是独立 bundle（factory 只能 `require('react')`），不能 import 包内文件，所以 `client.js` 里**镜像了一份**同样的纯函数。漂移后果是「面板显示英文、实际注入简体中文」，用户看不出来。防护三层：

1. `verify-checklist.sh` 的 **M1 / M2** 正则比对两侧关键分支逐字相同；
2. 镜像段落的注释明确写「改这里必须同步改 `lib/language.js`」；
3. `verify-language.mjs` 的 33 项用例是两侧共同的行为契约。

### E. Client 交互

- **模式控件**：`fieldset` + 2 个同名 radio（`name="language-guard-mode"`），在强度档位之前。
- **两行回显**：`.lg-mode-current`（「当前解析为 简体中文」）+ `.lg-mode-source`（「来自界面语言」/「未识别到界面语言，用配置值兜底」）。手动态不显示来源行。
- **自动态禁用**目标语言文本框与 5 个 chip（`disabled` 不隐藏，与 `injectEveryNRounds` 置灰的做法一致），说明文案换成「自动模式下不可编辑，切到手动即可自定义」。
- **迁移态提示**：空串模式 + 非默认 `targetLanguage` 时多显示一行 `.lg-mode-migrated`。
- **快速切换菜单**：第 1 项是「自动」，后接 5 个预设（共 6 项）。自动态按钮标签「自动，简体中文」，菜单头「当前自动解析为 简体中文」。
- **写入用 `form.mutate(ops)` 而非两次 `set`**：模式与语言语义上是一对，分两次写会留下「手动 + 旧语言」的半截状态，且每次写都触发一次 volatile 提交。

### F. 验收结果

| 命令 | 结果 |
| --- | --- |
| `node --check lib/*.js client.js scripts/*.mjs` | 全部通过 |
| `node scripts/verify-language.mjs` | **33 项全过** |
| `node scripts/verify-manifest.mjs` | **43/43 PASS** |
| `bash scripts/verify-checklist.sh` | **69 PASS / 0 FAIL / 0 TODO** |
| `npm pack --dry-run` | 15 文件 / 52.0 kB（含新增 `lib/language.js`） |

Host 端到端测试（stub 依赖）7 组全过，其中最关键的一组：**未设模式 + 手选 `ja` + 界面语言 `zh` → 仍是日本語**，证明不覆盖老用户。Client 渲染测试全过，覆盖模式 radio 数量、菜单 6 项、选自动只写 `languageMode`、选具体语言同批写两个字段。

### G. 判据与票面的三处偏差

1. **票面第五节写「默认 auto」，与同票第一节「默认值必须是空串 `''`」冲突**。按第一节与 captain 裁决取空串，脚本 M3 断言的就是空串。
2. **`scripts/verify-checklist.sh` 新增了 M1–M10 十条**（票面只列了五项必查），额外覆盖两侧映射表一致、迁移规则一致、`text()` 不读盘、界面语言缓存与事件订阅存在。
3. **`docs/decisions/01-mechanism.md` 的字符数表无需改动**：文案未变，按其复算命令实测仍为 `818 118 139 99`。

### H. 已知限制（已写进 README）

- 自动模式只认界面语言，DSH 界面只有简体中文与 English 两档，**解析不到繁體中文 / 日本語 / 한국어**，必须手动选；面板在自动态显示这条提示。
- 自动模式跟界面语言，不跟你输入的语言：界面简体中文 + 英文提问，约束仍是简体中文（设计意图）。
- 不实现 `detectedLanguage`：检测值落盘会改写用户手写的 `cordis.patch.yml`、多端共享 `$DSH_HOME` 会互相覆盖、检测值会伪装成用户偏好。

### I. captain 复核后的追加修复（M12：Client 与 Host 信号源必须同源）

初版交付后，captain 读 asar 源码发现一个**必然触发的缺陷**，已修复，本节记录，不改 A–H 节原文。

**缺陷**：Client 侧用 `ctx.locale.getSnapshot().active` 判断「界面语言」，Host 侧用 `settings.describe()` 里 `locale` 命名空间的 `preference`。二者在「用户从未在 DSH 设置里选过界面语言」时**必然分叉**：

- `dsh-client-locale/lib/client.js` 的 `resolveActive()`：`if (this.preference === void 0) return this.provisional;` —— `active` 是浏览器/系统语言派生的 provisional；
- 同一文件 `:1216-1220` 的快照结构 `Object.freeze({ active, locales, revision })` —— **不带 `preference`**；
- Host 侧 `preference` 为 `undefined` 时走兜底 `targetLanguage`（默认 `zh-CN`）。

后果：英文系统用户第一次装插件，面板显示「当前解析为 English · 来自界面语言」，实际注入简体中文 —— **面板撒谎**，正是本插件最不能出的错。

**修法**：Client 改读与 Host 完全同源的 `ctx.configForms.get('locale').getSnapshot().value.preference`（`ConfigFormController` 是 `settings.describe()` 的镜像投影，`dsh-client-ui-settings/lib/client.js:1294-1301` 的 `get(entryId)` 无条件创建、不要求 locale 已 served）。新增常量 `UI_LOCALE_NS = 'locale'`（`client.js:419`），`useUiLanguage` 改名 `useUiPreference(configForms)`（`client.js:443`），两个调用点（`client.js:712`、`client.js:1051`）改传 `props.configForms`。**不包 `whileServed(['locale'])`** —— 读失败返回 `null` 走兜底，否则「locale 未装配」会变成整块不渲染。

**镜像一致性独立验证**：captain 写 `/tmp/mirror-check.mjs`，从 `client.js` 抽出镜像纯函数块与 `lib/language.js` 逐函数比对，**38 个用例全部一致**（`effectiveMode` 10 组 / `mapPreference` 13 个 / `normalizeLocaleId` 7 个 / `resolveSource` 8 组）。

**新增两条判据**：
- **M12**：`hits 'configForms\.get\(UI_LOCALE_NS\)' && hits 'UI_LOCALE_NS = .locale.' && hits 'preference' && ! hits 'locale\.getSnapshot' && ! hits 'localeFace'`。已做反向变异测试：改回 `ctx.locale.getSnapshot().active` → **仅 M12 FAIL**；恢复后 PASS。
- **M13**：`! grep -q '^run_client()' docs/验收清单.md && ! grep -q '^m_tmp=' docs/验收清单.md` —— 防止 `docs/验收清单.md` 再嵌入脚本全文（0.2.0 期间曾嵌入，脚本从 400 行长到 539 行、副本漂移 139 行而人工对照没发现；现已改为「脚本正文以文件为准」+ 要点表，清单 776 → 273 行）。

**当前计数**：`verify-checklist.sh` **73 项**（M1–M13 + R23；M11 为 README 结构对等，随 t14 文档收尾拉平；R23 为文档 pack 尺寸与实测一致）、`verify-language.mjs` 34 项、`verify-manifest.mjs` 43 项。
