<!-- DSH-IDEMPOTENCY-KEY: deck-plan-dsh-language-guard-map-v1-map -->
<!-- created: 2026-10-18T13:16:24.980Z -->
# dsh-language-guard：DSH 语言锁定插件（开源发布）

## Destination

发布一个完全符合 DSH 插件规范的独立插件包 `dsh-language-guard`，开源到 GitHub `58fly/dsh-language-guard`，让用户能把模型的**思考过程与回复语言锁定为指定语言**（默认简体中文），不再出现「规定中文却漂移成英文或反复切换」。

> **分发方式定案**：**npm registry 已发布**（`dsh-language-guard@0.2.1`，`latest` 指向 0.2.1，2026-10-20 发布），npm 为主通道、GitHub 为备。曾因出口 IP 被 Cloudflare 风控而先走 GitHub 分发，后换网络注册成功并解决发布 2FA（`npm publish` 在 TTY 下走 web 认证链接，不需要验证器 App）。详见 `docs/发布说明.md` 第一节。

成功的样子：

- `dsh plugin add dsh-language-guard` 一条命令可装（固定版本 `dsh-language-guard@0.2.1`；npm 不可达时用 `https://github.com/58fly/dsh-language-guard`）。**装插件本身需重启一次 DSH**（profile 组合包变更）；装好之后在面板里改档位、改目标语言**不需要重启**，下一条消息即生效。
- 显示名为「语言守卫 / Language Guard」，中英两版同义对译，不绑定任何具体语言（0.1.2 定案；0.1.1 及之前误叫「中文语言守卫」）。
- 提供三档强度（基础 / 强化 / 周期），用户在 Web 插件面板里选择，每档有中文说明。
- 面板支持快速语言切换，UI 符合 DSH Desktop 主题规范（只用 `--dsw-alias-*` token，不引 Client primitives）。
- README 中英双语，含机制说明与「如何自证约束真的进了 system prompt」的验证步骤。
- `npm pack` 15 文件 / 54704 B / 解包 167078 B；**已发布到 npm registry**（`dsh-language-guard@0.2.1`，`latest` 指向 0.2.1，2026-10-20）与 GitHub 双通道。

## Notes

### 用户已确认的决策（本轮澄清产出）

- **定位**：通用「语言锁定器」，不绑定中文；默认值简体中文。受众是所有非英语母语用户。
- **依赖**：自带 `ctx.systemPrompt.section()` 注册，**不依赖**第三方 `dsh-context`。
- **命名**：包名与仓库名均为 `dsh-language-guard`（npm 与 GitHub 两处均已实测未被占用）。
- **UI**：v0.1 **要做**设置面板，符合 DSH Desktop UI 风格，支持快速语言切换。
- **机制**：B/C/D 三档全部做成面板选项，由用户自选并配说明。
- **发布**：~~做到 publish-ready；`npm publish` 由用户本人执行~~ → **后续定案改为 GitHub 分发**（npm 注册被 Cloudflare 403 拦住、命令行注册通道已被 npm 关闭）。凭据始终不经 agent 之手。
- **文档**：README 中英双语。

### 已查证的技术事实

- section order 常量表在 `dsh-system-prompt/lib/index.js:10-43`：`HARNESS_IDENTITY:-1000`、`DEPLOYMENT_PERSONA_PREFIX:0`、工具段 `500–5000`、`HARNESS_SOURCE:10000`、`WEB_SURFACE:10100`、`DEPLOYMENT_PERSONA_SUFFIX:10200`。
- `ctx.systemPrompt.section({name, order, text})` 注册，按 order 排序、按 name 唯一；`text` 支持函数求值。
- `systemPrompt.context` 的 `text` 同样支持函数求值（`resolveContext`，`dsh-system-prompt/lib/index.js:184-190`）。
- 配置字段加 `.volatile()` 即可运行时 `get()`/`set()`，改配置**不用重启**（volatile 只换运行中引用、不重挂插件）。~~`ctx.settings.configure(...)` 把插件配置注册进 Web 插件页配置区，UI 由宿主渲染~~ → **已被 #03/#04 推翻**：安装树里没有 schema→控件渲染器，配置页必须插件自己画（见 `## Decisions so far`）。
- ~~`agent.inject()` 记入 `agent/inbox/spliced` 事件并进入下一个被接纳的 step，**不污染 messages、不破坏日志**——这是 D 档的合规实现路径~~ → **已被 #02 推翻**：`agent.inject()` 是 `send(input, "next-step", false)`、不唤醒，idle 时注入会一直躺在 inbox；D 档改走 `agent/pre-step` 改写 `decision.messages`（见 `## Decisions so far`）。
- 官方 `practices.md` 明确禁止：`Do not listen to 'system-prompt/assemble' to add or remove tools or text.`（此条否定了最初设想的 C 方案，已改为多 section 方案）。
- 官方 Host-only bundle 也**必须**提供 `locale/en.json`（含 `meta.title`/`meta.description`）与包内图标（≤256KiB），并 export `./locale/*.json` 与 `./icon`。

### 本会话应查阅的技能

- `grilling` + `domain-modeling`：每张决策票在给出方案前先盘问一遍，尤其是三档强度与面板交互。
- `research`：三张 `wayfinder:research` 票（#02、#03、#05）按此技能派子代理解决，结论落到 `research/<name>` 分支并在票里留上下文指针。
- `writing-plans`：等决策票全部关闭后，据此产出实施计划。
- 语言约定：本仓库所有票的正文、评论、决策记录一律简体中文。

### 竞品情况

- `dsh-think-chinese@0.1.0`（npm 已占位，匿名、无 repository）：全文仅 21 行，单条 `systemPrompt.section({order:50})` 硬编码中文。缺陷：order 50 落在 persona 之后、全部工具说明之前，被大量英文包围——实测干净基线 5794 字符时它落在 offset 111，其后 5683 字符（98.1%）、ASCII 占比 99.8%；当前会话 14604 字符时落 offset 325，其后 14279 字符（97.8%）、ASCII 99.4%。无 locale、无图标、无 `engines.dsh`、无 `exports`。
- 官方 `@deepseek-ai/dsh-experimental-client-ui-cot-translation@0.2.1-rc.2`：包装 `conversation.chat.reasoning.body` slot 做**展示层翻译**，保留原文。解决「看得懂」，不解决「让模型用中文思考」，与本插件互补而非竞争。

## Decisions so far

- 采用**首尾夹击**（order `-2000` + `11200`）作为基础档，而非竞品的单点 `order:50` —— 直接针对已观测到的漂移现象。
- 放弃 `system-prompt/assemble` waterfall 方案（官方 practices.md 禁止），强化档改为**多个不同 name 的 section** 分布在 `-2000` / `5100` / `11200`（`5100` 是对初版 `5000` 的修正：`tools:sdk` 的 order 恰为 5000，而 `comparePromptSections`（`dsh-system-prompt/lib/index.js:101-103`）在 order 相同时按 name 的 code-unit 字典序排，`"language-guard:mid" < "tools:sdk"` 会让中段重申落到数千字 SDK 文档之前而失效）。
- ~~D 档（周期提醒）用 `agent.inject()` 实现，不用 `agent/pre-step` 改 messages~~ —— **本条已被 #02 推翻，见下方修正**。
- ~~设置面板走 `settings` 服务（宿主渲染，自动符合 desktop 风格），只有「快速语言切换」控件需要自己在 `conversation.composer.dock` slot 里画~~ —— **本条已被 #03 推翻，见下方修正**。
- npm 发布由用户执行，agent 只做到 publish-ready。
- **#05（已关闭）**：语言漂移的根因是「位置即权重」——`dsh-llm/lib/index.js:87-95` 把全部 section 拼成**一条** `role:"system"` 消息，模型看不到 section 边界，只能按文本顺序感受权重。故 `-2000`（内置最小常量 -1000 之前）与 `11200`（最大常量 10200 之后）是最优落点，实测分别位于 offset 0 与全篇末段。另：section 的 `context` 参数只有 `{agent, scope, signal}`、**没有轮次**，且 `assemble` 每 **step** 调用一次（`dsh-agent-loop/lib/index.js:907`），所以周期档不能靠 section 计数（单位会是 step 而非 turn）。
- **#06（已关闭）**：三档定案为 B 基础（head+tail）/ C 强化（head+mid+tail，**默认档**）/ D 周期（C 三段 + 每 N 轮提醒，N 默认 8、范围 3–50）；section 名固定为 `language-guard:head`(-2000) / `language-guard:mid`(5100) / `language-guard:tail`(11200)，**一次性注册、永不 dispose**，切档只切 `text()` 返回值（返回 `""` 即被 `renderPrompt` 的 filter 丢弃）；全部 `interpolate: false` 用 JS 模板替换占位符，避免用户 `extraRules` 里的 `{{` 让整个装配抛错；配置用 `@deepseek-ai/schemastery` 的 6 个逐字段 `.volatile()`（不得加在根对象上），**不引 zod**。
- **#02（已关闭，推翻上面第 1 条）**：D 档最终走 `agent/pre-step` waterfall 改写 `decision.messages`，**不是** `agent.inject()`。理由：官方 `practices.md:16` 明确允许改写且要求 spread；先例 `dsh-agent-instructions/lib/index.js:1406-1424` 同样做法；`agent/pre-step` 载荷自带 `turn` 与 `step`（`dsh-agent-loop/lib/index.js:956-958` 的 `this.preStep(target, { turn, step })`，`:911` 用 `...position` 展开），故「每 N 轮」可直接判定，**无需自建计数器**；改写后的 messages 落 `user/message` 日志（`dsh-agent-loop/lib/index.js:1072`），满足「Model-visible ⟺ logged」。而 `agent.inject()` 是 `send(input, "next-step", false)`（`:812-814`），**不唤醒**，idle 时注入会一直躺在 inbox。三条硬约束：必须 `await next()` 先取决策、`kind === "reject"` 原样返回、`{...decision, messages}` spread 保住 `startsRequestSeries`。风险：无条件注入会让 `inbox.hasPending` 永真、`turn()` 在 `:1033-1037` 无限续跑，故必须 `step === 1 && turn % N === 0` 门禁 + 幂等判断。
- **#03 / #04（已关闭，推翻上面第 2 条）**：**安装树里没有「schema→控件」自动表单渲染器**。`autoGenerate` 只在 `dsh-settings`（5 处透传）与协议 zod 描述里出现，web-frontend index bundle 中 0 次；官方 `plugin-manager/README.zh.md:14、:71-73` 明确「配置页由插件自己在插件页渲染，设置里只保留只读插件列表」。故本插件**必须带 client 半身**：配置页注册 `plugins.bundle.config`（key = 包名 `dsh-language-guard`，`ownerProps` 为 `{view: 'summary'|'page', form}`）；快速语言切换注册 `sidebar.footer.action`（id `language-guard`、order 100、`ownerProps` 为 `{wide}`），**不是** `conversation.composer.dock`。三档控件用原生 radio group 三行卡片（不用 select，因 select 只能显示当前档说明），说明文字常驻档名下方（不用 tooltip）。写入链路：Client `configForms.get(entryId).set(k,v)` → Host `Settings.write` → Loader 判定「只有 volatile 变」→ 原地替换 `fiber._config` + `_commitVolatile` + emit `loader/volatile-update`，**不 remount**，故无需重启即生效。

## Not yet specified

（无。原 6 条待定项已在 #02–#09 中全部确定，逐条结论如下，已并入上方 `## Decisions so far`：）

- ~~三档的精确文案与面板上的中文说明措辞~~ → 定案：文案唯一真源为 `docs/decisions/01-mechanism.md` 2.1 节；面板文案在 `client.js` 内联 `{zh, en}` 字典（NS `languageGuard`），说明常驻档名下方。
- ~~语言候选清单~~ → 定案：**5 个预设 + 任意合法 BCP-47**。`zh-CN` / `zh-TW` / `en` / `ja` / `ko` 进快速菜单与设置页 chip；自定义码只在设置页文本框（正则与 schema 同一条）。不做封闭枚举，否则会把 schema 已支持的 `fr`/`de` 变成不可用。
- ~~默认档位取 B 还是 C~~ → 定案：**C（强化）**。
- ~~D 档的 N 值与是否随会话长度自适应~~ → 定案：**N 默认 8，范围 3–50，不自适应**（自适应需要状态，会引入跨会话不一致）。
- ~~图标设计~~ → 定案：`icon.svg`，367 字节，远低于 256 KiB 上限。
- ~~版本号起点与 license 之外是否加 `funding`/`bugs` 字段~~ → 定案：起点 **`0.1.0`**（不是 1.0.0，API 仍可能调整）；`bugs` **加**（指向 GitHub issues）；`funding` **不加**。

## Out of scope

- 展示层 CoT 机器翻译（官方 `dsh-experimental-client-ui-cot-translation` 已覆盖，不重造）。
- 改写 `llm/stream` 的 `reasoning-delta` 文本（会破坏 `assistant/message` 日志与 thinking signature 回放）。
- 覆盖或修改 `~/.dsh/profiles/desktop/cordis.patch.yml` 里现有的 `dsh-context` 配置条目（用户现有安装不迁移）。
- 发布到 dsh-plugin 社区市场索引（另案）。

## 任务清单

<!-- 16 条，与本 map 的 16 张子票一一对齐；阻塞关系以建边工具落下的原生依赖边为准，此处只作索引。 -->

- [x] #02 调研：D 档周期提醒的 agent.inject 合规实现
- [x] #03 调研：DSH Desktop 设置面板与快速语言切换的官方实现范式
- [x] #04 决策：设置面板与快速语言切换的交互设计（依赖 #03）
- [x] #05 调研：语言漂移的机制根因与 section order 的精确落点
- [x] #06 决策：B/C/D 三档机制与配置 schema（依赖 #05、#02）
- [x] #07 决策：GitHub 建仓与 npm 发布的执行清单（依赖 #09）
- [x] #08 决策：中英双语 README 与验证文档结构（依赖 #06、#04）
- [x] #09 决策：包结构与 manifest 规范（依赖 #06）
- [x] #10 实现：dsh-language-guard 插件 Host 半与 Client 半
- [x] #11 缺陷：选择目标语言后「没有任何改变」（0.1.1 已修复）
- [x] #12 缺陷：插件显示名「中文语言守卫」与通用语言锁定器定位不符（0.1.2 已改名为「语言守卫 / Language Guard」）
- [x] #13 调研：自动识别语言环境的信号来源与 BCP-47 映射规则
- [x] #14 实现：自动语言模式（识别语言环境，自动选择目标语言）（依赖 #13）
- [x] #15 缺陷：client.js 镜像段缺 resolveTargetLanguage 且 resolveSource 未转发 defaultLanguage（评审 O1/O3，0.2.0 已修）
- [x] #16 缺陷：发布说明第十一节 0.1.1 的 pack 尺寸被 0.1.2 覆盖（评审 O2，0.2.0 已修）
- [x] #17 缺陷：Client 镜像段无回归防护（G1：resolveTargetLanguage / resolveSource 两侧等价性零覆盖）（0.2.1 已修）

当前状态：地图 open；子票 16 张，**全部关闭**（#02–#17）；依赖边共 15 条（8 条原生 block 边 + #10–#17 各 1 条 parent 边）。0.2.0 与 0.2.1 已完成并发布：评审 `pass`（`docs/评审报告-0.2.0.md`，含第八节终版复核），验收 `74 PASS / 0 FAIL / 0 TODO`，`npm pack` 15 文件 / 54704 B / 解包 167078 B，`v0.2.0`、`v0.2.1` tag 均已 push；`0.2.2` 为 README 安装章节修正版，待发布。

**0.2.0 新增需求（用户 2026-10-19 提出）**：自动识别当前语言环境、语言模式自动选择。已澄清定案：识别信号=界面语言为主、系统语言兜底；只自动选目标语言；自动/手动两态、默认自动。拆为 #13 调研 + #14 实现。

执行由 AgentTeams 团队「中文语言守卫插件开发组」承接（6 名成员、11 个任务，状态 `deliverable / Delivery: ok`）。落地结果：

- 插件已实现并落盘 14 个文件，`npm pack --dry-run` 通过（`entryCount: 14` / `size: 41240` / `unpackedSize: 124132`）。
- 验收脚本 `scripts/verify-checklist.sh` **74 项 PASS / 0 FAIL / 0 TODO**，退出码 0（0.2.0 起新增 M1–M13 自动模式判据与 R23 文档尺寸判据，0.2.1 起新增 M14 镜像段运行时比对）。
- 已开源并打 tag：<https://github.com/58fly/dsh-language-guard>（public、MIT、8 个 topic；`v0.1.0`、`v0.1.1`、`v0.1.2`、`v0.2.0`、`v0.2.1` 均已 push）。

**0.2.1 落地结果（2026-10-19）**：把「面板显示与实际注入不会分叉」从人工保证变成机器可守。

- 新增 `scripts/verify-mirror.mjs`（清单 **M14**）：把 `client.js` 里手抄的解析规则抽出来动态 import，与 `lib/language.js` 逐函数比输出。矩阵 `MODES(10) × LANGS(23) × FALLBACKS(8) × DEFAULTS(6)` + `effectiveMode` 的 `targetLanguage` 维 = **12420 组输入 / 56580 次函数比较 / 不一致 0**。
- **为什么必须手抄两份**：Client 是独立 bundle，`window.__ModuleLoader__.load` 的 factory 只能 `require('react')`，不能相对 import 包内文件。抄两份就必须有判据守住，而 0.2.0 时这条守护是假的：`verify-language.mjs` 只 import Host 模块、从不读 `client.js`；M1/M2 只是源文本抽查；R23 是文档尺寸副作用。实测把 `client.js` 的 `MODE_MANUAL` 改成 `'auto'`，全仓仍绿。
- 顺带修掉一处两侧不等价：`defaultLanguage` 兜底，Host 用默认参数（**只对 `undefined` 生效**），Client 原用 `||`（对任何假值生效），`null` / `''` 时判定相反。`??` 也修不好（对 `null` 也兜底），最终用 `pickDefaultLanguage()` 精确模拟默认参数语义。
- 验收 `74 PASS / 0 FAIL / 0 TODO`，`verify-language.mjs` 36 项，`verify-mirror.mjs` 不一致 0。`npm pack` 15 文件 / 54704 B / 解包 167078 B。
- 五组变异验证 M14 非空转：常量改值（常量不等）、`mapPreference` 改规则（5942 处）、去掉 `defaultLanguage` 转发（818 处）、`pickDefaultLanguage` 改回 `||`（1374 处）、改成 `??`（682 处，全在 `defaultLanguage=null`）。


**0.2.0 落地结果（2026-10-19）**：自动语言模式已完成并发布。

- 新增 `lib/language.js`（151 行纯函数，无 import）：`normalizeLocaleId` / `mapPreference` / `effectiveMode` / `resolveTargetLanguage` / `resolveSource`。
- Config 由 6 字段增至 **7 字段**：新增 `languageMode`（`'' | 'auto' | 'manual'`，默认空串），全部逐字段 `.volatile()`。
- 三态设计的关键取舍：默认**空串**而非 `'auto'`，否则 schema 会抹掉「用户没设过」的信息，老用户手选 `targetLanguage: ja` 会被界面语言 `zh` 静默覆盖成 `zh-CN`（破坏性升级）。判定规则：`''` + `targetLanguage === 'zh-CN'` → auto；`''` + 其他值 → **manual**（保护老用户）。
- 识别信号只走**界面语言**（`settings.describe()` 里 `ns === "locale"` 的 `value.preference`，官方 `dsh-electron` 主进程 `readLocalePreference()` 同款读法）。**没有系统语言这一档**——Host 侧拿不到可靠的 OS 语言信号（`Intl.DateTimeFormat().resolvedOptions().locale` 在本机实测返回 `en-US`，系统实为中文，因 `LANG=C.UTF-8`；`require("electron")` 在 Host 进程不可用）。
- 修掉一处 Client/Host 信号源分叉：Client 侧原读 `ctx.locale.getSnapshot().active`（浏览器派生值），与 Host 读的 `locale.preference`（显式偏好）在「从未选过界面语言」时必然不一致，会让面板显示「English」而实际注入中文。已统一为 `ctx.configForms.get('locale').getSnapshot().value.preference`。
- 评审 `pass`（`docs/评审报告-0.2.0.md`），21 项依赖真实运行时/浏览器的条目如实标「未验证 + 环境限制原因」。
- 已知限制（非本插件能解决）：DSH 界面语言只有简体中文与 English 两档，自动模式解析不到繁體中文 / 日本語 / 한국어，需手动选。

- **分发方式最终定案为 GitHub**（不是 npm registry）：出口 IP 被 Cloudflare 风控导致注册页 403，且 npm 已关闭命令行注册通道。Git 安装三种 spec 形式实测通过，`files` 白名单在 Git 安装时同样生效（只拉 14 个运行时文件）。`npm publish --dry-run` 仍全绿，保留为将来可选的发布路径。
- 本机 profile 已实装并**重启后复验通过**：最新 `system/message` 节点长度 15116，三段命中 3/3，落点 0 / 12251 / 15005 递增；旧方案（dsh-context 的 promptPrefix/promptSuffix）已清理且探针消失。
- 环境侧附带修复：本机 profile 的 `pnpm-workspace.yaml` 里两条 Git spec 形式的 `allowBuilds` 键会让任何 `pnpm install` 报 `ERR_PNPM_INVALID_VERSION_UNION`，已删除并记录在 `docs/发布说明.md` 第二节补记。
- 仍未本机自证的：桌面应用内 `dsh plugin add` 图形安装路径、`dsh` CLI 安装路径、浏览器渲染类检查（本机无 `dsh` CLI、内嵌 Electron 不可用），已在 `docs/验收清单.md` 与 `docs/评审报告.md` 如实标注「未验证 + 环境限制原因」，未标为通过。

Status: ready-for-agent
Type: map
Blocked by:
Labels: wayfinder:map

## Comments


## Answer

