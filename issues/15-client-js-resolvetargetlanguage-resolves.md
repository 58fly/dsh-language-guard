<!-- DSH-IDEMPOTENCY-KEY: deck-7f371973-5974670 -->
<!-- parentKey: 01 -->
<!-- created: 2026-10-19T09:10:09.719Z -->
# 缺陷：client.js 镜像段缺 resolveTargetLanguage 且 resolveSource 未转发 defaultLanguage（评审 O1/O3，0.2.0 已修）

## Question

0.2.0 评审（`docs/评审报告-0.2.0.md`）提出三条低危观察 O1/O2/O3，其中 O1 与 O3 都落在 `client.js` 的镜像段上：

- **O1**：`client.js:47-100` 的镜像段注释声称「逐条镜像 `lib/language.js`」，但实际缺 `resolveTargetLanguage()`；两个调用点 `client.js:765`（设置卡片）与 `client.js:1062`（侧栏菜单）各自内联 `mapPreference(uiPreference) || code`，映射规则存在两份。
- **O3**：`client.js:93-100` 的 `resolveSource()` 未转发 `defaultLanguage`，而 Host 侧 `lib/language.js:146` 转了。

这两条是否构成真实缺陷？镜像段的唯一职责就是与 Host 判定完全一致，任何一处缺项都会让面板显示与实际注入分叉——这正是 0.1.1 那次「面板撒谎」的同类问题。因此不是「可改进」，是必须修。

## 进度

<!-- 做到哪一步了，在这里一行一行记 -->

- 2026-10-19 评审 O1/O3 修复完成，随 0.2.0 发布（提交 80f1598，tag v0.2.0）

Status: resolved
Type: bug
Blocked by:
Labels: wayfinder:task, bug

## Comments


## Answer

### 一、O1 修复

`client.js:104-121` 新增 `resolveTargetLanguage(input)`，逐字镜像 `lib/language.js:130-135`：含 `defaultLanguage` 形参与 `?? defaultLanguage` 兜底（用 `??` 不用 `||`，否则空串会被误兜底）。

两个内联调用点改为调它：
- `client.js:791`（设置卡片）：`auto ? mapPreference(uiPreference) || language : language` → `resolveTargetLanguage({ mode, preference: uiPreference, fallback: language, defaultLanguage })`
- `client.js:1092`（侧栏菜单）：`auto ? mapPreference(uiPreference) || code : code` → 同上

映射规则从此只存在一处，「改一处忘改另一处」的结构性风险消除。

### 二、O3 修复

`client.js:120` 取出 `defaultLanguage` 并传入 `effectiveMode({ ..., defaultLanguage })`，与 `lib/language.js:148` 一致。

### 三、两侧比对（运行时比对，不是文本比对）

从 `client.js` 按函数名括号配平提取镜像段（5 常量 + 5 函数），与 `lib/language.js` 在 LANGS(18) × MODES(9) × DEFAULTS(3) 上逐条比输出，含 `null` / `''` / 非法值 / 大小写 / 空格。**共比对 5382 条，不一致 0 条。** 比对命令已写进 `docs/实现说明.md` 6.3.1 节，可直接复跑。

captain 另写了一份独立比对脚本（`/tmp/lgv2/mirror.mjs`，不共享实现工程师的工具），在 LANGS(18) × MODES(9) × FALLBACKS(5) × DEFAULTS(3) = 2430 例 × 5 个函数（`effectiveMode` / `resolveTargetLanguage` / `resolveSource` / `mapPreference` / `normalizeLocaleId`）上比对，**不一致 0 条**，与上述结论互相印证。

### 四、新增断言（`scripts/verify-language.mjs` 34 → 36 项）

- **【镜像 O1】** 四态：auto+`'zh'`→`'zh-CN'`；auto+`null`+fallback`'ja'`→`'ja'`；manual+`'zh'`+`'ja'`→`'ja'`；manual+`null`+`'ja'`→`'ja'`。
- **【镜像 O3】** `{ mode: '', preference: 'zh', fallback: 'zh-CN', defaultLanguage: 'en' }` → `'manual'`（不转发 `defaultLanguage` 时会被判成 auto → `'ui'`）。

两条都做了反向变异验证，确实会 FAIL，不是空转。

### 五、验证结果

| 命令 | 结果 |
| --- | --- |
| `node --check lib/*.js client.js` | 全部通过 |
| `node scripts/verify-language.mjs` | 全部 36 项通过 |
| `node scripts/verify-manifest.mjs` | 43/43 PASS（`dsh-language-guard@0.2.0`） |
| `bash scripts/verify-checklist.sh` | **73 PASS / 0 FAIL / 0 TODO**，退出码 0 |

### 六、连带数字

`client.js` 1354 行 / 59323 B → **1388 行 / 60563 B**；`npm pack` 15 文件 / **53657 → 53870 B**，解包 **163552 → 164792 B**；`docs/实现说明.md:43`、`:310` 与 `docs/发布说明.md:15`、`:107`、`:469`、`:474` 已同步，R23 PASS。

### 七、未触碰

`docs/评审报告-0.2.0.md`、`README.md`、`README.zh.md`、`scripts/verify-checklist.sh` 判据体均无改动（M11 仍 PASS）。

### 八、关联

提交 `80f1598 fix: client 镜像段补 resolveTargetLanguage 并转发 defaultLanguage（评审 O1/O3）`，含在 tag `v0.2.0` 内。O2 另立票处理。
