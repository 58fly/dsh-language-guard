<!-- DSH-IDEMPOTENCY-KEY: deck-plan-dsh-language-guard-map-v1-child-decide-manifest -->
<!-- parentKey: 01 -->
<!-- created: 2026-10-18T13:16:25.075Z -->
# 决策：包结构与 manifest 规范

定下完全符合官方 host-plugin.md 的包结构。

要定的事：
1. 目录结构与文件清单（含 `index.js` / `client.js` / `cordis.patch.yml` / `locale/*.json` / `icon.svg`）。
2. `package.json` 的完整字段：`name`、`version`、`type`、`exports`（含 `./client`、`./locale/*.json`、`./icon`）、`files` 白名单、`engines.dsh`、`dsh.manifestVersion`、`dsh.bundle.patch`、`dsh.client`（`platform`/`immediately`/`inject`）、`keywords`（含 `dsh-plugin`）、`repository`、`author`、`license`。
3. `cordis.patch.yml` 的内容（`- insert:` 一条自己的行）。
4. `locale/en.json` 与 `locale/zh.json` 的键结构（`meta.title`/`meta.description` 及面板文案键）。
5. 图标方案（SVG 内容，≤256KiB）。
6. 版本号起点。

产出：写入 `docs/decisions/03-manifest.md`，含完整 `package.json` 与各文件骨架。

完成标准：实现者可直接落盘，无需查规范。

## 进度

- 2026-10-18：完成包结构与 manifest 决策，产出落盘 `docs/decisions/03-manifest.md`（r2，721 行）。
- 依赖 #06（`01-mechanism.md`，Config 字段名唯一真源）已关闭；Client 半身契约以 `docs/decisions/02-panel.md` 11.2 为准。
- **r2 修订**：推翻 r1 的「纯 Host bundle」结论，改为「Host + Client 双半身」。原因是 DSH 不存在「schema → 表单」自动渲染器，没有 `client.js` 用户在面板上看不到任何配置控件。
- 已关闭本票。

Status: resolved
Type: task
Blocked by: #06
Labels: wayfinder:task

## Comments

### local — 2026-10-18T14:11:01.791Z
**票面 C 节的 yaml 代码块有格式损失**：deck 的 markdown 后端把 `#` 开头的行当标题剥空了，所以票面里那段 patch 只剩 `- insert:` 两行。

**完整带注释原文以 `docs/decisions/03-manifest.md` 第 4 节为准**（该节给出可逐字照抄的 YAML，含 5 行英文说明注释）。功能上两行就够——注释纯属说明性质，不影响 Loader 解析；实现时按文档第 4 节写。


## Answer

**完整决策已落盘：`/Volumes/data/dsh-cn-think/docs/decisions/03-manifest.md`（r2，721 行）。** 该文档是唯一真源（逐字段理由、`package.json` 全文、patch 原文、locale 原文、icon 原文、验证脚本、风险表、实现者照抄清单）。以下为结论摘要；两者不一致时以文档为准并回改本文。

---

### A. 包根布局与 `files` 白名单

仓库根 = npm 包根（不另建子目录），`npm publish` 直接在根执行。

| 路径 | 入 npm 包 | 入 git | 说明 |
|---|---|---|---|
| `lib/index.js` | 是 | 是 | `apply()` / `Config` / `inject` 声明 |
| `lib/text.js` | 是 | 是 | 三档约束文案，逐字来自 `01-mechanism.md` 第 3 节 |
| `lib/state.js` | 是 | 是 | 运行时状态：当前档位、`/language` 的内存覆盖值（**不含轮次计数**） |
| `lib/commands.js` | 是 | 是 | `/language` 命令注册（懒注入 `commands` 服务） |
| `lib/cycle.js` | 是 | 是 | D 档周期提醒（注册 `agent/pre-step` waterfall） |
| `client.js` | 是 | 是 | **Client 半身**：设置页配置卡片 + 快速语言切换按钮 |
| `cordis.patch.yml` | 是 | 是 | bundle patch 层 |
| `locale/en.json`、`locale/zh.json` | 是 | 是 | 插件显示元数据 |
| `icon.svg` | 是 | 是 | 插件图标 |
| `package.json` | 是 | 是 | npm 强制包含，无需列进 `files` |
| `README.md`、`README.zh.md`、`LICENSE` | 是 | 是 | 双语 README + MIT 全文 |
| `scripts/verify-manifest.mjs` | 否 | 是 | 开发期 manifest 断言脚本 |
| `docs/`、`issues/`、`asar_tool.py` | 否 | 是 | 决策调研文档、票面快照、本地 asar 排查工具 |
| `asar_header.json`、`.agent-teams/`、`node_modules/` | 否 | 否 | 机器特定提取物 / 团队运行时状态 / 零依赖不会出现 |

**为什么用 `files` 白名单而不是 `.npmignore`**：`files` 存在时 npm 完全忽略 `.npmignore`；白名单下新增目录默认不进包，黑名单下新增目录默认泄漏。只用 `files`。

**为什么不搬 `docs/` 与 `issues/`**：已有票面与验收清单把路径写死成 `docs/decisions/...`，搬家只换来「根目录好看一点」却造成跨票连锁改动。用白名单排除即可。

---

### B. `package.json` 完整字段表（含三个必须避开的坑）

| 字段 | 值 | 理由 |
|---|---|---|
| `name` | `dsh-language-guard` | 团队指定包名；实测 registry 返回 404，未被占用 |
| `version` | `0.1.0` | 起点。`0.x` 表示 Config 字段未冻结；`1.0.0` 等字段冻结后再打 |
| `description` | 见文档第 3 节 | npm 搜索与 locale 缺失时兜底；英文，≤200 字符 |
| `type` | `module` | 宿主以 ESM 加载；CJS 会让 `export function apply` 直接语法错误 |
| `main` | `./lib/index.js` | 给忽略 `exports` 的老读取方留路 |
| `exports["."]` | `./lib/index.js` | Loader 按包名插入行时解析到这里（验收 A2） |
| `exports["./client"]` | `./client.js` | **必须有**（验收 A6 / D1） |
| `exports["./locale/*.json"]` | 同名映射 | Plugin Manager 与设置页读 locale 必须走导出 |
| `exports["./icon"]` | `./icon.svg` | 官方文档给出的标准读取路径 |
| `exports["./package.json"]` | `./package.json` | 安装器与面板要读原始 manifest，不导出会被挡住 |
| `icon` | `icon.svg` | 顶层 `icon` 优先级高于 `./icon`，两条路径都覆盖 |
| `files` | 见 A 节 | 白名单 |
| `engines.node` | `^22.19.0 \|\| >=24.0.0` | 随包 Node 为 24.21.0；22.19 是 ESM 稳定基线 |
| `engines.dsh` | `>=0.2.1-rc.2` | **关键**：声明后 DSH 只用它判兼容，完全忽略 peer 范围（验收 A5） |
| `dsh.manifestVersion` | `1` | manifest 格式版本，与 npm 版本、Session 格式无关（验收 A4） |
| `dsh.bundle.patch` | `./cordis.patch.yml` | 声明本包是 bundle（验收 A3） |
| `dsh.client` | `{ platform: "web", immediately: true, inject: [ui-settings, ui-sidebar, ui-plugin-manager] }` | **必须声明**，否则浏览器端永不加载 `./client` |
| `peerDependencies` | 3 项，见 D 节 | 文档化宿主依赖 |
| `peerDependenciesMeta` | 3 项均 `{ optional: true }` | 阻止 pnpm 去 registry 拉宿主包 |
| `publishConfig.access` | `public` | 防被用户级 `.npmrc` 的 `access=restricted` 影响（验收 R18） |
| `keywords` | 含 `dsh-plugin`、`deepseek-harness` | npm 搜索命中（验收 R12） |
| `author` / `license` | `58fly` / `MIT` | 与 `LICENSE` 一致（验收 R5） |
| `repository` | `git+https://github.com/58fly/dsh-language-guard.git` | 面板与 dshmarket 的 GitHub 检查读它（验收 R9） |
| `homepage` / `bugs` | 对应 GitHub 地址 | npm 页面链接 |
| `private` | **必须不存在** | 见坑 1（验收 R22） |
| `scripts` / `dependencies` / `devDependencies` | **都不声明** | 无构建、无测试框架、零依赖 |

**三个必须避开的坑**

1. **`private: true`**：官方模板 `templates/decoration/package.json` 与 `templates/mcp/package.json` **都自带这一行**（模板是本地安装用的）。照抄后 `npm publish` 直接报 `This package has been marked as private`。发布前必须删，验证脚本把存在 `private` 判为硬失败（验收 R22）。
2. **`engines.dsh` 写成 `workspace:` 或空串**：app-boot README 第 52 行明确「empty or invalid ranges, including a `workspace:` value in `engines.dsh`, are incompatible」——会被判不兼容而拒绝挂载。
3. **`dsh.client` / `exports["./client"]` / `files` 里的 `client.js` 三处必须同时存在**：缺任一处，浏览器端加载不到产物，面板上没有任何配置控件，页面控制台报 `slot entry crashed` 或模块解析失败。另外 `client.js` 里 `window.__ModuleLoader__.load({ id })` 的 `id` **必须逐字等于包名**（验收 D2），`platform` 必须是 `web`，`external` 留空（只 `require('react')`，属基线模块）。

---

### C. `cordis.patch.yml` 原文与「整体替换」语义

```yaml

#



#


#






#
- insert:
    - id: dsh-language-guard
      name: dsh-language-guard
```

要点：

- **只插入自己的一行**，`insert` 列表长度为 1，`id` 与包名一致（验收 A8）。不覆盖、不改写他人条目。
- **`name` 写包名而不是相对路径**：包名让 Loader 按 Node 解析规则找到 `exports["."]`；相对路径是「插在 patch 文件旁边」的语义，发布后不成立。
- **不写 `config`**：官方 Loader 的 patch dialect 里，带 `id` 的定向 patch 对 `config` 是**整体替换不深合并**（`cordis-composition-reference/SKILL.md`）。写了就得写全，而默认值本身就是推荐值，没必要在 patch 里重复一遍。用户要覆盖时必须重述整个 config——这一点在 patch 注释里明写，避免用户只写一个字段导致其余字段被抹掉。
- **不加 `disabled`**：用户要停用自己在 profile 层加；插件自带开关会打破「装了就生效」的预期。
- 行元数据只允许 `id` / `name` / `config` / `disabled` / `inject` / `intercept` / `isolate`。服务依赖写在代码的 `export const inject`，不在行里重复。

---

### D. `peerDependencies` 全 optional 的依据

三个 peer：`@deepseek-ai/cordis >=4.0.5`、`@deepseek-ai/dsh-llm >=0.2.1-rc.2`、`@deepseek-ai/schemastery >=3.18.2`。

**不需要**声明 `@deepseek-ai/dsh-system-prompt`：`ctx.systemPrompt.section()` 是**服务调用**不是 import，服务名通过 `export const inject = ['systemPrompt']` 声明即可。

两条事实决定了「全 optional + 范围写宽」：

1. **兼容判定只看 `engines.dsh`**：app-boot README 第 52 行——「When the manifest declares `engines.dsh`, that range alone decides and `peerDependencies` are ignored」。所以 peer 范围写宽写窄都不影响能否挂载，只影响 npm 元数据。
2. **宿主已提供解析**：桌面启动器把 `desktop-runtime.json` 里 `sharedPackages` 列出的包（含 `cordis`、`schemastery`、`dsh-llm`、`dsh-system-prompt`、`dsh-commands`）链接进 profile 的 `.dsh-module-fallback/node_modules`。实测 profile 的 `node_modules/@deepseek-ai/` 下**只有 `cosmokit` 与 `schemastery` 两个实体包**，其余全靠这个 fallback——这也是 `@nanmicoder/dsh-agent-teams` 能 `import { createUserMessage } from '@deepseek-ai/dsh-llm'` 且**没有 dependencies、没有嵌套 node_modules** 的原因。

标 `optional: true` 的作用是阻止 pnpm 在 `dsh plugin add` 时去 registry 拉这些宿主包（离线安装会失败，且拉到的副本可能与宿主版本不一致）。

---

### E. `scripts/verify-manifest.mjs` 的职责

**它是开发期工具，不进 `files`、不进 npm 包**（入 git）。职责是把文档第 9 节的静态断言合并成一个可执行自检：`node scripts/verify-manifest.mjs`。检查项：

1. **manifest 形状**：`private` 不存在、`publishConfig.access === "public"`、`type === "module"`、`dsh.manifestVersion === 1`、`dsh.bundle.patch === "./cordis.patch.yml"`、`engines.dsh` 非空字符串。
2. **client 三处齐备**：`dsh.client` 存在、`platform === "web"`、`immediately === true`、`inject` 非空数组、`external` 未声明；`exports["./client"] === "./client.js"`；`files` 含 `client.js` 与 `lib`。
3. **`client.js` 的模块 id**：从源码正则提取 `__ModuleLoader__.load({ id: "..." })`，与 `package.json.name` 逐字比对；并断言源码里没有 `require('@deepseek-ai/dsh-client-ui-primitives')`。
4. **文件存在性**：`lib/index.js`、`client.js`、`cordis.patch.yml`、`icon.svg`、`locale/en.json`、`locale/zh.json`、`README.md`、`README.zh.md`、`LICENSE`；`exports` 里非通配的键都指向存在的文件。
5. **icon 合法性**：≤ 256 KiB、以 `<svg` 开头。
6. **locale 完整性**：`en`/`zh` 两份都有非空的 `meta.title` 与 `meta.description`。
7. **patch 形状**：含 `- insert:` 段且 `name:` 指向本包。

> **注意**：r1 版本里这句 `if (p.dsh?.client) die("本包不应有 dsh.client")` **必须删掉并反转**——不改的话，实现者跑自检会把正确的包判成失败。文档 9.1 已给出改后的完整断言。

**发布前必须人工跑的四步**（全不依赖 `npx`；`npm` 命令用 `npm_config_cache="$(mktemp -d)"` 绕开本机 root 归属 cache 的 `EPERM`）：

```bash
node scripts/verify-manifest.mjs
node --check lib/index.js && node --check client.js   # 逐文件语法检查
npm_config_cache="$(mktemp -d)" npm pack --dry-run --json   # 核对打包清单
dsh plugin --profile <干净 profile> add dsh-language-guard   # 唯一权威验证
```

---

### F. `.gitignore`、locale 与 icon

**`.gitignore` 原文**：

```gitignore

.agent-teams/


asar_header.json


node_modules/


.DS_Store
*.log
```

**locale 两个文件**（只有 `meta.title` / `meta.description`，配置项说明不放这里）：

| 文件 | `meta.title` | `meta.description` |
|---|---|---|
| `locale/en.json` | `Language Guard` | `Keeps model reasoning and replies in Simplified Chinese: three strength levels, configurable prompt placement, periodic reminders, and a panel with a quick language switch.` |
| `locale/zh.json` | `中文语言守卫` | `强制模型用简体中文思考与回复：基础 / 强化 / 周期三档强度、可配置的约束落点、周期性自检提醒，并支持面板与侧栏快速切换语言。` |

文件名必须是 `en.json` / `zh.json`（不带地区，面板按主语言标签匹配）；缺 `meta.title` 会回退成包名 `dsh-language-guard`，回退不算失败但会显示成英文，所以两份都必须写。

**组件文案不走这两个文件**：Client 半身的可见文案（字段名、三档说明、按钮 aria-label）必须走 `ctx.locale.register('languageGuard', { zh, en })`，两份字典 key 集合必须完全一致，禁止写死中文（验收 D9）。三档说明文案逐字取自 `01-mechanism.md` 第 2.1 节（验收 F3 比对两处）。

**icon**：包根 `icon.svg`，约 330 字节，纯几何「中」字（`viewBox="0 0 1024 1024"`、底板 `rect` 圆角 216 填 `#2F6FED`、白色描边「口」+ 白色竖线），原创、MIT。格式与体积硬约束：SVG/PNG/JPEG/WebP，≤ 256 KiB，必须在包内，绝对路径/URL/指向包外的符号链接一律拒绝；必须是原创或有再分发许可的作品。

---

### G. 与 `02-panel.md` 的对齐（r2 新增）

Client 半身的具体契约以 `docs/decisions/02-panel.md` 为准，本文只定 manifest 侧的接入点：

- `dsh.client.inject` 填三个**声明方**包名：`@deepseek-ai/dsh-client-ui-settings`（提供 `configForms`）、`@deepseek-ai/dsh-client-ui-sidebar`（声明 `sidebar.footer.action`）、`@deepseek-ai/dsh-client-ui-plugin-manager`（声明 `plugins.bundle.config`）。它只作 graph row 的排序提示透传，不参与 `orderByModuleGraph` 建边（该函数只遍历 `external`），因此指向未安装的包也不报错。
- Client locale namespace 用 `languageGuard`；快速切换按钮注册 `sidebar.footer.action`、`id: 'language-guard'`、`order: 100`。
- **不调用** `ctx.locale.addLanguage`：它用于新增一种**界面**语言，宿主已内置 `zh`/`en`，本插件没有新增界面语言的职责。
- 不注册 `plugins.item`、`plugins.row.config`、`settings.section`、`conversation.composer.dock`。

---

### H. 实现者不需要再判断的事项

目录结构、`package.json` 每个字段的值、`files` 白名单、patch 原文、locale 原文、icon 原文、`.gitignore` 原文、验证命令、`dsh.client` 的三个 inject 包名——全部已定死。实现者只需照 `docs/decisions/03-manifest.md` 第 3–6 节与第 12 节「照抄清单」落盘，然后跑第 9 节的验证。