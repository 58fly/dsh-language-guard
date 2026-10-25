/**
 * 宿主 API 兼容性自检。
 *
 * 为什么需要它：本插件依赖一批**宿主私有接口**——systemPrompt.section/context、
 * settings.configure/describe、commands.register、客户端 configForms/locale/slots。
 * 这些都不在公开 API 文档里，dsh 升级时随时可能改名或改签名。此前每次适配新版本
 * 都靠人工读 asar 逐个 grep，既不可重复也无法在 CI 里跑。
 *
 * 做法：直接解析 app.asar（Electron asar 格式：16 字节头 + JSON 目录 + 数据段），
 * 把宿主源码读成字符串，逐条断言本插件实际用到的接口仍在、且签名关键片段没变。
 * 不做语义分析——只验证「我们依赖的符号还在原位」，这是升级时最先被破坏的东西。
 *
 * 找不到 asar（非桌面版安装、CI 环境）时打印 SKIP 并 exit 0：这个判据只在装了
 * DSH 桌面版的机器上有意义，CI 上没有 asar 是正常情况，不该判失败。
 *
 * 用法：node scripts/verify-host-api.mjs
 * 退出码：0 全部通过（或跳过）；1 有不兼容项。
 */
import { readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';

/** 桌面版 asar 的默认位置；可用 DSH_ASAR 覆盖（便于测试其它安装路径）。 */
const ASAR = process.env.DSH_ASAR
  || '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar';

let pass = 0;
const failures = [];

async function chk(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push([name, error]);
    console.log(`FAIL ${name}`);
    console.log(`       ${error.message}`);
  }
}

/**
 * 极简 asar 读取器。
 * 格式：前 16 字节是 4 个小端 uint32，其中第 2 个（索引 1）是 header pickle 的大小，
 * 第 4 个（索引 3）是 header JSON 的长度；数据段起点 = 8 + headerPickleSize。
 */
function openAsar(path) {
  const buffer = readFileSync(path);
  const headerSize = buffer.readUInt32LE(4);
  const jsonLength = buffer.readUInt32LE(12);
  const header = JSON.parse(buffer.subarray(16, 16 + jsonLength).toString('utf8'));
  const base = 8 + headerSize;

  function nodeAt(inner) {
    let node = header;
    for (const segment of inner.split('/')) {
      if (segment === '') continue;
      node = node?.files?.[segment];
      if (node === undefined) throw new Error(`asar 里没有 ${inner}`);
    }
    return node;
  }

  return {
    /** 读文件为 utf8 字符串 */
    text(inner) {
      const node = nodeAt(inner);
      return buffer.subarray(base + Number(node.offset), base + Number(node.offset) + Number(node.size)).toString('utf8');
    },
  };
}

if (!existsSync(ASAR)) {
  console.log(`SKIP 宿主 asar 不存在（${ASAR}）——本判据只在装了 DSH 桌面版的机器上有意义`);
  process.exit(0);
}

let asar;
try {
  asar = openAsar(ASAR);
} catch (error) {
  console.log(`FAIL 无法解析宿主 asar：${error.message}`);
  process.exit(1);
}

// 逐条断言：本插件实际调用的宿主接口。
const DEPS = 'dsh/node_modules/@deepseek-ai';

/** 断言某文件里存在某个正则，失败时给出文件与正则。 */
function has(file, pattern, what) {
  const text = asar.text(file);
  assert.match(text, pattern, `${file} 里找不到 ${what}（模式 ${pattern}）`);
  return text;
}

// —— Host 半 ——
await chk('宿主 dsh 版本可读且不低于 engines 下限', () => {
  const pkg = JSON.parse(asar.text('dsh/package.json'));
  assert.ok(pkg.version, 'dsh/package.json 没有 version');
  const [major, minor] = pkg.version.split(/[.-]/).map(Number);
  assert.ok(major > 0 || minor >= 2, `宿主版本 ${pkg.version} 低于 engines.dsh >=0.2.1-rc.2`);
});

await chk('systemPrompt.section() 存在（三处常驻注入）', () => {
  has(`${DEPS}/dsh-system-prompt/lib/index.js`, /\bsection\s*\(/, 'section()');
});

await chk('systemPrompt.context() 存在（备用通道）', () => {
  has(`${DEPS}/dsh-system-prompt/lib/index.js`, /\bcontext\s*\(/, 'context()');
});

await chk('section 仍要求 order 为有限数', () => {
  has(`${DEPS}/dsh-system-prompt/lib/index.js`, /Number\.isFinite\(section\.order\)/, 'order 有限性校验');
});

await chk('renderPrompt 仍过滤空字符串（B 档 mid 返回 "" 等价于不存在）', () => {
  has(`${DEPS}/dsh-system-prompt/lib/index.js`, /filter\(\(text\) => text\.length > 0\)/, '空串过滤');
});

await chk('interpolate: false 仍受支持（我方三段全部用它规避 {{ }} 抛错）', () => {
  has(`${DEPS}/dsh-system-prompt/lib/index.js`, /interpolate === false/, 'interpolate: false 分支');
});

await chk('TOOLS_SDK 仍为 5000（mid 段 order 5100 依赖它）', () => {
  const text = asar.text(`${DEPS}/dsh-system-prompt/lib/index.js`);
  assert.match(text, /TOOLS_SDK:\s*5e3|TOOLS_SDK:\s*5000/, '找不到 TOOLS_SDK: 5000，mid 段 order 5100 的定位依据失效');
});

await chk('settings.configure() 存在', () => {
  has(`${DEPS}/dsh-settings/lib/index.js`, /\bconfigure\s*\(/, 'configure()');
});

await chk('settings.describe() 存在', () => {
  has(`${DEPS}/dsh-settings/lib/index.js`, /\bdescribe\s*\(/, 'describe()');
});

await chk('settings/document-updated 事件仍会发出（UI 语言缓存靠它刷新）', () => {
  has(`${DEPS}/dsh-settings/lib/index.js`, /settings\/document-updated/, 'document-updated 事件');
});

await chk('describe() 返回行仍含 ns 与 value 字段', () => {
  const text = asar.text(`${DEPS}/dsh-settings/lib/index.js`);
  assert.match(text, /\bns:/, 'describe 行缺少 ns 字段');
  assert.match(text, /\bvalue:/, 'describe 行缺少 value 字段');
});

await chk('volatileForm 仍按 schema.meta.volatile 判定（7 个字段都 .volatile()）', () => {
  has(`${DEPS}/dsh-settings/lib/index.js`, /schema\.meta\.volatile/, 'volatileForm 的 volatile 判定');
});

await chk('commands.register() 存在（/language 命令）', () => {
  has(`${DEPS}/dsh-commands/lib/index.js`, /\bregister\s*\(/, 'register()');
});

await chk('agent/pre-step 瀑布仍存在（D 档周期提醒）', () => {
  has(`${DEPS}/dsh-agent-loop/lib/index.js`, /agent\/pre-step/, 'agent/pre-step 事件');
});

await chk('dsh-llm 仍导出 createUserMessage（周期提醒构造消息）', () => {
  has(`${DEPS}/dsh-llm/lib/index.js`, /createUserMessage/, 'createUserMessage');
});

// —— Client 半 ——
await chk('客户端 configForms 服务仍存在', () => {
  has(`${DEPS}/dsh-client-ui-settings/lib/client.js`, /super\(ctx,\s*"configForms"\)/, 'configForms 服务定义');
});

await chk('configForms.get(entryId) 仍存在', () => {
  has(`${DEPS}/dsh-client-ui-settings/lib/client.js`, /\bget\s*\(\s*entryId\s*\)/, 'get(entryId)');
});

await chk('configForms.whileServed(namespaces, register) 仍存在', () => {
  has(`${DEPS}/dsh-client-ui-settings/lib/client.js`, /\bwhileServed\s*\(\s*namespaces\s*,\s*register\s*\)/, 'whileServed 签名');
});

await chk('客户端 locale.register(ns, ...) 仍存在', () => {
  has(`${DEPS}/dsh-client-locale/lib/client.js`, /\bregister\s*\(\s*ns\s*,/, 'register(ns, ...)');
});

await chk('客户端 locale.bind(ns) 仍存在', () => {
  has(`${DEPS}/dsh-client-locale/lib/client.js`, /\bbind\s*\(\s*ns\s*\)/, 'bind(ns)');
});

await chk('内置界面语言仍只有 zh / en（自动模式的前提）', () => {
  const text = asar.text(`${DEPS}/dsh-client-locale/lib/client.js`);
  assert.match(text, /LOCALE_IDS\s*=\s*\[[^\]]*"zh"[^\]]*"en"/, 'LOCALE_IDS 不再是 zh/en，自动模式的映射假设需要重算');
});

await chk('slot sidebar.footer.action 仍存在（侧栏快速切换）', () => {
  has(`${DEPS}/dsh-client-ui-sidebar/lib/client.js`, /sidebar\.footer\.action/, 'sidebar.footer.action');
});

await chk('slot plugins.bundle.config 仍存在（设置卡片）', () => {
  has(`${DEPS}/dsh-client-ui-plugin-manager/lib/client.js`, /plugins\.bundle\.config/, 'plugins.bundle.config');
});

console.log('');
console.log(`宿主 asar：${ASAR}`);
console.log(`全部 ${pass} 项通过 / ${pass + failures.length} 项`);

if (failures.length > 0) {
  console.log('');
  console.log('不兼容项（dsh 升级后接口变了，需要适配）：');
  for (const [name] of failures) console.log(`  - ${name}`);
  process.exit(1);
}
