<!-- DSH-IDEMPOTENCY-KEY: deck-plan-dsh-language-guard-map-v1-child-decide-docs -->
<!-- parentKey: 01 -->
<!-- created: 2026-10-18T13:16:25.063Z -->
# 决策：中英双语 README 与验证文档结构

定下 README 的双语结构与内容大纲。

要定的事：
1. 双语方案：`README.md`（英）+ `README.zh.md`（中）双文件，还是单文件双语切换？（对照官方包的做法）
2. 章节大纲：安装 / 快速开始 / 三档说明 / 配置项 / 验证方法 / 常见问题 / 开发 / 许可。
3. **验证方法**章节的具体内容：如何解压 session 日志确认约束真的进了 system prompt（这是差异化卖点，必须可复制执行）。
4. 竞品对比章节要不要写、怎么写才不失礼。
5. LICENSE（MIT）与 CONTRIBUTING 是否需要。

产出：写入 `docs/decisions/04-docs.md`，含中英双语章节大纲与验证章节的完整命令。

完成标准：写文档时只需按大纲填充，不需再设计结构。

## 进度

README.md（英文，23298 B / 323 行）与 README.zh.md（简体中文，21044 B / 323 行）已落盘，结构一一对应、顶部互链。docs/实现说明.md 已同步到最终代码（2.1 README 行、4.7 字典键数 44、6.2 打包 14 文件实测值、6.5 补 zstd 自证法、7 已知限制扩到 10 条）。npm pack --dry-run 实测 14 文件 / 39309 B。

Status: done
Type: task
Blocked by: #06, #04
Labels: wayfinder:task

## Comments

## Answer

### 一、交付物与实测尺寸

| 文件 | 语言 | 字节 | 行数 | 首行 |
|---|---|---|---|---|
| `README.md` | 英文 | 23298 | 323 | `**English** \| [简体中文](README.zh.md)` |
| `README.zh.md` | 简体中文 | 21044 | 323 | `[English](README.md) \| **简体中文**` |

两版**行数完全相同（各 323 行）**、章节顺序与表格、代码示例一一对应。中文版为准，英文版为对等翻译（非机翻，英文版按英文技术文档习惯重写句式，但事实、数字、命令逐项对齐）。

同时更新 `docs/实现说明.md`（287 → 331 行），使其与最终代码一致：2.1 的 README 行由「由 t9 交付（未创建）」改为已交付并列出章节；4.7 的「43 个 key」改为实测 44；6.2 由「预期 12 个文件（补齐后 14）」改为实测 `entryCount: 14 / size: 39309 / unpackedSize: 116489` 并附复核命令；6.5 补入 zstd 自证法；7 已知限制由 4 条扩到 10 条，与 README 逐条对应。

### 二、两版共同的 13 个二级章节

1. 为什么需要它（`Why you need it`）
2. 它做了什么（`What it does`）
3. 安装（`Install`）
4. 三档强度（`Strength levels`）
5. 配置项（`Configuration`）
6. 设置面板与快速语言切换（`Settings panel and quick language switch`）
7. `/language` 命令（`The /language slash command`）
8. 验证约束确实进了 system prompt（`Verifying that the constraint reached the system prompt`）
9. 与 dsh-context 共存（`Coexisting with dsh-context`）
10. 与官方 cot-translation 插件的区别（`How it differs from the official cot-translation plugin`）
11. 已知限制（`Known limitations`）
12. 设计边界（`Design boundaries`）
13. License

另有顶部一句话价值主张、目录、`dsh-context` 共存提示（正文专章 + 安装节后提示）。

### 三、逐节内容要点（都可验证，无空话）

**为什么需要它**：给出根因数字——DSH 0.2.1-rc.2 上取 order 50 之后的全部内容，98.1% 字符 / 99.8% ASCII 来自英文工具说明，首段与末段之间隔 5.7K–14K 字符。说明「顶端写一句请用中文」为什么短会话够、长会话不够。

**它做了什么**：三 section 注册表（`language-guard:head` -2000 / `mid` 5100 / `tail` 11200，B/C/D 三列 ✅❌），并解释 mid 为何取 5100 而非 5000（`tools:sdk` 恰为 5000，同序按 name 排序会把 mid 排到工具说明之前）。给出四段文本实测字符数表（head 552 / mid 118 / tail 113 / reminder 99；B 合计 665、C 合计 783），并**全文贴出 head 的真实注入内容**（`targetLanguage: "zh-CN"`），附复算命令。

**安装**：图形界面（侧栏插件页 → 添加插件 → 输入包名 → 立即启用）与 CLI（`dsh plugin add dsh-language-guard`）两条路径，另给本地目录安装（`dsh plugin add /Volumes/data/dsh-cn-think`）。明确写「看不到控件 = 插件没启用」及其机制（两个 slot 都在 `configForms.whileServed(['dsh-language-guard'], …)` 内）。

**三档强度**：三条说明**逐字**取自 `01-mechanism.md` 2.1（与 `client.js` 字典的 `strength.basic.desc` / `strong.desc` / `periodic.desc` 完全一致），另加行为差异表（常驻段数 / 中段重申 / 每 N 轮自检 / 日志记录 / 注入时机 / 重启后计数 / 适用场景）与「怎么选」三档建议。

**配置项**：6 字段表（类型 / 默认值 / 范围 / 说明），`targetLanguage` 的 BCP-47 正则、`strength` 枚举、`injectEveryNRounds` 3–50、`preserveCodeTerms` 布尔、`extraRules` 与 `overrideHead` 的差异（追加 vs 完全替换）。给出语言映射表（不做猜测）与 `cordis.patch.yml` 手写示例，并强调 **patch 对 config 是整体替换不深合并**。

**设置面板与快速语言切换**：面板路径与卡片自上而下六项控件；快速切换的 `sidebar.footer.action` slot、`id`、`order=100`、wide/rail 两形态、菜单行为与键盘支持；`/language` 命令四个用法与「只写内存覆盖、不写配置」的边界。

**验证**：三步可复制流程（改档位不重启 → `zstd -dc` 解压 `session.v4.jsonl.zstd` + `node` 脚本打印每个 system 节点的 `turn/step/长度/三段命中` → 切基础档复验 `2/3` 且长度**恰好短 118 字符**）。附四条补充检查（周期提醒的 `source.kind`、子代理被跳过、切语言、停用后 `0/3`）。

**共存与竞品**：`dsh-context` 撞 order 但不同名的排序证据（`"dsh-context:prompt-prefix" < "language-guard:head"`）与「不报错但重复烧 token」的结论、清空建议。cot-translation 用其 README 原文要点（把展示的推理发给外部服务、原始推理仍在上下文）作对照，给出六行对比表与「互补而非竞争」的判断。

**已知限制**：10 条，含模板中文写死（`en` 档出现「中文框架 + English」混排）、`language-guard` 标识符无法隐藏（`source.kind` 原样渲染，官方 `agent-instructions` 同样）、Client 无轮次计数、菜单仅 5 预设、不硬顶用户显式指令、周期不唤醒空闲会话、mid 位置可能被挤压、切档产生 in-history 替换。

**设计边界**：不监听 `system-prompt/assemble`、不改写 `llm/stream` reasoning delta、`agent/pre-step` 除 `messages` 外不碰 decision、不联网不读会话、零依赖、文本会话内稳定。

### 四、覆盖的验收项

| 项 | 状态 | 证据 |
|---|---|---|
| R6 中英双语且章节对等 | ✅ | 两版各 13 个 `^## `，行数各 323；`grep -c dsh-context README.md README.zh.md` → `7 / 7` |
| R7 顶部互链 | ✅ | `head -3` 两版首行互链，第二行语言标注 |
| R8 验证步骤可照做 | ✅ | 三步含具体路径与可粘贴命令，无「自行观察」类措辞；`brew install zstd` 提示两版都有（各 1 处） |
| F3 三档文案逐字 | ✅ | 三条 desc 与 `client.js:72/74/76` 逐字一致 |
| F17 / D13 共存提示 | ✅ | README 专章 + 面板 `notice.contextConflict` + 两 locale `meta.description`，三处齐备 |
| R5 License | ✅ | 末章 `[MIT](LICENSE) © 58fly` |
| F4 mid order 5100 | ✅ | README 明确写出取 5100 及理由，未沿用清单旧括注 5000 |

`npm pack --dry-run --json` 实测 **14 文件 / 39309 B**，`README.md` 与 `README.zh.md` 均在清单内。

### 五、没把握 / 需上游确认的地方

1. **head 字符数与决策文档差 4**。`docs/decisions/01-mechanism.md` 第 0 节现写「head 556 + tail 113 = 约 670」，而 `node` 实测 `headText({language:"zh-CN"}).length === 552`、`wc -m` 同为 552、B 合计 665、C 合计 783。README 采用实测值 552 / 665 / 783 并附复算命令。若验收按 556 / 670 比对需先统一口径——建议以 `lib/text.js` 实测为准，把决策文档的 556 改回 552、670 改回 665。
2. **`targetLanguage: "en"` 的实际观感**只有静态推演（模板中文写死，仅替换 `⟨LANG⟩`/`⟨CODE⟩`），未在真实会话里跑过 en 档。README 已在「已知限制」如实写明「中文框架 + English 混排」，未夸大。
3. **「长度恰好短 118 字符」的验证预期**基于 `midText` 实测 118 字符且无其他 section 变化。若同一会话中途还有别的插件切段，差值会被扰动；README 的判读口径是「与上一个节点比较」，默认会话内其余条件不变。
4. **英文版标题语言**：英文版章节名按英文习惯重写（如 `What it does` 而非直译 `What it does for you`），非逐字对译；R6 只要求「章节对等」，此处按语义对等处理。
