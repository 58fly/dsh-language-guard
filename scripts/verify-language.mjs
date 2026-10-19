/**
 * 语言解析器单测（`lib/language.js`）。
 *
 * 直接跑：
 *   node scripts/verify-language.mjs
 *
 * 覆盖票 #14 裁决二的四行映射表、裁决一的 `effectiveMode()` 三态判定
 * （含「老用户升级」这条唯一会让升级后语言被改的路径）、以及边界输入。
 *
 * 退出码：0 全过；1 有失败。
 */

import assert from 'node:assert/strict';

import {
  MODE_AUTO,
  MODE_MANUAL,
  MODE_UNSET,
  effectiveMode,
  mapPreference,
  normalizeLocaleId,
  resolveSource,
  resolveTargetLanguage,
} from '../lib/language.js';

let pass = 0;
const failures = [];

/** 一个用例：名字 + 断言体 */
function test(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push([name, error]);
    console.log(`FAIL ${name}`);
    console.log(`     ${error.message.split('\n')[0]}`);
  }
}

/** 便捷：解析一次 */
const resolve = (mode, preference, fallback = 'zh-CN') =>
  resolveTargetLanguage({ mode, preference, fallback });

// ===========================================================================
// 一、映射表（票 #14 裁决二：四条，不多不少）
// ===========================================================================

console.log('== 一、映射表 ==');

test('映射 1/4：zh → zh-CN', () => {
  assert.equal(mapPreference('zh'), 'zh-CN');
});

test('映射 2/4：en → en', () => {
  assert.equal(mapPreference('en'), 'en');
});

test('映射 3/4：ja → ja（外部语言包 id 原样透传）', () => {
  assert.equal(mapPreference('ja'), 'ja');
});

test('映射 3/4：ko → ko', () => {
  assert.equal(mapPreference('ko'), 'ko');
});

test('映射 3/4：fr / de / pt-BR 等任意合法 id 原样透传', () => {
  assert.equal(mapPreference('fr'), 'fr');
  assert.equal(mapPreference('de'), 'de');
  assert.equal(mapPreference('pt-BR'), 'pt-BR');
});

test('映射 4/4：缺失 / 空串 / 非法 → null（由调用方兜底）', () => {
  assert.equal(mapPreference(undefined), null);
  assert.equal(mapPreference(null), null);
  assert.equal(mapPreference(''), null);
  assert.equal(mapPreference('   '), null);
  assert.equal(mapPreference('zh_CN_extra!!'), null);
  assert.equal(mapPreference(42), null);
});

test('映射：zh 的变体一律简体（官方两处先例：zh* → zh-CN）', () => {
  // DSH 内置语言只有 zh / en，zh 不区分简繁；任何 zh-* 的界面语言都按简体处理。
  assert.equal(mapPreference('zh-CN'), 'zh-CN');
  assert.equal(mapPreference('zh-TW'), 'zh-CN');
  assert.equal(mapPreference('zh-Hant'), 'zh-CN');
  assert.equal(mapPreference('zh-Hans-CN'), 'zh-CN');
  assert.equal(mapPreference('ZH'), 'zh-CN');
});

test('映射：en 的变体一律 en', () => {
  assert.equal(mapPreference('en-US'), 'en');
  assert.equal(mapPreference('en-GB'), 'en');
  assert.equal(mapPreference('EN'), 'en');
});

// ===========================================================================
// 二、三态判定 effectiveMode（票 #14 迁移规则）
// ===========================================================================

console.log('== 二、有效模式（三态 → 两态）==');

test('languageMode=auto → auto（任意 targetLanguage）', () => {
  assert.equal(effectiveMode({ languageMode: 'auto', targetLanguage: 'ja' }), MODE_AUTO);
  assert.equal(effectiveMode({ languageMode: 'auto', targetLanguage: 'zh-CN' }), MODE_AUTO);
});

test('languageMode=manual → manual（任意 targetLanguage）', () => {
  assert.equal(effectiveMode({ languageMode: 'manual', targetLanguage: 'ja' }), MODE_MANUAL);
  assert.equal(effectiveMode({ languageMode: 'manual', targetLanguage: 'zh-CN' }), MODE_MANUAL);
});

test('未设 + targetLanguage 为默认值 → auto（新功能默认体验）', () => {
  assert.equal(effectiveMode({ languageMode: '', targetLanguage: 'zh-CN' }), MODE_AUTO);
  assert.equal(effectiveMode({ languageMode: undefined, targetLanguage: 'zh-CN' }), MODE_AUTO);
});

test('未设 + targetLanguage 非默认 → manual（老用户手选过语言）', () => {
  assert.equal(effectiveMode({ languageMode: '', targetLanguage: 'ja' }), MODE_MANUAL);
  assert.equal(effectiveMode({ languageMode: undefined, targetLanguage: 'en' }), MODE_MANUAL);
  assert.equal(effectiveMode({ languageMode: '', targetLanguage: 'zh-TW' }), MODE_MANUAL);
});

test('未设 + targetLanguage 缺失 → auto', () => {
  assert.equal(effectiveMode({ languageMode: '', targetLanguage: undefined }), MODE_AUTO);
});

test('大小写与空白容错', () => {
  assert.equal(effectiveMode({ languageMode: ' AUTO ', targetLanguage: 'ja' }), MODE_AUTO);
  assert.equal(effectiveMode({ languageMode: 'Manual', targetLanguage: 'zh-CN' }), MODE_MANUAL);
});

test('非法 languageMode 值按未设置处理', () => {
  assert.equal(effectiveMode({ languageMode: 'bogus', targetLanguage: 'zh-CN' }), MODE_AUTO);
  assert.equal(effectiveMode({ languageMode: 'bogus', targetLanguage: 'ja' }), MODE_MANUAL);
});

// ===========================================================================
// 三、解析链 resolveTargetLanguage
// ===========================================================================

console.log('== 三、解析链 ==');

test('manual 态忽略 preference，直接用 targetLanguage', () => {
  assert.equal(resolve('manual', 'zh', 'ja'), 'ja');
  assert.equal(resolve('manual', 'en', 'ko'), 'ko');
});

test('auto 态用 preference 的映射结果', () => {
  assert.equal(resolve('auto', 'zh', 'ja'), 'zh-CN');
  assert.equal(resolve('auto', 'en', 'ja'), 'en');
  assert.equal(resolve('auto', 'ko', 'ja'), 'ko');
});

test('auto 态 preference 缺失 → 兜底 targetLanguage', () => {
  assert.equal(resolve('auto', undefined, 'ja'), 'ja');
  assert.equal(resolve('auto', '', 'ko'), 'ko');
  assert.equal(resolve('auto', null, 'zh-TW'), 'zh-TW');
});

test('auto 态 preference 缺失且 targetLanguage 缺失 → 默认 zh-CN', () => {
  assert.equal(resolve('auto', undefined, undefined), 'zh-CN');
  assert.equal(resolve('auto', undefined, ''), 'zh-CN');
});

test('【关键】模拟老用户升级：{ languageMode: "", targetLanguage: "ja", preference: "zh" } → ja', () => {
  // 这是唯一会让老用户「升级后语言被改」的路径，captain 会亲自复核。
  assert.equal(resolve('', 'zh', 'ja'), 'ja');
  assert.equal(
    resolveTargetLanguage({ mode: '', preference: 'zh', fallback: 'ja' }),
    'ja',
    '老用户手选过 ja，升级后不得被界面语言 zh 覆盖',
  );
});

test('老用户升级 + 界面语言 en 也不覆盖 ja', () => {
  assert.equal(resolve('', 'en', 'ja'), 'ja');
});

test('新用户（未设 + 默认值）+ 界面语言 zh → zh-CN', () => {
  assert.equal(resolve('', 'zh', 'zh-CN'), 'zh-CN');
});

test('新用户（未设 + 默认值）+ 界面语言 en → en', () => {
  assert.equal(resolve('', 'en', 'zh-CN'), 'en');
});

test('显式 auto 覆盖手选值（用户自己选的，不算静默覆盖）', () => {
  assert.equal(resolve('auto', 'en', 'ja'), 'en');
});

test('非法 fallback 被归一化为默认值', () => {
  assert.equal(resolve('manual', undefined, 'not a tag!!'), 'zh-CN');
  assert.equal(resolve('auto', undefined, 'not a tag!!'), 'zh-CN');
});

test('【分叉防护】preference 为 null 时两侧必须都走兜底，不许猜界面语言', () => {
  // 用户从未在 DSH 设置里选过界面语言时，Host 的 describe() 给不出 preference。
  // Client 若改读 ctx.locale.getSnapshot().active，会拿到浏览器派生的 provisional，
  // 面板就会显示一个语言、实际注入另一个语言。这两条锁死「null 就是兜底」。
  assert.equal(resolve('auto', null, 'zh-CN'), 'zh-CN');
  assert.equal(resolveSource({ mode: 'auto', preference: null, fallback: 'zh-CN' }), 'fallback');
  assert.equal(resolve('auto', null, 'en'), 'en');
  assert.equal(resolveSource({ mode: 'auto', preference: null, fallback: 'en' }), 'fallback');
});

test('输出永远是合法 BCP-47', () => {
  const BCP47 = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
  const cases = [
    ['auto', 'zh', 'ja'],
    ['auto', 'en', 'ko'],
    ['auto', 'pt-BR', 'ja'],
    ['manual', 'zh', 'ja'],
    ['', 'zh', 'ja'],
    ['', 'zh', 'zh-CN'],
    ['auto', undefined, 'zh-TW'],
    ['manual', undefined, 'zz'],
  ];
  for (const [mode, preference, fallback] of cases) {
    assert.match(resolve(mode, preference, fallback), BCP47, `${mode}/${preference}/${fallback}`);
  }
});

// ===========================================================================
// 四、来源 resolveSource（UI 上「为什么是这个语言」）
// ===========================================================================

console.log('== 四、解析来源 ==');

test('manual 态来源为 manual', () => {
  assert.equal(resolveSource({ mode: 'manual', preference: 'zh', fallback: 'ja' }), 'manual');
});

test('auto 态 preference 可用 → ui', () => {
  assert.equal(resolveSource({ mode: 'auto', preference: 'zh', fallback: 'ja' }), 'ui');
  assert.equal(resolveSource({ mode: '', preference: 'en', fallback: 'zh-CN' }), 'ui');
});

test('auto 态 preference 缺失 → fallback', () => {
  assert.equal(resolveSource({ mode: 'auto', preference: undefined, fallback: 'ja' }), 'fallback');
  assert.equal(resolveSource({ mode: 'auto', preference: '', fallback: 'zh-CN' }), 'fallback');
});

test('老用户迁移态（未设 + 非默认）来源为 manual', () => {
  assert.equal(resolveSource({ mode: '', preference: 'zh', fallback: 'ja' }), 'manual');
});

// ===========================================================================
// 五、归一化边界
// ===========================================================================

console.log('== 五、归一化边界 ==');

test('normalizeLocaleId：去空白、下划线转连字符', () => {
  assert.equal(normalizeLocaleId('  zh-CN  '), 'zh-CN');
  assert.equal(normalizeLocaleId('zh_CN'), 'zh-CN');
  assert.equal(normalizeLocaleId('zh_Hans_CN'), 'zh-Hans-CN');
  assert.equal(normalizeLocaleId('en_US'), 'en-US');
});

test('normalizeLocaleId：非法返回 null', () => {
  assert.equal(normalizeLocaleId(''), null);
  assert.equal(normalizeLocaleId('   '), null);
  assert.equal(normalizeLocaleId('a'), null);
  assert.equal(normalizeLocaleId('zh--CN'), null);
  assert.equal(normalizeLocaleId('zh CN'), null);
  assert.equal(normalizeLocaleId(null), null);
  assert.equal(normalizeLocaleId({}), null);
});

test('MODE_UNSET 是空串（schema 默认值必须与它一致）', () => {
  assert.equal(MODE_UNSET, '');
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
