<!-- parentKey: 01 -->
<!-- created: 2026-10-18T13:16:25.020Z -->
<!-- DSH-IDEMPOTENCY-KEY: deck-plan-dsh-language-guard-map-v1-child-decide-panel -->
# 决策：设置面板与快速语言切换的交互设计

基于 `research-ui` 的结论，定下面板的完整交互。

要定的事：
1. 设置页里暴露哪些字段、控件类型、每个字段的说明文案（中英双语）。
2. 三档选项的呈现方式与说明文案措辞。
3. 快速语言切换控件放哪个 slot、长什么样、点击后的行为（下拉？循环切换？）。
4. 语言候选清单的最终确定（简体中文 / 繁体中文 / English / 日本語 / 한국어 / 自定义）。
5. 面板改动如何即时生效（是否需要提示用户重启）。

产出：写入 `docs/decisions/02-panel.md`，含字段表、文案表与控件草图说明。

完成标准：实现者可直接照做 UI，无需再问文案。

## 进度

- 2026-10-18 面板决策定稿：产出 `docs/decisions/02-panel.md`（14 节，含可照抄组件骨架、完整 zh/en 字典、token 表、状态矩阵、自证步骤、下游同步清单）。
- 推翻 `03-manifest.md` 2.2 节「纯 Host bundle」前提（其依赖的「schema 自动渲染表单」已被 #03 证伪），本包必须带 client 半身；差异清单见 `02-panel.md` 第 13.1 节。
- 指出 `验收清单.md` 需同步的 5 处（F6 落点、D10 addLanguage、F3 控件形态、F7 判定方法、C9 路径），见第 13.2 节。

Status: completed
Type: task
Blocked by: #03
Labels: wayfinder:task

## Comments

## Answer

决策文档：`docs/decisions/02-panel.md`（14 节，简体中文，全部技术结论带 `app.asar` 源码 `path:line`）。以下为 A–F 分节摘要，**细节与可照抄代码以文档为准**。

### A. 架构前提修正：本包必须带 Client 半身

`03-manifest.md` 2.2 节的「纯 Host bundle、无 `dsh.client`」建立在「设置页直接读 `Config` 并渲染表单」这一前提上，该前提已被 #03 的否定结论推翻：`autoGenerate` 只作为协议字段存在（`dsh-settings/lib/index.js:426`、`dsh-api-remotes/lib/client.js:2789` 的 zod 描述），**没有任何 UI 消费者**；`dsh-web-frontend/dist/assets/index-CN7NIWNw.js`（921071 字符）里出现 0 次；官方 `dsh-client-ui-plugin-manager/README.zh.md:14`、`:71-73` 明确写配置页由插件自己渲染。

因此 `package.json` 必须声明 `dsh.client`，`client.js` 必须存在。定案：

```json
"dsh": {
  "manifestVersion": 1,
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": {
    "platform": "web",
    "immediately": true,
    "inject": [
      "@deepseek-ai/dsh-client-ui-settings",
      "@deepseek-ai/dsh-client-ui-sidebar",
      "@deepseek-ai/dsh-client-ui-plugin-manager"
    ]
  }
}
```

`inject` 只作 graph row 的排序提示字段透传（`dsh-client-modules/lib/index.js:67`、`:72`、`:407`），不参与 `orderByModuleGraph` 建边（该函数只遍历 `external`，`:433-437`），指向未安装的包不报错。`external` 留空（只 `require('react')`，在 browser module table 静态表内）。

**需同步修订 `03-manifest.md` 6 处**（`:15`、`:23`、`:108`、`:126`、`:128-135`、`:408` 的 `if (p.dsh?.client) die(...)`），逐条替换文本见 `02-panel.md` 13.1 节。

### B. 面板信息架构（字段表 + 双语文案）

**唯一配置页：`plugins.bundle.config`，`key = "dsh-language-guard"`（bundle 包名）。**

依据：该 slot 契约原文（`dsh-cordis-client-runner/lib/client.js:4480-4484`）——`kind: "keyed"`, `scope: "root"`, "keyed by the bundle's package name and rendered on the bundle's page"；而 `plugins.item` 契约（`:4661-4662`）明确排除 bundle：「a bundle's configuration belongs in `plugins.bundle.config` or `plugins.row.config` instead」。渲染点 `dsh-client-ui-plugin-manager/lib/client.js:2961-2965`：`configured ? renderSlot("plugins.bundle.config", { view: "page" }, { entryKey: pkg.name }) : null`，`configured = ledger.bundles.has(pkg.name)`（`keysOf("plugins.bundle.config")`）。

**不注册** `settings.section`（取舍：那是整页偏好的左侧导航项，`:5295-5297`，本插件只有一个 6 字段表单，占顶级导航会稀释信噪比）；**不注册** `plugins.item`（契约明确排除）；**不注册** `plugins.row.config`（只插入一行，无需行级配置）。

| # | 字段 | 控件 | 中文标签 | 写入时机 |
|---|---|---|---|---|
| 1 | `strength` | radio group（3 行，每行档名 + 说明） | 强度档位 | 变更即写 |
| 2 | `targetLanguage` | 文本框 + 5 个预设 chip | 目标语言 | 草稿 + 保存 |
| 3 | `injectEveryNRounds` | number input（step 1） | 注入间隔（轮） | 变更即写 |
| 4 | `preserveCodeTerms` | switch（`role="switch"` + `aria-checked`） | 保留代码与术语原文 | 变更即写 |
| 5 | `extraRules` | textarea | 附加约束 | 草稿 + 保存 |
| 6 | `overrideHead` | textarea（默认折叠 `<details>`） | 覆盖首段规则（高级） | 草稿 + 保存 |

**写入时机为什么分两类**：`ConfigFormController.set()` 是立即发 RPC（`dsh-client-ui-settings/lib/client.js:1140-1146` → `:1170`），无 draft/save 概念。离散控件一次交互一个值，立即写最符合 volatile 的「改完即生效」且让 F8 当场可验；文本控件每次按键发 RPC 会产生几十次写盘（每次要拿 profile 文件锁 + 写 `cordis.patch.yml`，`dsh-config-editor/lib/index.js:69-135`），故走本地草稿 + 显式保存。两类共用 `form.unset(field)`（`:1153-1158`）作「恢复默认」。

完整中英双语字典见 `02-panel.md` 4.4 节（`NS = "languageGuard"`，key 规范 `<区块>.<字段>.<角色>`，约 50 个键）。三个「locale」必须分清：`locale/zh.json` 是**插件清单元信息**（只有 `meta.title`/`meta.description`，验收 B1/B2/B5）；`ctx.locale.register(NS, {zh,en})` 是**运行时 UI 文案**（验收 D9）；`ctx.config.targetLanguage` 是**被约束的思考语言**。切换 `targetLanguage` 不改变 UI 文案（验收 F10）。

### C. 三档强度控件：radio group（自建）

**形态：原生 `input[type=radio]` 的三行卡片式单选项，不用 `<select>`。**

| 方案 | 能否并列对比三档差别 | 键盘 | 一次点击可达 |
|---|---|---|---|
| `<select>` + 动态说明 | ❌ 只显示当前档，须逐一切换才能对比 | 原生好 | 需 2 次交互 |
| **radio group（三行）** | ✅ 三档说明同时可见 | 原生好（同 `name` 方向键切换） | 1 次点击 |
| 自绘分段按钮 | ⚠️ 说明只能放选中项下方 | 需自实现 roving tabindex | 1 次点击 |

票 #04 的核心诉求是「让用户看懂差别」，故选 radio group；用**原生 radio**（而非自绘按钮）免费获得键盘可达性与屏幕阅读器语义。

无障碍契约：`<fieldset>`+`<legend>`（legend 即「强度档位」标签）；三个 radio 同 `name`（Tab 进组只落一个 tab stop，`↑↓←→` 组内切换并立即触发 `change`）；每档说明用 `aria-describedby` 关联；档名用 `<label for>`；禁用用 `disabled`。

**文案（逐字取自 `01-mechanism.md` 2.1，验收 F3 逐字比对，不得改写）**：

- `B` 基础 —「只在提示词首尾各放一段语言约束，成本最低，适合短会话。」
- `C` 强化 —「在基础之上，于工具说明之后补一段重申，抵消英文工具说明带来的语言漂移，推荐默认。」（档名后加「推荐」徽标，`--dsw-alias-state-business-primary`）
- `D` 周期 —「在强化之上，每 N 轮在当轮开头追加一条语言自检提醒，适合长会话；提醒会作为一条会话记录出现，可在会话日志中看到。」

**说明文字常驻在档名下方，不用 tooltip**（tooltip 在触屏/键盘下不可达，且三档差别需要并列对比）。完整组件骨架（含 `fieldset`/`legend`/`aria-describedby`/`onChange` 即写）见 `02-panel.md` 3.3 节。

### D. 快速语言切换：`sidebar.footer.action` + 下拉菜单

**落点定案：`sidebar.footer.action`，`id = "language-guard"`，`order = 100`。**

契约（`dsh-cordis-client-runner/lib/client.js:5651-5697`）：`kind: "list"`、`scope: "root"`、"Optional actions beside Settings at the sidebar foot"、`ownerProps: SidebarFooterActionOwnerProps { wide: boolean }`、现有占位者 `client-ui-cordis CordisPanel id 'cordis-panel'`、`replaceRisk: "none"`。

- `id` 用自有值（复用 shipped id 会替换掉 `cordis-panel` 那一格）。
- `order: 100`：`cordis-panel` 未声明 order（默认 0，`dsh-client-ui-cordis/lib/client.js:1411-1414`），100 保证排在它右侧。
- **不选 `conversation.composer.dock`**：它是 `scope: "session"`，只在会话页渲染且要求 `variant === "composer" && input !== undefined && sessionId !== undefined`（`dsh-client-ui-conversation/lib/client.js:19161-19168`）。语言是全局偏好，在设置页改语言时不该够不着控件。
- **不用 `shell.leading`**：`single`/`root`，已被 sidebar 的 `HeaderLeadingControls` 占用（`dsh-client-ui-sidebar/lib/client.js:522-526`）。

**形态**：`wide` 时 = 自绘 inline SVG 图标（16px）+ 当前语言自称 + `▾`；56px rail 时仅图标（18px，对齐 `dsh-client-ui-cordis/lib/client.js:1119` 的 `size: wide ? 16 : 18`）。`aria-label` 始终完整（`quick.aria`）。**不得 require primitives 的图标集**（`references/practices.md` 硬规定，且该包在安装树里不存在）。

**点击后：弹出下拉菜单（不循环切换）。** 理由：循环切换一次只能看一个值、5 个预设之外的自定义标签无法参与循环；菜单能一次看全、当前项打勾、标题行显示「当前：X」（自定义标签时原样显示 code，用户不会以为配置丢了）。

**定位关键**：菜单渲染在组件树内、`position: absolute`（root `position: relative`）；`wide` 时 `bottom: calc(100% + 8px); left: 0`，rail 时 `bottom: 0; left: calc(100% + 8px)`。**不用 `position: fixed` + `getBoundingClientRect` 视口计算**（cordis 面板 `:749-763` 的做法）：sidebar 折叠动画用 `transform`，`transform` 祖先会改变 `fixed` 的包含块导致坐标算错。**不 portal、不 append 到 `document.body`**。

键盘：`Enter`/`Space` 开合、`Escape` 关闭并回焦触发按钮、`↑↓` 在菜单项间循环、`Enter` 选中、点击外部关闭。关闭菜单的 `pointerdown`/`keydown` 监听器在组件 `useEffect` 里注册并在清理函数里移除。菜单项用 `role="menuitemradio"` + `aria-checked`。

**双向同步（验收 F7）不需要任何额外代码**：两处都用同一个 `ConfigFormController` 实例——`ctx.configForms.get('dsh-language-guard')` 按 entryId 缓存（`dsh-client-ui-settings/lib/client.js:1294-1301`），其 `store` 由 mirror 驱动（`:1116-1119`），写入成功后 `mirror.acceptView(response.value)`（`:1178`）→ 所有订阅者重渲染。这是**同源**而非「同步逻辑」。

### E. 语言候选清单（定案）+ 视觉 + 空态错误态

**5 个预设 + 任意合法 BCP-47**：`zh-CN` 简体中文 / `zh-TW` 繁體中文 / `en` English / `ja` 日本語 / `ko` 한국어。预设同时出现在快速菜单与设置页 chip；**自定义标签只能在设置页文本框输入**（正则 `/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/`，与 schema 同一正则）。

理由：① 快速切换的意义是「不打开设置页就能换」，只放高频项；② 不能锁死枚举——schema 已是 BCP-47 正则、`01-mechanism.md` 3.5 规定「其他合法标签原样使用代码本身」，做成封闭枚举会把已支持的 `fr`/`de` 变成不可用（功能回退）；③ 菜单超过 7–8 项后扫视成本高于「打开设置页输一次」，且 3.5 的映射表只覆盖这 5 个语言族；④ 自定义值在菜单标题行原样显示，不会「消失」。语言名始终以自身语言显示（英文界面下 `日本語` 仍是 `日本語`）。

**视觉（零字面颜色，只用 `--dsw-alias-*`）**：

| 用途 | token |
|---|---|
| 卡片背景 / 描边 | `--dsw-alias-settings-card-fill` / `--dsw-alias-settings-card-stroke` |
| 分隔线 / 控件描边 | `--dsw-alias-border-l1` / `--dsw-alias-border-l2` |
| 主 / 次 / 说明 / 禁用文字 | `--dsw-alias-label-primary` / `-secondary` / `-tertiary` / `-dimmed` |
| 触发按钮 hover / active | `--dsw-alias-interactive-bg-hover` / `-active` |
| 菜单容器 / 分组头 | `--dsw-alias-bg-overlay` / `--dsw-alias-menu-group-header-fill` |
| 选中强调（radio 环、勾、推荐徽标、switch 开） | `--dsw-alias-state-business-primary` |
| 聚焦环 | `--dsw-focus-ring-color`（回退 `--dsw-alias-state-business-primary`） |
| switch 滑块 / 关态轨道 | `--dsw-alias-switch-thumb` / `--dsw-alias-border-l3` |
| 错误 / 成功 / 警告 | `--dsw-alias-state-error-primary` / `-success-primary` / `-warn-primary` |
| 骨架屏 | `--dsw-alias-bg-skeleton` |
| chip 选中底 | `--dsw-alias-interactive-bg-hover-accent` |

明暗适配由宿主切 `body[data-ds-dark-theme]` 完成（`dsh-client-ui-theme/lib/client.js:1413`），**不写 `@media (prefers-color-scheme)`、不写字面色**。类名一律 `lg-` 前缀。

**空态/错误态矩阵**：

| 情形 | 判定 | 表现 |
|---|---|---|
| Host 未装 `dsh-client-ui-settings` | Client 半 `inject` 缺 `configForms` → 整个 Client 半不激活 | 无卡片、无控件，**不报错**（合法部署） |
| 本插件 Host 行被 `disabled` | mirror 里无该 namespace → `whileServed` 不触发 `register` | 卡片与侧栏控件**都不注册**（不显示灰控件） |
| `status === "loading"` | controller 初始态（`:1108-1115`） | 骨架屏，**不渲染空表单**（避免把默认值误读为已保存） |
| `status === "unavailable"` | mirror 里找不到该 ns（`:1215-1220`） | `role="status"` 一行「配置暂不可用，请确认插件已启用。」 |
| `writable === false` | 只读部署（`:1213`、`:1227`） | 全控件 `disabled` + 顶部「当前部署为只读，配置不可修改。」 |
| 写入失败 | `mutate` 返回 `false`（已自动 `recover()`） | **保留用户本地选择**不静默回滚；`role="alert"` 一行「保存失败：{message}」+「重试」 |
| `targetLanguage` 非法 | 本地正则 | `aria-invalid` + 「不是合法的 BCP-47 语言标签。」，保存按钮 disabled，**不发 RPC** |

「控件消失」是刻意设计：`whileServed` 的语义就是「部署没组合该 owner 时不显示我的页面」（`:1302-1313` 注释：*"a deployment that never composed the owner shows no trace of the page"*）。代价是用户可能找不到入口，缓解方式是 README 写明「看不到控件 = 插件未启用」。

**与 D 档联动：不展示「当前第几轮注入」。** Client 侧没有任何轮次计数投影可读——`turnBoundary` 只存在于 Host 侧包，`dsh-client-ui-trajectory/lib/client.js` 里只命中一个 CSS 类名（`:6311`、`:6760`）。硬做要自己数会话事件流，会在重连/回放时算错。真正的联动是 **N 字段随档位启用**：`strength !== "D"` 时 `injectEveryNRounds` 输入框 `disabled` + 「仅在选择「周期」档时可调。」（用 `disabled` 而非隐藏，避免切档时布局跳动、且用户切到 D 后找不到 N）。

### F. 即时生效与自证步骤（无需重启、无需提示）

链路：`form.set()` → `remote.settings.mutate` → Host `Settings.write`（`dsh-settings/lib/index.js:501-537`）→ `configEditor.edit` 原子写 profile 的 `cordis.patch.yml`（`dsh-config-editor/lib/index.js:69-135`）→ Loader 判定「只有 volatile 变了」→ 原地替换 `fiber._config` + `_commitVolatile()` + emit `loader/volatile-update`（`cordis-plugin-loader/lib/index.js:382-388`、`:395-427`），**不 remount** → 插件下次 `.get()` 即新值 → 下一次 `systemPrompt.assemble()` 重新求值 `section.text()`（`dsh-system-prompt/lib/index.js:385-393`；`dsh-agent-loop/lib/index.js:902-917` 每 step 重算）→ 新 system 节点文本变化。

**用户自证三步（写进 README）**：

- **验证 A（改档位）**：设置 → 插件 → dsh-language-guard，档位「强化」→「周期」→ 底部出现「已保存 · 无需重启，下一条消息即生效」→ **不重启**发一条消息 → 读该会话最新 system 节点，搜 `language-guard:` 应见 head/tail 两段；再切「基础」重发，`mid` 段文本应为空（只剩 head/tail）。
- **验证 B（快速切换）**：点侧栏底部语言图标 → 选「日本語」→ 按钮标签变「日本語」，同时设置页 `targetLanguage` 显示 `ja`（F7 双向同步）→ 不重启发消息 → 新 system 节点语言名变「日本語」。
- **验证 C（持久化）**：完全退出重启 DSH → 档位与语言仍是重启前的值（F9）。
- 开发者自证：`cordis_inspect_query` 查本插件 `Config`，`strength.get()` / `targetLanguage.get()` 返回新值。

**明确不做**：不弹「需要重启」提示（验收 F8 要求无 `restart-required`）；不做额外「已生效」toast（与「已保存」重复）。

### 需同步修订的其它文档

`docs/验收清单.md` 5 处（见 `02-panel.md` 13.2）：**F6** 原文写「控件在 composer 区域可见」→ 改为「侧栏底部（设置按钮旁）」；**D10** 原文要求 `ctx.locale.addLanguage(...)` → 本插件**不调用**（`addLanguage` 是「新增一种**界面**语言」，会往宿主界面语言菜单塞条目，不是本插件职责；本插件只 `ctx.locale.register(NS, {zh,en})`）；**F3** 补「控件为 radio group，三档说明同时可见」；**F7** 补判定方法（无需刷新即变化）；**C9** 补路径（`设置 → 插件 → dsh-language-guard` 详情页配置区块）。票 #08（README）需新增「设置面板」「快速切换」「验证」三小节，见 13.3。