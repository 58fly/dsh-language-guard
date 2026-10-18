#!/usr/bin/env node
/**
 * 验证本机 DSH 的 system prompt 里到底有什么。
 *
 * 用途：清理旧的 dsh-context 自改方案、或安装 dsh-language-guard 之后，
 * 用会话日志（system/message 事件）证明「谁在生效」，不靠猜测。
 *
 * 用法：
 *   node scripts/verify-installed.mjs                  # 读最近写入的会话日志
 *   node scripts/verify-installed.mjs <会话目录或 zstd 路径>
 *
 * 判定依据：
 *   - 旧方案（dsh-context 的 promptPrefix / promptSuffix）标记：
 *       【语言硬约束 · 最高优先级】  /  【语言复述 · 请遵守】
 *   - 本插件（dsh-language-guard）三段标记：
 *       【语言锁定 · 最高优先级】 / 【语言锁定 · 中段重申】 / 【语言锁定 · 收尾复述】
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

const OLD_MARKS = ['【语言硬约束 · 最高优先级】', '【语言复述 · 请遵守】'];
const NEW_MARKS = ['【语言锁定 · 最高优先级】', '【语言锁定 · 中段重申】', '【语言锁定 · 收尾复述】'];

/** 找出最近写入的 session.v4.jsonl.zstd */
function findLatestSessionLog() {
  const root = join(homedir(), '.dsh', 'sessions');
  let best = null;
  for (const project of readdirSync(root)) {
    const projectDir = join(root, project);
    let entries;
    try {
      entries = readdirSync(projectDir);
    } catch {
      continue;
    }
    for (const session of entries) {
      const file = join(projectDir, session, 'session.v4.jsonl.zstd');
      let st;
      try {
        st = statSync(file);
      } catch {
        continue;
      }
      if (best === null || st.mtimeMs > best.mtimeMs) best = { file, mtimeMs: st.mtimeMs, project, session };
    }
  }
  return best;
}

/** 解压 zstd（用系统 zstd 命令，Node 没有内置支持） */
function readJsonl(file) {
  const raw = file.endsWith('.zstd')
    ? execFileSync('zstd', ['-dc', file], { maxBuffer: 512 * 1024 * 1024 })
    : readFileSync(file);
  return raw.toString('utf8').split('\n').filter(Boolean);
}

const arg = process.argv[2];
const target = arg ?? findLatestSessionLog()?.file;
if (!target) {
  console.error('找不到任何会话日志：~/.dsh/sessions/*/*/session.v4.jsonl.zstd');
  process.exit(1);
}

console.log('会话日志:', target);
if (!arg) {
  const info = findLatestSessionLog();
  console.log('所属项目:', info.project);
  console.log('修改时间:', new Date(info.mtimeMs).toISOString());
}

const systems = [];
for (const line of readJsonl(target)) {
  let evt;
  try {
    evt = JSON.parse(line);
  } catch {
    continue;
  }
  if (evt.type !== 'system/message') continue;
  const content = evt.data?.message?.content;
  if (!Array.isArray(content)) continue;
  const text = content.map((p) => p?.text ?? '').join('');
  systems.push({ turn: evt.data?.turn, step: evt.data?.step, text });
}

if (systems.length === 0) {
  console.error('这份日志里没有 system/message 事件。换一个会话，或在 DSH 里发一条消息后重试。');
  process.exit(2);
}

console.log(`system/message 节点数: ${systems.length}\n`);

let lastNew = null;
let anyOld = false;
for (const [i, s] of systems.entries()) {
  const oldHits = OLD_MARKS.filter((m) => s.text.includes(m));
  const newHits = NEW_MARKS.filter((m) => s.text.includes(m));
  if (oldHits.length > 0) anyOld = true;
  const tag =
    newHits.length > 0 ? `本插件 ${newHits.length}/3` : '本插件 0/3';
  const oldTag = oldHits.length > 0 ? `  ⚠ 旧方案残留 ${oldHits.length}/2` : '';
  console.log(
    `#${i} turn=${s.turn ?? '?'} step=${s.step ?? '?'} 长度=${s.text.length}  ${tag}${oldTag}`,
  );
  if (newHits.length > 0) lastNew = { index: i, hits: newHits.length, length: s.text.length };
}

console.log('\n=== 结论 ===');
if (anyOld) {
  console.log('✗ 日志里仍有旧方案（dsh-context promptPrefix/promptSuffix）的文本。');
  console.log('  说明清理没有生效：确认 desktop profile 的 cordis.patch.yml 里已无 dsh-context 的');
  console.log('  promptPrefix / promptSuffix，且 DSH 已重启（本机 HMR 被禁用，改 patch 必须重启）。');
} else {
  console.log('✓ 日志里没有旧方案的文本。');
}

if (lastNew === null) {
  console.log('· 本插件尚未生效：三段标记一个都没有。');
  console.log('  插件没装、没启用，或装完还没重启。');
} else {
  console.log(`✓ 本插件生效：最近一个带标记的节点是 #${lastNew.index}，命中 ${lastNew.hits}/3 段，长度 ${lastNew.length}。`);
  if (lastNew.hits < 3) {
    console.log('  少于 3 段属正常：只有「基础」档是 2 段（head+tail），「强化」「周期」是 3 段。');
  }
}
