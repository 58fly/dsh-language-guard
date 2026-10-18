#!/usr/bin/env node
/**
 * 开发期 manifest 自检脚本（不发布，不进 files）。
 *
 * 用法：node scripts/verify-manifest.mjs
 * 依据：docs/decisions/03-manifest.md 第 9 节 + docs/验收清单.md 的 A/B/C/D 组机械可判项。
 *
 * 覆盖范围：
 * - package.json 形状（含「dsh.client / exports["./client"] / files 里的 client.js」三者联合断言）
 * - 必填文件存在性、icon 尺寸与格式
 * - locale 两个文件的 meta 字段
 * - cordis.patch.yml 的 insert 段
 * - client.js 的模块 id 与包名一致、不 require dsh-client-ui-primitives
 * - Host/Client 半的合规 grep（不出现 system-prompt/assemble、iframe、字面颜色等）
 *
 * 退出码 0 表示全部通过；任何一项失败打印 FAIL 并以 1 退出。
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const failures = [];
const passes = [];

/**
 * 断言一条检查项。
 * @param {string} id 条目编号
 * @param {() => void} check 断言函数，失败时抛错
 */
function chk(id, check) {
  try {
    check();
    passes.push(id);
  } catch (error) {
    failures.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

/**
 * 去掉 // 行注释与块注释，供「按字面量 grep 源码」的断言使用。
 * 注释里提到被禁字符串不算违规（例如解释为什么不能监听某个事件），
 * 但为降低审查歧义，源码注释本身也已避免写出这些字符串。
 * @param {string} source
 */
const stripComments = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
const exists = (file) => fs.existsSync(path.join(root, file));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const pkg = JSON.parse(read('package.json'));

// —— 一、package.json 形状 ——

chk('A1 name', () => assert(pkg.name === 'dsh-language-guard', `name 应为 dsh-language-guard，实际 ${pkg.name}`));
chk('A1 type', () => assert(pkg.type === 'module', 'type 必须是 module'));
chk('A2 main', () => {
  assert(pkg.main === './lib/index.js', `main 应为 ./lib/index.js，实际 ${pkg.main}`);
  assert(pkg.exports?.['.'] === './lib/index.js', 'exports["."] 应指向 ./lib/index.js');
});
chk('A3 patch', () => {
  assert(pkg.dsh?.bundle?.patch === './cordis.patch.yml', 'dsh.bundle.patch 应指向 ./cordis.patch.yml');
});
chk('A4 manifestVersion', () => assert(pkg.dsh?.manifestVersion === 1, 'dsh.manifestVersion 必须是 1'));
chk('A5 engines.dsh', () => {
  assert(typeof pkg.engines?.dsh === 'string' && pkg.engines.dsh.length > 0, 'engines.dsh 必须是非空字符串');
  assert(!pkg.engines.dsh.includes('workspace:'), 'engines.dsh 不能是 workspace: 值');
});
chk('A5 engines.node', () => assert(typeof pkg.engines?.node === 'string', 'engines.node 必须声明'));
chk('A6 exports', () => {
  for (const key of ['.', './client', './locale/*.json', './icon', './package.json']) {
    assert(key in (pkg.exports || {}), `exports 缺 ${key}`);
  }
  assert(pkg.exports['./client'] === './client.js', 'exports["./client"] 应指向 ./client.js');
  assert(pkg.icon === 'icon.svg', '顶层 icon 应为 icon.svg');
});
chk('A6 files', () => {
  const files = pkg.files || [];
  for (const item of ['lib', 'client.js', 'cordis.patch.yml', 'icon.svg', 'README.md', 'README.zh.md', 'LICENSE']) {
    assert(files.includes(item), `files 缺 ${item}`);
  }
});
chk('A7 白名单', () => {
  const files = pkg.files || [];
  for (const banned of ['docs', 'issues', 'scripts', 'asar_tool.py', '.agent-teams']) {
    assert(!files.includes(banned), `files 不应包含 ${banned}`);
  }
});
chk('A8 patch 行', () => {
  const patch = read('cordis.patch.yml');
  const rows = patch.split('\n').filter((line) => /^\s+-\s+id:\s*\S/.test(line));
  assert(rows.length === 1, `insert 行数应为 1，实际 ${rows.length}`);
  assert(/id:\s*dsh-language-guard/.test(patch), 'insert 行的 id 应为包名');
  assert(/name:\s*dsh-language-guard/.test(patch), 'insert 行的 name 应为包名');
});
chk('A9 dsh.client 三处齐备', () => {
  assert(pkg.dsh?.client, '必须有 dsh.client，否则面板上没有配置控件');
  assert(pkg.dsh.client.platform === 'web', 'dsh.client.platform 必须是 web');
  assert(pkg.dsh.client.immediately === true, 'dsh.client.immediately 必须是 true');
  assert(
    Array.isArray(pkg.dsh.client.inject) && pkg.dsh.client.inject.length > 0,
    'dsh.client.inject 不能为空',
  );
  assert(pkg.dsh.client.external === undefined, '本包无非基线 import，不应声明 dsh.client.external');
  assert(pkg.exports?.['./client'] === './client.js', '缺 exports["./client"]');
  assert((pkg.files || []).includes('client.js'), 'files 必须包含 client.js');
});

// —— 二、必填文件、locale、icon ——

const requiredFiles = [
  'lib/index.js',
  'lib/text.js',
  'lib/state.js',
  'lib/commands.js',
  'lib/cycle.js',
  'client.js',
  'cordis.patch.yml',
  'icon.svg',
  'locale/en.json',
  'locale/zh.json',
  'LICENSE',
];
chk('B0 文件存在', () => {
  const missing = requiredFiles.filter((file) => !exists(file));
  assert(missing.length === 0, `缺文件 ${missing.join(', ')}`);
});
// README 由票 #08/t9 交付；此处只提示，不计入失败
const readmeMissing = ['README.md', 'README.zh.md'].filter((file) => !exists(file));
if (readmeMissing.length > 0) console.log(`WARN 待 t9 交付：${readmeMissing.join(', ')}`);

chk('B1/B2 locale meta', () => {
  for (const lang of ['en', 'zh']) {
    const meta = JSON.parse(read(`locale/${lang}.json`)).meta;
    assert(meta?.title, `locale/${lang}.json 缺 meta.title`);
    assert(meta?.description, `locale/${lang}.json 缺 meta.description`);
  }
  const enTitle = JSON.parse(read('locale/en.json')).meta.title;
  const zhTitle = JSON.parse(read('locale/zh.json')).meta.title;
  assert(enTitle !== zhTitle, '两个 locale 的 title 应分别是各自语言');
});
chk('B3 icon 尺寸', () => {
  const size = fs.statSync(path.join(root, 'icon.svg')).size;
  assert(size <= 256 * 1024, `icon 超过 256 KiB（实际 ${size} 字节）`);
});
chk('B4 icon 格式', () => {
  const head = read('icon.svg').trimStart();
  assert(head.startsWith('<svg'), 'icon.svg 必须以 <svg 开头');
});

// —— 三、Host / Client 合规 grep ——

const hostFiles = ['lib/index.js', 'lib/text.js', 'lib/state.js', 'lib/commands.js', 'lib/cycle.js'];
const hostSource = hostFiles.map(read).join('\n');
const clientSource = read('client.js');
// 判定「源码里有没有某个字符串」时先剥注释：注释里的解释性提及不算违规
const hostCode = stripComments(hostSource);
const clientCode = stripComments(clientSource);
const allSource = hostCode + '\n' + clientCode;

chk('C1 named exports 且无 default', () => {
  assert(/export function apply\s*\(/.test(hostCode), 'lib/index.js 必须 export function apply');
  assert(/export const Config\s*=/.test(hostCode), 'lib/index.js 必须 export const Config');
  assert(/export const inject\s*=/.test(hostCode), 'lib/index.js 必须 export const inject');
  assert(!/export default/.test(hostCode), '不得有 default export');
});
chk('C2 资源用 ctx.effect/ctx.on 注册', () => {
  assert(/ctx\.effect\(/.test(hostCode), 'Host 半必须用 ctx.effect 注册资源');
  assert(!/(^|[^.\w])setInterval\(/.test(hostCode), '不得出现裸 setInterval');
  assert(!/window\.addEventListener|globalThis\.addEventListener/.test(hostCode), '不得注册全局监听');
});
chk('C3 section 唯一且 order 为数字', () => {
  const orders = [...hostCode.matchAll(/order:\s*(-?\d+)/g)].map((match) => Number(match[1]));
  assert(orders.includes(-2000), '缺 order -2000（head）');
  assert(orders.includes(5100), '缺 order 5100（mid，不能用 5000）');
  assert(orders.includes(11200), '缺 order 11200（tail）');
  assert(!/complete:\s*true/.test(hostCode), 'section 不得带 complete: true');
  assert(!/order:\s*[A-Za-z_$]/.test(hostCode), 'order 必须是数字字面量');
});
chk('C4 不监听 system-prompt/assemble', () => {
  assert(!allSource.includes('system-prompt/assemble'), '源码中不得出现 system-prompt/assemble');
});
chk('C5 pre-step 改写合规', () => {
  assert(/await next\(\)/.test(hostCode), 'agent/pre-step 必须 await next()');
  assert(/\.\.\.decision,\s*messages:/.test(hostCode), '必须 { ...decision, messages } spread');
  assert(/step\s*!==\s*1|step\s*===\s*1/.test(hostCode), '门禁必须含 step === 1');
  assert(!/llm\/stream/.test(hostCode), '不得改写流式响应');
  assert(!/reasoning-delta/.test(hostCode), '不得改写推理增量');
});
chk('C6 D 档 source 字段', () => {
  assert(/kind:\s*'language-guard'/.test(hostCode), 'source.kind 必须是 language-guard');
  assert(/form:\s*'notice'/.test(hostCode), 'source.form 必须是 notice');
  assert(/summary:\s*'语言自检'/.test(hostCode), 'source.summary 不能为空');
  assert(!/kind:\s*'runtime-context'/.test(hostCode), 'source.kind 不能是 runtime-context');
});
chk('C7 不 append 新 type 事件', () => {
  assert(!/session\.append\(/.test(hostCode), '不得 append 自定义 session 事件');
});
chk('C9 Config 全字段 volatile', () => {
  const fields = ['targetLanguage', 'strength', 'injectEveryNRounds', 'preserveCodeTerms', 'extraRules', 'overrideHead'];
  for (const field of fields) assert(hostCode.includes(field), `Config 缺字段 ${field}`);
  const volatileCount = (hostCode.match(/\.volatile\(\)/g) || []).length;
  assert(volatileCount === 6, `.volatile() 应出现 6 次（逐字段），实际 ${volatileCount} 次`);
  assert(!/z\.object\([\s\S]*\}\)\.volatile\(\)/.test(hostCode), 'volatile 不能加在根对象上');
});
chk('C10 不依赖第三方插件', () => {
  // 只禁「真实依赖」形式：import / require / ctx.inject 指名该包。
  // 面板与 locale 里的共存提示文案（F17 / D13 要求）是纯文本，不算依赖。
  const depPatterns = [
    /(?:^|\n)\s*import[^\n]*from\s*['"][^'"]*dsh-context/,
    /require\(\s*['"][^'"]*dsh-context/,
    /ctx\.inject\(\s*\[[^\]]*dsh-context/,
    /ctx\.slots\.inject\(\s*['"][^'"]*dsh-context/,
  ];
  for (const pattern of depPatterns) {
    assert(!pattern.test(allSource), `不得依赖第三方插件 dsh-context（命中 ${pattern}）`);
  }
  // 反向：共存提示必须真的写进面板与两个 locale（F17 / D13 / R6）
  assert(/dsh-context/.test(clientCode), 'client.js 必须有 dsh-context 共存提示（D13）');
  for (const lang of ['en', 'zh']) {
    const meta = JSON.parse(read(`locale/${lang}.json`)).meta;
    assert(/dsh-context/.test(meta.description || ''), `locale/${lang}.json 的 meta.description 必须含共存提示（D13）`);
  }
});

chk('D1/D2 client 装载契约', () => {
  assert(/__ModuleLoader__\.load\(\{/.test(clientCode), 'client.js 必须调用 __ModuleLoader__.load');
  const match = clientCode.match(/__ModuleLoader__\.load\(\s*\{[\s\S]*?id:\s*['"]([^'"]+)['"]/);
  assert(match, '找不到 __ModuleLoader__.load({ id: ... })');
  assert(match[1] === pkg.name, `client.js 的 id 必须等于包名，实际是 ${match[1]}`);
  assert(/factory\s*\(\s*require\s*\)/.test(clientCode), 'factory 必须接收 require');
  assert(/require\(\s*['"]react['"]\s*\)/.test(clientCode), 'React 必须从宿主模块表取');
  assert(/inject:\s*\[[^\]]*['"]slots['"]/.test(clientCode), 'client.js 的 inject 必须含 slots');
});
chk('D3 factory 无副作用', () => {
  const start = clientSource.indexOf('factory(require)');
  assert(start > 0, '找不到 factory(require)');
  const body = clientSource.slice(start);
  // 只取 factory 的顶层语句：本文件统一 6 空格缩进一层，
  // 函数体与组件体缩进更深，其中的 useEffect 监听器（含清理函数）不算模块副作用。
  const topLevel = body
    .split('\n')
    .filter((line) => /^ {6}\S/.test(line) && !/^ {6}(function|const|let|var|return|\/\*|\*)/.test(line));
  for (const line of topLevel) {
    for (const banned of ['document.', 'window.', 'appendChild', 'addEventListener', 'setInterval', 'setTimeout']) {
      assert(!line.includes(banned), `factory 顶层不得有副作用：${line.trim()}`);
    }
  }
});
chk('D4 不替换 app root', () => {
  assert(!/createRoot\(/.test(clientCode), '不得调用 createRoot');
  assert(!/document\.body\.appendChild/.test(clientCode), '不得往 document.body 追加应用');
  assert(!/document\.head\.appendChild/.test(clientCode), '不得往 document.head 追加样式');
});
chk('D5 无 iframe', () => {
  assert(!/iframe/i.test(allSource), '不得出现 iframe');
});
chk('D6 不 require primitives', () => {
  assert(!clientCode.includes('dsh-client-ui-primitives'), '不得 require dsh-client-ui-primitives');
  assert(!JSON.stringify(pkg.dsh.client.inject).includes('primitives'), 'dsh.client.inject 不得含 primitives');
});
chk('D7 只用 alias token', () => {
  const tokens = [...clientCode.matchAll(/--dsw-[a-z0-9-]+/g)].map((match) => match[0]);
  const bad = tokens.filter((token) => !token.startsWith('--dsw-alias-') && token !== '--dsw-focus-ring-color');
  assert(bad.length === 0, `出现非 alias token：${[...new Set(bad)].join(', ')}`);
});
chk('D8 无字面颜色', () => {
  const styleBlock = clientSource.slice(clientSource.indexOf('const CSS ='), clientSource.indexOf('// —— 工具函数'));
  assert(!/#[0-9a-fA-F]{3,8}\b/.test(styleBlock), 'CSS 常量里不得出现十六进制颜色');
  assert(!/\brgba?\(/.test(styleBlock), 'CSS 常量里不得出现 rgb()/rgba()');
  assert(!/\bhsla?\(/.test(styleBlock), 'CSS 常量里不得出现 hsl()/hsla()');
  assert(!/prefers-color-scheme/.test(clientCode), '不得写深色媒体查询分支');
});
chk('D9 文案走 locale', () => {
  assert(/ctx\.locale\.register\(NS,\s*\{\s*zh,\s*en\s*\}\)/.test(clientCode), '必须注册 zh/en 字典');
  assert(/const NS = 'languageGuard'/.test(clientCode), 'NS 必须是 languageGuard');
  assert(!/ctx\.locale\.addLanguage/.test(clientCode), '不得调用 addLanguage');
});
chk('D10 zh/en key 集合一致', () => {
  const zhKeys = [...clientSource.matchAll(/^\s{6}'([\w.]+)':/gm)].map((match) => match[1]);
  const zhBlock = clientSource.slice(clientSource.indexOf('const zh = {'), clientSource.indexOf('const en = {'));
  const enBlock = clientSource.slice(clientSource.indexOf('const en = {'), clientSource.indexOf('// —— 样式'));
  const keysOf = (block) => [...block.matchAll(/^\s+'([\w.]+)':/gm)].map((match) => match[1]).sort();
  const zhList = keysOf(zhBlock);
  const enList = keysOf(enBlock);
  assert(zhList.length > 0, 'zh 字典为空');
  assert(zhList.length === enList.length, `zh(${zhList.length}) 与 en(${enList.length}) 的 key 数量不一致`);
  const missing = zhList.filter((key) => !enList.includes(key));
  assert(missing.length === 0, `en 缺 key：${missing.join(', ')}`);
  assert(zhKeys.length >= 0, 'noop');
});
chk('D11 注册两个 slot', () => {
  assert(/plugins\.bundle\.config/.test(clientCode), '必须注册 plugins.bundle.config');
  assert(/sidebar\.footer\.action/.test(clientCode), '必须注册 sidebar.footer.action');
  assert(/key:\s*ENTRY_ID|key:\s*'dsh-language-guard'/.test(clientCode), 'plugins.bundle.config 的 key 必须是包名');
  assert(/id:\s*'language-guard'/.test(clientCode), 'sidebar.footer.action 的 id 必须是 language-guard');
  assert(/order:\s*100/.test(clientCode), 'sidebar.footer.action 的 order 必须是 100');
  for (const banned of ['plugins.item', 'plugins.row.config', 'settings.section', 'conversation.composer.dock']) {
    assert(!clientCode.includes(banned), `不应注册 ${banned}`);
  }
});
chk('D12 whileServed 守卫', () => {
  const count = (clientCode.match(/whileServed\(/g) || []).length;
  assert(count === 2, `两个 slot 都应包 whileServed，实际出现 ${count} 次`);
});

// —— 四、发布相关 ——

chk('R5 LICENSE', () => {
  assert(pkg.license === 'MIT', 'package.json.license 必须是 MIT');
  const license = read('LICENSE');
  assert(license.includes('MIT License'), 'LICENSE 必须含 MIT License 正文');
  assert(license.includes('THE SOFTWARE IS PROVIDED "AS IS"'), 'LICENSE 必须含 MIT 免责声明');
});
chk('R22 无 private', () => {
  assert(!('private' in pkg), 'private 必须不存在，否则 npm publish 被拒');
});
chk('R18 publishConfig', () => {
  assert(pkg.publishConfig?.access === 'public', 'publishConfig.access 必须是 public');
});
chk('R3 files 非空', () => {
  assert(Array.isArray(pkg.files) && pkg.files.length > 0, 'files 不能为空');
});
chk('R4 无安装期脚本', () => {
  const scripts = pkg.scripts || {};
  assert(
    !Object.keys(scripts).some((key) => /install|prepare|prepublish/.test(key)),
    '不得声明 install/prepare/prepublish 类脚本',
  );
});
chk('R12 keywords', () => {
  const keywords = pkg.keywords || [];
  assert(keywords.includes('dsh-plugin'), 'keywords 缺 dsh-plugin');
  assert(keywords.includes('deepseek-harness'), 'keywords 缺 deepseek-harness');
});
chk('R9/R10/R11 元数据', () => {
  assert(String(pkg.repository?.url || '').includes('58fly/dsh-language-guard'), 'repository 应指向 58fly/dsh-language-guard');
  assert(typeof pkg.repository?.type === 'string', 'repository.type 必须存在');
  assert(Boolean(pkg.author), 'author 必须存在');
  assert(String(pkg.bugs?.url || '').includes('58fly/dsh-language-guard'), 'bugs 应指向本仓库');
  assert(String(pkg.homepage || '').includes('58fly/dsh-language-guard'), 'homepage 应指向本仓库');
});

// —— 输出 ——

for (const id of passes) console.log(`PASS ${id}`);
for (const failure of failures) console.error(`FAIL ${failure}`);

if (failures.length > 0) {
  console.error(`\n共 ${failures.length} 项失败，${passes.length} 项通过。`);
  process.exit(1);
}

console.log(`\n全部 ${passes.length} 项检查通过：${pkg.name}@${pkg.version}`);
