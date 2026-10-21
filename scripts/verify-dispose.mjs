/**
 * Host 半的真容器卸载验证：用真 `@deepseek-ai/cordis` 起容器，插件挂上、卸下，
 * 断言注册物归零。
 *
 * 直接跑：
 *   node scripts/verify-dispose.mjs
 *
 * 为什么要有这个脚本：`npm test` 里另外几个脚本全是 grep / 正则 / 假 ctx，
 * 对「卸载后有没有残留」零覆盖——section 注册了却释放不掉、事件监听泄漏，
 * 这些在长会话里表现为「插件卸了但约束还在」或「监听越积越多」。
 * 竞品 `dsh-thinking-language` 的 `cordis-check.mjs` 就是这么测的，我们照做。
 *
 * 依赖说明：`@deepseek-ai/cordis` 不在 `dependencies` 里（本包零运行时依赖），
 * 只在 devDependency / 本地临时安装时可用。解析不到时本脚本打印 TODO 并
 * **退出码 0**——不能让裸工作区的 `npm test` 因为没装 devDependency 而变红。
 *
 * 退出码：0 全过（或 cordis 不可用而跳过）；1 有失败。
 */

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

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
  }
}

const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

// —— 1. cordis 可用性探测：不可用就跳过，不让零依赖环境变红 ——
let Context = null;
let Service = null;
try {
  ({ Context, Service } = await import('@deepseek-ai/cordis'));
} catch {
  console.log('TODO 跳过真容器卸载验证：@deepseek-ai/cordis 不可解析。');
  console.log('     装上后再跑：npm install --no-save @deepseek-ai/cordis');
  console.log('     或把它加进 devDependencies。');
  process.exit(0);
}

// —— 2. `lib/cycle.js` 顶层静态 import `@deepseek-ai/dsh-llm`，
//       而该包是 optional peer（宿主提供，工作区通常没有）。
//       用 registerHooks 把解析短路到一个最小 stub，只为让模块图能加载。
//       本脚本不测 createUserMessage 的行为，它的行为由 verify-language /
//       验收清单 F5 覆盖。 ——
const DSH_LLM_STUB =
  'data:text/javascript,' +
  encodeURIComponent('export function createUserMessage(input) { return input; }');

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-llm') return { url: DSH_LLM_STUB, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

// —— 3. 加载插件。schemastery 缺失会让 Config 退化成 undefined 并打一条告警，
//       属预期降级（0.3.0 的改动），这里静音掉以免污染测试输出。 ——
const originalWarn = console.warn;
console.warn = () => {};
const plugin = await import('../lib/index.js');
console.warn = originalWarn;

/** 假的 systemPrompt 服务：只实现 section()，返回释放函数。 */
class FakeSystemPrompt extends Service {
  constructor(ctx) {
    super(ctx, 'systemPrompt');
    this.sections = new Map();
  }

  section(entry) {
    this.sections.set(entry.name, entry);
    return () => {
      this.sections.delete(entry.name);
    };
  }
}

/** 假的 commands 服务：只实现 register()，返回释放函数。 */
class FakeCommands extends Service {
  constructor(ctx) {
    super(ctx, 'commands');
    this.registered = new Map();
  }

  register(command) {
    this.registered.set(command.name, command);
    return () => {
      this.registered.delete(command.name);
    };
  }
}

/** 起一个容器，装上假服务，返回容器。 */
async function makeContainer({ withCommands = false } = {}) {
  const ctx = new Context();
  ctx.plugin(FakeSystemPrompt);
  if (withCommands) ctx.plugin(FakeCommands);
  await tick();
  return ctx;
}

/** 数某个事件上挂了多少监听（cordis 内部结构，取不到就返回 null）。 */
function listenerCount(ctx, event) {
  const hooks = ctx?.events?._hooks;
  if (!hooks) return null;
  const bucket = hooks[event];
  if (bucket === undefined) return 0;
  return Array.isArray(bucket) ? bucket.length : null;
}

// —— 用例 ——

await chk('apply 注册三个 section，name 与 order 都对', async () => {
  const ctx = await makeContainer();
  const fiber = ctx.plugin({ name: 'language-guard', inject: plugin.inject, apply: plugin.apply });
  await tick();

  const names = [...ctx.systemPrompt.sections.keys()];
  assert.deepEqual(
    names,
    ['language-guard:head', 'language-guard:mid', 'language-guard:tail'],
    `section 集合不对：${JSON.stringify(names)}`,
  );
  assert.equal(ctx.systemPrompt.sections.get('language-guard:head').order, -2000);
  assert.equal(ctx.systemPrompt.sections.get('language-guard:mid').order, 5100);
  assert.equal(ctx.systemPrompt.sections.get('language-guard:tail').order, 11200);

  await fiber.dispose();
  await tick();
});

await chk('dispose 后三个 section 全部释放', async () => {
  const ctx = await makeContainer();
  const fiber = ctx.plugin({ name: 'language-guard', inject: plugin.inject, apply: plugin.apply });
  await tick();
  assert.equal(ctx.systemPrompt.sections.size, 3, '挂载后应有 3 个 section');

  await fiber.dispose();
  await tick();
  assert.equal(ctx.systemPrompt.sections.size, 0, '卸载后不应残留 section');
});

await chk('dispose 后 agent/pre-step 监听释放', async () => {
  const ctx = await makeContainer();
  // strength 传 'D' 才会注册周期提醒（agent/pre-step）
  const fiber = ctx.plugin(
    { name: 'language-guard', inject: plugin.inject, apply: plugin.apply },
    { strength: 'D' },
  );
  await tick();

  const mounted = listenerCount(ctx, 'agent/pre-step');
  assert.ok(mounted !== null, 'cordis 内部结构变了，数不到监听数（需要更新本脚本）');
  assert.equal(mounted, 1, `D 档应挂 1 个 agent/pre-step 监听，实际 ${mounted}`);

  await fiber.dispose();
  await tick();
  assert.equal(listenerCount(ctx, 'agent/pre-step'), 0, '卸载后不应残留 agent/pre-step 监听');
});

await chk('B 档 mid 段返回空串（等价于该段不存在）', async () => {
  const ctx = await makeContainer();
  const fiber = ctx.plugin(
    { name: 'language-guard', inject: plugin.inject, apply: plugin.apply },
    { strength: 'B' },
  );
  await tick();

  // B 档也必须注册 mid section，只是 text 返回空串；
  // 宿主的 renderPrompt 会 `.filter(text => text.length > 0)` 把它丢掉，不留空行。
  const mid = ctx.systemPrompt.sections.get('language-guard:mid');
  assert.ok(mid, 'B 档也必须注册 mid section（只是 text 返回空串）');
  assert.equal(mid.text(), '', 'B 档 mid 的 text 应为空串');

  await fiber.dispose();
  await tick();

  // C 档作对照，防止「所有档都返回空串」这种反向 bug 蒙混过关。
  // 用独立容器：section 按 name 存，同容器再挂一个会覆盖前一个。
  const cCtx = await makeContainer();
  const cFiber = cCtx.plugin(
    { name: 'language-guard', inject: plugin.inject, apply: plugin.apply },
    { strength: 'C' },
  );
  await tick();
  const cMid = cCtx.systemPrompt.sections.get('language-guard:mid');
  assert.ok(cMid, 'C 档也必须注册 mid section');
  assert.ok(cMid.text().length > 0, 'C 档 mid 的 text 不应为空串');

  await cFiber.dispose();
  await tick();
});

await chk('有 commands 服务时注册 /language，dispose 后释放', async () => {
  const ctx = await makeContainer({ withCommands: true });
  const fiber = ctx.plugin({ name: 'language-guard', inject: plugin.inject, apply: plugin.apply });
  await tick();

  assert.ok(ctx.commands.registered.has('language'), '/language 命令没有注册');

  await fiber.dispose();
  await tick();
  assert.equal(ctx.commands.registered.size, 0, '卸载后不应残留命令');
});

await chk('缺 settings 服务时 apply 正常完成，不挂起', async () => {
  const ctx = await makeContainer();
  const fiber = ctx.plugin({ name: 'language-guard', inject: plugin.inject, apply: plugin.apply });
  await tick();

  // settings 是 ctx.inject 懒注入：没有该服务时不能抛错、也不能让插件永久 pending。
  // 判据是「section 照常注册」——这正是 headless 部署要的行为。
  assert.equal(ctx.systemPrompt.sections.size, 3, 'settings 缺失时 section 仍应注册');

  await fiber.dispose();
  await tick();
});

await chk('重复挂载/卸载两轮不累积残留', async () => {
  const ctx = await makeContainer();

  for (let round = 1; round <= 2; round += 1) {
    const fiber = ctx.plugin({ name: 'language-guard', inject: plugin.inject, apply: plugin.apply });
    await tick();
    assert.equal(ctx.systemPrompt.sections.size, 3, `第 ${round} 轮挂载后应有 3 个 section`);

    await fiber.dispose();
    await tick();
    assert.equal(ctx.systemPrompt.sections.size, 0, `第 ${round} 轮卸载后不应残留 section`);
  }
});

// —— 汇总 ——
if (failures.length === 0) {
  console.log(`\n全部 ${pass} 项通过`);
  process.exit(0);
}

console.log(`\n共 ${failures.length} 项失败 / ${pass + failures.length} 项`);
for (const [name, error] of failures) {
  console.log(`FAIL ${name}`);
  console.log(`     ${error && error.message ? error.message : String(error)}`);
}
process.exit(1);
