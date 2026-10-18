<!-- DSH-IDEMPOTENCY-KEY: deck-1f86c015-5974446 -->
<!-- parentKey: 01 -->
<!-- created: 2026-10-18T14:30:44.372Z -->
# 实现：dsh-language-guard 插件 Host 半与 Client 半

## Question

把 `docs/decisions/` 下三份决策（01-mechanism.md 的 Host 机制与 Config、02-panel.md 的 Client 半 UI、03-manifest.md 的包结构与 manifest）落地为可加载、可打包、可发布的插件实现。

## 验收依据

- `docs/验收清单.md`（82 条）
- `docs/实现说明.md`
- `scripts/verify-manifest.mjs`（43 项断言）
- `scripts/verify-checklist.sh`（机械可判项）

## 进度

- 2026-10-18 实现完成：Host 半 5 个文件 + Client 半 1 个文件 + 6 个配套文件 + 自检脚本 + 实现说明，全部落盘。
- `node --check` 6 文件通过；`scripts/verify-manifest.mjs` 43/43 PASS；stub 环境 29 组 Host 测试 + client 渲染测试全过；`npm pack --dry-run` 12 文件。
- `scripts/verify-checklist.sh` 33 PASS / 7 FAIL，7 项均为判据或环境问题（依据见 ## Answer 第四节）。
- D13（dsh-context 共存提示）已补：client.js + 两个 locale，grep 三处均命中。
- README 中英两份归 t9，本票未创建。

Status: resolved
Type: task
Blocked by:
Labels: wayfinder:task

## Answer

实现完成，全部落盘于仓库根。完整说明见 `docs/实现说明.md`（287 行），本票只放摘要。

### 一、文件清单（14 个，行数/字节为实测）

进 npm 包的 12 个：

| 文件 | 规模 | 职责 |
| --- | --- | --- |
| `lib/index.js` | 226 行 | Host 入口：`inject = ['systemPrompt']`、`apply(ctx, config)`、三个常驻 section、Config schema |
| `lib/text.js` | 139 行 | 四段约束文案唯一真源 + 语言显示名映射 + 模板填充 |
| `lib/state.js` | 98 行 | 配置规范化（档位/间隔/布尔/文本）与语言解析（覆盖 > 配置 > 默认） |
| `lib/cycle.js` | 85 行 | D 档周期提醒：`agent/pre-step` 全部门禁与插入 |
| `lib/commands.js` | 71 行 | `/language` 斜杠命令（查询 / 切换 / reset），只写内存覆盖 |
| `client.js` | 985 行 / 42.4 KB | Client 半：装载、两个 slot、zh/en 字典各 44 键、`lg-` 前缀样式 |
| `package.json` | 1976 B | manifest：`dsh.bundle.patch` + `dsh.client`，零 dependencies，peer 三项 optional |
| `cordis.patch.yml` | 649 B | bundle patch：只 insert 一行，不写 config |
| `locale/en.json` | 375 B | 只有 `meta.title` / `meta.description`（含 dsh-context 共存提示） |
| `locale/zh.json` | 397 B | 同上 |
| `icon.svg` | 367 B | 纯几何「中」字，远低于 256 KiB 上限 |
| `LICENSE` | 1062 B | MIT 全文 |

只进 git 的 2 个：

| 文件 | 规模 | 职责 |
| --- | --- | --- |
| `scripts/verify-manifest.mjs` | 363 行 | 43 项静态断言（A/B/C/D/R 组），剥注释后 grep |
| `docs/实现说明.md` | 287 行 | 每个文件职责、实现要点、验证方式、已知限制、7 项 FAIL 依据 |

`README.md` / `README.zh.md` 归 t9，本票未创建（`verify-manifest.mjs` 对此只 WARN 不 FAIL）。

### 二、关键实现点

**三个常驻 section（`lib/index.js`）**

| name | order | B 档 | C 档（默认） | D 档 |
| --- | --- | --- | --- | --- |
| `language-guard:head` | -2000 | 有文本 | 有文本 | 有文本 |
| `language-guard:mid` | 5100 | 返回 ""（被过滤，不留空行） | 有文本 | 有文本 |
| `language-guard:tail` | 11200 | 有文本 | 有文本 | 有文本 |

- order 一律写数字字面量：`ctx.systemPrompt.section()` 对非有限数字抛 TypeError。
- mid 用 5100 而非 5000：`tools:sdk` 恰为 5000，同序时 `language-guard:mid` 会按 name 字典序排到工具说明之前。
- 三个 section 一次性注册、永不 dispose，切档只切 `text()` 返回值，避免同名重复注册抛 `prompt section "..." is already registered`。
- 全部 `interpolate: false`：用户 extraRules 含 `{{` 时插值会抛错并让整份 system prompt 装配失败。
- 都不带 `complete: true`（多于一个会抛 `multiple complete prompt sections are active`）。
- 文本会话内稳定：只读配置与内存覆盖，不读轮次/时间/随机数。

**D 档七道门禁（`lib/cycle.js`）**

注册在插件根 ctx（`ctx.on('agent/pre-step', ...)`），payload 自带 agent，不持有 per-agent 状态、不维护计数器（轮次来自 payload 的 turn）。

1. `await next()` 后 `decision.kind === 'reject'` → 原样返回；
2. 档位非 D → 返回；
3. `step !== 1` → 返回（否则轮次永不结束）；
4. `decision.messages.length === 0` → 返回（否则凭空造出一轮）；
5. `turn % N !== 0` → 返回；
6. 已有 `source.kind === 'language-guard'` 的消息 → 返回（幂等）；
7. 子代理跳过：`Math.max(agent.session.header.delegationDepth ?? 0, agent.options.subagentDepth ?? 0) !== 0` → 返回。

插入位置 `findLastIndex(m => messages.includes(m)) + 1`（本轮真实输入之后、runtime context 之前），返回 `{ ...decision, messages }` —— 必须 spread，否则丢 `startsRequestSeries`。提醒消息用 `createUserMessage({ content, source: { kind: 'language-guard', form: 'notice', summary: '语言自检' } })`。

**Config 6 字段全部 volatile（`lib/index.js`）**

用 `@deepseek-ai/schemastery`（不是 zod），`targetLanguage` / `strength` / `injectEveryNRounds` / `preserveCodeTerms` / `extraRules` / `overrideHead` 逐字段 `.volatile()`；不能加在根对象（会报 `volatile fields require a fixed object path without an enclosing volatile field`）。运行时一律 `config.<field>.get()` 现取，改配置无需重启。schemastery 是 optional peer，不进 dependencies。

**Client 半两个 slot（`client.js`）**

| slot | 参数 | 用途 |
| --- | --- | --- |
| `plugins.bundle.config` | `key: 'dsh-language-guard'`（bundle 包名）、`locale: 'languageGuard'` | 插件详情页配置卡片，处理 summary / page / loading / unavailable / readOnly |
| `sidebar.footer.action` | `id: 'language-guard'`、`order: 100`、`locale: 'languageGuard'` | 侧栏底部快速语言切换 |

两个都包在 `ctx.effect(() => ctx.configForms.whileServed(['dsh-language-guard'], () => ctx.slots.inject(...)))` 内：Host 未启用该 namespace 时不注册 UI。

`whileServed` 签名已源码核实：`dsh-client-ui-settings/lib/client.js:1315` 为 `whileServed(namespaces, register)`，第 1319 行 `namespaces.some(...)` 说明第一个参数必须是数组（字符串没有 .some）；官方插件 `dsh-client-ui-settings-agent-loop:158`、`-shell:182`、`-web-search:510` 均为 `whileServed([NS], () => ctx.slots.inject(...))` 形态，与本实现一致。回调还会收到 `served`（Set），本实现忽略它。

**locale 两份 vs 内联字典的分工**

- `locale/{en,zh}.json`：只放 `meta.title` / `meta.description`，供插件管理器列表显示；共存提示并入 `meta.description`，不新增键（遵守 `03-manifest.md` 5.1/5.2）。
- `client.js` 内联字典：运行时可见文案全部在这里，`ctx.locale.register('languageGuard', { zh, en })`，两份各 44 键且 key 集合完全一致；不调用 `addLanguage`（语言清单由宿主维护）。

### 三、验证结果

| 检查 | 结果 |
| --- | --- |
| `node --check`（6 个 JS 文件） | 全过 |
| `node scripts/verify-manifest.mjs` | 43/43 PASS |
| stub 环境 29 组 Host 功能测试 | 全过 |
| stub 环境 client 渲染测试 | 全过 |
| `npm pack --dry-run` | 12 文件，LICENSE 在列，无 private/scripts/dependencies |
| `bash scripts/verify-checklist.sh` | 33 PASS / 7 FAIL（见下，均为判据或环境问题） |

功能测试覆盖：四段文案逐字与 preserveCodeTerms 变体、overrideHead/extraRules 合并、语言映射 9 分支、D 档 9 种门禁场景、导出集合无 default、三 section 的 name+order+interpolate、B 档 mid 空串、懒注入 settings/commands、`/language` 四种输入、`settings.configure({auto:false}, ctx.fiber)`、Config 6 字段 volatile；Client 侧覆盖装载 id、字典一致性、两 slot 的 whileServed 与参数、四种卡片状态、三档 radio 逐字文案、D 档间隔可编辑、switch aria、5 个 chip、wide/rail、菜单展开与写回。

### 四、7 项 FAIL 的判据修正依据

| 项 | 脚本判据 | 实际 | 建议判据 |
| --- | --- | --- | --- |
| A2 | `await import(p.exports['.'])` | `ERR_MODULE_NOT_FOUND: @deepseek-ai/schemastery` | 仓库根无 node_modules，而 schemastery/dsh-llm 是 optional peer，宿主运行时才提供。建议先 node --check，import 放有 DSH 依赖的环境，或记 SKIP |
| C1 | 同一 import 后判 `'default' in m` | 同一 import 失败 | 实测 `Object.keys(m)` = `['Config','apply','inject']`，无 default，符合 |
| C5 | `! grep -rq 'agent/pre-step'` | 命中 lib/cycle.js | 与 01-mechanism r2 决策相反：D 档就是要走 agent/pre-step。改为判「有 await next()、返回 {...decision, messages}、门禁含 step === 1、无 session.append(」 |
| C7 | `grep -q 'agent.ctx'` | 未命中 | 清单原文要求 per-agent 注册放 agent.ctx，同样与 r2 相反。r2 定案：注册在插件根 ctx，agent 由 payload 提供 |
| C9 | `grep -c 'volatile()' -eq 6` | 得 7 | 第 178 行注释里也有 .volatile()。剥注释后正好 6 处（190/198/207/213/219/225）。判据应剥注释 |
| D3 | 全文件 `! grep addEventListener\|setInterval` | 命中 addEventListener | 清单原文限定「工厂体内无」。两处在组件 useEffect 内注册、清理函数内移除，是 React 标准做法 |
| D7 | 只允许 `--dsw-alias-*` | 命中 `--dsw-focus-ring-color` | 该 token 是 02-panel 7.2 明确列出的官方焦点环 token（带 alias 回退）。白名单应加它 |

另有两处清单笔误：第 174 行 `import('./index.js')` 应为 `./lib/index.js`；第 176 行 chk C5 判据同上表 C5。

### 五、已知限制

- 提醒消息会作为一条会话记录出现，可在会话日志中看到（决策已接受，面板说明已对用户写明）；
- Client 半拿不到轮次计数，不展示「当前第几轮会注入」；
- 自定义语言只能在设置页文本框输入，快速切换菜单只列 5 个预设；
- 与 `dsh-context` 等第三方插件可能撞 order（-2000 / 11200），但不撞 name，共存稳定，代价是重复烧 token；面板与两个 locale 已常驻提示（D13），但插件无法自动检测对方是否安装（不做跨插件探测）。

## Comments
