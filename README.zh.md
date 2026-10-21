# 语言守卫（dsh-language-guard）

[English](README.md) | **简体中文**

> 让 DSH 的智能体用你选定的语言思考与回复——默认简体中文，三档强度，下一条消息即生效，零依赖、零构建。

<img src="https://raw.githubusercontent.com/58fly/dsh-language-guard/main/docs/images/settings-panel.webp" alt="语言守卫设置面板：语言来源（自动 / 手动）、强度档位（基础 / 强化 / 周期）、目标语言与保留代码原文开关" width="760">

---

## 目录

- [为什么需要它](#为什么需要它)
- [它做了什么](#它做了什么)
- [安装](#安装)
- [三档强度](#三档强度)
- [配置项](#配置项)
- [自动语言模式](#自动语言模式)
- [设置面板与快速语言切换](#设置面板与快速语言切换)
- [`/language` 命令](#language-命令)
- [验证约束确实进了 system prompt](#验证约束确实进了-system-prompt)
- [与 dsh-context 共存](#与-dsh-context-共存)
- [与官方 cot-translation 插件的区别](#与官方-cot-translation-插件的区别)
- [已知限制](#已知限制)
- [设计边界](#设计边界)
- [License](#license)

---

## 为什么需要它

DSH 的 system prompt 由许多 section 拼装而成：身份、计划策略、团队策略、**工具说明**、交付物引用、部署人设。其中体量最大的一块是工具说明——英文写的，而且正好落在提示词的中间。

在 DSH 0.2.1-rc.2 上实测（取 order 50 之后的全部内容）：**98.1% 的字符、99.8% 的 ASCII** 来自英文工具说明，首段与末段之间隔着 5.7K–14K 字符。模型读到的绝大多数 token 是英文，于是它漂移：

- 开头几轮还是你的语言；
- 一旦开始连续调用工具、读长文件、做长链推理，内部推理就滑回英文；
- 你的设置一个字都没改——只是会话变长了。

在 system prompt 最顶端写一句「请用中文回答」，短会话够用。长会话不够，因为那句话距离真正影响模型的地方（工具说明）有上万字符。

本插件把约束放在**三个位置**：最前、工具说明之后、最后。默认档（强化）每次请求多花约 146 个字符，换来一次紧跟在英文工具说明之后的重申。

## 它做了什么

三个常驻 system prompt section，通过 `ctx.systemPrompt.section()` 注册，永不注销，切档只切换它们的文本：

| section 名 | order | 位置 | B | C | D |
| --- | --- | --- | --- | --- | --- |
| `language-guard:head` | `-2000` | 最前，早于 `harness:identity`（`-1000`） | ✅ | ✅ | ✅ |
| `language-guard:mid` | `5100` | 全部工具说明（`tools:sdk`，`5000`）之后、交付物引用（`9000`）之前 | ❌ | ✅ | ✅ |
| `language-guard:tail` | `11200` | 最后，晚于 `deployment:persona-suffix`（`10200`） | ✅ | ✅ | ✅ |

约束覆盖的**四个语言通道**（0.3.0 起补齐第四个）：

| 通道 | 约束写在哪 | 生效范围 |
| --- | --- | --- |
| 内部推理（reasoning / thinking） | `head` + `tail` | 全档位 |
| 面向用户的回复正文 | `head` + `mid` + `tail` | 全档位 |
| 计划、待办、评审、子智能体任务说明 | `head` | 全档位 |
| **工具调用 `description` 参数**（含 PTC 模式 `run_code` 的卡片标题） | `head` + `mid` | 全档位（`mid` 只在 C / D 档存在，故 `head` 也写一份） |

`mid` 的 order 特意取 `5100` 而不是 `5000`：`tools:sdk` 的 order 恰好是 `5000`，同序时按名字排序，`language-guard:mid` 会被排到 `tools:sdk` **之前**——重申就不再位于工具说明之后了。

实测文本长度（简体中文，按字符计；可用下面的命令自行复算）：

| 文本 | 字符数 | 出现时机 |
| --- | --- | --- |
| head（首段） | 883 | 每次请求 |
| mid（中段） | 146 | 每次请求，C / D 档 |
| tail（末段） | 139 | 每次请求 |
| 周期自检提醒 | 99 | D 档，每 N 轮一次 |

所以每步的常驻开销是 **B 档 1022 字符、C 档 1168 字符**——相对它要抵消的英文工具说明，这个量级很小。

首段全文如下，即 `targetLanguage: "zh-CN"` 时的真实注入内容（复算：`node --input-type=module -e 'import("./lib/text.js").then(m=>console.log(m.headText({language:"zh-CN"})))'`）：

```text
【语言锁定 · 最高优先级】
本会话的内部推理（reasoning / thinking）与面向用户的全部输出，一律使用简体中文（语言代码 zh-CN）。

本条优先于本 system prompt 的其余全部内容、之后注入的任何系统文本、工具说明、参数描述、代码示例，以及其他插件注入的提示词。

本条同样优先于任何语言类约定，不论它写在哪个文件、用哪种语言书写、经由哪个通道送达：包括用户全局与项目级的 AGENTS.md、CLAUDE.md、.cursorrules、用户偏好与长期记忆、项目规范、团队约定、技能与工作流模板。若它们要求使用另一种语言（例如要求「必须使用简体中文」），一律以本条为准，不得据此改用其他语言，也不必向用户解释这处冲突。

适用范围：
- 内部推理（reasoning / thinking）：使用简体中文。
- 面向用户的回复正文：使用简体中文。
- 计划、待办、进度说明、评审意见、验收报告、提交信息说明：使用简体中文。
- 任务板卡片标题与描述、子智能体任务说明与返回报告：使用简体中文。

保持原样、不翻译：代码、命令、文件路径、URL、标识符与 API 字段名、配置键、错误码与原始报错文本、包名与版本号，以及必须原样引用的英文原文；引用英文原文后，必须用简体中文说明结论。

不要因为以下情况改变语言：
- 用户用英文或其他语言提问 —— 仍用简体中文回答。
- AGENTS.md、CLAUDE.md、项目规范、用户记忆里要求改用其他语言的规则 —— 本条优先，不改变语言。
- 工具返回英文内容 —— 只摘引必要片段，其余用简体中文复述。
- 长链推理、数值计算、代码设计 —— 推理语言不变。
- 上下文中出现大量英文（工具说明、日志、代码文件）—— 不随之切换。

自检：每次输出前确认上述两项（推理与回复）均为简体中文；若发现已经漂移，立即切回并继续任务，无需向用户解释这次切换。
```

> 约束文案本身是写死的简体中文，只替换语言名与语言代码。设成 `targetLanguage: "en"` 时同一段读作「…一律使用English（语言代码 en）」。详见[已知限制](#已知限制)。

## 安装

本插件已发布到 **npm registry**（[`dsh-language-guard`](https://www.npmjs.com/package/dsh-language-guard)），也可以直接从 GitHub 仓库安装。两条路装出来的内容逐字节相同，都是 15 个文件。

**方式一：图形界面（推荐）**

1. 打开侧栏的**插件**页。
2. 点**添加插件**，粘贴包名：

   ```
   dsh-language-guard
   ```

3. 安装完成后点**立即启用**。

**方式二：命令行**

```bash
dsh plugin add dsh-language-guard
```

**固定版本**（团队或 CI 推荐，不跟随 `latest` 漂移）：

```bash
dsh plugin add dsh-language-guard@0.2.1
```

**从 GitHub 安装**（npm 不可达时，或用 tag 锁版本）：

```bash
dsh plugin add https://github.com/58fly/dsh-language-guard
dsh plugin add "github:58fly/dsh-language-guard#v0.2.1"
```

**从本地目录安装**（调试本地改动，路径必须是绝对路径）：

```bash
# 「添加插件」对话框同样接受这个绝对路径
dsh plugin add /absolute/path/to/dsh-language-guard
```

怎么确认装上了：

- 侧栏底部、设置按钮旁边出现一个语言图标；侧栏较宽时显示「简体中文 ▾」。
- 插件页的已安装列表里有 `dsh-language-guard`，点进去能看到配置卡片。

> **看不到任何控件，就是插件没启用。** 两个 slot 都注册在 `configForms.whileServed(['dsh-language-guard'], …)` 内部；插件被禁用时表单服务不可用，不会注册任何界面。这是有意为之，不是 bug——先去插件页启用它。

环境要求：DSH `>= 0.2.1-rc.2`，Node `^22.19.0 || >=24.0.0`。`dependencies` 为空、peer 依赖全部 optional，所以运行时不需要额外下载依赖。从 npm 安装只需能访问 `registry.npmjs.org`；从 GitHub 安装则需要能访问 `github.com`（或 `codeload.github.com`）。

## 三档强度

下面三条说明与设置面板上显示的文字完全一致：

| 档位 | 配置值 | 说明 |
| --- | --- | --- |
| 基础 | `B` | 只在提示词首尾各放一段语言约束，成本最低，适合短会话。 |
| 强化 | `C` | 在基础之上，于工具说明之后补一段重申，抵消英文工具说明带来的语言漂移，推荐默认。 |
| 周期 | `D` | 在强化之上，每 N 轮在当轮开头追加一条语言自检提醒，适合长会话；提醒会作为一条会话记录出现，可在会话日志中看到。 |

行为差异：

| 行为 | B | C | D |
| --- | --- | --- | --- |
| 常驻 system prompt 段数 | head + tail | head + mid + tail | head + mid + tail |
| 工具说明之后重申 | ❌ | ✅ | ✅ |
| 每 N 轮自检 | ❌ | ❌ | ✅（N 默认 8，范围 3–50） |
| 会话日志新增记录 | 无 | 无 | 每 N 轮一条（`source.kind = "language-guard"`） |
| 注入时机 | — | — | 命中轮的**第一个 step**，随当轮用户消息一起进入模型视图，不额外发请求 |
| 重启 / 恢复后计数 | — | — | **不归零**：轮次取自会话日志的 turn 投影，`turn % N` 稳定 |
| 适合 | 短会话、在意 token | 默认选择 | 长会话，或已经观察到漂移 |

怎么选：

- **先用默认的「强化」。** 它是唯一针对真正根因（英文工具说明）的档位，每步只多约 146 字符。
- **会话很短、或每个 token 都要省** → 降到**基础**。3–5 轮的会话，首尾两段足够。
- **一轮会话几十轮起步，或已经看到推理滑回英文** → 升到**周期**。N 越小提醒越密，默认 8 是折中，N = 3 会明显啰嗦。

## 配置项

七个字段，全部是 `volatile`（改动立即生效，不需要重启，也不重挂插件）：

| 字段 | 类型 | 默认值 | 取值范围 | 说明 |
| --- | --- | --- | --- | --- |
| `languageMode` | `"" \| "auto" \| "manual"` | `""` | 三态枚举，大小写敏感 | 语言模式。`"auto"` 跟随界面语言、`"manual"` 固定用 `targetLanguage`、`""` 表示「还没选过」，按迁移规则推断（见下节） |
| `targetLanguage` | `string` | `"zh-CN"` | 合法 BCP-47 标签（`/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/`） | 目标语言。`zh-CN` 简体中文、`zh-TW` 繁體中文、`en` English、`ja` 日本語、`ko` 한국어；其他合法标签按原样使用 |
| `strength` | `"B" \| "C" \| "D"` | `"C"` | 枚举，大小写敏感 | 强度档位，见上 |
| `injectEveryNRounds` | `number` | `8` | 3–50 的整数 | 周期自检的间隔。只在 D 档生效，其他档位该控件禁用 |
| `preserveCodeTerms` | `boolean` | `true` | `true` / `false` | `true`：代码、命令、路径、标识符、API 字段与原始报错保持原样。`false`：技术名词优先用目标语言表达，必要时括号附英文 |
| `extraRules` | `string` | `""` | 任意文本 | 追加在内置规则之后。留空表示只用内置规则 |
| `overrideHead` | `string` | `""` | 任意文本 | **完全替换**内置首段文本（`extraRules` 仍会追加在其后）。留空或纯空白回退内置文本 |

`targetLanguage` 到语言显示名的映射是固定的（不做语言猜测）：`zh-CN` / `zh-Hans` / `zh-SG` → 简体中文，`zh-TW` / `zh-HK` / `zh-MO` / `zh-Hant` → 繁體中文，`en` / `en-US` / `en-GB` → English，`ja` / `ja-JP` → 日本語，`ko` / `ko-KR` → 한국어；其他合法标签直接显示代码本身。

配置落在 profile 的 `cordis.patch.yml` 里。**patch 对 `config` 是整体替换，不做深合并**——手写覆盖时必须把每个字段都写全，否则漏掉的字段会丢：

```yaml
- id: dsh-language-guard
  name: dsh-language-guard
  config:
    languageMode: auto
    targetLanguage: zh-CN
    strength: C
    injectEveryNRounds: 8
```

## 自动语言模式

`languageMode` 决定目标语言从哪来：

| 模式 | 行为 |
| --- | --- |
| **自动** | 目标语言跟随 DSH 的**界面语言**。你把界面切成英文，下一条消息就变成英文约束 |
| **手动** | 目标语言固定用 `targetLanguage`，与界面语言无关 |

**默认是自动。** 新装用户什么都不用设：界面是简体中文就约束简体中文，界面是英文就约束英文。

### 解析顺序

自动模式只有两个来源，按顺序取第一个有效的：

1. **界面语言**（`locale` 配置里的 `preference`）——这是 `Settings → General → Language` 那一项。
2. **`targetLanguage` 配置值**（默认 `zh-CN`）——界面语言读不到时兜底。

映射规则（`zh` 开头的标签 → `zh-CN`、`en` 开头的标签 → `en`，其余合法标签原样保留）：

| 界面语言 | 目标语言 | 约束读作 |
| --- | --- | --- |
| `zh` / `zh-CN` / `zh-Hans` | `zh-CN` | 简体中文 |
| `en` / `en-US` | `en` | English |
| `ja` | `ja` | 日本語 |
| `ko` | `ko` | 한국어 |
| 其他合法 BCP-47 | 原样 | 该语言的显示名或代码 |

> **为什么没有「系统语言」这一档？** Host 半是 `ELECTRON_RUN_AS_NODE=1` 的子进程，`require("electron")` 直接抛 `Cannot find module 'electron'`；`Intl.DateTimeFormat().resolvedOptions().locale` 恒返回 `en-US`，会把中文用户误判成英文。**Host 侧没有可靠的系统语言信号**，所以插件不去猜，也不编一个假信号出来。

### 从 0.1.x 升级

老用户手选过 `targetLanguage`（比如设成 `ja`）却没碰过 `languageMode` 的，升级后**仍然是手动模式**，语言不会被界面语言静默覆盖。规则是：`languageMode` 为空串且 `targetLanguage` 不等于默认值 `zh-CN` → 判为手动。

想改成跟随界面，在设置卡片里点「自动」即可；一旦显式选过，迁移规则就永久失效。

### 怎么知道现在解析成什么

设置卡片第一组控件就是语言模式，选「自动」时下面直接写出当前结果与来源：

```text
当前解析为 简体中文
来自界面语言
```

来源行显示「来自界面语言」时，指的是**你在 DSH 设置里显式选过的界面语言**；从没选过时显示「未识别到界面语言，用配置值兜底」，而不是拿浏览器或系统语言去猜——Host 与设置面板读的是同一个值（`settings.describe()` 里 `locale` 命名空间的 `preference`），所以面板显示什么、实际就注入什么，不会分叉。侧栏快速切换按钮的标签也会读作「自动，简体中文」这样的当前状态。

**改界面语言不需要重启**：插件在启动后缓存界面语言，并订阅 `settings/document-updated`（`locale` 命名空间变化时刷新），所以下一次装配 system prompt 就用了新值。

## 设置面板与快速语言切换

### 设置面板

路径：**侧栏插件页 → 已安装插件 → `dsh-language-guard`**。配置卡片渲染在组合包页面上、描述与行列表之间（`plugins.bundle.config` slot，以包名为 key）。设置里的插件分区只保留只读信息，配置在这里改。

卡片自上而下：

1. **语言模式**——自动 / 手动两行单选。选自动时下面直接写出「当前解析为 X」与来源（界面语言 / 配置值），切换界面语言后这里跟着变。自动态下第 3 项的目标语言控件置灰。
2. **强度档位**——三行单选（`fieldset` + 同名 `radio`），三条说明并列可见，C 档带「推荐」徽标。用单选组而不是 `<select>`，因为三档差别必须一眼可比。
3. **注入间隔（轮）**——数字输入框，3–50，非周期档时禁用并给出说明。
4. **目标语言**——文本框 + 五个预设 chip（简体中文 / 繁體中文 / English / 日本語 / 한국어）。自定义标签直接填进文本框，输入即校验，非法时保存按钮禁用。
5. **保留代码与术语原文**——开关（`role="switch"` + `aria-checked`）。
6. **附加约束**——文本框，带本地草稿与「保存 / 放弃更改」。
7. **覆盖首段规则（高级）**——默认折叠。改它等于整段替换最高优先级的约束，所以收起来。

每个字段都有「恢复默认」（清掉用户值，回到 schema 默认值）。

保存态文案是「已保存 · 无需重启，下一条消息即生效」。档位、开关、间隔是变更即写；文本类字段走本地草稿 + 显式保存，避免每敲一个字都写一次盘。

### 快速语言切换

在侧栏底部、设置按钮旁边（`sidebar.footer.action` slot，`id = "language-guard"`，`order = 100`）：

- 侧栏较宽：图标 + 该语言的自称 + `▾`。
- 侧栏收成 56px 窄条：只显示图标，`aria-label` 仍然完整。
- 点击弹出下拉菜单（不是循环切换）。**第一项是「自动」**（跟随界面语言），后面才是五个预设。当前项打勾；自动态下按钮标签读作「自动，简体中文」，菜单里「自动」那一项下方读作「当前自动解析为 简体中文」。当前值不属于五个预设时显示原始代码，预设项都不打勾。
- 键盘：Enter / Space 打开，Escape 关闭并把焦点还回按钮，↑↓ 在菜单内移动。
- 菜单底部有一行提示，指向设置页文本框填其他语言。

选一项即写入配置（选具体语言会同时把模式切成手动，模式与语言同批原子写入，不会留下半截状态），侧栏标签与设置页文本框双向同步。写入完成后按钮上方会出现一行 4 秒后自动消失的提示：改成新语言时是「已保存 · 无需重启，下一条消息即生效」，选中项本来就是当前语言时是「当前已是 X」（不会静默无动作），写入失败时显示失败原因。

> **改配置不需要重启 DSH**。配置写入走 `dsh-config-editor`，它在改完磁盘后立即让 Loader 应用；volatile 字段只替换运行中的引用、不重挂插件（`cordis-plugin-loader` 的 `_commitVolatile` → `loader/volatile-update`），而 system prompt 是每次请求重新装配的，所以**下一条消息**就带上新语言。需要重启的只有**改插件代码**（例如升级版本），不是改配置。

### `/language` 命令

在输入框里用的快捷方式。它只设置本次运行的内存覆盖，**不写配置**，重启后回到配置值：

```text
/language          报告当前语言与配置值
/language ja       本次运行切到日语
/language reset    清除覆盖，回到配置值
/language default  等同 reset
```

非法标签返回错误且不改任何东西。覆盖优先于配置：`覆盖 > 配置值 > 默认值`。

## 验证约束确实进了 system prompt

档位、面板、开关，在没看到模型真正收到什么之前都只是说法。DSH 会把每次请求的 system prompt 作为 `system/message` 事件记进会话日志（`~/.dsh/sessions/<转义后的工作目录>/<会话 id>/session.v4.jsonl.zstd`）。下面三步在任何装好本插件的环境里都能复现。

### 第一步：改档位，不重启

1. 打开设置面板（侧栏插件页 → `dsh-language-guard`）。
2. 把强度从「强化」切到「周期」。
3. 卡片底部显示「已保存 · 无需重启，下一条消息即生效」。

### 第二步：读会话日志，看 system 节点

在任意会话里发一条普通消息（比如「你好」），然后执行：

```bash
# 1. 找最近写入的会话日志
latest=$(ls -t "$HOME"/.dsh/sessions/*/*/session.v4.jsonl.zstd | head -1)
echo "$latest"

# 2. 解压成 JSONL（macOS 上没有 zstd 先 brew install zstd）
zstd -dc "$latest" > /tmp/dsh-session.jsonl

# 3. 打印每个 system 节点的长度，并检查三段是否都在
node -e '
const fs = require("node:fs");
const lines = fs.readFileSync("/tmp/dsh-session.jsonl", "utf8").split("\n").filter(Boolean);
const sys = lines.map((l) => JSON.parse(l)).filter((o) => o.type === "system/message");
const marks = ["【语言锁定 · 最高优先级】", "【语言锁定 · 中段重申】", "【语言锁定 · 收尾复述】"];
console.log("system 节点数:", sys.length);
sys.forEach((o, i) => {
  const text = o.data.message.content.map((p) => p.text || "").join("");
  const hit = marks.filter((m) => text.includes(m)).length;
  console.log(`#${i} turn=${o.data.turn} step=${o.data.step} 长度=${text.length} 三段命中=${hit}/3`);
});
'
```

在「强化」（或「周期」）档下应看到 `三段命中=3/3`。

### 第三步：切到「基础」，看中段消失

1. 把强度切到「基础」，再发一条消息。
2. 重跑第二步的命令。

新的 system 节点应报 `三段命中=2/3`——缺的是`【语言锁定 · 中段重申】`——且长度比上一个节点**短 146 个字符**，正好是中段的长度（见[它做了什么](#它做了什么)）。基础档下 `language-guard:mid` 返回空字符串，`renderPrompt` 会把空文本过滤掉，所以不会留下空 section 或多余空行。

### 补充检查

- **周期提醒**：把强度设为「周期」、间隔设为 3，然后聊 3 轮。会话日志里会出现 `user/message` 事件，其 `data.message.source.kind` 为 `"language-guard"`、`form` 为 `"notice"`、`summary` 为 `"语言自检"`。界面上它渲染成折叠的一行「上下文注入 · language-guard · 语言自检」——它不会伪装成用户的一轮发言。
- **子代理被跳过**：周期档下派一个子智能体，它的会话日志里没有 `source.kind = "language-guard"` 的记录（子代理继承父会话的 system prompt 约束，紧凑上下文不去打扰它）。
- **切换语言**：从侧栏菜单选「日本語」，发一条消息，新 system 节点读作「一律使用日本語（语言代码 ja）」。
- **停用插件**：停用后没有 section、没有注入，新 system 节点报 `三段命中=0/3`。这是干净的回退，不是残留。

### 一键自检

上面这些手工步骤可以合并成一条命令：

```bash
node scripts/verify-installed.mjs
```

它会自动找最近写入的会话日志、解压、统计每个 `system/message` 节点的长度与三段命中数，并直接给出两个结论：**旧方案（dsh-context 的 promptPrefix/promptSuffix）是否还有残留**、**本插件是否生效**。也接受显式路径：

```bash
node scripts/verify-installed.mjs ~/.dsh/sessions/<项目>/<会话>/session.v4.jsonl.zstd
```

需要系统里有 `zstd` 命令（macOS：`brew install zstd`）。

## 与 dsh-context 共存

第三方插件 `dsh-context` 注册的 `promptPrefix` / `promptSuffix` 两段，order 与本插件的**完全撞值**（`-2000` 与 `11200`）。

- **不会出错**：排序是 `order - order || compareNames(name)`，同 order 不等于同名。`"dsh-context:prompt-prefix" < "language-guard:head"`（`d` < `l`），所以 dsh-context 的两段稳定排在本插件前面。
- **但 token 会烧两遍**：两者都在往同一个位置写语言约束——同一件事，说了两次。
- **建议**：装好本插件后，把 `dsh-context` 的 `promptPrefix` / `promptSuffix` 清空，或直接停用 `dsh-context`。

设置卡片底部有一行常驻提示，`locale/{zh,en}.json` 的 `meta.description` 里也写着同一句。本插件**不检测也不改写** `dsh-context` 的配置——写别的插件的配置违反最小惊讶原则。

## 与官方 cot-translation 插件的区别

`@deepseek-ai/dsh-experimental-client-ui-cot-translation`（配合 `cot-translation-bundle`）是官方实验插件，做的是**渲染层翻译**：把界面上展开的推理内容机器翻译成另一种语言显示。它自己的 README 明确写着：翻译会把展示出来的推理内容发送给选定的外部服务，其中可能包含私有代码或会话细节；原始推理仍保留在会话与模型上下文中。

本插件做的是**生成层约束**：在 system prompt 里告诉模型，用你选的语言思考与回答。

| | cot-translation | dsh-language-guard |
| --- | --- | --- |
| 作用于 | 已经渲染到界面上的推理文本 | 模型的下一次生成 |
| 层次 | Client 渲染（`conversation.chat.reasoning.body` slot） | Host system prompt（`ctx.systemPrompt.section()`） |
| 联网 | 会，把文本发给外部翻译服务 | 不会，零网络请求 |
| 读会话内容 | 会，把推理正文送出 | 不会，只写自己的约束段 |
| 原始推理的语言 | 不变（仍在会话与上下文中） | 就是你配置的语言 |

两者是**互补而非竞争**：一个决定模型用什么语言思考，另一个决定这份思考显示成什么语言。可以同时装——但如果本插件已经把思考钉在简体中文，把 cot-translation 也指向简体中文就没有增量；它有价值的设置是反方向（模型用中文思考，你读英文）。

## 已知限制

- **约束文案本身是写死的简体中文。** 只替换语言名与语言代码，所以 `targetLanguage: "en"` 时注入文本读作「…一律使用English（语言代码 en）」。模型能正常处理，但行文没有本地化。模板本地化留待后续版本。
- **周期提醒在会话界面上可见**，折叠成一行「上下文注入 · language-guard · 语言自检」。英文标识符 `language-guard` **无法隐藏**——客户端把 `source.kind` 原样当作注入标签渲染，官方 `agent-instructions`、`skill-invocation` 同样如此。要本地化它得为上下文节点写一个自定义 `conversation.chat.node` 渲染器，首版不做。
- **Client 半拿不到轮次计数**，所以面板无法显示「下一次注入会落在第几轮」。
- **快速切换菜单只列五个预设加一条「当前自定义」。** 自定义 BCP-47 标签必须在设置页文本框里填；手动模式且当前值不在预设内时，菜单会多出一条「当前自定义：<语言名>」并处于勾选态，避免六项全无勾选看起来像「没设过语言」。菜单无法枚举任意标签，切换其它自定义值仍要回设置页。
- **绝对锁定，不给单轮开口子。** 有意的设计取舍：本插件是「设定一次、全程有效」，所以「这次先用英文回答」这类当轮指令**不会**让它临时切走——想换语言就改设置或用 `/language`。这与「按轮灵活切换」是相反的取向，需要按轮切换的用户不适合用本插件。
- **检测不到是否装了 `dsh-context`**，所以提示是常驻的（见上）。
- **周期档不会唤醒空闲会话。** `agent/pre-step` 只在轮次运行中触发，不发消息就没有提醒——语言守卫不应该自己产生对话。
- **`mid` 的位置可能被未来的插件挤压。** 如果有插件在 order `5000` 到 `9000` 之间插段，「工具说明之后」的语义会被稀释。届时的修法是把 `mid` 提到 `8900`（仍在交付物引用 `9000` 之前）；再不行就回退到基础档，它不依赖 `mid`。
- **无法自动区分简体与繁体。** DSH 内置界面语言只有 `zh` 与 `en`（`dsh-client-locale/lib/index.js:11` `LOCALE_IDS = ["zh","en"]`），`zh` 不区分简繁；而 Host 侧拿不到系统语言。因此界面语言为「中文」时，自动模式一律解析为 `zh-CN`。需要繁体输出的用户请把语言模式切到「手动」并选 `zh-TW`。日本語 / 한국어 同理：标准安装下自动模式只能解析出 `zh-CN` 或 `en`，需要这两种语言请切到「手动」自行选择——若你装了对应的外部语言包，它的语言标签会原样透传。
- **不覆盖 API 的 `tools` 参数本身。** 真正传给模型的工具 schema 在请求的 `tools` 参数里，不在 system prompt 内；本插件只在提示词侧要求模型用目标语言书写 `description` 参数，无法改写 schema 里的英文措辞。模型若不遵从，工具卡片标题仍会是英文——这是提示词级约束的固有边界，不是配置问题。
- **不自动跟随操作系统语言。** 插件读取的是你在 DSH 设置里选择的界面语言，不是操作系统语言。DSH 的 Host 进程以 `ELECTRON_RUN_AS_NODE=1` 运行，拿不到 Electron 的 `app.getLocale()`；Node 的 `Intl` 在该进程里恒为 `en-US`，用它会把中文用户误判成英文，所以我们选择不用它。
- **自动模式跟的是界面语言，不是你输入的语言。** 界面是简体中文、你用英文提问，约束仍然是简体中文（这是设计意图：插件声明默认语言，不猜单轮输入）。想按输入语言变，只能手动切。
- **切档会改变 system prompt**，因此 DSH 会追加一个新的 system 节点（in-history 替换）。这是一次性的 token 开销，属于预期行为。

## 设计边界

本插件刻意**不**做下面这些事——每一件都会破坏宿主约定，或者让排查变得不可能：

- 不监听 `system-prompt/assemble` 去增删宿主文本；只用 `ctx.systemPrompt.section()` 声明自己的段。
- 不改写 `llm/stream` 的 reasoning delta——绝不伪造「思考过程」。
- 在 `agent/pre-step` 里除 `messages` 之外不碰任何 decision 字段，也不追加新的事件类型；周期路径返回 `{ ...decision, messages }`，保留 `startsRequestSeries` 等其余字段。
- 不联网、不读会话内容、不上报任何数据。
- `dependencies` 为空；Client 半只从宿主模块表里 `require('react')`。
- 约束文本在会话内保持稳定，避免频繁 in-history 替换与 prompt cache 失效。

## License

[MIT](LICENSE) © 58fly

仓库：<https://github.com/58fly/dsh-language-guard> · 问题反馈：<https://github.com/58fly/dsh-language-guard/issues>
