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

<!-- 做到哪一步了，在这里一行一行记 -->

Status: ready-for-agent
Type: bug
Blocked by:
Labels: wayfinder:task, bug, needs-triage

## Comments


## Answer

