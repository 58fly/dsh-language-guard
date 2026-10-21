#!/usr/bin/env node
/**
 * 「只看代码行」的 grep 替身（verify-checklist.sh 的 hits / hits_n 后端）。
 *
 * 为什么不用 grep：
 *   同一份源码、同一套 ERE，本机（BSD grep）与 CI（GNU grep）给出了相反的结果——
 *   C9 的 `hits_n '^[[:space:]]*\.volatile\(\),'` 在 CI 上返回 0（本机 7），
 *   M12 的 `hits 'locale\.getSnapshot'` 在 CI 上命中注释行（本机正确地排除了）。
 *   差异来自 grep 的几处实现相关构造：`-r` 的 `file:line:` 前缀格式、`-o` 与 `-E`
 *   的组合、以及 ERE 里 `\*` / `\,` 这类 POSIX 未定义的反斜杠转义。
 *   与其逐个赌方言，不如两边跑同一份 JS——行为一致，本地能验的 CI 一定也对。
 *
 * 用法：
 *   node scripts/grepcode.mjs --count <ERE> <路径...>   打印命中次数
 *   node scripts/grepcode.mjs <ERE> <路径...>           有命中退出 0，无命中退出 1
 * 出错（正则非法、路径不存在）退出 2。
 *
 * 语义与旧 grep 实现保持一致：
 *   - 递归读取文件，跳过目录；
 *   - 排除整行注释（行首是 `*`、`//`、`/*`），避免注释里写了「不该出现什么」反而造成假通过；
 *   - 计数按**出现次数**（等价于旧实现的 `grep -oE | wc -l`）。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const countMode = argv[0] === '--count';
if (countMode) argv.shift();

const [pattern, ...targets] = argv;
if (!pattern || targets.length === 0) {
  console.error('用法：node scripts/grepcode.mjs [--count] <ERE> <路径...>');
  process.exit(2);
}

// POSIX 字符类 → JS 等价写法（JS RegExp 不支持 [[:space:]] 这类语法）。
function toJs(source) {
  return source
    .replaceAll('[[:space:]]', '[ \\t\\r\\n]')
    .replaceAll('[[:blank:]]', '[ \\t]')
    .replaceAll('[[:alpha:]]', 'A-Za-z')
    .replaceAll('[[:digit:]]', '0-9')
    .replaceAll('[[:alnum:]]', 'A-Za-z0-9');
}

let re;
try {
  re = new RegExp(toJs(pattern), 'g');
} catch (error) {
  console.error(`正则无法编译：${pattern}（${error.message}）`);
  process.exit(2);
}

/** 整行注释：行首（忽略缩进）是 * / // / /* */
function isComment(line) {
  const head = line.replace(/^[ \t]+/, '');
  return head.startsWith('*') || head.startsWith('//') || head.startsWith('/*');
}

function collect(target, files) {
  let entries;
  try {
    entries = readdirSync(target, { withFileTypes: true });
  } catch {
    // 不是目录：当作文件读
    files.push(target);
    return;
  }
  for (const entry of entries) {
    const full = join(target, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      collect(full, files);
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
}

const files = [];
for (const target of targets) collect(target, files);

let total = 0;
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    console.error(`读不到 ${file}：${error.message}`);
    process.exit(2);
  }
  for (const line of text.split('\n')) {
    if (isComment(line)) continue;
    re.lastIndex = 0;
    const hits = line.match(re);
    if (hits) total += hits.length;
  }
}

if (countMode) {
  console.log(total);
  process.exit(0);
}
process.exit(total > 0 ? 0 : 1);
