#!/usr/bin/env node
/**
 * 镜像段运行时等价性比对（清单 M14）。
 *
 * ## 为什么需要这个脚本
 *
 * `client.js` 里的「语言模式常量与解析规则」那一段是 `lib/language.js` 的
 * **手抄副本**：Client 半是独立 bundle，`window.__ModuleLoader__.load` 的 factory
 * 只能 `require('react')`，不能相对 import 包内其他文件，所以必须抄一份。
 *
 * 抄两份就必须有判据守住一致性。此前的覆盖情况：
 *
 * - `scripts/verify-language.mjs` 只 import `../lib/language.js`，**从不读
 *   `client.js`**；它的【镜像 O1】【镜像 O3】两条断言虽然名字带「镜像」，
 *   测的却是 Host 侧自己。
 * - `scripts/verify-checklist.sh` 的 M1 只比 `mapPreference` 的 zh/en 两条规则、
 *   M2 只比 `effectiveMode` 的三元式 —— 都是**源文本正则抽查**，不是行为断言。
 * - 于是 `resolveTargetLanguage` 与 `resolveSource` 两侧的等价性零覆盖：
 *   把 `client.js` 的 `MODE_MANUAL` 改成 `MODE_AUTO`，上面两个脚本全绿。
 *
 * 本脚本补上这个缺口：把镜像段从 `client.js` 抽出来，用 `data:` URL 动态
 * import 成真正的模块，再与 `lib/language.js` 在同一批输入上逐条比输出。
 *
 * ## 抽取的两个边界（踩过的坑）
 *
 * - 起点必须是 `const BCP47 =`。从 `const MODE_AUTO =` 起抽会漏掉 `BCP47`
 *   正则，`normalizeLocaleId` 一调用就 `ReferenceError: BCP47 is not defined`。
 * - 终点是 `/** 语言标签 → 显示名`，即 `LANGUAGE_NAMES` 的文档注释。
 *   它之后是显示名映射表，不属于解析规则，不参与镜像段比对。
 *
 * ## 显示名表（P1）
 *
 * 显示名表本身也是两份手抄副本（`client.js` 的 `LANGUAGE_NAMES` 与
 * `lib/text.js` 的同名表）。镜像段的终点刻意停在这张表之前，所以它此前
 * 完全没有判据：面板显示「日本語」而实际注入别的语言，用户看不出来。
 * 本脚本额外比对表结构 + `languageLabel()` 行为。
 *
 * 用法：`node scripts/verify-mirror.mjs`（退出码 0 = 等价，1 = 分叉或定位失败）
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as host from '../lib/language.js';
import { languageLabel as hostLanguageLabel } from '../lib/text.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLIENT_PATH = new URL('../client.js', import.meta.url);
const HOST_PATH = new URL('../lib/language.js', import.meta.url);
const TEXT_PATH = new URL('../lib/text.js', import.meta.url);

const START_MARK = 'const BCP47 =';
const END_MARK = '/** 语言标签 → 显示名';

/** 显示名表的抽取边界（P1）：表本体 + `languageLabel` 函数体，两段都要抽 */
const TABLE_START_MARK = 'const LANGUAGE_NAMES = [';
const LABEL_START_MARK = 'function languageLabel(code) {';

/** 需要两侧逐个比对的函数（镜像段的全部解析函数） */
const FUNCTIONS = [
  'normalizeLocaleId',
  'mapPreference',
  'effectiveMode',
  'resolveTargetLanguage',
  'resolveSource',
];

/**
 * 用例矩阵。
 *
 * 每一维都必须包含「脏」输入，因为真实分叉几乎都藏在边界上：
 * 0.2.1 就出过一次 `||` 与默认参数语义不等价（`defaultLanguage: ''` / `null`），
 * 只测合法值永远发现不了。
 */
const LANGS = [
  'zh', 'zh-CN', 'zh-TW', 'zh-Hans', 'zh-Hant', 'zh_CN', 'zh-Hans-CN',
  'en', 'en-US', 'en-GB', 'ja', 'ja-JP', 'ko', 'fr', 'de-DE', 'pt-BR',
  'ZH-cn', '  ja  ', 'invalid!', 'x', '', null, undefined,
];

const MODES = ['auto', 'manual', '', 'AUTO', ' Manual ', 'unknown', ' ', null, undefined, 0];

const FALLBACKS = ['zh-CN', 'en', 'ja', 'zh-TW', 'invalid!', '', null, undefined];

/** 必须含假值：`defaultLanguage` 的兜底形态正是靠这一维守住 */
const DEFAULTS = ['zh-CN', 'en', 'ja', '', null, undefined];

/**
 * 显示名表的比对用例（P1）。
 *
 * 必须覆盖两张表的每一个键（14 个），否则「只在 client.js 里多一条」这类
 * 分叉测不出来；再补脏输入守住 `typeof` / `trim` / 兜底分支。
 */
const LABEL_CODES = [
  'zh-cn', 'zh-CN', 'zh-hans', 'zh-Hans', 'zh-sg', 'zh-tw', 'zh-TW',
  'zh-hk', 'zh-mo', 'zh-hant', 'en', 'en-us', 'en-gb', 'ja', 'ja-jp',
  'ko', 'ko-kr', 'fr', 'de-DE', 'pt-BR', 'ZH-CN', '  ja  ',
  'invalid!', 'x', '', 'zh-CN-x-private',
  null, undefined, 0, 123, {}, [],
];

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

/** 从 client.js 抽出镜像段，返回一个可用的模块命名空间 */
async function loadMirror() {
  let source;
  try {
    source = fs.readFileSync(CLIENT_PATH, 'utf8');
  } catch (error) {
    fail(`读不到 ${CLIENT_PATH.pathname}：${error.message}`);
  }

  const start = source.indexOf(START_MARK);
  const end = source.indexOf(END_MARK);
  if (start < 0) {
    fail(`在 client.js 里找不到镜像段起点 \`${START_MARK}\` —— 起点标记被改过？本脚本无法比对，按失败处理。`);
  }
  if (end < 0) {
    fail(`在 client.js 里找不到镜像段终点 \`${END_MARK}\` —— 终点标记被改过？本脚本无法比对，按失败处理。`);
  }
  if (end <= start) {
    fail(`镜像段终点出现在起点之前（start=${start}, end=${end}），client.js 结构异常。`);
  }

  const block = source.slice(start, end);
  const exports = [
    'BCP47', 'MODE_AUTO', 'MODE_MANUAL', 'MODE_UNSET', 'DEFAULT_LANGUAGE',
    ...FUNCTIONS,
  ].join(', ');

  const encoded = Buffer.from(`${block}\nexport { ${exports} };\n`, 'utf8').toString('base64');
  try {
    return await import(`data:text/javascript;base64,${encoded}`);
  } catch (error) {
    fail(`镜像段无法作为模块求值（可能抽到了半截代码）：${error.message}`);
  }
}

const mirror = await loadMirror();

/**
 * 从源码里抽出 `const LANGUAGE_NAMES = [...]` 字面量（P1）。
 *
 * 两张表同构，都是 `[code, label]` 数组，所以可以各自求值后直接比对结构：
 * 键集合、顺序、显示名任何一处不同都会被抓到，比只测行为更严格。
 */
async function loadTable(source, fileLabel) {
  const start = source.indexOf(TABLE_START_MARK);
  if (start < 0) {
    fail(`在 ${fileLabel} 里找不到 \`${TABLE_START_MARK}\` —— 标记被改过？本脚本无法比对，按失败处理。`);
  }
  const end = source.indexOf('];', start);
  if (end < 0) {
    fail(`在 ${fileLabel} 里找不到显示名表的结束 \`];\`，结构异常。`);
  }
  const block = source.slice(start, end + 2);
  const encoded = Buffer.from(`${block}\nexport { LANGUAGE_NAMES };\n`, 'utf8').toString('base64');
  try {
    return (await import(`data:text/javascript;base64,${encoded}`)).LANGUAGE_NAMES;
  } catch (error) {
    fail(`显示名表无法作为模块求值（${fileLabel}，可能抽到了半截代码）：${error.message}`);
  }
}

/** 从 client.js 抽出 `languageLabel`，与表一起求值，用于行为比对 */
async function loadClientLabel() {
  let source;
  try {
    source = fs.readFileSync(CLIENT_PATH, 'utf8');
  } catch (error) {
    fail(`读不到 ${CLIENT_PATH.pathname}：${error.message}`);
  }

  const start = source.indexOf(LABEL_START_MARK);
  if (start < 0) {
    fail(`在 client.js 里找不到 \`${LABEL_START_MARK}\` —— 标记被改过？本脚本无法比对，按失败处理。`);
  }
  const end = source.indexOf('/** 极简', start);
  if (end < 0) {
    fail('在 client.js 里找不到 languageLabel 的结束位置（`/** 极简` 标记缺失），client.js 结构异常。');
  }

  const block = `${source.slice(source.indexOf(TABLE_START_MARK), source.indexOf('];', source.indexOf(TABLE_START_MARK)) + 2)}\n`
    + `${source.slice(start, end)}\n`;
  const encoded = Buffer.from(`${block}\nexport { LANGUAGE_NAMES, languageLabel };\n`, 'utf8').toString('base64');
  try {
    return await import(`data:text/javascript;base64,${encoded}`);
  } catch (error) {
    fail(`客户端显示名段无法作为模块求值（可能抽到了半截代码）：${error.message}`);
  }
}

// 常量先比一遍：函数行为相同但常量值不同，说明某一侧已经改过字面量。
// 注意 `DEFAULT_LANGUAGE` 不在 Host 的导出里（Host 把 `'zh-CN'` 直接写在三处默认参数上），
// 它的一致性由函数行为间接覆盖 —— 若两侧默认值不同，下面一定会出现差异。
const CONSTANTS = ['MODE_AUTO', 'MODE_MANUAL', 'MODE_UNSET'];
for (const name of CONSTANTS) {
  if (!(name in host)) fail(`lib/language.js 没有导出 \`${name}\`，两侧结构已经不一致。`);
  if (host[name] !== mirror[name]) {
    fail(`常量 \`${name}\` 两侧不等：host=${JSON.stringify(host[name])} client=${JSON.stringify(mirror[name])}`);
  }
}

let cases = 0;
let comparisons = 0;
const differences = [];

function compare(fn, args, label) {
  comparisons += 1;
  const expected = host[fn](...args);
  const actual = mirror[fn](...args);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    differences.push(`${fn}(${label}): host=${JSON.stringify(expected)} client=${JSON.stringify(actual)}`);
  }
}

for (const mode of MODES) {
  for (const preference of LANGS) {
    for (const fallback of FALLBACKS) {
      for (const defaultLanguage of DEFAULTS) {
        cases += 1;
        const label = `mode=${JSON.stringify(mode)}, preference=${JSON.stringify(preference)}, `
          + `fallback=${JSON.stringify(fallback)}, defaultLanguage=${JSON.stringify(defaultLanguage)}`;
        compare('normalizeLocaleId', [preference], `preference=${JSON.stringify(preference)}`);
        compare('mapPreference', [preference], `preference=${JSON.stringify(preference)}`);
        compare('effectiveMode', [{ languageMode: mode, targetLanguage: fallback, defaultLanguage }], label);
        compare('resolveTargetLanguage', [{ mode, preference, fallback, defaultLanguage }], label);
        compare('resolveSource', [{ mode, preference, fallback, defaultLanguage }], label);
      }
    }
  }
}

// `effectiveMode` 的 `targetLanguage` 维单独扫一遍：上面的循环里它恒等于 `fallback`
for (const mode of MODES) {
  for (const targetLanguage of LANGS) {
    for (const defaultLanguage of DEFAULTS) {
      cases += 1;
      const label = `mode=${JSON.stringify(mode)}, targetLanguage=${JSON.stringify(targetLanguage)}, `
        + `defaultLanguage=${JSON.stringify(defaultLanguage)}`;
      compare('effectiveMode', [{ languageMode: mode, targetLanguage, defaultLanguage }], label);
    }
  }
}

// —— 显示名表（P1）：镜像段的终点停在表之前，这张表此前没有任何判据 ——
let tableCases = 0;

{
  let hostTextSource;
  try {
    hostTextSource = fs.readFileSync(TEXT_PATH, 'utf8');
  } catch (error) {
    fail(`读不到 ${TEXT_PATH.pathname}：${error.message}`);
  }

  const hostTable = await loadTable(hostTextSource, 'lib/text.js');
  const clientMod = await loadClientLabel();

  // 先比表结构：键集合、顺序、显示名，任何一处不同都要报
  const hostJson = JSON.stringify(hostTable);
  const clientJson = JSON.stringify(clientMod.LANGUAGE_NAMES);
  if (hostJson !== clientJson) {
    const hostKeys = hostTable.map((pair) => pair[0]);
    const clientKeys = clientMod.LANGUAGE_NAMES.map((pair) => pair[0]);
    const missingInClient = hostKeys.filter((key) => !clientKeys.includes(key));
    const extraInClient = clientKeys.filter((key) => !hostKeys.includes(key));
    if (missingInClient.length > 0) {
      differences.push(`LANGUAGE_NAMES 缺少键（client 侧）: ${missingInClient.join(', ')}`);
    }
    if (extraInClient.length > 0) {
      differences.push(`LANGUAGE_NAMES 多出键（client 侧）: ${extraInClient.join(', ')}`);
    }
    if (missingInClient.length === 0 && extraInClient.length === 0) {
      differences.push('LANGUAGE_NAMES 键集合相同但顺序或显示名不同');
    }
  }
  comparisons += 1;

  // 再比行为：逐个代码走一遍两侧的 languageLabel
  for (const code of LABEL_CODES) {
    tableCases += 1;
    comparisons += 1;
    const expected = hostLanguageLabel(code);
    const actual = clientMod.languageLabel(code);
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      differences.push(`languageLabel(${JSON.stringify(code)}): host=${JSON.stringify(expected)} client=${JSON.stringify(actual)}`);
    }
  }
}

const hostRel = HOST_PATH.pathname.slice(ROOT.length);
const clientRel = CLIENT_PATH.pathname.slice(ROOT.length);

console.log('镜像段运行时比对（M14）');
console.log(`  Host  : ${hostRel}`);
console.log(`  Client: ${clientRel}`);
console.log(`  矩阵  : MODES(${MODES.length}) × LANGS(${LANGS.length}) × FALLBACKS(${FALLBACKS.length}) `
  + `× DEFAULTS(${DEFAULTS.length})，另扫 effectiveMode 的 targetLanguage 维`);
console.log(`  函数  : ${FUNCTIONS.join(' / ')}`);
console.log(`  显示名表（P1）: ${LABEL_CODES.length} 组 languageLabel 用例 + 表结构 1 次`);

if (differences.length > 0) {
  console.error('');
  console.error(`✗ 两侧不等价：${differences.length} 处（共 ${comparisons} 次比较，${cases} 组输入）`);
  for (const line of differences.slice(0, 10)) console.error(`    ${line}`);
  if (differences.length > 10) console.error(`    …… 还有 ${differences.length - 10} 处未列出`);
  console.error('');
  console.error('  修法：改 client.js 镜像段让它与 lib/language.js 等价，或反之；');
  console.error('        两侧必须逐条一致，见 client.js 镜像段顶部注释。');
  process.exit(1);
}

console.log('');
console.log(`  用例数: ${cases}（${comparisons} 次函数比较，另含显示名表 ${tableCases} 组）`);
console.log('  不一致: 0');
console.log('✓ 镜像段与 lib/language.js 完全等价');
process.exit(0);
