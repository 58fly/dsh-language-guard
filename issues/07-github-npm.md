<!-- DSH-IDEMPOTENCY-KEY: deck-plan-dsh-language-guard-map-v1-child-decide-release -->
<!-- parentKey: 01 -->
<!-- created: 2026-10-18T13:16:25.054Z -->
# 决策：GitHub 建仓与 npm 发布的执行清单

定下发布落地的完整步骤与验收标准。

要定的事：
1. GitHub 建仓步骤：仓库名 `dsh-language-guard`、public、MIT、是否加 `dsh-plugin` topic、初始分支名。
2. 首次提交的内容范围与 commit message 规范。
3. npm publish-ready 的验收清单：`npm pack` 内容核对、`npm publish --dry-run` 全绿、`files` 白名单无遗漏、无敏感文件混入。
4. 发布顺序：先 GitHub 还是先 npm？`repository` 字段指向的仓库必须先存在吗？
5. 版本号与 tag 策略。
6. 交给用户执行的命令清单（用户本人跑 `npm publish`）。

产出：写入 `docs/decisions/05-release.md`，含逐步命令与验收项。

完成标准：用户照文档执行即可完成发布，agent 侧无遗留动作。

## 进度

<!-- 做到哪一步了，在这里一行一行记 -->

Status: ready-for-agent
Type: task
Blocked by: #09
Labels: wayfinder:task

## Comments


## Answer

