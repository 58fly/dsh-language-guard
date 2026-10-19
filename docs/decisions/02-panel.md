# 决策 02：设置面板与快速语言切换的交互设计

- 状态：已定稿
- 版本：**r1**（2026-10-18）
- 对应 wayfinder 票：#04「决策：设置面板与快速语言切换的交互设计」（父票 #01）
- 上游依赖：#03（面板官方范式调研）——已关闭，见 `docs/research/03-settings-panel.md`
- 上游依赖：#06（B/C/D 三档机制与配置 schema）——已关闭，见 `docs/decisions/01-mechanism.md`（**唯一真源**，本文的档位文案逐字取自该文 2.1 节）
- 下游消费者：#08（README 面板章节）、#09（包结构：本文第 11 节新增 `client.js` 与 `dsh.client`）、实现票、`docs/验收清单.md` 的 D9/D10/F3/F6/F7
- **本文推翻 `docs/decisions/03-manifest.md` 第 2.2 节的架构前提**，差异清单见第 13 节

本文所有技术结论均有 `app.asar` 内源码取证（路径以 asar 根为基准，行号为实际行号）；纯设计取舍处标注「取舍」并给出理由。**实现者按本文写代码，不需要再问文案或形态。**

---

## 0. 结论速览

| 要定的事 | 结论 | 关键证据 |
| --- | --- | --- |
| 本包要不要 Client 半 | **要**。`docs/decisions/03-manifest.md` 2.2 节「纯 Host bundle」的前提（schema 自动渲染表单）已被 #03 证伪 | `docs/research/03-settings-panel.md` 否定结论 2；`dsh-client-ui-plugin-manager/README.zh.md:71-73` |
| 配置页注册点 | **只注册 `plugins.bundle.config`**，`key = "dsh-language-guard"`（bundle 包名）。**不注册** `plugins.item`、**不注册** `settings.section` | `dsh-cordis-client-runner/lib/client.js:4480-4484`、`:4661-4662`、`:5295-5297` |
| 三档控件形态 | **原生 radio group（三行卡片式单选项）**，不用 `<select>` | 见第 3 节取舍 |
| 三档说明文案落点 | **locale 字典**，每档两条键：`strength.<档>.label` / `strength.<档>.desc`；说明常驻显示在档名下方，**不用 tooltip** | 见第 3.3、4 节 |
| 快速切换控件落点 | `sidebar.footer.action`，`id = "language-guard"`，`order = 100` | `dsh-cordis-client-runner/lib/client.js:5651-5697`；实例 `dsh-client-ui-cordis/lib/client.js:1411-1414` |
| 快速切换控件形态 | 图标 + 当前语言短标签（`wide` 时）；56px rail 时仅图标。点击弹出**下拉菜单**（不循环切换） | 见第 5 节取舍 |
| 语言候选清单 | **5 个预设 + 自定义 BCP-47**：`zh-CN`/`zh-TW`/`en`/`ja`/`ko`；任意合法 BCP-47 标签只能在设置页文本框输入 | 见第 6 节 |
| 即时生效 | 改档/换语言**无需重启、无需提示**；写入成功即生效，下一次 `systemPrompt.assemble()` 自然拿到新文本 | `cordis-plugin-loader/lib/index.js:382-427`；`dsh-system-prompt/lib/index.js:385-393` |
| 是否显示「当前第几轮注入」 | **不显示**。Client 侧没有任何轮次计数投影可读 | `docs/research/03-settings-panel.md`；全树 grep `turnBoundary` 只命中 Host 侧包 |
| 视觉 | 只用 `--dsw-alias-*`；设置卡片专用 `--dsw-alias-settings-card-fill` / `-stroke` | 见第 7 节 token 表 |
| 空态/错误态 | Host 未服务该 namespace → 整块 UI **不注册**（不是显示错误）；写入失败 → 保留用户选择 + `role="alert"` 一行 | 见第 8 节 |

---

## 1. 架构前提修正（必读）

### 1.1 被推翻的假设

`docs/decisions/03-manifest.md` 第 2.2 节的三条论断：

> - **设置面板**：DSH 的设置页直接读插件的 `Config`（schemastery schema）并渲染表单（`dsh-client-ui-settings` 读取 `Config.listConfigs`）。插件只要导出 `export const Config`，面板自动出现，字段说明取 `meta.description`。
> - **快速语言切换**：宿主命令（`commands` 服务）会自动出现在 Web GUI 的斜杠菜单里。
> - 不带 client 的收益：无 `dsh.client` 声明、无构建工具链……**代价**：面板长什么样由 schema 决定，不能自定义控件——对本插件完全够用。

**三条都不成立**：

1. **没有「schema → 控件」的自动表单渲染器。** #03 的否定结论 2：`autoGenerate` 只作为协议字段存在（`dsh-settings/lib/index.js:426`、`dsh-api-remotes/lib/client.js:2789` 的 zod 描述 `"Generate a page if no custom page is registered for this instance."`），**没有任何 UI 消费者**；`dsh-web-frontend/dist/assets/index-CN7NIWNw.js`（921071 字符）里 `autoGenerate` 出现 **0 次**。官方 `dsh-client-ui-plugin-manager/README.zh.md:14`、`:71-73` 明确写配置页由插件自己渲染。
2. **三档必须有每档说明。** 票 #04 的完成标准与验收 F3 都要求「每档有中文说明，且与 `01-mechanism.md` 一致」。schemastery 的 `description` 是**整字段级**（`schemastery/lib/index.cjs:70-83` 的 `toJSON` 只带字段 meta，没有 per-option 描述），无法表达三档各自的说明。
3. **快速切换不能只靠宿主命令。** 验收 F6 要求「控件在 composer 区域可见、可点击」，F7 要求「控件与设置面板表单状态双向同步」。斜杠命令两者都做不到。

### 1.2 因此本包必须带 Client 半

`dsh.client` 字段必须声明，`client.js` 必须存在。`03-manifest.md` 中与之冲突的条目（`:15`、`:23`、`:108`、`:126`、`:128-135`、`:408` 的 `if (p.dsh?.client) die(...)`、`:533` 的 A6 修订）需按第 13 节同步修订。

---

## 2. 面板信息架构

### 2.1 唯一配置页：`plugins.bundle.config`

**决策：只注册 `plugins.bundle.config`，`key = "dsh-language-guard"`。**

证据与理由：

- 该 slot 的官方契约（`dsh-cordis-client-runner/lib/client.js:4480-4484`）：
  > `kind: "keyed"`, `scope: "root"`
  > summary: `"A bundle's own configuration, keyed by the bundle's package name and rendered on the bundle's page between its description and its rows (`view: 'page'` only)."`
- 而 `plugins.item` 的契约（同文件 `:4661-4662`）明确排除了我们：
  > `"OCCUPIED by the official settings pages, one companion package per host-plane namespace; **a bundle's configuration belongs in `plugins.bundle.config` or `plugins.row.config` instead**."`
- 我们只插入**一行**（`cordis.patch.yml` 的 `id: dsh-language-guard`，见 `03-manifest.md:257-258`），所以不需要 `plugins.row.config`（那是 key＝`包名#行 id`，用于 bundle 内多行各自配置）。
- **不注册 `settings.section`**（取舍）：`settings.section` 是「一个设置页对应一个左侧导航项」（`:5295-5297`），现有 5 个占位者是 `agent-presets`/`account`/`general`/`models`/`plugins` 这类**整页偏好**。本插件只有一个 6 字段表单，占一个顶级导航项会稀释导航信噪比，且与「插件自己的配置」这一官方归类冲突。若将来确实需要直达入口，用 `settings.general.item`（单行偏好，`:4969-4970`）而不是 `settings.section`。

渲染时机（`dsh-client-ui-plugin-manager/lib/client.js`）：

```js
// :2961-2965 —— bundle 详情页，且仅当本包注册了该 key
configured ? renderSlot("plugins.bundle.config", { view: "page" }, { entryKey: pkg.name }) : null
// configured = ledger.bundles.has(openPkg.name)，ledger.bundles = keysOf("plugins.bundle.config")（:62、:3059 附近）
```

即：**组件只会以 `view: "page"` 被渲染**；但组件仍必须处理 `view: "summary"`（返回一行摘要），因为这是契约类型（`PluginConfigViewProps.view: 'summary' | 'page'`）的一部分，未来 owner 可能新增 summary 调用点。

用户路径：`设置 → 插件 → dsh-language-guard → （详情页）配置`。

### 2.2 字段表

字段定义与默认值**唯一真源是 `01-mechanism.md` 4.1 节**，此处只定「控件与文案」，不改 schema。

| # | 字段 | 类型 | 控件 | 中文标签 | 英文标签 | 写入时机 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `strength` | `"B"\|"C"\|"D"` | **radio group**（3 行，每行档名 + 说明） | 强度档位 | Strength | 变更即写 |
| 2 | `targetLanguage` | BCP-47 string | **文本框** + 5 个预设快捷 chip | 目标语言 | Target language | 草稿 + 保存按钮 |
| 3 | `injectEveryNRounds` | 3–50 整数 | **number input**（step 1） | 注入间隔（轮） | Injection interval (turns) | 变更即写（`change` 事件，非每次按键） |
| 4 | `preserveCodeTerms` | boolean | **switch**（`role="switch"` + `aria-checked`） | 保留代码与术语原文 | Keep code and technical terms verbatim | 变更即写 |
| 5 | `extraRules` | string | **textarea**（3 行） | 附加约束 | Additional rules | 草稿 + 保存按钮 |
| 6 | `overrideHead` | string | **textarea**（3 行，默认折叠） | 覆盖首段规则（高级） | Override the opening rules (advanced) | 草稿 + 保存按钮 |

**为什么写入时机要分两类**（取舍）：

- `ConfigFormController.set()` 是**立即发 RPC**（`dsh-client-ui-settings/lib/client.js:1140-1146` → `:1170` `ctx.remote.settings.mutate(...)`），没有 draft/save 概念。
- 离散控件（radio / switch / number 的 `change`）一次交互一个值，立即写最符合 volatile 的「改完即生效」语义，且能让验收 F8「不重启即生效」当场可验。
- 文本控件每次按键都发 RPC 会产生几十次写盘（每次写都要拿 profile 文件锁 + 写 `cordis.patch.yml`，`dsh-config-editor/lib/index.js:69-135`）。因此文本走**本地草稿 + 显式保存**。
- 两种时机共用同一个「恢复默认」动作：`form.unset(field)`（`:1153-1158`）→ 清除用户值，回落到 schema `default`。

### 2.3 面板布局（自上而下）

```
┌─ section[data-plugin-config]（owner 已提供外壳）──────────────────┐
│                                                                  │
│  ┌ card ────────────────────────────────────────────────────┐    │
│  │  强度档位                              [恢复默认]          │    │
│  │  ○ 基础   只在提示词首尾各放一段语言约束…                  │    │
│  │  ● 强化   在基础之上，于工具说明之后补一段重申…   ← 默认   │    │
│  │  ○ 周期   在强化之上，每 N 轮在当轮开头追加一条…           │    │
│  │                                                           │    │
│  │  注入间隔（轮）  [ 8 ]  仅周期档生效                       │    │
│  │                                                           │    │
│  │  目标语言       [ zh-CN            ]  (简体中文)          │    │
│  │                 [简体中文][繁體中文][English][日本語][한국어]│
│  │                                                           │    │
│  │  保留代码与术语原文                        [ ●—— ]         │    │
│  │                                                           │    │
│  │  附加约束                                                 │    │
│  │  ┌─────────────────────────────────────────────────┐      │
│  │  │                                                 │      │
│  │  └─────────────────────────────────────────────────┘      │
│  │                                        [保存] [放弃更改]   │    │
│  │                                                           │    │
│  │  ▸ 覆盖首段规则（高级）                                    │    │
│  └───────────────────────────────────────────────────────────┘    │
│                                                                  │
│  已保存 · 无需重启，下一条消息即生效                               │
└──────────────────────────────────────────────────────────────────┘
```

- 分组顺序：档位 → 依赖档位的 N → 语言 → 术语 → 自定义文本（由常用到少用）。
- `overrideHead` 默认折叠（`<details>`），避免用户误编辑最高优先级约束（`01-mechanism.md` 5 节「避免用户一次误编辑就把最高优先级约束改坏」）。
- 说明文字**常驻**在控件下方，**不用 tooltip**：tooltip 在触屏与键盘下不可达，且三档差别需要并列对比（见 3.2）。

---

## 3. 三档强度控件

### 3.1 为什么是 radio group 而不是 `<select>`

| 方案 | 能否并列对比三档差别 | 键盘 | 一次点击可达 |
| --- | --- | --- | --- |
| `<select>` + 下方动态说明 | ❌ 只显示当前档说明，必须逐一切换才能对比 | 原生好 | 需 2 次交互 |
| **radio group（三行）** | ✅ 三档说明同时可见 | 原生好（同 `name` 方向键切换） | 1 次点击 |
| 自绘分段按钮（segmented） | ⚠️ 说明只能放在选中项下方，仍是单档可见 | 需自实现 roving tabindex | 1 次点击 |

票 #04 的核心诉求是「让用户看懂差别」，因此选 radio group。它同时满足 `references/practices.md` 的「必须自己写控件」要求，且用**原生 `input[type=radio]`**（不是自绘按钮）来获得免费的键盘可达性与屏幕阅读器语义。

### 3.2 无障碍契约（不可省）

- `<fieldset>` + `<legend>` 提供分组语义；`legend` 就是「强度档位」标签。
- 三个 `<input type="radio" name="language-guard-strength">` 同 `name`：Tab 进组只落一个 tab stop，`↑`/`↓`/`←`/`→` 在组内切换并**立即触发 `change`**（浏览器原生行为，即「变更即写」）。
- 每档说明用 `aria-describedby` 关联，档名用 `<label for>` 关联。
- 禁用（只读部署）时用 `disabled`（不是 `aria-disabled`），原生控件已足够。
- 校验失败不适用（radio 值域由 schema 枚举保证）。

### 3.3 组件骨架（可照抄）

```js
// client.js 内 —— 无 JSX，用 React.createElement（与官方 templates/decoration/client.js 一致）
function StrengthField({ value, disabled, onPick, t }) {
  const h = React.createElement;
  const LEVELS = ['B', 'C', 'D'];
  return h('fieldset', { className: css.fieldset, disabled },
    h('legend', { className: css.fieldLabel }, t('strength.label')),
    LEVELS.map((level) => {
      const id = 'lg-strength-' + level;
      const descId = id + '-desc';
      const checked = value === level;
      return h('div', { key: level, className: checked ? css.option + ' ' + css.optionOn : css.option },
        h('input', {
          type: 'radio',
          id,
          name: 'language-guard-strength',
          value: level,
          checked,
          disabled,
          'aria-describedby': descId,
          onChange: () => onPick(level),
          className: css.radio,
        }),
        h('div', { className: css.optionText },
          h('label', { htmlFor: id, className: css.optionTitle },
            t('strength.' + level.toLowerCase() + '.label'),
            level === 'C' ? h('span', { className: css.badge }, t('strength.recommended')) : null),
          h('p', { id: descId, className: css.optionDesc },
            t('strength.' + level.toLowerCase() + '.desc'))));
    }));
}
```

档名与说明的**中文逐字取自 `01-mechanism.md` 2.1 节**（验收 F3 逐字比对，不得改写）：

| 档 | label | desc |
| --- | --- | --- |
| B | 基础 | 只在提示词首尾各放一段语言约束，成本最低，适合短会话。 |
| C | 强化 | 在基础之上，于工具说明之后补一段重申，抵消英文工具说明带来的语言漂移，推荐默认。 |
| D | 周期 | 在强化之上，每 N 轮在当轮开头追加一条语言自检提醒，适合长会话；提醒会作为一条会话记录出现，可在会话日志中看到。 |

`strength.recommended` = 「推荐」/「Recommended」，渲染成 C 档档名后的一个小徽标（用 `--dsw-alias-state-business-primary` 前景 + 透明背景，不填充色块）。

---

## 4. locale 命名规范与完整字典

### 4.1 三个「locale」不是一回事（实现者最容易搞错的地方）

| 名字 | 位置 | 用途 | 谁读 |
| --- | --- | --- | --- |
| `locale/zh.json`、`locale/en.json` | 包根 `locale/` 目录，通过 `exports["./locale/*.json"]` 暴露 | **插件清单展示元信息**：`{ "meta": { "title", "description" } }`，出现在「设置 → 插件」列表与详情页 | Host（`dsh-package-manifest`），验收 B1/B2/B5 |
| `ctx.locale.register(NS, { zh, en })` | `client.js` 内联常量 | **运行时 UI 文案**：本插件所有可见字符串 | Client locale 服务，验收 D9 |
| `ctx.config.targetLanguage` | Host `Config`（volatile） | **被约束的思考/回复语言**，写进 system prompt | 本插件 Host 半 |

三者互不影响：**切换 `targetLanguage` 不会改变 UI 文案**（验收 F10 明确要求「UI 文案不随之改变，UI 跟 DSH locale」）。

### 4.2 NS 与 key 命名规范

- **NS**：`"languageGuard"`（camelCase，与官方 `cotTranslation`、`chat` 同风格；不用 `settings.` 前缀，因为同一个 NS 同时服务设置页与侧栏控件）。
- **key**：`<区块>.<字段>.<角色>`，全小写点分，例：`strength.basic.desc`、`language.menu.title`、`error.saveFailed`。
- 区块名固定 6 个：`meta`、`strength`、`language`、`interval`、`terms`、`advanced`；横切用 `error`、`state`、`action`。
- 占位符用 locale 服务的 `{name}` 语法（`dsh-client-locale/lib/client.js:1427`），例：`state.savedAt` = `"已保存 · {time}"`。

### 4.3 `locale/zh.json` 与 `locale/en.json`（清单元信息）

```json
{
  "meta": {
    "title": "语言守卫",
    "description": "强制模型用简体中文思考与回复：可调强度档位、目标语言与周期提醒，改动即时生效。"
  }
}
```

```json
{
  "meta": {
    "title": "Language Guard",
    "description": "Keeps the model thinking and replying in your chosen language, with adjustable strength, target language, and periodic reminders. Changes apply immediately."
  }
}
```

### 4.4 `client.js` 内联字典（完整，可照抄）

```js
const NS = 'languageGuard';

const zh = {
  // —— 设置卡片
  'card.title': '语言守卫',
  'strength.label': '强度档位',
  'strength.recommended': '推荐',
  'strength.basic.label': '基础',
  'strength.basic.desc': '只在提示词首尾各放一段语言约束，成本最低，适合短会话。',
  'strength.strong.label': '强化',
  'strength.strong.desc': '在基础之上，于工具说明之后补一段重申，抵消英文工具说明带来的语言漂移，推荐默认。',
  'strength.periodic.label': '周期',
  'strength.periodic.desc': '在强化之上，每 N 轮在当轮开头追加一条语言自检提醒，适合长会话；提醒会作为一条会话记录出现，可在会话日志中看到。',
  'interval.label': '注入间隔（轮）',
  'interval.hint': '仅周期档生效，3–50 轮。',
  'interval.disabled': '仅在选择「周期」档时可调。',
  'language.label': '目标语言',
  'language.hint': 'BCP-47 语言标签，例如 zh-CN、zh-TW、en、ja、ko。',
  'language.invalid': '不是合法的 BCP-47 语言标签。',
  'language.current': '当前：{code}',
  'language.preset.zhCN': '简体中文',
  'language.preset.zhTW': '繁體中文',
  'language.preset.en': 'English',
  'language.preset.ja': '日本語',
  'language.preset.ko': '한국어',
  'terms.label': '保留代码与术语原文',
  'terms.hint': '代码、命令、路径、标识符与英文报错保持原样，不翻译。',
  'advanced.summary': '覆盖首段规则（高级）',
  'advanced.label': '首段规则全文',
  'advanced.hint': '留空则使用内置规则；填入后完全替换首段内置文本，「附加约束」仍会追加在其后。',
  'extraRules.label': '附加约束',
  'extraRules.hint': '追加在内置规则之后，留空则只用内置规则。',
  'action.save': '保存',
  'action.discard': '放弃更改',
  'action.reset': '恢复默认',
  'state.saved': '已保存 · 无需重启，下一条消息即生效',
  'state.saving': '保存中…',
  'state.loading': '正在读取配置…',
  'state.unavailable': '配置暂不可用，请确认插件已启用。',
  'state.readOnly': '当前部署为只读，配置不可修改。',
  'error.saveFailed': '保存失败：{message}',
  'error.retry': '重试',
  // —— 快速切换控件
  'quick.aria': '切换目标语言，当前 {label}',
  'quick.menu.title': '目标语言',
  'quick.menu.current': '当前：{label}',
  'quick.menu.check': '已选中',
  'quick.menu.hint': '其他语言可在 设置 → 插件 → 语言守卫 中填写。',
};

const en = {
  'card.title': 'Language Guard',
  'strength.label': 'Strength',
  'strength.recommended': 'Recommended',
  'strength.basic.label': 'Basic',
  'strength.basic.desc': 'One language constraint at the start and one at the end of the prompt. Cheapest, best for short sessions.',
  'strength.strong.label': 'Strong',
  'strength.strong.desc': 'Adds a restatement right after the tool descriptions on top of Basic, countering drift from English tool docs. Recommended default.',
  'strength.periodic.label': 'Periodic',
  'strength.periodic.desc': 'Adds a language self-check at the start of every Nth turn on top of Strong, for long sessions. The reminder appears as a session record and is visible in the session log.',
  'interval.label': 'Injection interval (turns)',
  'interval.hint': 'Applies to Periodic only, 3–50 turns.',
  'interval.disabled': 'Available only when Periodic is selected.',
  'language.label': 'Target language',
  'language.hint': 'A BCP-47 language tag, e.g. zh-CN, zh-TW, en, ja, ko.',
  'language.invalid': 'Not a valid BCP-47 language tag.',
  'language.current': 'Current: {code}',
  'language.preset.zhCN': '简体中文',
  'language.preset.zhTW': '繁體中文',
  'language.preset.en': 'English',
  'language.preset.ja': '日本語',
  'language.preset.ko': '한국어',
  'terms.label': 'Keep code and technical terms verbatim',
  'terms.hint': 'Code, commands, paths, identifiers, and raw English error text stay untranslated.',
  'advanced.summary': 'Override the opening rules (advanced)',
  'advanced.label': 'Opening rules text',
  'advanced.hint': 'Leave empty to use the built-in rules. When set, it replaces the built-in opening text entirely; Additional rules are still appended after it.',
  'extraRules.label': 'Additional rules',
  'extraRules.hint': 'Appended after the built-in rules. Leave empty to use the built-in rules alone.',
  'action.save': 'Save',
  'action.discard': 'Discard changes',
  'action.reset': 'Reset to default',
  'state.saved': 'Saved · no restart needed, applies to the next message',
  'state.saving': 'Saving…',
  'state.loading': 'Reading configuration…',
  'state.unavailable': 'Configuration is unavailable. Check that the plugin is enabled.',
  'state.readOnly': 'This deployment is read-only; configuration cannot be changed.',
  'error.saveFailed': 'Save failed: {message}',
  'error.retry': 'Retry',
  'quick.aria': 'Switch target language, currently {label}',
  'quick.menu.title': 'Target language',
  'quick.menu.current': 'Current: {label}',
  'quick.menu.check': 'Selected',
  'quick.menu.hint': 'Other languages can be entered in Settings → Plugins → Language Guard.',
};
```

**注意**：`language.preset.*` 在 `en` 字典里仍然给中文/日文/韩文的自称（`简体中文`/`日本語`/`한국어`）——语言名应始终以其自身语言显示，这是通行做法，且让中文用户在英文界面下也能认出目标语言。

---

## 5. 快速语言切换控件

### 5.1 落点：`sidebar.footer.action`

**决策：`sidebar.footer.action`，`id = "language-guard"`，`order = 100`。**

契约（`dsh-cordis-client-runner/lib/client.js:5651-5697`）：

```
key: "sidebar.footer.action"
kind: "list"
scope: "root"
summary: "Optional actions beside Settings at the sidebar foot."
ownerProps: SidebarFooterActionOwnerProps { wide: boolean }   // 只有 wide
occupants: ["client-ui-cordis CordisPanel id 'cordis-panel'"]
replaceRisk: "none"
source: packages/client/ui-sidebar/src/client/contract/slots.ts:53
```

- `id: "language-guard"` —— 自有 id，不复用 shipped id（复用会替换掉 `cordis-panel` 那一格）。
- `order: 100` —— 现有唯一占位者 `cordis-panel` 未声明 order（默认 0，`dsh-client-ui-cordis/lib/client.js:1411-1414`），100 保证我们排在它右侧、且将来别人用默认 order 也不会插到我们中间。
- **为什么不选 `conversation.composer.dock`**（`03-settings-panel.md` 里的次选）：该 slot 是 `scope: "session"`，只在会话页渲染，且 `dsh-client-ui-conversation/lib/client.js:19161-19168` 要求 `variant === "composer" && input !== undefined && sessionId !== undefined`。语言是**全局偏好**，在设置页/插件页改语言时不该因为「不在会话里」而够不着控件。`sidebar.footer.action` 是 `scope: "root"`，全局常驻。
- **为什么不用 `shell.leading`**：`single`/`root`，已被 sidebar 的 `HeaderLeadingControls` 占用（`dsh-client-ui-sidebar/lib/client.js:522-526`），注册会顶掉宿主控件。

### 5.2 形态：图标 + 当前语言短标签，点击弹下拉

```
wide（侧栏展开，约 240px）          56px rail（收起）
┌──────────────────────────┐        ┌────┐
│  [中]  简体中文        ▾ │        │[中] │
└──────────────────────────┘        └────┘
```

- `wide === false`（56px rail）时只渲染图标，`aria-label` 仍完整（`t('quick.aria', { label })`）。
- 图标：**自绘 inline SVG**（一个圆角方框内一个「中」字，或 `A/文` 字形），尺寸 `wide ? 16 : 18`（对齐 `dsh-client-ui-cordis/lib/client.js:1119` 的 `size: wide ? 16 : 18`）。
  - **不得** require `@deepseek-ai/dsh-client-ui-primitives` 的图标集（`references/practices.md` 硬规定；且该包在安装树里根本不存在——只有官方包能从 browser module table 拿到）。
- 短标签：`wide` 时显示当前语言的**自称**（简体中文/繁體中文/English/日本語/한국어），自定义标签显示原始 code。rail 时不显示文字。
- 触发按钮必须是 `<button type="button">`，带 `aria-haspopup="menu"`、`aria-expanded={open}`、`aria-label`（抄 `dsh-client-ui-cordis/lib/client.js:1108-1118` 的写法）。

### 5.3 点击后：下拉菜单（不是循环切换）

**决策：弹出下拉菜单。**

| 方案 | 一次可见全部候选 | 能显示当前值 | 支持自定义标签 |
| --- | --- | --- | --- |
| 循环切换（每次点切下一个） | ❌ | 靠图标推断 | ❌ 5 个预设之外的标签无法参与循环 |
| **下拉菜单** | ✅ | ✅（当前项打勾 + 标题行写「当前：X」） | ✅（标题行原样显示自定义 code） |

菜单结构：

```
┌──────────────────────┐
│ 目标语言              │  ← menu-group-header，--dsw-alias-menu-group-header-fill
├──────────────────────┤
│ 当前：简体中文         │  ← 只读行，自定义标签时显示 code
├──────────────────────┤
│ ✓ 简体中文    zh-CN  │  ← 当前项：--dsw-alias-label-primary + 勾用 state-business-primary
│   繁體中文    zh-TW  │
│   English     en     │
│   日本語       ja     │
│   한국어       ko     │
├──────────────────────┤
│ 其他语言可在设置中填写   │  ← 提示行，--dsw-alias-label-tertiary
└──────────────────────┘
```

**定位**（关键，避免 portal 到 `document.body`）：

- 菜单渲染在**组件树内**，作为触发按钮的兄弟节点，`position: absolute`；root 容器 `position: relative`。
- `wide` 时 `bottom: calc(100% + 8px); left: 0;`（向上展开，因为控件在侧栏底部）；rail 时 `bottom: 0; left: calc(100% + 8px);`（向右展开）。
- **不用 `position: fixed` + `getBoundingClientRect` 计算视口坐标**（`dsh-client-ui-cordis/lib/client.js:749-763` 的做法）：sidebar 折叠动画使用 `transform`（`dsh-client-ui-sidebar/lib/client.js:159-167` 的 `COLLAPSE_SETTLE_MS`/crossfade 说明），`transform` 祖先会改变 `fixed` 的包含块，坐标会算错。`absolute` 相对 root 不受影响。
- **不 portal、不 append 到 `document.body`**：`references/practices.md` 禁止往 body 追加第二个应用；在组件树内用 `absolute` 完全够用（侧栏 z-index 已建立隔离层，`dsh-client-ui-trajectory/lib/client.js:6289` 有 `isolation:isolate` 的先例）。

### 5.4 交互与键盘契约

| 动作 | 行为 |
| --- | --- |
| 点击按钮 | 开/关菜单 |
| `Enter` / `Space` | 同点击（`<button>` 原生） |
| `Escape` | 关闭菜单，焦点回触发按钮 |
| `ArrowDown` / `ArrowUp` | 在菜单项间移动焦点（循环） |
| `Enter` | 选中聚焦项 → `form.set('targetLanguage', code)` → 关闭菜单 → 焦点回按钮 |
| 点击菜单外 | 关闭菜单 |
| 选中后 | 菜单关闭、按钮标签立即变为新语言；卡片里的 radio/chip 同步（同一 `ConfigFormController` 的 store，见 5.6） |

关闭菜单的两类监听器（`pointerdown` 与 `keydown`）在**组件内 `useEffect` 注册并在清理函数里移除**——符合 `references/practices.md`「监听器在 apply 里用 `ctx.effect` 注册并返回清理函数」的精神（组件级 effect 的清理函数等价且更精确）。

### 5.5 骨架（可照抄）

```js
function QuickLanguageSwitch({ wide, useForm, t }) {
  const h = React.createElement;
  const snapshot = useForm((s) => s);          // ConfigFormController 的 store 选择器
  const [open, setOpen] = React.useState(false);
  const [focusIndex, setFocusIndex] = React.useState(0);
  const rootRef = React.useRef(null);
  const btnRef = React.useRef(null);

  const code = snapshot.value?.targetLanguage ?? '';
  const label = displayName(code, t);

  React.useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') { setOpen(false); btnRef.current?.focus(); }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (value) => {
    setOpen(false);
    btnRef.current?.focus();
    onPick(value);                              // → form.set('targetLanguage', value)
  };

  return h('div', { ref: rootRef, className: css.root, 'data-rail': wide ? undefined : '' },
    h('button', {
      ref: btnRef, type: 'button', className: css.trigger,
      'aria-haspopup': 'menu', 'aria-expanded': open,
      'aria-label': t('quick.aria', { label }),
      onClick: () => setOpen((v) => !v),
    },
      h(LanguageGlyph, { size: wide ? 16 : 18 }),
      wide ? h('span', { className: css.triggerLabel }, label) : null,
      wide ? h('span', { className: css.caret, 'aria-hidden': true }, '▾') : null),
    open ? h('div', { className: css.menu, role: 'menu', 'aria-label': t('quick.menu.title') },
      h('div', { className: css.menuHeader }, t('quick.menu.title')),
      h('div', { className: css.menuCurrent }, t('quick.menu.current', { label })),
      PRESETS.map((preset, index) => h('button', {
        key: preset.code, type: 'button', role: 'menuitemradio',
        'aria-checked': code === preset.code,
        className: css.menuItem + (code === preset.code ? ' ' + css.menuItemOn : ''),
        tabIndex: index === focusIndex ? 0 : -1,
        onFocus: () => setFocusIndex(index),
        onClick: () => pick(preset.code),
      },
        h('span', { className: css.check, 'aria-hidden': true }, code === preset.code ? '✓' : ''),
        h('span', { className: css.menuLabel }, t(preset.labelKey)),
        h('span', { className: css.menuCode }, preset.code))),
      h('div', { className: css.menuHint }, t('quick.menu.hint'))) : null);
}
```

注册：

```js
ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
  name: 'sidebar.footer.action',
  id: 'language-guard',
  order: 100,
  locale: NS,
  inject: () => ({ hooks: { quickForm: form }, onPick: (code) => form.set('targetLanguage', code) }),
}, QuickLanguageSwitch));
```

- `inject` 返回 `{ hooks: {...}, ...actions }`：`hooks` 里的每个名字会被 renderer 转成 `use<Name>` prop（`dsh-client-ui-renderer/lib/client.js:444-458` 的 `bindInjectSources` + `standardHookPropName`）。因此 `hooks: { quickForm: form }` → 组件收到 `useQuickForm`。
- 顶层 `inject: () => ({...})` 的函数式 inject 在 `scope: "root"` 下不传 sessionId（`dsh-client-ui-renderer/lib/client.js:435-442` 只在 session 绑定存在时传 binding.key）。

### 5.6 与设置面板的双向同步（验收 F7）

**不需要任何额外代码**：两处都用**同一个** `ConfigFormController` 实例。

- `ctx.configForms.get('dsh-language-guard')` 按 entryId 缓存（`dsh-client-ui-settings/lib/client.js:1294-1301`），同一个 `ctx` 下第二次调用返回同一对象。
- 该 controller 的 `store` 由 mirror 驱动（`:1116-1119` 订阅 mirror → `derive()`）；写入成功后 `mirror.acceptView(response.value)`（`:1178`）→ mirror 通知 → `derive()` → store 更新 → 所有订阅者重渲染。
- 所以：面板改 → 控件标签变；控件改 → 面板 radio/chip 变。这是**同源**而非「同步逻辑」。

---

## 6. 语言候选清单（地图 `## Not yet specified` 待定项，此处定案）

### 6.1 决策

**5 个预设 + 任意合法 BCP-47 标签。**

| 预设 | code | 快速菜单 | 设置页 chip | 显示名（自称） |
| --- | --- | --- | --- | --- |
| 简体中文 | `zh-CN` | ✅ | ✅ | 简体中文 |
| 繁體中文 | `zh-TW` | ✅ | ✅ | 繁體中文 |
| English | `en` | ✅ | ✅ | English |
| 日本語 | `ja` | ✅ | ✅ | 日本語 |
| 한국어 | `ko` | ✅ | ✅ | 한국어 |
| 自定义 | 任意 BCP-47 | ❌ | ✅ 文本框 | 原样显示 code |

### 6.2 理由

1. **预设必须覆盖「一键可达」的场景。** 快速切换控件的存在意义是「不打开设置页就能换语言」，因此它只放高频项。
2. **不能锁死枚举。** `Config.targetLanguage` 的 schema 已经是 BCP-47 正则（`01-mechanism.md` 4.1：`/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/`），`01-mechanism.md` 3.5 节也规定「其他合法标签原样使用代码本身」。若把候选做成封闭枚举，等于把已经支持的 `fr`/`de`/`ru` 变成不可用，是功能回退。
3. **不把 20 种语言塞进菜单。** 菜单项超过 7–8 项后，扫视成本高于「打开设置页输入一次」。且 `01-mechanism.md` 3.5 的映射表只覆盖 5 个语言族，其余本来就没有本地化显示名。
4. **自定义值在快速菜单里不消失。** 当前值不在预设里时，菜单标题行显示「当前：`fr`」（`quick.menu.current`），所有预设项都不打勾。用户不会看到「菜单里没有我设的语言」而怀疑配置丢了。

### 6.3 自定义值的校验

- 输入即校验：`/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/`（与 schema 同一正则，`01-mechanism.md` 4.1）。
- 不合法 → 输入框 `aria-invalid="true"` + 下方 `t('language.invalid')`，**保存按钮 disabled**。
- 合法但与当前值相同 → 保存按钮 disabled（无改动）。
- 大小写：写入前**不**规范化（BCP-47 大小写语义由 Host 侧 `01-mechanism.md` 4.5 的兜底处理）；但 chip 与菜单比较时用大小写不敏感比较（`zh-cn` 命中 `zh-CN` 预设）。

---

## 7. 视觉规范

### 7.1 硬约束

- **只用 `--dsw-alias-*` token 上色**；字面颜色只允许出现在插画/艺术图形（本插件没有插画，因此**零字面颜色**）。
- 明暗适配由宿主完成：亮色段定义在 `body{...}`，暗色段在 `body[data-ds-dark-theme]{...}`（`dsh-client-ui-theme/lib/client.js:1413` 的 `design_platform_css`）。**引用 token 即自动适配，不写 `@media (prefers-color-scheme)`、不写 `.dark` 分支。**
- 字面**尺寸/圆角/间距**允许（不是颜色）。
- 类名必须带插件前缀（`lg-`），不得抄宿主 hash 类名。

### 7.2 token 表（逐项指名，均已在主题包中确认存在）

| 用途 | token |
| --- | --- |
| 卡片背景 | `--dsw-alias-settings-card-fill` |
| 卡片描边 | `--dsw-alias-settings-card-stroke` |
| 卡片内分隔线 | `--dsw-alias-border-l1` |
| 控件描边（输入框、radio 未选、菜单容器） | `--dsw-alias-border-l2` |
| 主文字（档名、字段标签、菜单项标签） | `--dsw-alias-label-primary` |
| 次文字（当前值、菜单 code） | `--dsw-alias-label-secondary` |
| 说明文字（每档 desc、hint、菜单提示行） | `--dsw-alias-label-tertiary` |
| 禁用文字 | `--dsw-alias-label-dimmed` |
| 触发按钮 hover 背景 | `--dsw-alias-interactive-bg-hover` |
| 触发按钮 active 背景 | `--dsw-alias-interactive-bg-active` |
| 菜单容器背景 | `--dsw-alias-bg-overlay` |
| 菜单分组头背景 | `--dsw-alias-menu-group-header-fill` |
| 选中项强调色（radio 选中环、勾、推荐徽标） | `--dsw-alias-state-business-primary` |
| 输入框聚焦环 | `--dsw-focus-ring-color`（回退 `--dsw-alias-state-business-primary`，`dsh-client-ui-theme/lib/client.js:1416`） |
| switch 滑块 | `--dsw-alias-switch-thumb`；轨道用 `--dsw-alias-state-business-primary`（开）/ `--dsw-alias-border-l3`（关） |
| 错误文字 | `--dsw-alias-state-error-primary` |
| 成功/已保存 | `--dsw-alias-state-success-primary` |
| 警告（如 N 越界提示） | `--dsw-alias-state-warn-primary` |
| 骨架屏（loading） | `--dsw-alias-bg-skeleton` |
| 焦点/悬停时的浅色底（chip 选中） | `--dsw-alias-interactive-bg-hover-accent` |

### 7.3 排版

| 元素 | 规则 |
| --- | --- |
| 字段标签 | 13px / 500 / `--dsw-alias-label-primary` |
| 每档 desc、hint | 12px / 400 / `--dsw-alias-label-tertiary` / `line-height: 1.5` |
| 选项行间距 | `gap: 6px`；选项之间 `10px` |
| 卡片内边距 | `16px`；字段间距 `20px` |
| 圆角 | 卡片 `10px`，输入框/按钮 `6px`，chip `999px` |
| 菜单 | 最小宽 `200px`，`padding: 4px`，项高 `32px` |

---

## 8. 空态与错误态

### 8.1 状态矩阵

| 情形 | 判定 | 表现 |
| --- | --- | --- |
| Host 未装 `dsh-client-ui-settings` | Client 半 `inject` 缺 `configForms` 服务 → **整个 Client 半不激活** | 设置页无本插件卡片，侧栏无控件。**不显示任何错误**（这是合法部署） |
| 本插件 Host 行被 `disabled` | `configForms` 的 mirror 里没有 `dsh-language-guard` namespace → `whileServed` 不触发 `register` | 卡片与侧栏控件**都不注册**（不是显示错误态）。用户看到「插件被禁用」即解释了一切 |
| `status === "loading"` | controller 初始态（`:1108-1115`） | 卡片渲染骨架（`--dsw-alias-bg-skeleton`，高 120px），**不渲染空表单**（避免用户把 schema 默认值误读为「已保存」） |
| `status === "unavailable"` | mirror 里找不到该 ns（`:1215-1220`） | 一行 `t('state.unavailable')`，`role="status"`，无表单 |
| `writable === false` | 只读部署（`:1213`、`:1227`） | 表单正常渲染但全部 `disabled`，顶部一行 `t('state.readOnly')` |
| 写入成功 | `mutate` 返回 `true` | 卡片底部 `t('state.saved')`（`--dsw-alias-state-success-primary`），3 秒后淡出 |
| 写入失败 | `mutate` 返回 `false`（`:1171-1174`，已自动 `recover()` 重读 Host 真值） | 保留**用户的本地选择**不静默回滚；卡片内 `role="alert"` 一行 `t('error.saveFailed', { message })` + 「重试」按钮（`--dsw-alias-state-error-primary`） |
| 校验失败（仅 `targetLanguage`） | 本地正则 | 输入框 `aria-invalid` + `t('language.invalid')`，保存按钮 disabled。**不发 RPC** |

### 8.2 「控件消失」是刻意设计

未启用时**不渲染**而非「渲染成灰色禁用」：`whileServed` 的语义就是「部署没组合该 owner 时不显示我的页面」（`dsh-client-ui-settings/lib/client.js:1302-1313` 的注释：*"so a deployment that never composed the owner shows no trace of the page"*）。灰控件会让用户以为是 bug 并去点它。

**代价**：用户可能找不到入口。缓解：README 的「验证」章节写明「看不到控件 = 插件未启用或被禁用」。

---

## 9. 与 D 档（周期）的联动

### 9.1 决策：不做轮次计数显示

**不展示「当前第几轮注入」，也不做「还有 X 轮」的近似值。**

理由（#03 取证）：Client 侧**没有任何轮次计数投影**可读。`turnBoundary` 只存在于 Host 侧包（`dsh-agent-loop/lib/index.js`、`dsh-api-session-controller`、`dsh-session-title` 等），`dsh-client-ui-trajectory/lib/client.js` 里 `turnBoundary` 只命中一个 CSS 类名（`:6311`、`:6760`），不是数据投影。硬做要自己数会话事件流，违反「不重造轮子」且会在重连/回放时算错。

### 9.2 真正的联动：N 字段随档位启用

| `strength` | `injectEveryNRounds` 输入框 | 提示 |
| --- | --- | --- |
| `B` / `C` | `disabled` | `t('interval.disabled')` = 「仅在选择「周期」档时可调。」 |
| `D` | 可编辑 | `t('interval.hint')` = 「仅周期档生效，3–50 轮。」 |

**用 `disabled` 而不是隐藏**：隐藏会让布局在切档时跳动，且用户切到 D 后找不到 N 在哪。

### 9.3 D 档选中时的额外说明

D 档 desc 已经含「提醒会作为一条会话记录出现，可在会话日志中看到」（`01-mechanism.md` 2.1 逐字）。这是对「会写会话日志」这一副作用的最重要告知，**不得删减**（`01-mechanism.md` 11 节把「每 N 轮注入一次语言自检提醒」改成了「每 N 轮在当轮开头追加一条语言自检提醒，会作为一条会话记录出现」，面板文案已同步）。

---

## 10. 即时生效与用户自证步骤

### 10.1 链路（实现者需要理解的因果）

```
用户点 radio
  → ConfigFormController.set('strength','D')
  → mutate → ctx.remote.settings.mutate('dsh-language-guard', [{op:'set',path:['strength'],value:'D'}], revision)
      （dsh-client-ui-settings/lib/client.js:1165-1181）
  → Host: SettingsController.write → Settings.write
      （dsh-api-settings-controller/lib/index.js:461-475；dsh-settings/lib/index.js:501-537）
  → configEditor.edit：写 profile 的 cordis.patch.yml（文件锁 + 原子写）
      （dsh-config-editor/lib/index.js:69-135）
  → Loader 发现「只有 volatile 变了」→ 原地替换 fiber._config + _commitVolatile()
      → emit 'loader/volatile-update'
      （cordis-plugin-loader/lib/index.js:382-388、:395-427）
  → 插件下次读 ctx.config.strength.get() 即新值（不 remount）
  → 下一次 systemPrompt.assemble() 重新求值 section.text()（每个 step 都重算）
      （dsh-system-prompt/lib/index.js:385-393；dsh-agent-loop/lib/index.js:902-917）
  → 新 system 节点文本变化
```

**关键点**：不需要任何「刷新」「重载」「重启」动作，也不需要插件自己发通知——`section.text` 是函数，`assemble` 每步重新调用它。

### 10.2 用户自证步骤（写进 README 的就是这三步）

**验证 A：改档位立即生效**

1. 打开 `设置 → 插件 → dsh-language-guard`，把「强度档位」从「强化」切到「周期」。
2. 底部出现「已保存 · 无需重启，下一条消息即生效」。
3. **不重启**，在任意会话里发一条普通消息（如「你好」）。
4. 打开该会话的会话日志，找到**最新**的 system 节点，搜索 `language-guard:` —— 应看到 `head` 与 `tail` 两段，以及 `mid` 段（C/D 档都有）。
5. 再把档位切到「基础」，重发一条消息，看新的 system 节点 —— `mid` 段文本应变为空（只剩 head 与 tail）。

**验证 B：快速切换立即生效**

1. 点侧栏底部（设置按钮旁）的语言图标，菜单里选「日本語」。
2. 菜单关闭，按钮标签变为「日本語」；同时打开设置页，`targetLanguage` 文本框显示 `ja`（双向同步，验收 F7）。
3. **不重启**，发一条消息，看新 system 节点的约束文本 —— 语言名应变为「日本語」。

**验证 C：持久化**

1. 完全退出并重启 DSH。
2. 打开设置页，档位与语言仍是重启前的值（验收 F9）。

**进阶（开发者自证）**：`cordis_inspect_query` 查本插件实例的 `Config`，`strength.get()` / `targetLanguage.get()` 返回新值。

### 10.3 明确不做的提示

**不弹「需要重启才能生效」的提示**（验收 F8 要求无 `restart-required`）。**不做**「已生效」的 toast（会与「已保存」重复）；只在卡片底部显示「已保存 · 无需重启，下一条消息即生效」，一次性把两件事说清。

---

## 11. Client 半的文件结构与 manifest

### 11.1 新增/变更文件

| 文件 | 变更 | 内容 |
| --- | --- | --- |
| `client.js` | **新增** | `window.__ModuleLoader__.load({ id: 'dsh-language-guard', factory(require) {...} })`，导出 `{ inject, apply }` |
| `package.json` | 变更 | 增加 `exports["./client"] = "./client.js"`、`files` 增加 `"client.js"`、增加 `dsh.client` 段（见 11.2） |
| `locale/zh.json`、`locale/en.json` | 新增（`03-manifest.md` 已有） | 仅 `meta.title` / `meta.description`（4.3） |

### 11.2 `package.json` 的 `dsh` 段（定案）

```json
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
}
```

字段语义（`dsh-client-modules/lib/index.js`）：

- `platform` 必须是非空 string（`:66-74` 校验）；值为 `"web"`（对齐官方 `templates/decoration/package.json`）。
- `immediately: true`：随应用批一起预载，不等首次需要。
- `inject`：三个**声明方**包名（`configForms` 服务由 `dsh-client-ui-settings` 提供；两个 slot 分别由 sidebar / plugin-manager 声明）。
  - 它**只作为 graph row 的排序提示字段**透传（`:67`、`:72`、`:407`、`:743`），**不参与** `orderByModuleGraph` 的建边（该函数只遍历 `external`，`:433-437`），因此**指向未安装的包不会报错**。
  - `external` **留空**：我们只 `require('react')`，它在 browser module table 的静态表里，不是非基座运行时依赖。
- **不要**把 `@deepseek-ai/dsh-client-ui-primitives` 写进 `inject` 或 `external`：`references/practices.md` 明确禁止把它当模块加载，而且该包在安装树里**根本不存在**。

### 11.3 `client.js` 顶层结构

```js
window.__ModuleLoader__.load({
  id: 'dsh-language-guard',            // 必须等于包名（dsh-client-modules 用 id 定位 exports["./client"]）
  factory(require) {
    const React = require('react');     // React 只能从 browser module table 取
    const h = React.createElement;      // 不用 JSX（无构建步骤）
    // …… 组件与样式常量 ……
    return {
      inject: ['slots', 'locale', 'configForms'],
      apply(ctx) { /* 见 11.4 */ },
    };
  },
});
```

- **factory 必须无副作用**：所有注册都在 `apply` 里；CSS 用 `<style>` React 元素渲染（挂载即注入、卸载即移除，官方 `ui-plugin.md` 推荐做法），**不在模块体里 `document.head.appendChild`**。
- 样式类名一律 `lg-` 前缀。

### 11.4 `apply` 结构（定案顺序）

```js
function apply(ctx) {
  // 1) 字典（用 ctx.effect 包，卸载即注销）
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'language-guard: dictionaries');
  const t = ctx.locale.bind(NS);

  // 2) 表单控制器（按 entryId 缓存，entryId === cordis 行 id === 包名）
  const form = ctx.configForms.get('dsh-language-guard');
  const formHook = (selector) => form.subscribe
    ? useSnapshot(form, selector)   // 自建 useSyncExternalStore 包装，见下
    : undefined;

  // 3) 设置卡片：仅在 Host 服务该 namespace 时注册
  ctx.effect(() => ctx.configForms.whileServed(['dsh-language-guard'], () =>
    ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
      name: 'plugins.bundle.config',
      key: 'dsh-language-guard',           // === bundle 包名（plugins.bundle.config 契约）
      locale: NS,
      inject: () => ({
        hooks: { guardForm: form },
        onSet: (field, value) => form.set(field, value),
        onUnset: (field) => form.unset(field),
      }),
    }, GuardSettingsCard))
  ), 'language-guard: settings card');

  // 4) 侧栏快速切换：同一个 whileServed 守卫（Host 未启用则不出现）
  ctx.effect(() => ctx.configForms.whileServed(['dsh-language-guard'], () =>
    ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'language-guard',
      order: 100,
      locale: NS,
      inject: () => ({ hooks: { guardForm: form }, onPick: (code) => form.set('targetLanguage', code) }),
    }, QuickLanguageSwitch))
  ), 'language-guard: quick switch');
}
```

**hook 包装**：`hooks` 里的值需要是「快照 store」（有 `getSnapshot()` + `subscribe()`）或选择器钩子。`ConfigFormController` 本身有 `getSnapshot()` 与 `subscribe()`（`:1122-1132`），符合 snapshot store 形状，可直接放进 `hooks`；renderer 的 `bindInjectSources`（`dsh-client-ui-renderer/lib/client.js:444-458`）会把它绑定成 `use<Name>(selector)`。

---

## 12. 禁止事项（实现者逐条自检）

来自 `references/practices.md` 与 `ui-plugin.md` 的硬规定，本插件全部适用：

1. ❌ `require('@deepseek-ai/dsh-client-ui-primitives')` —— 或把任何 Harness Client 包当模块加载。控件全部自己写。
2. ❌ `<iframe>` —— 拿不到主题 token、明暗切换、`ctx.locale`。
3. ❌ 替换 app root、往 `document.body` 追加第二个应用、把菜单 portal 到 body。
4. ❌ 在组件外写 DOM（模块体里 `document.*.appendChild`、直接改 `style` 标签）。样式用 React 元素渲染；监听器在 effect 里注册并返回清理函数。
5. ❌ 硬编码任何可见文案（中英文都不行）——全部走 `ctx.locale`。
6. ❌ 字面颜色。只用 `--dsw-alias-*`；不写 `@media (prefers-color-scheme: dark)`。
7. ❌ 读别的插件的 DOM / 样式表 / 组件源码来估位置。
8. ❌ 复用 shipped slot id（`cordis-panel`、`activity`、`usage` 等）——会替换掉宿主控件。
9. ❌ 在 Client 半直接读写 `ctx.config.*`（Client 侧没有 Config；唯一入口是 `configForms`）。
10. ❌ 假设 `Config` 字段是普通值——Host 侧永远是 `.get()`。

---

## 13. 下游文档需要同步的差异

### 13.1 `docs/decisions/03-manifest.md`（必须改，否则实现者会删掉 client 半）

| 位置 | 现文 | 应改为 |
| --- | --- | --- |
| `:15` | 「包类型：**纯 Host bundle**，无 client 半身、无构建步骤、零运行时依赖」 | 「Host bundle + Client 半身（`client.js` 手写、无构建步骤），零运行时依赖」 |
| `:23` | 「设置面板由 `Config`（schemastery）自动渲染；快速切换走宿主命令 `/language`，都不需要 client 代码」 | 删除。改为「设置面板与快速切换均由 `client.js` 自建，见 `02-panel.md`」 |
| `:108` | `dsh.client` 一行「**不声明**」 | 改为「声明，见 `02-panel.md` 11.2」 |
| `:126` | 「`dsh.client` 抄进模板值会让宿主去找一个不存在的 client bundle，插件行报错。本包**没有**这个字段」 | 保留「模板的 inject 值不能照抄」的警告，但改为「本包**有** `dsh.client`，`inject` 取 `02-panel.md` 11.2 的三个包名」 |
| `:128-135` | 第 2.2 节「为什么不带 client 半身」 | 整节改写为「为什么必须带 client 半身」，引用 `02-panel.md` 第 1 节 |
| `:408` | `if (p.dsh?.client) die("本包不应有 dsh.client")` | 改为 `if (!p.dsh?.client) die("本包必须有 dsh.client")` + 校验 `platform === "web"` |
| `:533` | A6 修订说明「本包不带 client 是第 2.2 节的明确决策」 | 删除该理由，A6 恢复无条件要求 `./client` 导出与 `client.js` 文件 |

### 13.2 `docs/验收清单.md`

| 条目 | 现文 | 应改为 |
| --- | --- | --- |
| **F6** | 「控件在 **composer 区域**可见、可点击」 | 「控件在**侧栏底部（设置按钮旁）**可见、可点击」（`sidebar.footer.action`）。判定列同步；若仍要求 composer 区域，需明确「两处都注册」——本文决策为**只放侧栏**，理由是语言是全局偏好、`sidebar.footer.action` 是 `scope: "root"` 常驻 |
| **D10** | 「语言定义以 `ctx.locale.addLanguage({ id, label, fallback })` 注册」 | 本插件**不调用** `addLanguage`：它用于「新增一种**界面**语言」，而本插件只提供 `zh`/`en` 两份界面字典（宿主已内置这两种界面语言）。`addLanguage` 会往宿主的界面语言菜单里塞条目，不是本插件的职责。D10 应改为可选/不适用，或改为校验 `ctx.locale.register(NS, {zh, en})` 存在且 `zh`/`en` key 集合相同 |
| **F3** | 「面板出现三档选项，说明文案非空且与 `01-mechanism.md` 一致」 | 补一句：控件形态为 **radio group**，三档说明**同时可见**（验收时逐条与 `01-mechanism.md` 2.1 三句逐字比对） |
| **F7** | 双向同步 | 补一句判定方法：改一处后另一处**在无需刷新页面的情况下**变化（同一 `ConfigFormController` store，见 `02-panel.md` 5.6） |
| **C9** | 「设置页表单出现对应字段」 | 补：字段出现在 `设置 → 插件 → dsh-language-guard` 详情页的配置区块（`plugins.bundle.config`） |

### 13.3 票 #08（README）

需要新增/对齐的面板章节：

- 「设置面板」小节：路径 `设置 → 插件 → dsh-language-guard`，6 个字段的用途表，三档差别说明（逐字取 `01-mechanism.md` 2.1）。
- 「快速切换」小节：侧栏底部图标，5 个预设，自定义标签去设置页填。
- 「验证」小节：`02-panel.md` 10.2 的验证 A/B/C 三步（F8/F9 的实操步骤）。
- 明确写「看不到控件 = 插件未启用」，避免用户误判为 bug。

---

## 14. 实现者照抄清单

1. **`package.json`**：`exports["./client"] = "./client.js"`；`files` 加 `"client.js"`；`dsh.client` 用 11.2 原文（`platform: "web"`、`immediately: true`、三个 inject 包名、无 `external`）。
2. **`client.js`**：`window.__ModuleLoader__.load({ id: 'dsh-language-guard', factory(require) { const React = require('react'); ... return { inject: ['slots','locale','configForms'], apply }; } })`。factory 内无副作用。
3. **字典**：`NS = 'languageGuard'`；`ctx.effect(() => ctx.locale.register(NS, { zh, en }), ...)`；`zh`/`en` 用 4.4 全文（key 集合必须完全一致）。
4. **设置卡片**：注册 `plugins.bundle.config`，`key: 'dsh-language-guard'`，外层 `ctx.configForms.whileServed(['dsh-language-guard'], ...)` + `ctx.effect`。组件必须处理 `view === 'summary'`（返回 `t('card.title')` 一行）与 `view === 'page'`（完整表单）。
5. **三档控件**：3.3 骨架；文案逐字取 3.3 表格；`fieldset`+`legend`+原生 radio+`aria-describedby`；`onChange` 即 `form.set('strength', level)`。
6. **N 字段**：`strength !== 'D'` 时 `disabled` + `t('interval.disabled')`。
7. **语言字段**：文本框（草稿+保存）+ 5 个 chip（点击即 `form.set('targetLanguage', code)`）；本地 BCP-47 校验；非法时 `aria-invalid` 且保存 disabled。
8. **switch**：`role="switch"` + `aria-checked`，`onChange` 即写。
9. **两个 textarea**：草稿 + 「保存」/「放弃更改」；`overrideHead` 包在 `<details>` 里，`summary` 用 `t('advanced.summary')`。
10. **「恢复默认」**：每个字段旁一个，调 `form.unset(field)`。
11. **快速切换**：注册 `sidebar.footer.action`，`id: 'language-guard'`，`order: 100`，外层同样 `whileServed` + `ctx.effect`；5.5 骨架；`absolute` 定位（不用 `fixed`、不 portal）；`aria-haspopup="menu"` + `aria-expanded` + `Escape` 回焦 + 点击外部关闭。
12. **样式**：一个 `const CSS = \`...\`` 常量，用 `<style>` React 元素渲染；类名 `lg-` 前缀；颜色只用 7.2 表里的 token；无 `@media (prefers-color-scheme)`。
13. **不调用** `ctx.locale.addLanguage`（见 13.2 的 D10 说明）。
14. **不注册** `plugins.item`、`plugins.row.config`、`settings.section`、`conversation.composer.dock`。
