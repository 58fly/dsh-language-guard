# 决策 03：包结构与 manifest 规范

- 状态：已定稿（全部字段已按官方文档与实机 manifest 核对，无待定项）
- 版本：**r2**（2026-10-18 修订：由「纯 Host bundle」改为「Host + Client 双半身」；变更记录见文末附录）
- 对应 wayfinder 票：#09「决策：包结构与 manifest 规范」（父票 #01）
- 上游依赖：#05（已关闭，order 落点）——本文只引用其结论；#06（`docs/decisions/01-mechanism.md`，Config 字段名与文案唯一真源）；#03（`docs/decisions/02-panel.md`，Client 半身与面板契约唯一真源）
- 下游消费者：#08（README 双语）、实现票、`docs/验收清单.md` 的 A1–A8 / R14 / F13
- 本文与 `01-mechanism.md` 分工：**01 管「说什么」（三档文案、order、schema 字段），03 管「怎么装」（目录、manifest、patch、locale、icon、发布）**。两份文档冲突时，文案与 schema 以 01 为准，打包与元数据以本文为准。

---

## 0. 结论速览

| 决策点 | 结论 |
|---|---|
| 包类型 | **Host + Client 双半身 bundle**：Host 半（`lib/`）+ Client 半（`client.js`），**无构建步骤、零运行时依赖** |
| 入口 | Host：`exports["."] = "./lib/index.js"`；Client：`exports["./client"] = "./client.js"` |
| 包名 / 版本 | `dsh-language-guard` / `0.1.0`（npm 上未占用，实测 registry 返回 404） |
| 仓库 | `https://github.com/58fly/dsh-language-guard` |
| `private` | **必须缺席**。官方模板自带 `private: true`，照抄会让 `npm publish` 直接被拒 |
| 发布可见性 | `publishConfig.access: "public"` |
| 兼容声明 | 只靠 `engines.dsh`（`>=0.2.1-rc.2`）。**一旦声明它，DSH 就完全忽略 `peerDependencies` 的版本范围**（app-boot README 第 52 行） |
| peer 依赖 | 声明但**全部 `optional: true`**，只作文档用；解析由宿主的 `.dsh-module-fallback` 兜底 |
| 配置入口 | **必须自带 client 半身**：DSH 没有「schema → 表单」自动渲染器，设置页与快速切换都由 `client.js` 自绘 React（见 2.2） |
| Client 装载 | `dsh.client = { platform: "web", immediately: true, inject: [ui-settings, ui-sidebar, ui-plugin-manager] }`（`02-panel.md` 11.2 定案）；`window.__ModuleLoader__.load({ id: "dsh-language-guard" })` |
| 快速语言切换 | `sidebar.footer.action` 槽位上的自绘按钮（**不是**宿主斜杠命令——斜杠命令不进面板控件） |
| locale | `locale/en.json` + `locale/zh.json`，各含 `meta.title` / `meta.description` |
| icon | 包根 `icon.svg`，纯几何「中」字，< 1 KiB，原创、MIT |
| 白名单 | `files` 只放运行时资源；`docs/`、`issues/`、`scripts/`、`.agent-teams/`、`asar_*` 全部排除 |
| 验证 | 纯 `node` + `npm pack --dry-run`（**不依赖 npx**，并用 `npm_config_cache` 绕开 root 归属 cache 的 EPERM） |

---

## 1. 包根布局

仓库根 = npm 包根（不另建子目录），`npm publish` 直接在根执行。

| 路径 | 入 npm 包 | 入 git | 说明 |
|---|---|---|---|
| `lib/index.js` | ✅ | ✅ | `apply()` / `Config` / `inject` 声明 |
| `lib/text.js` | ✅ | ✅ | 三档约束文案，逐字来自 `01-mechanism.md` 第 3 节 |
| `lib/state.js` | ✅ | ✅ | 运行时状态：当前档位、`/language` 的内存覆盖值（**不含轮次计数**——D 档的轮次取自 `agent/pre-step` payload） |
| `lib/commands.js` | ✅ | ✅ | `/language` 命令注册（懒注入 `commands` 服务） |
| `lib/cycle.js` | ✅ | ✅ | D 档周期提醒（注册 `agent/pre-step` waterfall，见 `01-mechanism.md` 第 6.2 节） |
| `client.js` | ✅ | ✅ | **Client 半身**：设置页配置卡片 + 快速语言切换按钮（见 2.2） |
| `cordis.patch.yml` | ✅ | ✅ | bundle patch 层，见第 4 节 |
| `locale/en.json` | ✅ | ✅ | 英文显示元数据 |
| `locale/zh.json` | ✅ | ✅ | 简体中文显示元数据 |
| `icon.svg` | ✅ | ✅ | 插件图标 |
| `package.json` | ✅ | ✅ | npm 强制包含，无需列进 `files` |
| `README.md` | ✅ | ✅ | 英文主 README（GitHub 默认展示） |
| `README.zh.md` | ✅ | ✅ | 简体中文 README |
| `LICENSE` | ✅ | ✅ | MIT 全文 |
| `scripts/verify-manifest.mjs` | ❌ | ✅ | 开发期 manifest 断言脚本（见第 9 节），不发布 |
| `docs/` | ❌ | ✅ | 决策与调研文档（本文件所在目录） |
| `issues/` | ❌ | ✅ | wayfinder 票面快照 |
| `asar_tool.py` | ❌ | ✅ | 读 `app.asar` 的本地排查工具，见 1.2 |
| `asar_header.json` | ❌ | ❌ | 5 MB 机器特定提取物，`.gitignore` 排除 |
| `.agent-teams/` | ❌ | ❌ | 团队运行时状态（含 inbox），`.gitignore` 排除 |
| `node_modules/` | ❌ | ❌ | 本项目零依赖，正常不会出现；仍预先排除 |

### 1.1 为什么 `docs/` 与 `issues/` 不搬走

已有票面与 `docs/验收清单.md` 把路径写死成 `docs/decisions/01-mechanism.md`、`docs/research/01-section-orders.md`。搬家会造成跨票连锁改动，收益只有「根目录好看一点」。**保持根级，用 `files` 白名单排除**——`files` 是白名单，未列出的一律不进包，比逐个 `.npmignore` 排除安全得多（后者是黑名单，新增目录会默认泄漏）。

### 1.2 `asar_tool.py` 与 `asar_header.json`

两者是本地读 `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar` 的排查工具（`python3 asar_tool.py cat|ls|tree|grep <path>`）。`asar_header.json` 是 5 MB 的 asar 头提取物，机器特定，**必须 gitignore**；`asar_tool.py` 只有几 KB，保留在根（其他成员的命令仍在用它，搬走会打断正在进行的调研）。

`.gitignore` 内容：

```gitignore
# 团队运行时状态（含 inbox 消息），不入库
.agent-teams/

# asar 排查工具的 5 MB 提取物，机器特定
asar_header.json

# 零依赖项目，正常不会出现
node_modules/

# 本地环境
.DS_Store
*.log
```

### 1.3 不用 `.npmignore`

`files` 存在时 npm 完全忽略 `.npmignore`。同时存在两套规则只会让人猜「到底哪套生效」。**只用 `files`**。

---

## 2. `package.json` 完整字段表

| 字段 | 值 | 为什么必须是这个值 |
|---|---|---|
| `name` | `"dsh-language-guard"` | 团队目标指定的开源包名；不带 scope，`npm install dsh-language-guard` 可直接装。实测 `https://registry.npmjs.org/dsh-language-guard` 返回 404，未被占用。**注（后续定案）**：实际分发走 GitHub Git 地址，npm registry 未发布（出口 IP 被 Cloudflare 风控，见 `docs/发布说明.md` 第一节）；包名仍保持无 scope，便于将来恢复 npm 发布 |
| `version` | `"0.1.0"` | 首个可发布版本。`0.x` 表示 API 未冻结（Config 字段还可能加），符合 SemVer |
| `description` | 见第 3 节原文 | npm 搜索与 `locale` 缺失时的兜底文案；英文，≤ 200 字符 |
| `type` | `"module"` | 宿主以 ESM 加载插件；CJS 会让 `export function apply` 直接语法错误 |
| `main` | `"./lib/index.js"` | 给忽略 `exports` 的老读取方留一条路；与 `exports["."]` 指向同一文件，无歧义 |
| `exports["."]` | `"./lib/index.js"` | Loader 按包名插入行时解析到的就是这里（验收 A2） |
| `exports["./locale/*.json"]` | 同名映射 | Plugin Manager 与设置页读 locale 必须走导出（验收 A6） |
| `exports["./client"]` | `"./client.js"` | **必须有**。Client 半身的标准读取路径（验收 A6 / D1） |
| `exports["./icon"]` | `"./icon.svg"` | `./icon` 是官方文档给出的标准读取路径（验收 A6） |
| `exports["./package.json"]` | `"./package.json"` | 安装器与面板要读原始 manifest；不导出会被 `exports` 挡住 |
| `icon` | `"icon.svg"` | 顶层 `icon` 优先级高于 `./icon`，两条读取路径都覆盖；与 `dsh-context` 实际做法一致 |
| `files` | 见第 3 节 | 白名单，只放运行时资源 |
| `engines.node` | `"^22.19.0 \|\| >=24.0.0"` | 本机随包 Node 为 `24.21.0`；22.19 是 ESM 稳定基线。与 `dsh-context` 取同值 |
| `engines.dsh` | `">=0.2.1-rc.2"` | **关键字段**：声明后 DSH 只用它判定兼容，忽略 peer 范围（验收 A5）。当前运行时 `0.2.1-rc.2` 满足；预发布版参与范围匹配，后续 `0.3.x-rc.*` 不会被误判 |
| `dsh.manifestVersion` | `1` | manifest 格式版本，与 npm 版本、Session 格式版本无关（验收 A4） |
| `dsh.bundle.patch` | `"./cordis.patch.yml"` | 声明本包是 bundle，并指向 patch 文件（验收 A3） |
| `dsh.client` | `{ platform: "web", immediately: true, inject: ["@deepseek-ai/dsh-client-ui-settings", "@deepseek-ai/dsh-client-ui-sidebar", "@deepseek-ai/dsh-client-ui-plugin-manager"] }` | **必须声明**，否则浏览器端永远不加载 `./client`，用户看不到任何配置控件。`inject` 填三个**声明方**包名（`02-panel.md` 11.2），只作排序提示、不建边，指向未安装包也不报错；`external` 留空 |
| `peerDependencies` | 3 项，见第 3 节 | 文档化「我依赖这些宿主包」，全部 optional |
| `peerDependenciesMeta` | 3 项均 `{ "optional": true }` | 阻止 pnpm 自动安装宿主包（宿主已通过 fallback 提供），并避免离线/无网安装失败 |
| `publishConfig.access` | `"public"` | 无 scope 包默认就是 public，但显式声明可防止被用户级 `.npmrc` 的 `access=restricted` 影响 |
| `keywords` | 见第 3 节 | npm 搜索命中 |
| `author` | `"58fly"` | GitHub 账号 |
| `license` | `"MIT"` | 开源最省事的许可；与本仓库 `LICENSE` 一致 |
| `repository` | `git+https://github.com/58fly/dsh-language-guard.git` | npm 页面显示源码链接，`dshmarket` 与 Plugin Manager 的 GitHub 检查也读它 |
| `homepage` | `https://github.com/58fly/dsh-language-guard#readme` | npm 页面「Homepage」 |
| `bugs` | `https://github.com/58fly/dsh-language-guard/issues` | npm 页面「Issues」 |
| `private` | **必须不存在** | 见 2.1 |
| `scripts` | **不声明** | 无构建、无测试框架。`scripts.verify` 之类会把开发命令塞进发布包语义里，用第 9 节的命令行即可 |
| `devDependencies` / `dependencies` | **都不声明** | 零依赖，见第 8 节 |

### 2.1 三个必须避开的坑

1. **`private: true`**：官方模板 `templates/decoration/package.json` 与 `templates/mcp/package.json` 都自带这一行（模板是本地安装用的）。照抄后 `npm publish` 直接报 `This package has been marked as private`。**发布前必须删掉**，`scripts/verify-manifest.mjs` 会把存在 `private` 判为失败。
2. **`engines.dsh` 写成 `workspace:` 或空串**：app-boot README 第 52 行明确「empty or invalid ranges, including a `workspace:` value in `engines.dsh`, are incompatible」——会被判不兼容而拒绝挂载。
3. **`dsh.client` 漏了 `./client` 导出，或 `files` 漏了 `client.js`**：宿主会去加载一个不存在的浏览器产物，插件行报 `cannot resolve`，页面控制台出 `slot entry crashed`。三处必须同时存在：`dsh.client` 声明、`exports["./client"]`、`files` 里的 `client.js`（9.1 已把三者列成联合断言）。

### 2.2 为什么必须带 client 半身

**结论先给：DSH 不存在「schema → 表单」的自动渲染器。插件不提供 client 半身，用户在面板上就看不到任何配置控件。**

官方 `dsh-client-ui-plugin-manager/README.zh.md` 原文：

> 注册了配置页的插件在这里、在它自己的页面上编辑；设置里只保留只读的插件列表。

> 自带配置的插件把配置渲染在本页而不是设置里，通过本页声明的三个 slot：`plugins.item`（list）用于官方插件……`plugins.bundle.config`（以组合包的包名为键）用于组合包自己的配置……`plugins.row.config`（以 `<包名>#<行 id>` 为键）用于某一行的配置……页面用 `view: 'page'` 渲染带自己保存控件的表单。

界面调研（`docs/research/03-settings-panel.md` 第 A.3 节）独立核实到三条硬事实：

1. `autoGenerate` 只出现在 `dsh-settings/lib/index.js`（5 处，全是存储/透传）与协议 zod 描述里，`dsh-web-frontend` 的 index bundle 里出现 **0 次**——没有任何消费者。
2. `volatileForm`（`dsh-settings/lib/index.js:122-131`）只**投影** volatile 子树成 plain schema，它产出的是数据不是控件。
3. 逐个 `dsh-client-ui-*` 的 `client.js` 里都没有「按 `schema.type` 分派控件」的代码。

因此：**`.volatile()` 仍然必须写**（它是「这个字段可被面板写入」的开关，也是 `ConfigFormController.set()` 能成功的条件），但**光有 volatile 不会长出界面**，界面必须自己写。

#### 2.2.1 Client 装载契约

```js
// client.js —— 第一行就是契约，id 必须逐字等于 package.json 的 name
window.__ModuleLoader__.load({
  id: 'dsh-language-guard',
  factory(require) {
    const React = require('react');   // 从 browser module table 取，禁止自装 React
    const h = React.createElement;
    return {
      inject: ['slots', 'locale', 'configForms'],
      apply(ctx) { /* 所有注册都放这里 */ },
    };
  },
});
```

硬规则（`references/ui-plugin.md` 与 `practices.md` UI 段）：

- `id` **必须等于包名**（验收 D2）。写成 `@58fly/dsh-language-guard`、`language-guard` 等都会导致模块表找不到入口。
- `factory` 必须**无副作用**：样式、定时器、监听器一律放 `apply`，用 `ctx.effect` / `ctx.on` 注册并返回清理函数。
- **禁止** `require('@deepseek-ai/dsh-client-ui-primitives')`，也禁止把任何 Harness Client 包当模块加载（官方 experimental 包自己 require 是 Harness 自带包的特权）。
- **禁止**替换 app root、禁止往 `document.body` 追加第二个应用、禁止在组件外写 DOM。
- `react` 属基线模块，直接 `require` 即可，**不需要**写进 `dsh.client.external`（`external` 只用于非基线运行时 import）。本包没有非基线 import，故 `external` **不声明**。
- `dsh.client.inject` 填**声明方**包名：`@deepseek-ai/dsh-client-ui-settings`（提供 `configForms`）、`@deepseek-ai/dsh-client-ui-sidebar`（声明 `sidebar.footer.action`）、`@deepseek-ai/dsh-client-ui-plugin-manager`（声明 `plugins.bundle.config`）。它只作 graph row 的排序提示透传，**不参与** `orderByModuleGraph` 建边（该函数只遍历 `external`），因此指向未安装的包也不会报错（`dsh-client-modules/lib/index.js:66-74`、`:407`、`:433-437`、`:743`）。
- **不要**把 `@deepseek-ai/dsh-client-ui-primitives` 写进 `inject` 或 `external`：`practices.md` 明令禁止把它当模块加载，而且该包在安装树里根本不存在。

#### 2.2.2 本插件的 slot 注册表（两个，都在 `apply` 里）

| 用途 | slot | kind / scope | 注册键 | 说明 |
|---|---|---|---|---|
| 配置卡片 | `plugins.bundle.config` | `keyed` / root | `key` = **组合包包名** `dsh-language-guard` | 渲染在「插件 → 本组合包」详情页，包名与行 id 不同，别写混；外层包 `ctx.configForms.whileServed(['dsh-language-guard'], …)` |
| 快速语言切换 | `sidebar.footer.action` | `list` / root | `id` = `language-guard`、`order` = `100` | 侧栏底部常驻按钮，`wide` prop 区分展开/折叠两种形态；外层同样 `whileServed` |

**为什么配置页选 `plugins.bundle.config` 而不是 `settings.section`**：`plugins.bundle.config` 与本机已验证的官方 `dsh-experimental-client-ui-cot-translation`（`lib/client.js:996-1011`）完全同构，键语义最明确；`settings.section` 会在左侧导航多一个独立分区，属于「更显眼」的可选项，**首版不做**（多一个注册点就多一处 UI 回归面）。

**为什么快速切换选 `sidebar.footer.action`**：

- 它是 `list` / root scope，可多注册、全局常驻、官方 cordis 插件（`dsh-client-ui-cordis/lib/client.js:1411-1425`）就在这放按钮。
- `shell.leading` 是 **`single`** 且已被 sidebar 的 `HeaderLeadingControls` 占用，抢不到位置。
- `conversation.composer.dock` 只在会话页渲染（`variant === 'composer'` 且 `sessionId` 存在），首页与无会话时看不到——作为**加分项**再加一份注册可以，但不能作为唯一入口。

**`/language` 斜杠命令与面板按钮的分工**：命令（`lib/commands.js`）保留，但它是**输入框里的快捷方式**，不是「面板上的快速语言切换」。用户要求的「快速语言切换」由 `sidebar.footer.action` 按钮承担；README 与面板说明都要按这个分工写，不能拿斜杠命令冒充面板控件。

注册写法：

```js
apply(ctx) {
  // 配置卡片：等 slot 声明出现才注册；声明塌陷时自动 dispose
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config',
    key: 'dsh-language-guard',      // 组合包包名
    locale: 'languageGuard',        // 见 2.2.4
    inject: () => ({ hooks: { form: /* ConfigFormController 选择器 */ } }),
  }, LanguageGuardCard));

  // 快速切换：侧栏底部
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'language-guard',
    order: 100,
    locale: 'languageGuard',
  }, QuickLanguageSwitch));
}
```

`ctx.slots.inject(key, cb)` 等该 slot 的声明出现才执行 `cb`，声明塌陷时自动 dispose（`dsh-client-ui-renderer/lib/client.js:1368-1427`）；`register()` 内部就是 `ctx.effect(...)`，随插件卸载自动清理（`:1813-1816`）。

#### 2.2.3 写入链路（为什么面板改值能立刻生效）

```
用户点「周期」
  └─ Client: ctx.configForms.get('<Host entry id>').set('strength', 'D')
       └─ mutate([{op:'set', path:['strength'], value:'D'}])     // dsh-client-ui-settings/lib/client.js:1140
            └─ ctx.remote.settings.mutate(ns, ops, revision)      // :1165-1170
                 └─ Host: Settings.write(ns, change, expected, paths)   // dsh-settings/lib/index.js:501-537
                      └─ configEditor.edit(entry, …) → 持久化进 profile 的 Cordis patch
                           └─ Loader: equalExceptVolatile(prev, next, schema)  // cordis-plugin-loader/lib/index.js:285
                                → fiber._config = next; _commitVolatile()      // :382-384
                                     → updateVolatile(ref, source) → emit 'loader/volatile-update'  // :422
                                          └─ Host 半下次 config.strength.get() 即新值（无需 remount）
```

要点：

- **不要**试图在插件里 `config.strength.set(...)`：volatile 引用只有 `get()`，写入符号 `Symbol.for('cosmokit.volatile.write')` 只由 owning runtime 使用（`cosmokit/lib/types/volatile.js:28-34`）。
- 写入被拒（版本冲突 `SETTINGS_CONFLICT` / 字段不可写）时 `mutate` 会 `recover()` 重读并抛错，**UI 必须显示错误**，不能假装成功（验收 D5/D6 同源要求）。
- 外部改配置时（另一个窗口、profile patch 手改），监听 `settings/document-updated` 同步刷新（官方 cot-translation `lib/client.js:911` 同款）。

#### 2.2.4 可见文案走 Client locale，不进 `locale/*.json`

两套东西不要混：

| | `locale/*.json` | Client locale 服务 |
|---|---|---|
| 谁读 | Plugin Manager / 设置页的**插件元数据**（包标题、包描述） | 插件自己的**组件文案**（字段名、三档说明、按钮 aria-label） |
| 内容 | 只有 `meta.title` / `meta.description` | 任意键值 |
| 注册方式 | 文件 + `exports["./locale/*.json"]` | `ctx.locale.register('languageGuard', { zh: {...}, en: {...} })` |
| 本项目要求 | 见第 5 节 | **禁止写死中文**：所有可见文案都从字典取（验收 D9） |

`ctx.locale.register(ns, {zh, en})` 返回 disposer，必须放进 `ctx.effect`；`fallback` 链必须终止于 `en`（`dsh-client-locale/lib/client.js:1351-1369` 的 `assertFallbackChain`）。

**关键约束：三档的说明文案无法靠 schema 表达。** `schemastery` 的 `toJSON` 只带字段级 `meta.description`，`z.union([z.const('B'), …])` 的每个分支没有 per-option 描述。所以「B 基础 / C 强化 / D 周期」三句说明必须写在 Client locale 字典里，并按当前选中档位切换显示——这三句的**正文逐字取自 `docs/decisions/01-mechanism.md` 第 2.1 节**（验收 F3 比对两处措辞）。

#### 2.2.5 代价与收益

| | 说明 |
|---|---|
| 收益 | 用户真的能在面板上看到并修改配置；三档说明可以逐档解释（schema 做不到）；快速切换是真按钮 |
| 代价 | 多一个 `client.js`（约 200–300 行，手写、无构建）；要遵守主题 token（只用 `--dsw-alias-*`）、locale、slot 生命周期三套规则；验收多出 D1/D2/D7/D9/D10 五条浏览器侧检查 |
| 不加构建 | 官方模板 `templates/decoration/client.js` 就是手写的 `__ModuleLoader__.load` 形式，22 行。本插件照这个形式手写即可，**不引入 bundler** |

---

## 3. `package.json` 原文（可直接照抄）

```json
{
  "name": "dsh-language-guard",
  "version": "0.1.0",
  "description": "Enforce Simplified Chinese reasoning and replies in DeepSeek Harness: three strength levels, configurable prompt sections, periodic reminders, a settings panel with a quick language switch.",
  "type": "module",
  "main": "./lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./client.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg",
    "./package.json": "./package.json"
  },
  "icon": "icon.svg",
  "files": [
    "lib",
    "client.js",
    "cordis.patch.yml",
    "locale/*.json",
    "icon.svg",
    "README.md",
    "README.zh.md",
    "LICENSE"
  ],
  "engines": {
    "node": "^22.19.0 || >=24.0.0",
    "dsh": ">=0.2.1-rc.2"
  },
  "dsh": {
    "manifestVersion": 1,
    "bundle": {
      "patch": "./cordis.patch.yml"
    },
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": [
        "@deepseek-ai/dsh-client-ui-settings",
        "@deepseek-ai/dsh-client-ui-sidebar",
        "@deepseek-ai/dsh-client-ui-plugin-manager"
      ]
    }
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": ">=4.0.5",
    "@deepseek-ai/dsh-llm": ">=0.2.1-rc.2",
    "@deepseek-ai/schemastery": ">=3.18.2"
  },
  "peerDependenciesMeta": {
    "@deepseek-ai/cordis": {
      "optional": true
    },
    "@deepseek-ai/dsh-llm": {
      "optional": true
    },
    "@deepseek-ai/schemastery": {
      "optional": true
    }
  },
  "publishConfig": {
    "access": "public"
  },
  "keywords": [
    "dsh",
    "dsh-plugin",
    "deepseek-harness",
    "chinese",
    "language",
    "locale",
    "system-prompt",
    "i18n"
  ],
  "author": "58fly",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/58fly/dsh-language-guard.git"
  },
  "homepage": "https://github.com/58fly/dsh-language-guard#readme",
  "bugs": {
    "url": "https://github.com/58fly/dsh-language-guard/issues"
  }
}
```

### 3.1 三个 peer 依赖的依据

| 包 | 为什么需要 | 版本下限来源 |
|---|---|---|
| `@deepseek-ai/schemastery` | `lib/index.js` 要 `import z from '@deepseek-ai/schemastery'` 才能导出 `Config` | 本机共享包实测 `3.18.5` |
| `@deepseek-ai/dsh-llm` | D 档注入要用 `createUserMessage()` 构造 user 消息 | 运行时 `0.2.1-rc.2` |
| `@deepseek-ai/cordis` | 插件宿主框架本身（`ctx` / `ctx.effect` / `Service`） | 本机实测 `4.0.5` |

**不需要**声明 `@deepseek-ai/dsh-system-prompt`：`ctx.systemPrompt.section()` 是**服务调用**，不是 import；服务名通过 `export const inject = ['systemPrompt']` 声明即可。

### 3.2 为什么 peer 全部 optional、且范围写宽

两条事实决定了这个写法：

1. **兼容判定只看 `engines.dsh`**：app-boot README 第 52 行——「When the manifest declares `engines.dsh`, that range alone decides and `peerDependencies` are ignored」。所以 peer 范围写宽写窄都不影响能否挂载，只影响 npm 元数据。
2. **宿主已提供解析**：桌面启动器把 `desktop-runtime.json` 里 `sharedPackages` 列出的包（含 `cordis`、`schemastery`、`dsh-llm`、`dsh-system-prompt`、`dsh-commands`）链接进 profile 的 `.dsh-module-fallback/node_modules`，插件 `import '@deepseek-ai/schemastery'` 就能解析。**profile 的 `node_modules/@deepseek-ai/` 下只有 `cosmokit` 与 `schemastery` 两个实体包，其余全靠这个 fallback**——这也是 `@nanmicoder/dsh-agent-teams` 能 `import { createUserMessage } from '@deepseek-ai/dsh-llm'` 的原因。

标 `optional: true` 的作用是阻止 pnpm 在 `dsh plugin add` 时去 registry 拉这些宿主包（离线安装会失败，且拉到的副本可能与宿主版本不一致）。

---

## 4. `cordis.patch.yml` 原文

```yaml
# dsh-language-guard 的 bundle patch 层。
#
# 这一行把本包的主入口（exports["."]）挂成一个宿主插件。
# 这里故意不写 config：所有 Config 字段都有 schema 默认值，
# 改配置的正确位置是设置面板，或用户自己的 profile patch 层。
#
# 要在自己的 profile patch 里覆盖，必须重述整个 config ——
# patch 对 config 是整体替换，不做深合并：
#
#   - id: dsh-language-guard
#     name: dsh-language-guard
#     config:
#       targetLanguage: zh-CN
#       strength: C
#       injectEveryNRounds: 8
#
- insert:
    - id: dsh-language-guard
      name: dsh-language-guard
```

要点：

- **只插入自己的一行**，`insert` 列表长度必须为 1，`id` 与包名一致（验收 A8）。不覆盖、不改写他人条目。
- **`name` 写包名**（不是相对路径）。包名会让 Loader 按 Node 解析规则找到 `exports["."]`；相对路径是「插在 patch 文件旁边」的语义，发布后不成立。
- **不写 `config`**。理由：写了就得写全（整体替换语义），而且默认值就是推荐的默认档（`01-mechanism.md` 第 5 节），没必要在 patch 里重复一遍。
- **`disabled` 不加**。用户要停用自己在 profile 层加，插件不自带开关——否则「装了就生效」这条预期会被打破。
- 行元数据只允许 `id` / `name` / `config` / `disabled` / `inject` / `intercept` / `isolate`；`inject` 是 Loader 行的服务依赖声明，本插件把服务依赖写在代码里的 `export const inject`，不在行里重复。

---

## 5. locale 两个文件的 meta 文案（原文）

### 5.1 `locale/en.json`

```json
{
  "meta": {
    "title": "Language Guard",
    "description": "Keeps model reasoning and replies in Simplified Chinese: three strength levels, configurable prompt placement, periodic reminders, and a /language switch."
  }
}
```

### 5.2 `locale/zh.json`

```json
{
  "meta": {
    "title": "中文语言守卫",
    "description": "强制模型用简体中文思考与回复：基础 / 强化 / 周期三档强度、可配置的约束落点、周期性自检提醒，并支持 /language 快速切换。"
  }
}
```

### 5.3 规则

- 只放 `meta.title` 与 `meta.description`，字段名固定（`PluginLocalizedMeta`）。**不要**把插件配置项写进 locale——配置项说明来自 schemastery 的 `meta.description`（`01-mechanism.md` 第 4 节）。
- 两个文件的 `title` **必须不同语言但同一含义**，不能一边写「Language Guard」一边写「中文语言守卫（测试）」这种对不上的话（验收 F3 会比对档位说明与面板文案的一致性）。
- 缺 `meta.title` 会回退到 `package.json` 的 `name`（显示成 `dsh-language-guard`），缺 `description` 回退到 `package.json` 的 `description`（英文长句）。**回退不算失败，但会被面板显示成英文**，所以两个文件都必须写。
- 文件名必须是 `en.json` / `zh.json`，靠 `exports["./locale/*.json"]` 暴露。
- 格式化 JSON 时**不要加注释**（JSON 不支持），也不要用 `zh-CN.json` 这种带地区的名字——面板按主语言标签匹配。

---

## 6. icon 方案

### 6.1 硬约束（来自 `references/host-plugin.md` 第 51 行）

- 允许格式：SVG / PNG / JPEG / WebP，**上限 256 KiB**。
- 必须留在包内；绝对路径、URL、指向包外的符号链接都会被拒。
- 必须是**原创作品**，或使用允许再分发的授权作品并保留署名。**不接受**从网上随手下载的图标。
- 文件名本身不代表内容合法：SVG 必须真的能被渲染。

### 6.2 方案：纯几何「中」字

不用字体、不嵌位图、不引用外部资源。`中` 字本身就是「一个方框 + 一条贯穿的竖线」，用两个 `<rect>` 就能画准，缩小到 16 px 仍然可辨——这正是插件行图标需要的。

`icon.svg` 原文（约 330 字节）：

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="中文语言守卫">
  <rect x="32" y="32" width="960" height="960" rx="216" fill="#2F6FED"/>
  <rect x="276" y="316" width="472" height="392" rx="72" fill="none" stroke="#FFFFFF" stroke-width="76"/>
  <rect x="468" y="176" width="88" height="672" rx="44" fill="#FFFFFF"/>
</svg>
```

几何说明：

- `viewBox="0 0 1024 1024"` 与 `dsh-context` 一致，面板按正方形渲染时无留白差异。
- 底板 `960×960`、圆角 `216`（约 22.5%），与 DSH 其他插件图标的圆角观感接近。
- 「口」：`276,316 → 748,708`，中心 `(512,512)`，白色描边 76。
- 竖线：`468,176 → 556,848`，中心 x = 512；上下各露出 140，比例接近印刷体「中」。
- 竖线在「口」之后绘制，白压白无接缝。
- 前景 `#FFFFFF` 与底板 `#2F6FED` 对比度约 5.1:1，深色/浅色主题下都可辨。

### 6.3 不需要的东西

- 不需要 PNG 副本（SVG 已足够，且多一份文件就多一处可能过期）。
- 不需要 `favicon`、`social-preview` 之类营销素材——那是仓库侧的事，不进 npm 包。
- 不在 `files` 之外放图标副本。

---

## 7. README 双语方案

| 文件 | 语言 | 说明 |
|---|---|---|
| `README.md` | 英文 | GitHub 默认展示、npm 页面正文。首行写 `English \| [简体中文](README.zh.md)` |
| `README.zh.md` | 简体中文 | 首行写 `[English](README.md) \| 简体中文` |

与 DSH 官方包（`README.md` / `README.zh.md`）命名一致，不发明 `README.en.md`。

正文由票 #08 撰写，但**必须包含以下章节**（本文只定骨架，不定正文措辞）：

1. 这是什么 / 解决什么问题（一句话 + 一张面板截图位）
2. 安装（`dsh plugin --profile <name> add dsh-language-guard`，以及从本地目录装）
3. 三档强度说明 —— **逐字对齐 `01-mechanism.md` 第 2、3 节**，不得自行改写档位描述（验收 F3 比对这两处）
4. 配置项表格（字段名、类型、默认值、说明，与 `01-mechanism.md` 第 4 节一致）
5. 面板与快速切换：设置路径 `设置 → 插件 → dsh-language-guard`（`plugins.bundle.config`）+ 侧栏底部切换按钮（`sidebar.footer.action`）；`/language` 斜杠命令作为输入框快捷方式一并说明
6. **与已有中文插件共存**（见 7.1）
7. 合规说明：只用 `ctx.systemPrompt.section()`，不监听 `system-prompt/assemble`，不改写 `llm/stream` 的 reasoning-delta
8. 失效模式与排查（对应 `01-mechanism.md` 第 8 节）
9. License

### 7.1 「与已有中文插件共存」章节要点（必写）

本机第三方插件 `dsh-context` 已占用 order `-2000` 与 `11200`，与本插件**完全撞值**：

- **不会报错**：排序是 `order - order || compareNames(name)`，撞 order 不撞 name。`"dsh-context:prompt-prefix" < "language-guard:head"`（`d` < `l`），dsh-context 的两段排在本插件之前，共存稳定。
- **但会重复烧 token**：两者都在做语言约束，等于同一段意思写两遍。
- **建议**：装本插件后把 dsh-context 的 `promptPrefix` / `promptSuffix` 清空，或直接停用 dsh-context。
- **本插件不检测、不改写 dsh-context 的配置**——跨插件写配置违反最小惊讶原则。

---

## 8. 零依赖、零构建

| 问题 | 结论 |
|---|---|
| 用 TypeScript 吗 | **不用**。纯 ESM JavaScript（Host 半）+ 手写 `__ModuleLoader__.load`（Client 半）。带类型就得带 `tsdown`/`tsc` 构建，发布包要么带 sourcemap 要么带 `lib/types`，验收要多一条「构建产物与源码一致」。这个插件约 700 行，类型收益远小于链路成本 |
| 用 bundler 吗 | **不用**。官方模板 `templates/decoration/client.js` 就是 22 行手写的 `window.__ModuleLoader__.load({ id, factory(require) })`，本插件照这个形式手写 `client.js`；Host 半由宿主直接 import 源码。`react` 从 browser module table 取，没有非基线 import，所以既不需要打包也不需要 `dsh.client.external` |
| 用 zod 吗 | **不用**。Config 用 `@deepseek-ai/schemastery`（`01-mechanism.md` 第 4 节），它是 DSH 设置面板唯一认识的 schema 方言。引 zod 会让面板渲染不出表单 |
| `dependencies` | 空。Host 半的宿主能力通过服务（`ctx.systemPrompt`、`ctx.settings`、`agent/pre-step`）与共享包（`@deepseek-ai/schemastery`、`@deepseek-ai/dsh-llm`）获得；Client 半只 `require('react')`，从宿主模块表取，**不新增依赖** |
| 锁文件 | 不产生。零依赖就没有 lockfile；将来若加 devDeps 再入库 |

---

## 9. 验证步骤（全部不依赖 npx）

**背景**：本机 npm cache 有 root 归属目录，直接跑 `npm` 会报 `EPERM`；`npx` 更会连带失败。下面的命令**不用 npx**，且凡是用到 `npm` 的都把 cache 指到临时目录绕开该问题（已实测可用）。

### 9.1 manifest 形状断言（纯 node，无文件依赖）

```bash
node -e '
const fs = require("node:fs");
const p = JSON.parse(fs.readFileSync("package.json", "utf8"));
const die = (m) => { console.error("FAIL:", m); process.exit(1); };
if ("private" in p) die("private 必须不存在，否则 npm publish 被拒");
if (p.name !== "dsh-language-guard") die("name 不符");
if (!/^\d+\.\d+\.\d+/.test(p.version)) die("version 不是 SemVer");
if (p.type !== "module") die("type 必须是 module");
if (p.publishConfig?.access !== "public") die("publishConfig.access 必须是 public");
if (p.dsh?.manifestVersion !== 1) die("dsh.manifestVersion 必须是 1");
if (p.dsh?.bundle?.patch !== "./cordis.patch.yml") die("dsh.bundle.patch 不符");
if (typeof p.engines?.dsh !== "string" || !p.engines.dsh) die("engines.dsh 缺失");
// client 半身：三处必须同时存在，缺一处浏览器端就加载不到
if (!p.dsh?.client) die("本包必须有 dsh.client，否则面板上没有配置控件");
if (p.dsh.client.platform !== "web") die("dsh.client.platform 必须是 web");
if (p.dsh.client.immediately !== true) die("dsh.client.immediately 必须是 true");
if (!Array.isArray(p.dsh.client.inject) || p.dsh.client.inject.length === 0) die("dsh.client.inject 不能为空");
if (p.dsh.client.external !== undefined) die("本包无非基线 import，不应声明 dsh.client.external");
if (p.exports?.["./client"] !== "./client.js") die("缺 exports[\"./client\"]");
if (!p.files.includes("client.js")) die("files 必须包含 client.js");
if (!p.files.includes("lib")) die("files 必须包含 lib 目录");
for (const f of ["lib/index.js","client.js","cordis.patch.yml","icon.svg","locale/en.json","locale/zh.json","README.md","README.zh.md","LICENSE"])
  if (!fs.existsSync(f)) die("缺文件 " + f);
// client.js 的模块 id 必须逐字等于包名（验收 D2）
const cl = fs.readFileSync("client.js", "utf8");
const idm = cl.match(/__ModuleLoader__\.load\(\s*\{[\s\S]*?id:\s*["']([^"']+)["']/);
if (!idm) die("client.js 里找不到 __ModuleLoader__.load({ id: ... })");
if (idm[1] !== p.name) die("client.js 的 id 必须等于包名，实际是 " + idm[1]);
if (/require\(\s*["']@deepseek-ai\/dsh-client-ui-primitives["']\s*\)/.test(cl)) die("禁止 require dsh-client-ui-primitives");
for (const [k, v] of Object.entries(p.exports))
  if (k !== "." && !k.includes("*") && !fs.existsSync(v)) die("exports " + k + " 指向不存在的文件");
const iconSize = fs.statSync("icon.svg").size;
if (iconSize > 256 * 1024) die("icon 超过 256 KiB");
const head = fs.readFileSync("icon.svg", "utf8").trimStart();
if (!head.startsWith("<svg")) die("icon.svg 不是 SVG");
console.log("manifest OK", p.name, p.version, "icon=" + iconSize + "B");
'
```

### 9.2 locale 与 patch 断言

```bash
node -e '
const fs = require("node:fs");
for (const l of ["en", "zh"]) {
  const m = JSON.parse(fs.readFileSync("locale/" + l + ".json", "utf8")).meta;
  if (!m?.title || !m?.description) throw new Error(l + " 的 meta.title/description 缺失");
}
console.log("locale OK");
'
node -e '
const y = require("node:fs").readFileSync("cordis.patch.yml", "utf8");
if (!/^\s*-\s*insert:/m.test(y)) throw new Error("缺 insert 段");
if (!/name:\s*dsh-language-guard/m.test(y)) throw new Error("insert 行未指向本包");
console.log("patch OK");
'
```

### 9.3 语法检查（不执行、不解析依赖）

```bash
node --check lib/index.js && node --check lib/text.js && node --check lib/state.js \
  && node --check lib/commands.js && node --check lib/cycle.js \
  && node --check client.js && echo "语法 OK"
```

实测：Node ≥ 22 的 `--check` 会按 `package.json` 的 `type: module` 自动识别 ESM，坏文件返回退出码 1。若某天行为变化，用兜底写法（只解析不执行，不解析 import）：

```bash
node --experimental-vm-modules -e '
const vm = require("node:vm"), fs = require("node:fs");
for (const f of ["lib/index.js","lib/text.js","lib/state.js","lib/commands.js","lib/cycle.js","client.js"])
  new vm.SourceTextModule(fs.readFileSync(f, "utf8"));
console.log("ESM 解析 OK");
'
```

### 9.4 发布包文件清单（绕开 EPERM）

```bash
npm_config_cache="$(mktemp -d)" npm pack --dry-run --json
```

实测可用（npm 10.9.8）。检查点：

- 列表里**只能**出现 `lib/*.js`、`client.js`、`cordis.patch.yml`、`locale/*.json`、`icon.svg`、`package.json`、`README.md`、`README.zh.md`、`LICENSE`。
- **`client.js` 必须在列表里**：漏了它，`dsh.client` 声明指向一个不存在的浏览器产物，面板控件永远不出现。
- **不能**出现 `docs/`、`issues/`、`scripts/`、`.agent-teams/`、`asar_tool.py`、`asar_header.json`。
- 若出现白名单外的文件，说明 `files` 漏了或多了，先修再发（验收 A7）。

### 9.5 真实验证（唯一权威）

上面都是静态检查。**装进干净 profile 跑一次**才是权威判定（验收 A5 / R14）：

```bash
dsh plugin --profile <干净 profile> add dsh-language-guard
```

返回体里**不得出现 `incompatible-version`**；随后用 `cordis_inspect_query` 确认本插件的行是 `application: applied`（不是 `list_plugins`），再打开设置页确认面板与图标。

### 9.6 关于 `scripts/verify-manifest.mjs`

把 9.1–9.3 的三段断言合并成一个脚本，作为提交前自检（`node scripts/verify-manifest.mjs`）。它是**开发期工具**，不进 `files`。t6 只定这条契约，脚本由实现票创建。

---

## 10. 版本与发布流程

1. `version` 从 `0.1.0` 起。Config 字段增删（破坏性）→ 升 minor；纯文案/修复 → 升 patch。`1.0.0` 在 Config 字段冻结后再打。
2. 发布前按顺序跑 9.1 → 9.2 → 9.3 → 9.4，全绿再发。
3. `npm publish`（`publishConfig.access` 已声明 public；**不要**加 `--access` 参数，也不要 `--dry-run` 后就以为发过了）。
4. GitHub 侧：仓库 `58fly/dsh-language-guard`，推 tag `v0.1.0`，Release 说明取 README 摘要。`CHANGELOG.md` 首版不做（Release 承担），避免手工维护的第二份真源。
5. 发布后回填：README 里的版本徽章（如果有）与 `dshmarket` 索引由后续票处理，不在本文范围。

---

## 11. 失效风险与回退

| 风险 | 观测信号 | 处理 |
|---|---|---|
| 照抄模板留下 `private: true` | `npm publish` 报 `marked as private` | 删字段；9.1 已把它列为硬失败 |
| `engines.dsh` 写成 `workspace:` 或空串 | 安装返回 `incompatible-version`，或启动时行被 deny | 改回 `>=0.2.1-rc.2`；这是 app-boot README 明示的非法值 |
| `files` 漏文件 | 9.4 的清单里缺文件；或安装后 import 失败 | `files` 补上；`lib` 整目录白名单已覆盖新增模块，不会漏 |
| `files` 多文件 | 9.4 出现 `docs/` 等 | 从 `files` 删；不要改用 `.npmignore` 黑名单 |
| `exports` 漏 `./package.json` | 安装器/面板读 manifest 失败 | 补回导出 |
| locale 文件名带地区（`zh-CN.json`） | 面板不显示中文标题 | 改成 `zh.json` |
| icon 超过 256 KiB 或不是合法图像 | 面板显示默认图，或诊断报错 | 用第 6 节原文（< 1 KiB） |
| peer 未标 optional | 离线/无网环境 `dsh plugin add` 失败 | 三项都标 `optional: true` |
| 宿主升级后插件被判不兼容 | 安装返回 `incompatible-version` | `engines.dsh` 放宽；或用户用 `dsh plugin version-exemptions allow-version` 临时豁免（需 `--accept-risk`） |
| 与本机 `dsh-context` 重复占 order | 无报错，只是多烧 token | README 7.1 的共存建议 |
| `client.js` 漏出 `files` 或漏写 `exports["./client"]` | 面板上看不到任何控件；页面控制台 `slot entry crashed` 或模块解析失败 | 9.1 已把「`dsh.client` / `exports["./client"]` / `files` 三者同时存在」列为联合断言 |
| `client.js` 的 `id` 与包名不一致 | 浏览器端模块表找不到入口，控件不出现 | 9.1 从 `client.js` 里正则提取 `id` 并与 `package.json.name` 比对 |
| client 半里 `require('@deepseek-ai/dsh-client-ui-primitives')` | 运行期模块解析失败 | `practices.md` 明令禁止；9.1 有对应断言 |

---

## 12. 实现者照抄清单

1. 建目录：`lib/`、`locale/`、`scripts/`；包根放 `package.json`、`client.js`、`cordis.patch.yml`、`icon.svg`、`README.md`、`README.zh.md`、`LICENSE`。
2. `package.json` 用第 3 节原文，**逐字**。三处联合自检：`private` 不存在、`publishConfig.access` 是 `public`、`dsh.client` / `exports["./client"]` / `files` 里的 `client.js` **三者同时存在**。
3. `cordis.patch.yml` 用第 4 节原文。
4. `locale/en.json`、`locale/zh.json` 用第 5 节原文。
5. `icon.svg` 用第 6.2 节原文。
6. `lib/index.js` 导出 `apply` / `Config` / `inject = ['systemPrompt']`；`commands` 服务用 `ctx.inject([...])` **懒注册**，不要放进 `export const inject`（否则缺该服务的 profile 会让插件永久 pending，section 永远不注册）。**不需要 `agents` 服务**：D 档直接 `ctx.on("agent/pre-step", ...)`，payload 自带 `agent`。
7. `client.js`：`window.__ModuleLoader__.load({ id: 'dsh-language-guard', factory(require) { const React = require('react'); return { inject: ['slots','locale','configForms'], apply }; } })`。`factory` 内无副作用；两个 slot（`plugins.bundle.config` / `sidebar.footer.action`）与 locale 字典注册全在 `apply` 里，逐条照 `02-panel.md` 第 14 节。**不调用** `ctx.locale.addLanguage`。
8. `.gitignore` 用第 1.2 节原文。
9. 提交前跑 9.1–9.4，全绿再发。

---

## 附：与 `docs/验收清单.md` 的偏差（需质检员同步）

本文定稿后，验收清单里有一处**示例命令**与本包结构不一致（**判定标准本身不冲突**，只有命令需要改）：

| 条目 | 清单现状 | 本包实际 | 建议 |
|---|---|---|---|
| A2 | 示例命令 `node --input-type=module -e "await import('./index.js')"` | 入口是 `./lib/index.js` | 命令改成 `await import('./lib/index.js')`；判定列「`exports["."]` 指向包内实际存在的文件」无需改 |
| A6 | 判定列写「三个键都存在」 | **本包有 `client.js`**（第 2.2 节），`./client`、`./locale/*.json`、`./icon` 三个键都必须存在 | **无需改动**：清单原文就是对的。此前本文曾提议把它改成条件式，该提议已随「不带 client」决策一起作废 |

其余与面板相关的条目（F3 控件形态、F6 快速切换落点、D10 不调 `addLanguage`）的同步要求见 `docs/decisions/02-panel.md` 第 13.2 节，本文不重复。

---

## 附录 A：r2 修订记录（「纯 Host」→「Host + Client 双半身」）

| 版本 | 日期 | 变更 | 原因 |
|---|---|---|---|
| r1 | 2026-10-18 | 初稿：纯 Host bundle、无 `dsh.client`、设置面板由 `Config` 自动渲染、快速切换用宿主命令 | 票 #09 交付 |
| r2 | 2026-10-18 | **包类型改为 Host + Client 双半身**：新增 `client.js`、`exports["./client"]`、`files` 里的 `client.js`、`dsh.client` 段；2.2 节整节重写；9.1 断言由「不应有 `dsh.client`」改为「必须有且三处齐备」；第 12 节补 `client.js` 步骤；风险表补三条 client 相关失效 | r1 的核心前提「DSH 设置页会把 schemastery schema 自动渲染成表单」**是错的**。官方 `dsh-client-ui-plugin-manager/README.zh.md` 明确「注册了配置页的插件在这里、在它自己的页面上编辑；设置里只保留只读的插件列表」；界面调研（`docs/research/03-settings-panel.md` A.3）实测 `autoGenerate` 在 web-frontend bundle 里出现 0 次，`volatileForm` 只投影数据不产控件。没有 client 半身，用户在面板上看不到任何配置控件 |

### A.1 与 `02-panel.md` 13.1 列出的 6 处旧前提的逐处核对

| `02-panel.md` 13.1 指出的位置 | 内容 | 状态 |
|---|---|---|
| `:15` | 结论速览「纯 Host bundle，无 client 半身」 | **已改**：改为「Host + Client 双半身 bundle」 |
| `:23` | 「设置面板由 `Config` 自动渲染；快速切换走宿主命令」 | **已改**：改为「必须自带 client 半身」，并新增「Client 装载」「快速语言切换」两行 |
| `:108` | 字段表 `dsh.client`「**不声明**」 | **已改**：改为「必须声明」，列出完整对象与三处联合要求 |
| `:126` | 坑 3「`dsh.client` 抄进模板值……本包**没有**这个字段」 | **已改**：改为「三处必须同时存在」，保留「模板 inject 值不能照抄」的警告 |
| `:128-135` | 第 2.2 节「为什么不带 client 半身」 | **已整节改写**为「为什么必须带 client 半身」，含 2.2.1 装载契约 / 2.2.2 slot 注册表 / 2.2.3 写入链路 / 2.2.4 locale 分工 / 2.2.5 代价与收益 |
| `:408` | 9.1 断言 `if (p.dsh?.client) die("本包不应有 dsh.client")` | **已改**：改为「必须有 `dsh.client`」+ `platform === "web"` + `immediately === true` + `inject` 非空 + 无 `external` + `exports["./client"]` + `files` 含 `client.js` + 从 `client.js` 正则提取 `id` 与包名比对 + 禁止 `require dsh-client-ui-primitives`。**这条最危险：不改的话实现者跑自检会把正确的包判成失败** |
| `:533`（附录） | 「本包不带 client 是第 2.2 节的明确决策」 | **已改**：A6 恢复无条件要求 `./client`，并注明此前「改成条件式」的提议已作废 |

另外自查出 3 处 13.1 未列出、但同源的残留，一并改掉：

| 位置 | 内容 | 处理 |
|---|---|---|
| 第 8 节「用 bundler 吗」 | 「没有 client 半身就没有必须打包的东西」 | 改为「官方模板就是手写 `__ModuleLoader__.load`，照写即可，不需要打包」 |
| 第 8 节「`dependencies`」 | 只提 Host 半的共享包 | 补「Client 半只 `require('react')`，从宿主模块表取，不新增依赖」 |
| 第 7 节 README 第 5 章 | 「`/language` 快速切换用法」 | 改为「面板与快速切换：设置页 `plugins.bundle.config` + 侧栏按钮 `sidebar.footer.action`；`/language` 作为斜杠快捷方式一并说明」 |
