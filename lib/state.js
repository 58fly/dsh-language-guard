/**
 * 运行时状态与配置值规范化。
 *
 * 本模块**不持有轮次计数**：D 档的 `turn` / `step` 直接来自
 * `agent/pre-step` 的 waterfall payload（01-mechanism.md 6.2、8.3），
 * 重启或恢复后仍然连续，不需要插件自己数。
 *
 * 这里只保存两类东西：
 * 1. `/language` 命令设置的内存覆盖值（不写配置、不落盘）；
 * 2. 配置值的规范化与兜底（schema 校验之外的二次防线）。
 *
 * 语言解析的**纯函数**部分在 `lib/language.js`（可单测），本模块只负责把
 * 内存覆盖值与它串起来。
 */

import { resolveTargetLanguage } from './language.js';

/** 合法档位 */
export const STRENGTHS = ['B', 'C', 'D'];

/** 默认档位：强化（01-mechanism.md 第 5 节） */
export const DEFAULT_STRENGTH = 'C';

/** 注入间隔的取值范围与默认值（01-mechanism.md 4.1） */
export const MIN_INTERVAL = 3;
export const MAX_INTERVAL = 50;
export const DEFAULT_INTERVAL = 8;

/** 默认目标语言 */
export const DEFAULT_LANGUAGE = 'zh-CN';

/** `/language` 命令的内存覆盖值；null 表示未覆盖，走配置值 */
let languageOverride = null;

/**
 * 设置 `/language` 的内存覆盖值。
 * @param {string} code BCP-47 语言标签
 */
export function setLanguageOverride(code) {
  languageOverride = typeof code === 'string' && code.trim() ? code.trim() : null;
}

/** 清除 `/language` 的内存覆盖值，回到配置里的 targetLanguage。 */
export function clearLanguageOverride() {
  languageOverride = null;
}

/** 读取 `/language` 的内存覆盖值（未设置时为 null）。 */
export function getLanguageOverride() {
  return languageOverride;
}

/**
 * 解析当前生效的目标语言。
 *
 * 优先级（0.2.0）：
 * 1. `/language` 命令的内存覆盖值 —— 两种模式下都最优先，且不写配置；
 * 2. 自动模式：`mapPreference(界面语言) ?? targetLanguage`；
 * 3. 手动模式：`targetLanguage`；
 * 4. 兜底：`DEFAULT_LANGUAGE`。
 *
 * 不传 `options` 时行为与 0.1.x 完全一致（纯配置值），因此既有调用点无需改动。
 *
 * @param {string | undefined} configured 配置里的 targetLanguage
 * @param {{ mode?: unknown, preference?: unknown }} [options]
 *   `mode` 是原始的 `languageMode` 值（可为空串），三态判定在 `lib/language.js` 内完成。
 */
export function resolveLanguage(configured, options) {
  if (languageOverride) return languageOverride;
  const raw = typeof configured === 'string' ? configured.trim() : '';
  if (options && typeof options === 'object') {
    return resolveTargetLanguage({
      mode: options.mode,
      preference: options.preference,
      fallback: raw || DEFAULT_LANGUAGE,
      defaultLanguage: DEFAULT_LANGUAGE,
    });
  }
  return raw || DEFAULT_LANGUAGE;
}

/**
 * 规范化档位：接受大小写，非法值回退默认档。
 * @param {unknown} raw
 * @returns {{ value: 'B' | 'C' | 'D', valid: boolean }}
 */
export function normalizeStrength(raw) {
  const text = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (STRENGTHS.includes(text)) return { value: text, valid: true };
  return { value: DEFAULT_STRENGTH, valid: false };
}

/**
 * 规范化注入间隔：取整并夹到 3–50，非法值回退默认值。
 * @param {unknown} raw
 * @returns {{ value: number, valid: boolean }}
 */
export function normalizeInterval(raw) {
  const number = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(number)) return { value: DEFAULT_INTERVAL, valid: false };
  const rounded = Math.round(number);
  if (rounded < MIN_INTERVAL || rounded > MAX_INTERVAL) {
    return { value: Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, rounded)), valid: false };
  }
  return { value: rounded, valid: true };
}

/**
 * 规范化布尔值：只认真正的布尔，其余按默认 true 处理。
 * @param {unknown} raw
 */
export function normalizeBoolean(raw) {
  return typeof raw === 'boolean' ? raw : true;
}

/**
 * 规范化自由文本字段（extraRules / overrideHead）：非字符串按空串处理。
 * @param {unknown} raw
 */
export function normalizeText(raw) {
  return typeof raw === 'string' ? raw : '';
}
