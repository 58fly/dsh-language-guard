# AGENTS.md — dsh-language-guard

本文件是本仓库的最高优先级开发约束。与任何其他文档、历史约定、个人习惯冲突时，以本文件为准。

## 铁律：npm 与 GitHub 必须完全对齐

**任何时刻，npm registry 上 `dsh-language-guard` 的每个已发布版本，都必须在 GitHub 仓库里有对应的 commit 与 tag；GitHub `main` 的 `package.json` 版本号必须等于 npm 的 `latest`。**

这条铁律不接受"下次补"、"先发再说"。npm 发布不可逆（unpublish 受 72 小时限制且会破坏已安装用户），GitHub 可改可补，所以**顺序只能是 Git 先行**。

### 发布流程（唯一允许的顺序）

```bash
# 1. 版本号与内容就绪，工作区必须干净
npm test                        # 必须全绿
git status --short              # 必须为空

# 2. 先提交
git add -A
git commit -m "release: X.Y.Z —— <一句话说明>"

# 3. 再打 tag（tag 必须与 package.json 版本一致，格式 vX.Y.Z）
git tag vX.Y.Z

# 4. 推送 commit 与 tag —— 推 tag 会触发 GitHub Actions 自动发布
git push origin main
git push origin vX.Y.Z

# 5. 等 CI 发布完，做三方对齐自检
npm run verify:release --verify
```

推 tag 后由 `.github/workflows/publish.yml` 在干净环境里跑 `npm ci` + `npm test`，
全绿才 `npm publish`（`NPM_TOKEN` 来自仓库 secret）。发布门禁仍是 `prepublishOnly`
→ `scripts/verify-release.mjs`，工作区干净、tag 存在、tag 之后进包内容未变，三条都不放宽。

本机手动 `npm publish` 仍然可行（紧急情况），但不再是常规路径——CI 跑的是同一份测试，
且能保证发布环境干净。

### 禁止事项

- ❌ 在工作区有未提交改动时 `npm publish`
- ❌ 发布后不推 GitHub（会导致 npm 有版本、GitHub 无对应代码）
- ❌ 推了 commit 不打 tag（版本无法从 Git 侧追溯）
- ❌ 改了 `package.json` 版本号却不发布（GitHub 版本高于 npm）
- ❌ 用 `npm version` 自动打 tag 后跳过 push
- ❌ 直接改 npm 上的版本而不同步仓库

### 强制机制

`npm publish` 前会自动执行 `scripts/verify-release.mjs`（通过 `prepublishOnly`），它检查：

1. 工作区干净（无未提交改动）
2. `HEAD` 上存在 `v<package.json version>` 的 tag
3. tag 之后，**进包的内容**没有变过（比对 `package.json` + `files` 白名单内文件的 `git diff`；tag 正好指向 `HEAD` 时差集为空）

第 3 条只约束进包内容，是因为真正的铁律是「npm 上发布的内容 == tag 指向的内容」。只改 `docs/`、`scripts/`、`.github/`、`package-lock.json` 这类不进包的文件，不需要为了通过校验而发一个内容完全相同的版本号。

任一项不满足，发布直接失败。这不是可跳过的建议，是硬拦截。确实需要紧急跳过时用 `npm publish --ignore-scripts`，但那属于明知故犯，事后必须在同一天补齐 Git 侧。

### 发布后自检

```bash
npm run verify:release          # 比对本地 / npm latest / git tag 三方一致
```

这条也会检查 npm 上是否有 GitHub 里不存在的版本（反向漂移）。

## 其他约束

- **每个版本必须更新 `CHANGELOG.md`。** 新增一节 `## [X.Y.Z] - YYYY-MM-DD`，版本号与日期必须与 `package.json`、git tag 一致；分类固定用 新增 / 修复 / 变更 / 文档 / 移除；条目写「用户能感知到什么」，不写内部重构名词。
  - `CHANGELOG.md` 随包分发（在 `files` 白名单内），给用户看；`docs/发布说明.md` 不随包分发，给维护者看（为什么改、复现步骤、连带列表）。**同一件事只写各自那层，两边不重复。**
  - 该条暂无自动门禁：`prepublishOnly` 校验 tag 对齐，但不会解析 CHANGELOG 的标题格式。
- 中文文案与英文文案必须同时更新（`README.md` / `README.zh.md` / `locale/*.json` / `client.js` 内联字典），键集合必须一致。
- `lib/text.js` 的文本改动必须同步 `scripts/verify-checklist.sh` 的 F18 字符断言与 `docs/decisions/01-mechanism.md` 第 0 节表格。
- `docs/` 不在 npm `files` 白名单内，改文档不影响打包产物；改 `README*`、`client.js`、`package.json`、`lib/`、`CHANGELOG.md` 会改变 pack 尺寸，需同步 `docs/发布说明.md` 与 `docs/实现说明.md` 里的实测值（R23 会硬断言）。新增/删除发包文件时还要同步 `scripts/verify-checklist.sh` 的 R1 期望集合。
- 密钥、token、cookie 一律不写入仓库文件。
