<!-- DSH-IDEMPOTENCY-KEY: deck-35dbda87-5974672 -->
<!-- parentKey: 01 -->
<!-- created: 2026-10-19T09:21:10.714Z -->
# 缺陷：Client 镜像段无回归防护（G1：resolveTargetLanguage / resolveSource 两侧等价性零覆盖）

## Question

0.2.0 终版复核（`docs/评审报告-0.2.0.md` 第八节 8.5）发现一处**回归防护缺口 G1**，captain 已独立核实三条依据全部成立：

1. **`scripts/verify-language.mjs:24` 只 import `../lib/language.js`**，从不读 `client.js`。而 O1/O3 的修复本体在 `client.js`。
2. **`client.js:49-56` 的注释与事实不符**：原文写「`scripts/verify-checklist.sh` 的 M1–M4 断言两侧规则文本一致」，但实际 M1 只比 `mapPreference` 的 zh/en 两条规则、M2 只比 `effectiveMode` 的三元式，**M3 是 Config 默认值、M4 是 radio group 结构**，都不是两侧规则比对。
3. **`resolveTargetLanguage` 与 `resolveSource` 两个函数在两侧的等价性，仓库内零覆盖**。变异实测：把 `client.js:112` 的 `MODE_MANUAL` 改成 `MODE_AUTO`，`verify-language.mjs` 仍 exit 0 / FAIL 0；`verify-checklist.sh` 唯一报警的是 R23（文档尺寸），而 R23 是改任何字节都会触发的副作用，**不是行为断言**——改完代码顺手同步文档尺寸，全仓会绿而镜像已漂移。

后果：镜像段（Client 无法 import Host 模块，只能手抄一份）失去守护。谁改了 `client.js` 的判定规则而忘了同步 Host，或反之，现有判据一个都不会响。这正是 0.1.1「面板显示与实际注入分叉」那类缺陷的温床。

## 进度

- 新建 `scripts/verify-mirror.mjs`：从 `client.js` 抽 `const BCP47 =` → `/** 语言标签 → 显示名` 之间的镜像段，用 `data:text/javascript;base64,` 动态 import，与 `lib/language.js` 逐条比 5 个函数。矩阵 `MODES(10) × LANGS(23) × FALLBACKS(8) × DEFAULTS(6)`，另扫 `effectiveMode` 的 `targetLanguage` 维 → **12420 组输入 / 56580 次比较 / 不一致 0**。
- `scripts/verify-checklist.sh` 新增 **M14** 调它，纳入 PASS/FAIL 汇总。
- `client.js:49-56` 注释改为与事实一致（M1/M2 是源文本抽查、M3 是 Config 默认值、M4 是 radio 结构、M14 才是运行时行为比对）。
- **顺带修掉一处两侧不等价**：`defaultLanguage` 的兜底形态。Host 用默认参数（只对 `undefined` 生效），Client 用 `||`（对任何假值生效），传 `''` / `null` 时判定相反。新增 `pickDefaultLanguage()` 精确模拟默认参数（`given === undefined ? DEFAULT_LANGUAGE : given`），三处统一改调它。
- 三次变异全部确认 M14 会 FAIL（含 `??` 方案也会 FAIL 的那一组），还原后 md5 与基线一致。
- 四套验收：`node --check` 全过、`verify-mirror` 12420/0/exit 0、`verify-language` 36 项、`verify-manifest` 43/43、`verify-checklist` **74 PASS / 0 FAIL / 0 TODO / exit 0**。
- pack 尺寸 53870 → **54528 B**、解包 164792 → **166516 B**，四处文档已同步（R23 PASS）。

Status: resolved
Type: bug
Blocked by:
Labels: wayfinder:task, bug, needs-triage

## Comments

## Answer

### A. G1 是什么（为什么现有判据守不住）

`client.js` 里「语言模式常量与解析规则」那一段是 `lib/language.js` 的**手抄副本**——Client 是独立 bundle，`window.__ModuleLoader__.load` 的 factory 只能 `require('react')`，不能相对 import 包内其他文件。抄两份就必须有判据守住一致性。

此前是**零覆盖**：

| 判据 | 实际覆盖 | 是不是行为断言 |
| --- | --- | --- |
| `scripts/verify-language.mjs` | 只 import `../lib/language.js`，**从不读 `client.js`**；两条名字带「镜像」的断言测的是 Host 自己 | 是，但只测 Host 一侧 |
| `verify-checklist.sh` M1 | `mapPreference` 的 zh / en 两条规则 | 否，源文本正则抽查 |
| `verify-checklist.sh` M2 | `effectiveMode` 的三元式 | 否，源文本正则抽查 |
| `verify-checklist.sh` M3 / M4 | Config 默认值 / radio group 结构 | 与本段无关 |
| `verify-checklist.sh` R23 | 文档里的 pack 尺寸 | 否，且改任何字节都会响 |

后果实测：把 `client.js` 的 `MODE_MANUAL` 改成 `MODE_AUTO`，上面两个脚本全绿。`resolveTargetLanguage` 与 `resolveSource` 两侧等价性**完全没有守护**。

### B. 新增 `scripts/verify-mirror.mjs`（清单 M14）

实现要点：

1. **抽取边界**：起点 `const BCP47 =`，终点 `/** 语言标签 → 显示名`。起点必须是 `BCP47`——从 `const MODE_AUTO =` 起抽会漏掉正则，`normalizeLocaleId` 一调用就 `ReferenceError: BCP47 is not defined`。任一标记找不到或终点在起点之前，都**明确报错并 exit 1**，绝不静默通过。
2. **动态 import**：把抽出的块拼上 `export { … }`，用 `data:text/javascript;base64,` import 成真模块，拿到的是可执行函数，不是文本比对。
3. **矩阵**：`MODES(10) × LANGS(23) × FALLBACKS(8) × DEFAULTS(6)`，另扫 `effectiveMode` 的 `targetLanguage` 维。含 `null` / `undefined` / `''` / `'invalid!'` / `'ZH-cn'` / `'  ja  '` / `'zh_CN'` / `'x'` / `0` / `' '` / `'unknown'`。
4. **比对 5 个函数**：`normalizeLocaleId` / `mapPreference` / `effectiveMode` / `resolveTargetLanguage` / `resolveSource`；常量 `MODE_AUTO` / `MODE_MANUAL` / `MODE_UNSET` 另比一次。
5. **输出**：不一致时打印「函数名 + 完整入参 + host 输出 + client 输出」（最多前 10 条 + 剩余条数）并 exit 1；全一致时打印用例数、比较次数、「不一致: 0」并 exit 0。

实测输出：

```
镜像段运行时比对（M14）
  Host  : lib/language.js
  Client: client.js
  矩阵  : MODES(10) × LANGS(23) × FALLBACKS(8) × DEFAULTS(6)，另扫 effectiveMode 的 targetLanguage 维
  函数  : normalizeLocaleId / mapPreference / effectiveMode / resolveTargetLanguage / resolveSource

  用例数: 12420（56580 次函数比较）
  不一致: 0
✓ 镜像段与 lib/language.js 完全等价
```

### C. 顺带修掉一处两侧不等价：`defaultLanguage` 兜底形态

写脚本时把假值放进 `DEFAULTS`，立刻撞出真实分叉：

| 输入 `defaultLanguage` | Host（默认参数 `= 'zh-CN'`） | Client 改前（`\|\|`） | `??` 方案 | `given === undefined`（最终采用） |
| --- | --- | --- | --- | --- |
| 省略 / `undefined` | auto | auto ✅ | auto ✅ | auto ✅ |
| `''` | **manual** | auto ❌ | manual ✅ | manual ✅ |
| `null` | **manual** | auto ❌ | `'zh-CN'` → auto ❌ | manual ✅ |

**`??` 修不好这一格。** `??` 只对 `null` / `undefined` 兜底，对 `''` 原样；JS 默认参数只对 `undefined` 生效，对 `''` 和 `null` 都原样传入。两者在 `null` 上不等价——变异实测：把 `pickDefaultLanguage` 换成 `??`，`verify-mirror.mjs` 报 **682 处差异**，全是 `defaultLanguage=null` 那一格（`host=null client="zh-CN"`）。

最终实现（`client.js:89`）：

```js
function pickDefaultLanguage(input) {
  const given = input ? input.defaultLanguage : undefined;
  return given === undefined ? DEFAULT_LANGUAGE : given;
}
```

三处（`effectiveMode` / `resolveTargetLanguage` / `resolveSource`）统一改调它，注释里写明三种兜底语义的差异。**这是 G1 之外的顺带修复**，理由是新脚本要覆盖假值输入，不修就无法等价。

### D. 判据分工（写进 `client.js:49-56` 注释）

| 判据 | 覆盖什么 | 层次 |
| --- | --- | --- |
| **M14**（`verify-mirror.mjs`） | 镜像段**全部 5 个函数**与 Host 的等价性 | 运行时行为 |
| M1 / M2 | `mapPreference` 的 zh / en 两条规则、`effectiveMode` 的三元式 | 源文本抽查 |
| M3 / M4 | Config 默认值 / radio group 结构 | 与本段无关 |
| `verify-language.mjs` | Host 侧语义（36 项） | 运行时行为，单侧 |

### E. 三次变异验证（每次都必须 FAIL，还原后必须 PASS）

| # | 变异 | 预期 | 实测 |
| --- | --- | --- | --- |
| 1 | `client.js:71` `const MODE_MANUAL = 'manual'` → `'auto'` | FAIL | `verify-mirror` exit 1，`✗ 常量 MODE_MANUAL 两侧不等：host="manual" client="auto"`；checklist `FAIL M14` |
| 2 | `resolveSource` 去掉 `defaultLanguage` 转发 | FAIL | `resolveSource(mode="", preference="zh", fallback="zh-CN", defaultLanguage="en"): host="manual" client="ui"`，另有 818 处；checklist `FAIL M14` |
| 3a | `pickDefaultLanguage` 改回 `\|\|` | FAIL | `resolveTargetLanguage(… defaultLanguage=""): host="" client="zh-CN"`，另有 1374 处；checklist `FAIL M14` |
| 3b | `pickDefaultLanguage` 改成 `??`（captain 原建议） | FAIL | `resolveTargetLanguage(… defaultLanguage=null): host=null client="zh-CN"`，另有 682 处；checklist `FAIL M14` |

三次变异后均从独立基线 `/tmp/t19-own-baseline.js` 还原，`grep -n "const MODE_MANUAL" client.js` → `71: const MODE_MANUAL = 'manual'`，`md5 -q client.js` 与基线 `abbcaff3e77d83646dd789f7e0532953` 一致，`git diff --numstat client.js` → `38 6`。

> 变异 3b 是本票最有价值的一条：它证明 captain 最初建议的 `??` 方案**不够精确**，`null` 那一格仍会分叉。

### F. 验收结果

| 命令 | 结果 |
| --- | --- |
| `node --check client.js` + `lib/*.js` | 全部通过 |
| `node scripts/verify-mirror.mjs` | 12420 组 / 56580 次比较 / 不一致 0 / **exit 0** |
| `node scripts/verify-language.mjs` | **36 项全过** |
| `node scripts/verify-manifest.mjs` | **43/43 PASS** |
| `bash scripts/verify-checklist.sh; echo "退出码=$?"` | **PASS 74 / FAIL 0 / TODO 0，退出码=0** |

### G. 尺寸与文档同步

- `client.js`：1388 行 / 60563 B → **1420 行 / 62287 B**
- `npm pack`：15 文件 / **53870 → 54528 B**，解包 **164792 → 166516 B**
- 已同步：`docs/发布说明.md:15`、`:107`、`:469`（行数 / KB）、`:474`、`:475`（74 PASS、M1–M14）、M 组清单补 M14；`docs/实现说明.md:43`（行数/字节）、`:56`（2.2 补 `verify-mirror.mjs`）、`:311`（pack 尺寸）、6.3.1–6.3.3 三节、6.4 判据清单、第 8 节当前结果 74 PASS；`docs/验收清单.md` 补 M14 行与 M8 用例数 36。
- **R23 PASS**（正向断言：文档必须包含实测 `size` 与 `unpackedSize`）。

### H. 边界遵守

- `lib/language.js` 的判定逻辑**一字未改**（只改 `client.js` 的兜底形态，让它与 Host 等价）。
- `docs/评审报告-0.2.0.md` 未动。
- `scripts/` 不在 `files` 白名单，新增 `verify-mirror.mjs` 不进包（pack 仍是 15 文件）。
- `README*.md` 未动，M11 结构对等仍 PASS。
