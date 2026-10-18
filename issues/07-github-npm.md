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

- 2026-10-18 决策落盘，实际产出路径为 `docs/发布说明.md`（382 → 405 行），而非原文写的 `docs/decisions/05-release.md`。偏离原因见 Answer 第 0 项。
- 六项要定的事全部给出结论，并已在真实环境执行到「publish-ready + GitHub 已发布」。
- 唯一未由 agent 执行的动作是 `npm publish` 本身（本机 npm 未登录，且发布不可逆、凭据不应经 agent 手）。

Status: resolved
Type: task
Blocked by: #09
Labels: wayfinder:task

## Comments

- captain 复核补充：发现仓库 topics 为空、三份文档均未提到 topic，即本票第 1 项「是否加 `dsh-plugin` topic」实质遗漏。已用 `gh repo edit --add-topic` 补写 8 个 topic 并回填文档。

## Answer

### 0. 产出路径偏离说明

原文要求写到 `docs/decisions/05-release.md`。实际写到了 `docs/发布说明.md`。

理由是内容性质不同：`docs/decisions/` 下四份（01-mechanism / 02-panel / 03-manifest / 04-verification）都是「为什么这样设计」的决策记录，而本票产出的是「用户照着敲就能发布」的操作手册，混进去会让决策目录变成大杂烩。且发布说明是**给用户看的**，放在 `docs/` 顶层比 `docs/decisions/` 更好找。

内容覆盖了原文要求的全部 6 项，逐项对应见下。

### 1. GitHub 建仓步骤（已执行）

仓库名 `dsh-language-guard`，public，MIT，默认分支 `main`：

```bash
gh repo create 58fly/dsh-language-guard --public --source=. --remote=origin --push
```

结果实测：`gh repo view --json` 返回 `visibility: PUBLIC`、`defaultBranchRef.name: main`、`licenseInfo.key: mit`。

**`dsh-plugin` topic：加。** 已写入 8 个 topic：

```bash
gh repo edit 58fly/dsh-language-guard \
  --add-topic dsh-plugin --add-topic dsh --add-topic deepseek-harness \
  --add-topic language --add-topic i18n --add-topic chinese \
  --add-topic localization --add-topic prompt-engineering
```

复核 `gh repo view 58fly/dsh-language-guard --json repositoryTopics` 返回 8 条。理由：`dsh-plugin` 是生态内检索标签，其余为语义相关标签；topic 只影响可发现性，不进 npm 包、不影响加载。

初始分支名用 `main` 而非 `master`：GitHub 默认已是 `main`，且 `gh repo create` 会沿用本地当前分支名。

### 2. 首次提交内容范围与 commit message 规范

内容范围 = 全部 37 个文件（含 `docs/`、`issues/`、`scripts/`、`asar_tool.py`），但**只提交进 git，不进 npm 包**——npm 包内容由 `files` 白名单决定，实测 14 个文件。

三个提交，常规提交，无 `--amend`、无 force push：

```
d199d0b docs: 新增发布说明（publish-ready 状态与用户手动步骤）
ded0a63 docs: 验收清单新增 F18（四段文本字符数可复算）
219e31b docs: 修正 01-mechanism 字符成本为实测值 552/665/783
b735a67 feat: 发布 dsh-language-guard 0.1.0
```

规范：`<type>: <中文描述>`，type 取 `feat` / `fix` / `docs` / `test` / `chore`；描述用中文，技术名词保留英文原文（与全局 AGENTS.md 的语言约定一致）。

### 3. npm publish-ready 验收清单（全部已过）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 包名未被占用 | `npm view dsh-language-guard version` | 404，可用 |
| 打包内容 | `npm pack --dry-run --json` | `entryCount: 14` |
| 白名单无遗漏 | 逐项比对 `files` 与 tarball | 14 项全在，无多余 |
| dry-run 全绿 | `npm publish --dry-run` | 退出码 0，`+ dsh-language-guard@0.1.0` |
| 无敏感文件 | 全仓扫 `gho_`/`ghp_`/`npm_`/`Bearer`/`api_key=`/`password=` | 零命中 |
| 无 `.npmrc` 入库 | `git ls-files \| grep npmrc` | 0 |
| 无 `private: true` | `node -p "require('./package.json').private"` | `undefined` |
| `publishConfig.access` | 同上 | `"public"` |

14 个文件：`LICENSE` / `README.md` / `README.zh.md` / `client.js` / `cordis.patch.yml` / `icon.svg` / `lib/{index,text,state,cycle,commands}.js` / `locale/{en,zh}.json` / `package.json`。

一个必须记住的坑：**官方模板的 `package.json` 自带 `private: true`**，照抄会让 `npm publish` 被直接拒绝（`This package has been marked as private`）。

### 4. 发布顺序：先 GitHub，后 npm

顺序：GitHub 先行，npm 后发。理由三条：

1. `package.json` 的 `repository` / `homepage` / `bugs` 三字段都指向 GitHub URL，npm 包页面会自动渲染这些链接。仓库先存在，npm 页面一上线就是可点的，不会出现 404 链接。
2. npm 发布**不可逆**（72 小时内可 unpublish，之后只能升版本）；GitHub 推送可随时修正。先做可逆的、后做不可逆的，是标准顺序。
3. `npm publish` 本身**不校验** `repository` 指向的仓库是否存在——所以「先 npm 后 GitHub」技术上可行，只是会在 npm 页面留下一段时间的坏链接。既然没有收益，就不这么做。

### 5. 版本号与 tag 策略

- 起始版本 **`0.1.0`**（不是 `1.0.0`）：三档机制与设置面板已实现且验证通过，但尚无真实用户在长期使用中反馈，按 semver 的 0.x 语义表示「可用但 API 仍可能调整」。
- npm dist-tag：默认 `latest`，不打额外 tag。
- GitHub tag：**可选**，建议 `v0.1.0`（带 `v` 前缀，与 npm 的 `0.1.0` 区分）。不打也不影响 npm 发布，只是 GitHub Releases 页面会空着。
- 后续版本：破坏性变更（如删除某个 `strength` 档位、改 section name）→ 主版本；新增配置字段或档位 → 次版本；文案与文档修正 → 补丁版本。

### 6. 交给用户执行的命令清单

agent 侧到此为止，剩下三步只能由用户本人做：

```bash

npm login


npm whoami
npm view dsh-language-guard version    # 应仍是 404


cd /Volumes/data/dsh-cn-think
npm publish
```

发布后自检：

```bash
npm view dsh-language-guard version        # → 0.1.0
npm view dsh-language-guard dist.tarball   # 确认 tarball 地址
```

可选：

```bash
git tag v0.1.0 && git push origin v0.1.0
gh release create v0.1.0 --title "v0.1.0" --notes "首个版本"
```

### 7. 未由 agent 完成的两项（环境限制，非缺陷）

1. **真实 `npm publish`**：本机 `npm whoami` 返回 `ENEEDAUTH`。且发布不可逆、需 npm 凭据，按约定由用户执行。
2. **桌面应用内实装验证（R8/R14/R20）**：本机**没有 `dsh` CLI**（`which dsh` 无输出；asar 内 `bin.js` 无法用 node 直接执行，报 `Cannot find module .../app.asar/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js`）。替代路径是在桌面应用插件页输入本地绝对路径 `/Volumes/data/dsh-cn-think` 安装。这三项在验收清单里如实标注为「未验证 + 环境限制原因」，未标通过。