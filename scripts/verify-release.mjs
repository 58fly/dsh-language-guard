#!/usr/bin/env node
/**
 * npm 与 GitHub 对齐校验。
 *
 * 两种模式：
 *   node scripts/verify-release.mjs            # 发布前（prepublishOnly 自动调用）
 *   node scripts/verify-release.mjs --verify   # 发布后自检（npm run verify:release）
 *
 * 铁律见仓库根 AGENTS.md：npm 上每个已发布版本，GitHub 必须有对应 commit 与 tag。
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;
const tagName = `v${version}`;

/**
 * 铁律生效前发布、且 GitHub 上确实没有对应 tag 的历史版本。
 * 只允许往这里加「已经无法追溯」的旧版本，新版本一律不得豁免。
 */
const LEGACY_VERSIONS = new Set(['0.0.0-stage']);

const failures = [];
const notes = [];

function fail(message, hint) {
  failures.push(hint ? `${message}\n    → ${hint}` : message);
}

function git(args) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function tryGit(args) {
  try {
    return git(args);
  } catch {
    return null;
  }
}

// ---- 1. 工作区必须干净 ----
const dirty = tryGit(['status', '--porcelain']);
if (dirty === null) {
  fail('不是 git 仓库，无法校验版本对齐');
} else if (dirty !== '') {
  const lines = dirty.split('\n');
  fail(
    `工作区有 ${lines.length} 处未提交改动，禁止发布`,
    '先 git add -A && git commit，再打 tag、push，最后才 npm publish'
  );
}

// ---- 2. HEAD 必须已被 tag 标记 ----
const head = tryGit(['rev-parse', 'HEAD']);
const tagCommit = tryGit(['rev-list', '-n', '1', tagName]);

if (head === null) {
  fail('读不到 HEAD commit');
} else if (tagCommit === null) {
  fail(
    `本地不存在 tag ${tagName}，GitHub 侧将无法追溯这个版本`,
    `git tag ${tagName} && git push origin main && git push origin ${tagName}`
  );
} else if (tagCommit !== head) {
  fail(
    `tag ${tagName} 指向 ${tagCommit.slice(0, 8)}，不是当前 HEAD ${head.slice(0, 8)}`,
    '发布内容必须等于 tag 指向的内容，否则 GitHub 与 npm 不一致'
  );
}

// ---- 3. 发布后自检：三方比对 ----
if (process.argv.includes('--verify')) {
  const remote = pkg.repository?.url?.replace(/^git\+/, '').replace(/\.git$/, '');
  notes.push(`本地版本：${version}`);
  notes.push(`tag ${tagName}：${tagCommit ? tagCommit.slice(0, 8) : '缺失'}`);

  try {
    const res = await fetch(`https://registry.npmjs.org/${pkg.name}`, {
      headers: { accept: 'application/vnd.npm.install-v1+json' },
    });
    if (!res.ok) throw new Error(`registry 返回 ${res.status}`);
    const meta = await res.json();
    const latest = meta['dist-tags']?.latest;
    const published = Object.keys(meta.versions ?? {});

    notes.push(`npm latest：${latest}`);
    notes.push(`npm 已发布：${published.join(', ')}`);

    if (latest !== version) {
      fail(
        `npm latest 是 ${latest}，本地是 ${version}`,
        latest === undefined ? '包尚未发布过任何版本' : '要么发布新版本，要么回滚本地版本号'
      );
    }

    for (const v of published) {
      const remoteTag = tryGit(['rev-list', '-n', '1', `v${v}`]);
      if (remoteTag !== null) continue;
      if (LEGACY_VERSIONS.has(v)) {
        notes.push(`  （历史遗留，豁免）npm 有 ${v}，GitHub 无 tag`);
        continue;
      }
      fail(
        `npm 上有 ${v}，但 GitHub 没有对应 tag v${v}`,
        `补 tag：git tag v${v} <该版本对应的 commit> && git push origin v${v}`
      );
    }

    if (remote) {
      notes.push(`仓库：${remote}`);
    }
  } catch (error) {
    fail(
      `无法查询 npm registry：${error.message}`,
      '断网或代理问题时无法完成对齐校验，请稍后重试'
    );
  }
}

// ---- 输出 ----
for (const note of notes) console.log(`  ${note}`);

if (failures.length === 0) {
  console.log(
    process.argv.includes('--verify')
      ? `✅ npm 与 GitHub 对齐：${pkg.name}@${version}（tag ${tagName}）`
      : `✅ 发布前置检查通过：${pkg.name}@${version}，tag ${tagName} 已就位`
  );
  process.exit(0);
}

console.error(`\n❌ npm / GitHub 对齐校验失败（${failures.length} 项）\n`);
for (const message of failures) console.error(`  - ${message}\n`);
console.error('铁律见 AGENTS.md：Git 先行，npm 后发。\n');
process.exit(1);
