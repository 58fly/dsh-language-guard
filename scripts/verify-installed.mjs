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

const lastIndex = systems.length - 1;
for (const [i, s] of systems.entries()) {
  const oldHits = OLD_MARKS.filter((m) => s.text.includes(m));
  const newHits = NEW_MARKS.filter((m) => s.text.includes(m));
  const tag = newHits.length > 0 ? `本插件 ${newHits.length}/3` : '本插件 0/3';
  // 只有「最新节点」能代表当前装配结果；更早的节点是历史快照，
  // 它们带着旧方案文本是正常的（那时还没重启），不能算「残留」。
  const isLatest = i === lastIndex;
  const oldTag =
    oldHits.length === 0
      ? ''
      : isLatest
        ? `  ⚠ 旧方案仍在生效 ${oldHits.length}/2`
        : `  （历史节点，含旧方案 ${oldHits.length}/2）`;
  console.log(
    `#${i} turn=${s.turn ?? '?'} step=${s.step ?? '?'} 长度=${s.text.length}  ${tag}${oldTag}`,
  );
}

// 判定只看最新节点：它才是重启后真正装配出来的 system prompt。
const latest = systems[lastIndex];
const latestOld = OLD_MARKS.filter((m) => latest.text.includes(m));
const latestNew = NEW_MARKS.filter((m) => latest.text.includes(m));

console.log('\n=== 结论（依据最新节点 #' + lastIndex + '）===');

if (latestOld.length > 0) {
  console.log('✗ 最新节点里仍有旧方案（dsh-context promptPrefix/promptSuffix）的文本。');
  console.log('  说明清理没有生效：确认 desktop profile 的 cordis.patch.yml 里已无 dsh-context 的');
  console.log('  promptPrefix / promptSuffix，且 DSH 已重启（本机 HMR 被禁用，改 patch 必须重启）。');
} else {
  console.log('✓ 最新节点里没有旧方案的文本，清理已生效。');
}

if (latestNew.length === 0) {
  console.log('· 本插件尚未生效：最新节点里三段标记一个都没有。');
  console.log('  插件没装、没启用，或装完还没重启。');
} else {
  console.log(
    `✓ 本插件生效：最新节点命中 ${latestNew.length}/3 段，长度 ${latest.text.length}。`,
  );
  if (latestNew.length < 3) {
    console.log('  少于 3 段属正常：只有「基础」档是 2 段（head+tail），「强化」「周期」是 3 段。');
  }
  // 顺带报出三段在文本里的位置，用来证明首/中/尾的顺序是对的。
  const positions = latestNew.map((m) => latest.text.indexOf(m));
  console.log(`  三段位置：${positions.join(' / ')}（应递增）`);
  const ascending = positions.every((p, k) => k === 0 || p > positions[k - 1]);
  console.log(`  顺序${ascending ? '正确' : '异常（不是首→中→尾）'}`);
}

if (systems.length > 1) {
  console.log(
    `\n注：更早的 ${systems.length - 1} 个节点是重启前的历史快照，保留旧文本属正常，不计入判定。`,
  );
}
