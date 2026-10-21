/**
 * Client 半的无浏览器验证：加载 + 降级 + 槽注册。
 *
 * 直接跑：
 *   node scripts/verify-client.mjs
 *
 * 覆盖三件事：
 *   1. `client.js` 能被 `window.__ModuleLoader__.load` 接受，`factory` 无副作用；
 *   2. 服务缺失时**降级而不是抛错**——locale 可选、configForms 缺失即整体跳过；
 *   3. 服务齐全时两个槽都注册，且 `dispose` 后回调都被清理。
 *
 * 为什么要有这个脚本：0.3.1 及以前 `apply()` 第一行直接 `ctx.locale.register(...)`，
 * 缺 locale 就抛 TypeError 并连带吞掉后面两个槽的注册——面板与侧栏同时消失，
 * 而 74 项验收清单全是 grep/正则，一条都覆盖不到这里。本脚本补上这层。
 *
 * 退出码：0 全过；1 有失败。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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

// —— React stub：只给 client.js 实际用到的那几个 ——
const reactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  Fragment: Symbol('Fragment'),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: (factory) => factory(),
  useRef: (initial) => ({ current: initial }),
  useCallback: (fn) => fn,
};

/** 装一个假的 `window.__ModuleLoader__`，载入 client.js，返回 factory 的返回值。 */
function loadClient() {
  let bundle = null;
  globalThis.window = { __ModuleLoader__: { load: (definition) => { bundle = definition; } } };
  // client.js 是纯副作用脚本（只在 window.__ModuleLoader__.load 里注册），无导出。
  // 用 data: URL 重新求值，避免 ESM 缓存让第二次加载拿到旧的 window。
  const source = readFileSync(join(ROOT, 'client.js'), 'utf8');
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return import(url).then(() => {
    assert.ok(bundle, 'client.js 没有调用 window.__ModuleLoader__.load');
    assert.equal(bundle.id, 'dsh-language-guard', 'bundle.id 必须等于包名');
    return bundle.factory((specifier) => {
      if (specifier === 'react') return reactStub;
      throw new Error(`factory 只应 require('react')，实际 require 了 ${specifier}`);
    });
  });
}

/**
 * 造一个假 ctx。
 * @param services 额外挂上的服务（locale / configForms）
 * @param served `whileServed` 是否立刻回调（模拟 Host 正在服务该命名空间）
 */
function makeCtx(services, served = true) {
  const registered = [];   // 注册过的槽名
  const effects = [];      // 登记过的 effect disposer
  const warnings = [];
  const slots = {
    // 只记 register 落地的槽名；inject 只是「问这个槽在不在」，不算注册。
    inject: (name, callback) => {
      assert.ok(name, 'slots.inject 缺少槽名');
      const disposer = typeof callback === 'function' ? callback() : undefined;
      return () => disposer?.();
    },
    register: (definition, component) => {
      assert.ok(component, `槽 ${JSON.stringify(definition)} 缺少组件`);
      registered.push(definition?.name ?? definition);
      return () => {};
    },
  };
  const ctx = {
    slots,
    effect: (fn) => {
      const disposer = fn();
      effects.push(disposer);
      return disposer;
    },
    on: () => () => {},
    get: (name) => services[name],
    inject: (deps, fn) => {
      if (deps.every((dep) => services[dep] !== undefined)) return fn(ctx);
      return undefined;
    },
    ...services,
  };
  if (services.configForms !== undefined) {
    ctx.configForms = {
      describe: () => [],
      whileServed: (_namespaces, callback) => {
        if (served) callback();
        return () => {};
      },
      ...services.configForms,
    };
  }
  ctx.__registered = registered;
  ctx.__effects = effects;
  ctx.__warnings = warnings;
  return ctx;
}

/** 把 console.warn 截下来，避免脚本输出里混入预期告警。 */
function captureWarn(fn) {
  const original = console.warn;
  const lines = [];
  console.warn = (...args) => lines.push(args.join(' '));
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return lines;
}

const mod = await loadClient();

// ===========================================================================
// 1. factory 契约
// ===========================================================================

await chk('factory 无副作用：只 require react 就能拿到 inject 与 apply', () => {
  assert.deepEqual(mod.inject, ['slots', 'locale', 'configForms'], 'inject 声明与预期不符');
  assert.equal(typeof mod.apply, 'function', 'apply 必须是函数');
});

// ===========================================================================
// 2. 服务缺失时降级，不抛错
// ===========================================================================

await chk('locale 缺失：不抛错，configForms 可用时两个槽仍注册', () => {
  const ctx = makeCtx({ configForms: {} });
  assert.doesNotThrow(() => mod.apply(ctx), 'locale 缺失不应抛错（0.3.1 及以前会抛 TypeError）');
  assert.deepEqual(ctx.__registered, ['plugins.bundle.config', 'sidebar.footer.action']);
});

await chk('configForms 缺失：不抛错，一个槽都不注册，并留一条告警', () => {
  const ctx = makeCtx({});
  const warnings = captureWarn(() => mod.apply(ctx));
  assert.equal(warnings.length, 1, '应当恰好告警一次');
  assert.match(warnings[0], /configForms/, '告警文案应点出 configForms');
  assert.deepEqual(ctx.__registered, [], 'configForms 缺失时不应注册任何槽');
});

await chk('configForms 缺 whileServed：按缺失处理，不抛错', () => {
  const ctx = makeCtx({ configForms: { whileServed: undefined } });
  const warnings = captureWarn(() => mod.apply(ctx));
  assert.equal(warnings.length, 1);
  assert.deepEqual(ctx.__registered, []);
});

await chk('locale 存在但 register 是坏实现：抛出后不再继续（已知边界，记录在案）', () => {
  const ctx = makeCtx({
    configForms: {},
    locale: { register: () => { throw new Error('locale 拒绝注册'); } },
  });
  // 这是刻意记录的行为：locale.register 自身抛错会中断 apply。
  // 它属于「宿主 locale 服务坏掉」，不是我们的降级目标（我们只保证服务缺失可降级）。
  // 若将来改成 try/catch 包住，本用例会随之失败，提醒同步更新说明。
  assert.throws(() => mod.apply(ctx), /locale 拒绝注册/);
});

// ===========================================================================
// 3. 服务齐全时的行为
// ===========================================================================

await chk('三服务齐全：注册两个槽，且槽名与 manifest 契约一致', () => {
  const ctx = makeCtx({ configForms: {}, locale: { register: () => () => {} } });
  assert.doesNotThrow(() => mod.apply(ctx));
  assert.deepEqual(ctx.__registered, ['plugins.bundle.config', 'sidebar.footer.action']);
});

await chk('Host 未服务该命名空间（whileServed 不回调）：两个槽都不出现', () => {
  const ctx = makeCtx({ configForms: {}, locale: { register: () => () => {} } }, false);
  assert.doesNotThrow(() => mod.apply(ctx));
  assert.deepEqual(ctx.__registered, []);
});

// ===========================================================================
// 4. dispose 语义：effect 登记的回调在释放时被调用
// ===========================================================================

await chk('dispose 后 effect disposer 全部被释放（不留监听）', () => {
  let released = 0;
  const ctx = makeCtx({
    configForms: {},
    locale: { register: () => () => { released += 1; } },
  });
  mod.apply(ctx);
  assert.equal(ctx.__effects.length, 3, '应有 3 个 effect：字典 1 个 + 两个槽守卫');
  for (const disposer of ctx.__effects) {
    if (typeof disposer === 'function') disposer();
  }
  assert.equal(released, 1, 'locale.register 返回的 disposer 必须被调用');
});

// ===========================================================================

console.log('');
if (failures.length > 0) {
  console.log(`共 ${failures.length} 项失败 / ${pass + failures.length} 项`);
  for (const [name, error] of failures) {
    console.log(`\nFAIL ${name}\n${error.message}`);
  }
  process.exit(1);
}
console.log(`全部 ${pass} 项通过`);
