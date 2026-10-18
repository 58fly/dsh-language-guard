<!-- DSH-IDEMPOTENCY-KEY: deck-plan-dsh-language-guard-map-v1-child-research-ui -->
<!-- parentKey: 01 -->
<!-- created: 2026-10-18T13:16:25.010Z -->
# 调研：DSH Desktop 设置面板与快速语言切换的官方实现范式

确认设置面板与快速切换控件的正确做法，保证「符合 dsh desktop UI 风格规范」。

需要回答：
1. `ctx.settings.configure()` 的完整签名与行为：注册后 Web 插件页如何渲染配置项？`volatile()` 字段与普通字段在 UI 上的差异？
2. 配置项在 UI 上呈现成什么控件（下拉/开关/文本框）？由 schema 类型推断还是要自己声明？
3. `conversation.composer.dock` slot 的 props 与注册方式（对照官方 `templates/decoration/client.js`）。
4. 可用主题 token 清单（`--dsw-alias-*`），以及 locale 服务如何让控件文案跟随界面语言。
5. 面板改动配置后，Host 侧如何即时感知（`settings` 服务的变更通知机制）。

产出：写入 `docs/research/02-ui-panel.md`，含可直接抄的代码骨架与 token 清单。

完成标准：给出设置面板与快速切换控件的最小可用实现方案。

## 进度

- 2026-10-18 完成全部取证，产出 `docs/research/03-settings-panel.md`（原定 02-ui-panel.md 已被 #05 的 01-section-orders.md 占用编号，实际落 03-settings-panel.md）。含 A–F 六节、可直接抄的骨架、token 表与验证清单。

Status: resolved
Type: task
Blocked by:
Labels: wayfinder:research, wayfinder:task

## Comments

## Answer

完整取证文档：`docs/research/03-settings-panel.md`。以下为结论摘要（所有行号均为 app.asar 内实际源码行号）。

### A. 插件配置如何注册进设置页

- **精确签名**：`SettingsForms#configure(presentation, owner = this.ctx.fiber)` —— `dsh-settings/lib/index.js:370-381`。`presentation` 只有 `{ auto: boolean }`；返回 disposer；同一 fiber 重复注册抛 `Settings presentation is already configured for this plugin instance`（`:372`）。
- **正确调用形态**（官方实例 `dsh-experimental-client-ui-cot-translation/lib/index.js:166-168`）：
  ```js
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
  });
  ```
  第二个参数必须显式传 `ctx.fiber`——在 `child` 里默认值会变成 child 的 fiber，页面归属就错了。
- **volatileForm 语义**：`dsh-settings/lib/index.js:122-131`。`schema.meta.volatile` → 整个字段进表单；否则只对 `type === 'object'` 递归挑 volatile 子字段；**一个 volatile 子字段都没有就返回 `undefined`，该 entry 不进表单**。配套 `plainSchema`（`:103-117`）剥掉 volatile 标记、保留 `description`/`default`；`plainConfig`（`:97-102`）把引用展开成普通值。
- **描述符**（`:441-451`）：`{ autoGenerate, ns, schema, revision, applies: 'live', value, base, user }`。
- **写入**：`write(ns, change, expected, paths)`（`:501-537`）；路径不在 volatile 之下抛 `Config field "<path>" is not volatile`（`:507`）；版本冲突抛 `SETTINGS_CONFLICT`（`:163-170`）。
- **普通字段 vs volatile 字段的 UI 差异**：普通字段**根本不进设置页**，只能改 `cordis.patch.yml`；设置页只承载 volatile 字段，且写后立即生效、不 remount 插件。

### B. 关键否定结论：没有「自动表单渲染器」

- 全树 grep `autoGenerate` 只命中 `dsh-settings/lib/index.js`（5 处，纯存储/透传）与协议 zod 描述（`dsh-api-remotes/lib/client.js:2789` 等，注释为 `Generate a page if no custom page is registered for this instance.`）。
- `dsh-web-frontend/dist/assets/index-CN7NIWNw.js` 中 `autoGenerate` 出现 **0** 次；各 `dsh-client-ui-*` 的 `client.js` 里也没有「按 `schema.type` 分派控件」的代码。
- 官方 `dsh-client-ui-plugin-manager/README.zh.md:14` 明说：「**注册了配置页的插件在这里、在它自己的页面上编辑；设置里只保留只读的插件列表**。」
- **所以「三档强度」的每档说明不能靠 schema**：`schemastery` 的 `description` 是字段级（`schemastery/lib/index.cjs:70-83` 的 toJSON 只带 meta），没有 per-option 描述。必须自建 `<select>`/分段按钮 + 随档位切换的说明文案，文案走 Client locale。

### C. 设置页的注册点（四个）

| 注册点 | kind/scope | 键 | 证据 |
| --- | --- | --- | --- |
| `plugins.item` | list/root | 无（官方插件） | `dsh-client-ui-plugin-manager/lib/client.js:4432-4447` |
| `plugins.bundle.config` | keyed/root | **组合包包名** | 同上；渲染 `:2961-2965`；实例 cot-translation `lib/client.js:996-1011` |
| `plugins.row.config` | keyed/root | `包名#行id` | `:27-29`、`:4432-4447` |
| `settings.section` | list（导航分区） | `id`+`order`+`label()` | `dsh-client-ui-settings-account/lib/client.js:4773-4795` |

守卫：`ctx.configForms.whileServed(namespaces, register)`（`dsh-client-ui-settings/lib/client.js:1315-1334`）——owner 插件没装就不显示我的页。

### D. 快速语言切换放哪个 slot

| slot | kind/scope | 判定 | 证据 |
| --- | --- | --- | --- |
| `sidebar.footer.action` | list/root，传 `{ wide }` | **首选**：全局常驻、可多注册 | `dsh-client-ui-sidebar/lib/client.js:515-518`、渲染 `:403`；实例 `dsh-client-ui-cordis/lib/client.js:1411-1425` |
| `conversation.composer.dock` | list/session，仅 `variant==='composer'` 且有 sessionId 时渲染 | 次选（官方模板背书、会话页内） | `dsh-client-ui-conversation/lib/client.js:19916-19919`、渲染 `:19161-19168`；实例 `dsh-client-ui-chat/lib/client.js:13312-13328` |
| `shell.leading` | **single**/root，只渲染 `entriesOfSlot()[0]` | **禁用**：已被 sidebar 占用 | `dsh-client-ui-layout/lib/client.js:647-650`、`:1173-1177`；占用 `dsh-client-ui-sidebar/lib/client.js:522-526` |
| `settings.general.item` | list | 官方语言行位置（慢速，非快速） | `dsh-client-locale/lib/client.js:1553-1560` |

### E. 即时生效链路（面板改值 → Host 感知）

```
Client: configForms.get('<entry id>').set('language','en')      // dsh-client-ui-settings/lib/client.js:1294 / :1140
  → mutate([{op:'set',path:['language'],value:'en'}])           // :1165-1170 → ctx.remote.settings.mutate(...)
    → Host: Settings.write(ns, change, expected, paths)         // dsh-settings/lib/index.js:501-537
      → configEditor.edit(entry, …) 持久化进 profile patch
        → Loader: equalExceptVolatile(prev,next,schema)         // cordis-plugin-loader/lib/index.js:285
          → fiber._config = next; _commitVolatile()             // :382-384
            → updateVolatile(ref, source); emit 'loader/volatile-update'   // :422
              → 插件下次 ctx.config.language.get() 即新值（不 remount）
```

- volatile 引用**只有 `get()`**，写入符号 `Symbol.for('cosmokit.volatile.write')` 只由 runtime 用（`cosmokit/lib/types/volatile.js:28-34`）——插件里绝不要尝试 `.set()`。
- 写失败（冲突/不可写）时 `mutate` 会 `recover()` 重读并抛错（`dsh-client-ui-settings/lib/client.js:1184-1188`），UI 必须显示错误。

### F. Client 半写法与禁止事项

- 装载：`window.__ModuleLoader__.load({ id: '<包名>', factory(require) { … return { inject, apply } } })`（官方 `templates/decoration/client.js`）；`id` 必须等于包名；`factory` 无副作用，样式/监听/定时器放 `apply` + `ctx.effect`。
- React 用 `require('react')` 从 browser module table 取；非基线 import 在 `dsh.client.external` 声明。
- `ctx.slots.inject(key, cb)`（`dsh-client-ui-renderer/lib/client.js:1368-1427`）等声明出现才注册；`register(options, component)`（`:1813-1816`）的 `options` 支持 `name/id/key/order/label()/locale/inject/store`；`inject` 的 `hooks` 键会变成组件 `useXxx` prop（`:435-458`），session slot 自动注入 `sessionId` 与 `t`（`:542-558`）。
- 禁止：`require('@deepseek-ai/dsh-client-ui-primitives')` 或加载任何 Harness Client 包；iframe；替换 app root；往 `document.body` 追加第二个应用；组件外写 DOM；读别的插件 DOM/CSS 源码估位置；字面颜色做 UI（仅艺术图形）；硬编码中文文案（必须走 `ctx.locale.register`）。
- 主题：只用 `--dsw-alias-*`（明暗由 `body[data-ds-dark-theme]` 切变量，`dsh-client-ui-theme/lib/client.js:1413`）；常用分组与 107 个 token 的完整清单见文档 E 节。

### 交付物

- 文档：`docs/research/03-settings-panel.md`（A–F 六节 + 最小可用骨架 + 验证清单 + 六条否定结论）。
