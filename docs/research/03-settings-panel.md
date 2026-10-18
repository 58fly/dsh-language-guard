# DSH 设置面板与快速语言切换：官方实现范式调研

> 对应 wayfinder 票 #03。取证全部来自本机 app.asar 内的实际安装源码（`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`），
> 读取工具：`python3 asar_tool.py cat|ls|grep`。文中路径均以 asar 根为基准，行号为该文件实际行号。

## 结论速查

| 问题 | 结论 | 关键证据 |
| --- | --- | --- |
| 插件配置怎么进设置页 | Host 半声明 `static Config`（schemastery），把**用户可改**字段包 `.volatile()`；再在 `apply` 里用 `ctx.inject(['settings'], …)` 注册页面策略 | `dsh-settings/lib/index.js:370-381`、`dsh-experimental-client-ui-cot-translation/lib/index.js:159-168` |
| `ctx.settings.configure()` 签名 | `configure(presentation, owner = this.ctx.fiber)`，`presentation` 只有 `{ auto: boolean }`，返回 disposer；同一 fiber 重复注册抛错 | `dsh-settings/lib/index.js:370-381`、`:372` |
| `.volatile()` 的运行时语义 | 读值必须 `config.xxx.get()`；用户改值不是调 `.set()`，而是走设置表单写入 → Loader 只热替换 volatile 值并 emit `loader/volatile-update` | `schemastery/lib/index.cjs:235-238`、`cordis-plugin-loader/lib/index.js:382-427` |
| 设置页会不会自动渲染 enum 下拉 | **不会**。安装树里没有任何「schema → 控件」的自动渲染器；`autoGenerate` 只是 Host 描述符里的协议标志，没有 UI 消费者 | `dsh-client-ui-plugin-manager/README.zh.md:14`、`:71-73`；全树 grep `autoGenerate` 仅命中 `dsh-settings`（5 处）与协议 zod 描述 |
| 三档强度怎么做成「下拉 + 每档说明」 | 自建控件（`<select>` 或按钮组 + 说明文字），文案走 Client locale；schema 的 `description` 是**整字段级**，没有 per-option 描述 | `schemastery/lib/index.cjs:70-83`（toJSON 只带 meta）、官方 `ui-plugin.md` 要求自写控件 |
| 设置页放哪 | 三个官方注册点：`plugins.item`（官方插件）、`plugins.bundle.config`（键＝**组合包包名**）、`plugins.row.config`（键＝`包名#行 id`）；要独立分区则用 `settings.section` | `dsh-client-ui-plugin-manager/lib/client.js:4432-4447`、`:2961-2965`、`README.zh.md:131-133`；`dsh-client-ui-settings-account/lib/client.js:4773-4795` |
| 快速语言切换放哪 | 首选 `sidebar.footer.action`（`list`/`root`，全局常驻、带 `wide` 参数）；次选 `conversation.composer.dock`（`list`/`session`，官方模板背书）；**不要用 `shell.leading`**（`single`/`root`，已被 sidebar 占用） | `dsh-client-ui-sidebar/lib/client.js:515-518`、`:403`；`dsh-client-ui-conversation/lib/client.js:19916-19919`；`dsh-client-ui-layout/lib/client.js:647-650`、`:1173-1177` |
| 面板改完配置何时生效 | 写入返回后 Host 立即生效：Loader 判定「只有 volatile 变了」→ 原地替换 `fiber._config` 并 `_commitVolatile()`，不 remount 插件；插件下次读 `config.x.get()` 即新值 | `cordis-plugin-loader/lib/index.js:382-384`、`:395-427` |
| Client 半怎么写 | `window.__ModuleLoader__.load({ id: '<包名>', factory(require) { … return { inject, apply } } })`；React 用 `require('react')`；**禁止** `require('@deepseek-ai/dsh-client-ui-primitives')` | 官方 `templates/decoration/client.js`；`references/practices.md` UI 段 |

---

## A. 插件配置如何注册进宿主设置页

### A.1 Host 半：Config + volatile 字段

```js
// index.js —— Host 半
import z from '@deepseek-ai/schemastery';

export const Config = z.object({
  // 用户可改、且改了要「立即生效、不重载插件」的字段，必须 .volatile()
  language: z.union(['zh-CN', 'en', 'auto']).default('zh-CN')
    .description('思考与回复使用的语言；auto 跟随界面语言').volatile(),
  strength: z.union(['basic', 'strong', 'periodic']).default('strong')
    .description('强制中文思考的强度').volatile(),
  periodTurns: z.natural().default(6).description('周期档每 N 轮注入一次').volatile(),
});

export function apply(ctx) {
  // settings 服务可能不存在（未装 dsh-settings），必须用可选子级 + effect
  ctx.inject(['settings'], (child) => {
    // 第二个参数显式传「插件实例 fiber」：child.fiber 不是它
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
  });

  // 读值永远是 .get()
  const lang = () => ctx.config.language.get();
}
```

证据与语义：

- `configure(presentation, owner = this.ctx.fiber)`：`dsh-settings/lib/index.js:370-381`。注释写明它只登记「本插件实例的页面策略」；`presentation` 形状是 `{ auto: boolean }`；同一 fiber 二次注册抛 `Settings presentation is already configured for this plugin instance`（`:372`）。
- 官方实例写法：`dsh-experimental-client-ui-cot-translation/lib/index.js:166-168` ——
  `ctx.inject(["settings"], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)); })`。
- `static Config` 实例：同文件 `:159-162`，两个字段都 `.volatile()`；读值在 `:182`、`:237-241` 用 `this.config.provider.get()`。
- `.volatile()` 本身：`schemastery/lib/index.cjs:235-238` —— 给 schema 打 `meta.volatile = true`；重复包装抛 `volatile schema is already wrapped`。
- 硬约束：volatile 字段必须落在**固定对象路径**上，且不能被另一个 volatile 字段包住，否则抛 `volatile fields require a fixed object path without an enclosing volatile field`（`schemastery/lib/index.cjs:241-252`，错误在 `:246`）。所以 `Config` 顶层保持普通 object，只给叶子字段包 `.volatile()`。
- `Schema.resolve` 遇到 volatile 节点会用 `createVolatile(value)` 包成稳定引用（`:265-277`），因此 Host 侧读到的字段是 `{ get() }` 对象，**不是值本身**。

### A.2 哪些字段会进设置页

`dsh-settings/lib/index.js` 的 `describe()`（`:413-464`）只投影 volatile 子树：

- `volatileForm(schema)`（`:122-131`）：`schema.meta.volatile` → `plainSchema(schema)`；否则仅当 `type === 'object'` 时递归挑 volatile 子字段重组成 `z.object`；**一个 volatile 子字段都没有就返回 `undefined`，该 entry 根本不进表单**。
- `plainSchema`（`:103-117`）：剥掉 `meta.volatile` 与 secret 字段的 `default/required`，其余 meta（`description`、`default`、enum 信息）原样保留。
- `plainConfig`（`:97-102`）：`isVolatile(v) ? plainConfig(v.get()) : …`，把引用展开成普通值给前端。
- 返回描述符（`:441-451`）：`{ autoGenerate, ns, schema: form.toJSON(), revision, applies: 'live', value, base, user, …secrets }`。
- 写入：`write(ns, change, expected, paths)`（`:501-537`），路径不在 volatile 之下抛 `Config field "<path>" is not volatile`（`:507`）；entry 没有任何 volatile 字段抛 `Plugin entry "<ns>" has no volatile fields`（`:506`）；版本冲突抛 `SettingsConflictError`（code `SETTINGS_CONFLICT`，`:163-170`），持久化进当前 profile 的 Cordis patch。

> 也就是说：**普通字段不进设置页，只能改 `cordis.patch.yml`**；设置页只承载 volatile 字段。这与官方 `practices.md` 的说法一致（可调值放插件 Config，让用户改 patch；只有需要即时生效的才 volatile）。

### A.3 关键否定结论：没有「自动表单渲染器」

`describe()` 返回了 `schema` 与 `autoGenerate`，但**安装树里没有任何代码把 schema 渲染成控件**：

- `autoGenerate` 在全树只出现在 `dsh-settings/lib/index.js`（5 处，全部是存储/透传）与协议 zod 描述里（`dsh-api-remotes/lib/client.js:2789` 等，注释是 `Generate a page if no custom page is registered for this instance.`）。
- `dsh-web-frontend/dist/assets/index-CN7NIWNw.js` 里 `autoGenerate` 出现 **0** 次。
- 逐个 `dsh-client-ui-*` 的 `client.js` 里也没有「按 `schema.type` 分派控件」的代码（只有 schemastery 自身的校验分派）。
- 官方 `dsh-client-ui-plugin-manager/README.zh.md:14` 明确：「**注册了配置页的插件在这里、在它自己的页面上编辑；设置里只保留只读的插件列表**。」`:71-73` 给出三个 slot 契约。

**结论**：配置页必须由插件自己用 React 渲染（自己决定下拉/开关/文本框），`autoGenerate` 只表示「允许 Host 在没有自定义页时自动生成」，而当前 GUI 并未实现这个自动生成器。因此：

- 「三档强度」的每档说明文字**无法**靠 schema 的 per-option description 表达（`toJSON` 只带字段级 `meta.description`，`schemastery/lib/index.cjs:70-83`）；
- 正确做法是自建 `<select>`/分段按钮 + 一段随选中档位切换的说明文案，文案放 Client locale 字典。

---

## B. 设置页的四个注册点

| 注册点 | kind / scope | 用途 | 键 | 证据 |
| --- | --- | --- | --- | --- |
| `plugins.item` | `list` / `root` | 官方插件（内置）配置卡片，按 `label` 列在内置插件分组 | 无 | `dsh-client-ui-plugin-manager/lib/client.js:4432-4447`；实例 `dsh-client-ui-settings-web-search/lib/client.js:493-517` |
| `plugins.bundle.config` | `keyed` / `root` | 组合包自己的配置页，渲染在组合包详情「描述与行之间」 | `key` = **组合包包名** | 同上 `:4432-4447`、渲染 `:2961-2965`；实例 `dsh-experimental-client-ui-cot-translation/lib/client.js:996-1011` |
| `plugins.row.config` | `keyed` / `root` | 组合包里某一行（entry）的配置 | `key` = `${包名}#${行 id}` | `dsh-client-ui-plugin-manager/lib/client.js:27-29`、`:4432-4447` |
| `settings.section` | `list`（导航分区） | 独立设置分区（左侧导航多一项） | `id` + `order` + `label()` | `dsh-client-ui-settings-account/lib/client.js:4773-4795` |

官方页面用的注入守卫：`ctx.configForms.whileServed(namespaces, register)` —— 只有当该 namespace 出现在 `settings.describe` 镜像里才执行注册，没装 owner 插件就不显示我的页面（`dsh-client-ui-settings/lib/client.js:1315-1334`）。

推荐选择：

- 我们的配置属于「组合包自带配置」→ 用 `plugins.bundle.config`，`key` 填**组合包包名**（例如 `@58fly/dsh-language-guard` 的 bundle 包名），与 cot-translation 完全同构。
- 若希望左侧导航有独立「语言守卫」入口（更显眼、也方便承载三档说明），用 `settings.section` + `settings.general.item` 组合；两者可同时存在。

---

## C. 快速语言切换：放哪个 slot

### C.1 候选评估

| slot | kind / scope | 渲染条件 | 适配度 | 证据 |
| --- | --- | --- | --- | --- |
| `sidebar.footer.action` | `list` / `root` | 侧栏底部 footerActions，传 `{ wide }`（侧栏展开/折叠） | **最推荐**：全局常驻、可多注册、官方 cordis 插件就在这放按钮 | `dsh-client-ui-sidebar/lib/client.js:515-518`、渲染 `:403`；实例 `dsh-client-ui-cordis/lib/client.js:1411-1425` |
| `conversation.composer.dock` | `list` / `session` | 仅 `variant === 'composer'` 且 `sessionId` 存在时渲染（会话页输入框下方） | 次选：官方模板背书、有横向空间；但首页/无会话时不显示 | `dsh-client-ui-conversation/lib/client.js:19916-19919`、渲染 `:19161-19168`；实例 `dsh-client-ui-chat/lib/client.js:13312-13328` |
| `shell.leading` | **`single`** / `root` | 外壳左上角，`renderSlot` 取 `entriesOfSlot(key)[0]`（只渲染第一个） | **不要用**：已被 sidebar 的 `HeaderLeadingControls` 占用，`single` 不会给你第二个位置 | `dsh-client-ui-layout/lib/client.js:647-650`、`:1173-1177`；占用 `dsh-client-ui-sidebar/lib/client.js:522-526` |
| `settings.trigger` | 按钮位 | 设置入口按钮内部 | 不适合（语义是「设置」） | `dsh-client-ui-settings-general/lib/client.js:461`、注册 `:1274` |
| `settings.general.item` | `list` | 「设置 → 通用」里的行 | 官方语言行的位置（**慢速**切换，不是快速） | `dsh-client-locale/lib/client.js:1553-1560`、组件 `:1056-1097` |

### C.2 推荐落点

1. **MVP**：`sidebar.footer.action` 注册一个图标按钮（地球/语言图标），点击用 `ctx.slots` 之外的本地 state 渲染一个绝对定位弹层（放在组件自身 DOM 内，**不要** append 到 `document.body`），列出 `简体中文 / English / 跟随界面`；选中即写 Host 配置。
2. **加分项**：同一份组件再注册一次到 `conversation.composer.dock`（`order: 50`，排在 activity/usage 之后），让会话页也能一键切。

### C.3 与 Host 半的 volatile 配置联动（即时生效链路）

```
用户点「English」
  └─ Client: configForms.get('<Host entry id>')        // dsh-client-ui-settings/lib/client.js:1294
       .set('language', 'en')                          // :1140 → mutate([{op:'set',path:['language'],value:'en'}])
         └─ ctx.remote.settings.mutate(ns, ops, revision)   // :1165-1170
              └─ Host: Settings.write(ns, change, expected, paths)   // dsh-settings/lib/index.js:501-537
                   └─ configEditor.edit(entry, …)  → 持久化进 profile 的 Cordis patch
                        └─ Loader: 判定「只有 config 变了 且 除 volatile 外全等」
                             equalExceptVolatile(prev, next, schema)      // cordis-plugin-loader/lib/index.js:285
                             → this.fiber._config = next; _commitVolatile()  // :382-384
                                  → updateVolatile(ref, source)            // :422
                                  → emit 'loader/volatile-update'          // :422
                                     └─ Host 半下次 ctx.config.language.get() 即新值（无需 remount）
```

要点：

- **不要**试图在插件里 `config.language.set(...)`：volatile 引用只有 `get()`，写入符号 `Symbol.for('cosmokit.volatile.write')` 只由 owning runtime 使用（`cosmokit/lib/types/volatile.js:28-34`）。
- 写入成功后 Client 侧 `ConfigFormController` 会重读镜像并通知订阅者（`dsh-client-ui-settings/lib/client.js:1165-1190`）；组件用 `controller.subscribe(fn)` 或 `getSnapshot()` 驱动重渲染（`:1108-1130`）。
- 若写入被拒（版本冲突/字段不可写），`mutate` 会 `recover()` 重读并抛错（`:1184-1188`），UI 必须显示错误而不是假装成功。
- 失效兜底：官方还监听 `settings/document-updated`（cot-translation `lib/client.js:911`），外部改配置时同步刷新。

---

## D. Client 半写法

### D.1 模块装载契约

```js
// client.js —— Client 半（浏览器）
window.__ModuleLoader__.load({
  id: '@58fly/dsh-language-guard',        // 必须等于包名
  factory(require) {
    const React = require('react');        // React 从 browser module table 取，不要重复装
    const { createElement: h, useState } = React;
    // …组件定义（纯函数、无副作用）…
    return {
      inject: ['slots', 'locale', 'configForms'],
      apply(ctx) { /* 只在 apply 里注册 slot / 样式 / 监听 */ },
    };
  },
});
```

- 官方模板全文：`dsh-agent-preset/skills/cordis-plugin-development/templates/decoration/client.js`（22 行）。
- `factory` 必须**无副作用**：样式注入、定时器、事件监听一律放 `apply`，用 `ctx.effect(...)`/`ctx.on(...)` 注册并返回清理函数（`references/practices.md`、`references/ui-plugin.md`）。
- 非基线运行时 import 必须在 `package.json` 的 `dsh.client.external` 里声明；`react` 属基线，直接从 module table `require`。
- **禁止** `require('@deepseek-ai/dsh-client-ui-primitives')`，也禁止把任何 Harness Client 包当模块加载（`dsh.client.inject` 只做激活排序，仍允许）——`references/practices.md` UI 段。

### D.2 `ctx.slots.inject` / `ctx.slots.register`

- `inject(key, callback)`：等该 slot 的声明出现才执行 `callback`；声明塌陷则自动 dispose；返回 disposer（`dsh-client-ui-renderer/lib/client.js:1368-1427`）。
- 回调可以返回 generator，逐条 `yield` 多个注册（`dsh-client-ui-chat/lib/client.js:13312-13328`）。
- `register(options, component)` 实际是 `ctx.effect(() => this._register(...))`（`:1813-1816`），`options` 支持：
  - `name`：slot 名（必填）
  - `id`：list 内的稳定标识（必填，用于 key/排序）
  - `key`：keyed slot 的键（`plugins.bundle.config` 必填）
  - `order`：数字，升序渲染
  - `label`：函数 `() => string`，随语言变化（`settings.section`、`plugins.item` 用）
  - `locale`：该条目的 locale namespace
  - `inject`：`() => ({ hooks: {...}, ...props })`，`hooks` 里的每个键会变成组件的 `useXxx` 选择器 prop；session scope 下 `inject` 还会收到 session key 作为第一个参数（`:435-458`、`:463-489`）
  - `store`：函数或句柄，用于跨注册共享状态
- 组件 props：session scope 的 slot 自动注入 `sessionId` 与 `use*` 钩子、`t`（语言函数，locale revision 变化时 identity 改变以触发重渲染，`:542-558`）。

### D.3 slot 清单（按用途分组，均为实装声明）

- **对话区**：`conversation.composer`、`conversation.composer.bar`、`conversation.composer.dock`、`conversation.input.dock`、`conversation.input.activity`、`conversation.input.overlay`、`conversation.input.attachments`、`conversation.input.model`、`conversation.input.permission`、`conversation.input.plan`、`conversation.chat.*`（`node`/`flow`/`turnTail`/`reasoning.body`/`assistant-actions`/`message.images`/`user.images`）、`conversation.header`、`conversation.session.header.*`（`header`/`actions`/`corner`/`utilities`）、`conversation.hero.agentPreset`、`conversation.hero.workspace`、`conversation.approval.detail`、`conversation.view`、`conversation.session`
- **外壳/侧栏**：`root`、`main`、`main.conversation`、`shell.leading`（single，已占用）、`shell.overlay`、`shell.quota-notice`、`sidebar`、`sidebar.brand.mark`、`sidebar.brand.name`、`sidebar.footer.action`、`sidebar.panellist`、`sidebar.settings`、`sidebar.toggle.badge`、`sidebar.workspaces`、`sidebar.right.pane.tab`、`rightbar`、`rightbar.session`、`workspace.toast`
- **设置**：`settings.section`、`settings.general.item`、`settings.launcher`、`settings.onboarding`、`settings.trigger`、`settings.header`、`settings.action`、`settings.close`、`settings.plugins.tab`
- **插件页**：`plugins.tab`、`plugins.item`、`plugins.bundle.config`、`plugins.bundle.activation`、`plugins.add.actions`
- **其它**：`tool.call.toolview`、`tool.call.images`、`deliverables.file.actions`

---

## E. 主题 token 与禁止事项

### E.1 用法

- 只允许用 `--dsw-alias-*` 系列（以及 `--dsw-static-*` 里明确给插画用的）上色；**字面颜色只用于艺术图形**（`references/practices.md`）。
- 明暗切换由宿主在 `body[data-ds-dark-theme]` 上切变量，插件不要自己判断主题（`dsh-client-ui-theme/lib/client.js:1413` 内的暗色块）。
- 字体走 `--dsh-font-family-text-default` 等基础变量（`:1407` 的 `:root`）。
- token 改名只会让外观降级，不会破坏渲染；但抄宿主控件时必须：类名换自己的前缀、只保留 `--dsw-alias-*` 引用、保留 `role="switch"` + `aria-checked`、Modal 的焦点陷阱与 Escape、Tooltip 位置。
- 权威清单用 `cordis_inspect_query` 的 `Theme` 现场查；离线参考：`dsh-client-ui-theme/lib/client.js` 内共 107 个 `--dsw-alias-*`。

### E.2 常用 token 分组（本项目会用到）

| 用途 | token |
| --- | --- |
| 文字 | `--dsw-alias-label-primary` / `-secondary` / `-tertiary` / `-caption` / `-dimmed` |
| 背景 | `--dsw-alias-bg-base`、`--dsw-alias-bg-layer-1` / `-2` / `-3`、`--dsw-alias-bg-overlay` |
| 边框 | `--dsw-alias-border-l1` / `-l2` / `-l3` / `-l4` |
| 卡片 | `--dsw-alias-settings-card-fill`、`--dsw-alias-settings-card-stroke` |
| 按钮 | `--dsw-alias-button-primary-fill`、`-primary-hover`、`--dsw-alias-button-ghost-active-fill`、`-ghost-active-border`、`--dsw-alias-button-floating-fill`、`-floating-hover`、`--dsw-alias-button-tool-bar-fill`、`-tool-bar-hover` |
| 交互态 | `--dsw-alias-interactive-bg-hover`、`-active`、`-hover-solid` |
| 开关 | `--dsw-alias-switch-thumb`（轨道用 `button-primary-fill`） |
| 状态 | `--dsw-alias-state-success` / `-error` / `-warn` / `-idle` |
| 焦点 | `--dsw-focus-ring-width`、`--dsw-focus-ring-color`、`--dsw-focus-ring-offset`（`:1416`） |
| 菜单 | `--dsw-alias-menu-icon`、`--dsw-alias-menu-group-header-fill` |
| Tooltip | `--dsw-alias-tooltip-bg`、`-label`、`-key-bg` |

### E.3 禁止事项（逐条）

1. 禁止 `require('@deepseek-ai/dsh-client-ui-primitives')` 或把任何 Harness Client 包当模块加载。
2. 禁止 iframe（拿不到主题 token、明暗切换、`ctx.locale`）。
3. 禁止替换 app root、禁止往 `document.body` 追加第二个应用、禁止在组件外写 DOM。
4. 禁止读别的插件的 DOM / CSS / 组件源码来估算位置。
5. 禁止在 `factory` 里做副作用（样式、定时器、监听器都进 `apply` + `ctx.effect`）。
6. 禁止自造字面颜色做 UI 上色（仅艺术图形可用）。
7. 禁止写死中文文案：可见文本必须走 Client locale 服务（`ctx.locale.register(ns, {zh, en})` + `t()`）。
8. 禁止在 volatile 字段上再套 volatile，或把整棵 Config 包成 volatile（`schemastery/lib/index.cjs:246`）。

---

## F. 最小可用实现骨架

### F.1 包结构

```
dsh-language-guard/
├─ package.json
├─ cordis.patch.yml
├─ index.js          # Host 半：Config + configure + 注入
├─ client.js         # Client 半：设置页 + 快速切换
├─ locale/
│  ├─ zh.json
│  └─ en.json
└─ icon.svg
```

```json
{
  "name": "@58fly/dsh-language-guard",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./index.js",
    "./client": "./client.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  },
  "files": ["index.js", "client.js", "cordis.patch.yml", "locale/*.json", "icon.svg"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": ["@deepseek-ai/dsh-client-ui-conversation"]
    }
  }
}
```

```yaml
# cordis.patch.yml
- insert:
    - id: language-guard
      name: '@58fly/dsh-language-guard'
```

### F.2 Client 半骨架（设置页 + 快速切换）

```js
window.__ModuleLoader__.load({
  id: '@58fly/dsh-language-guard',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'language-guard';

    function LanguageGuardCard({ t, useForm }) {
      // useForm = slot inject 注入的选择器；实际取 controller 用 ctx.configForms
      const snap = useForm((s) => s);
      const strength = snap?.value?.strength ?? 'strong';
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } }, [
        h('label', { key: 'l', style: { color: 'var(--dsw-alias-label-primary)' } }, t('strength')),
        h('select', {
          key: 's',
          value: strength,
          onChange: (e) => useForm.set('strength', e.target.value),
          style: {
            background: 'var(--dsw-alias-bg-layer-2)',
            color: 'var(--dsw-alias-label-primary)',
            border: '1px solid var(--dsw-alias-border-l2)',
            borderRadius: 6, padding: '4px 8px',
          },
        }, [
          h('option', { key: 'basic', value: 'basic' }, t('strength.basic')),
          h('option', { key: 'strong', value: 'strong' }, t('strength.strong')),
          h('option', { key: 'periodic', value: 'periodic' }, t('strength.periodic')),
        ]),
        // 每档说明：schema 无法承载，必须自己写
        h('p', { key: 'd', style: { color: 'var(--dsw-alias-label-tertiary)', margin: 0 } },
          t(`strength.${strength}.desc`)),
      ]);
    }

    function QuickLanguageSwitch({ t, useForm, wide }) {
      return h('button', {
        type: 'button',
        'aria-label': t('quickSwitch'),
        title: t('quickSwitch'),
        onClick: () => useForm.cycleLanguage(),
        style: {
          display: 'flex', alignItems: 'center', gap: 6,
          color: 'var(--dsw-alias-label-secondary)',
          background: 'transparent', border: 'none', cursor: 'pointer',
          padding: wide ? '4px 8px' : 4, borderRadius: 6,
        },
      }, [h('span', { key: 'i', 'aria-hidden': true }, '文'), wide ? h('span', { key: 'x' }, t('quickSwitch')) : null]);
    }

    return {
      inject: ['slots', 'locale', 'configForms'],
      apply(ctx) {
        const NS_LOCALE = NS;
        ctx.effect(() => ctx.locale.register(NS_LOCALE, {
          zh: { strength: '强制强度', 'strength.basic': '基础', 'strength.strong': '强化', 'strength.periodic': '周期',
                'strength.strong.desc': '每轮都要求简体中文思考。', quickSwitch: '切换语言' },
          en: { strength: 'Strength', 'strength.basic': 'Basic', 'strength.strong': 'Strong', 'strength.periodic': 'Periodic',
                'strength.strong.desc': 'Requires Simplified-Chinese reasoning on every turn.', quickSwitch: 'Switch language' },
        }));

        // 1) 设置页：组合包配置
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config',
          key: '@58fly/dsh-language-guard',   // 组合包包名
          locale: NS_LOCALE,
          inject: () => ({ hooks: { form: /* 见下 */ } }),
        }, LanguageGuardCard));

        // 2) 快速切换：侧栏底部常驻按钮
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'language-guard-switch',
          locale: NS_LOCALE,
        }, QuickLanguageSwitch));
      },
    };
  },
});
```

> 注：上面 `useForm` 的具体接线（`ctx.configForms.get(entryId)` → `ConfigFormController` → `subscribe/getSnapshot/set`）在实现票里补全；
> 契约已在本文 A/B/C 节给全（`dsh-client-ui-settings/lib/client.js:1103-1244`、`:1294`）。

### F.3 验证清单

- [ ] `dsh.client.platform = "web"`、`immediately: true`、`inject` 指向对话 UI 包，页面打开无 `slot entry crashed` 控制台报错。
- [ ] 设置页出现「语言守卫」卡片，三个字段可读写；改完刷新页面值仍在（已持久化进 profile patch）。
- [ ] 改强度后**不重载插件**即生效：Host 侧下次读 `ctx.config.strength.get()` 为新值（可加临时日志验证 `loader/volatile-update`）。
- [ ] 快速切换按钮在侧栏展开/折叠（`wide` 为 true/false）两种形态下都不溢出。
- [ ] 中英文界面下所有可见文案都跟着变（无硬编码中文）。
- [ ] 深色/浅色主题下颜色均来自 `--dsw-alias-*`，无写死颜色（艺术图形除外）。
- [ ] 卸载插件后设置页与侧栏按钮都消失（`ctx.effect` 清理生效）。

---

## 附：本次调研的关键否定结论（避免后续踩坑）

1. 不存在「schema 自动生成控件」的设置页渲染器 —— 配置页必须自己写 React。
2. `autoGenerate` 只是协议标志，当前 GUI 无消费者；不要指望 `{auto: true}` 能自动出表单。
3. volatile 引用只有 `get()`；写入只能走 `settings` 表单/`configForms.mutate`，由 Loader 提交。
4. `shell.leading` 是 `single`，已被 sidebar 占用，第三方插件不要抢。
5. `plugins.bundle.config` 的 `key` 是**组合包包名**，不是插件行 id；行级配置用 `plugins.row.config` + `包名#行id`。
6. 官方 experimental 包自己 `require` 了 `@deepseek-ai/dsh-client-ui-primitives`，但那是 Harness 自带包的特权；**第三方插件被明令禁止**，必须自写控件。
