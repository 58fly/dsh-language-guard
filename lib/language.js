/**
 * 语言解析：把「界面语言」映射成 `targetLanguage`，并处理自动 / 手动两种模式。
 *
 * 本模块是**纯函数模块**：不 import 任何 ctx、不读磁盘、不碰配置对象，
 * 所有输入显式传入。这样验收脚本可以直接 `import` 后断言每一条映射规则
 * （`scripts/verify-language.mjs`），不需要伪造 DSH 运行时。
 *
 * 真源：docs/research/04-auto-language.md 第 7.3 / 8.3 / 9.3 节，
 * 以及票 #14 的三条裁决（0.2.0 只做路径 A、映射只四条、解析器必须纯函数）。
 *
 * ## 0.2.0 的信号范围（有意为之的窄）
 *
 * Host 侧唯一可靠信号是 `settings.describe()` 里 `ns === 'locale'` 的
 * `value.preference`。系统语言（`osLanguages`）只有 Client 能拿到，而路径 B
 * （Client 回写检测值）在 0.2.0 **完全不实现**，理由见 `lib/index.js` 的
 * `refreshPreference()` 注释。因此映射表只有四条，不多不少。
 */

/** 语言模式：自动跟随界面语言 */
export const MODE_AUTO = 'auto';

/** 语言模式：固定使用 `targetLanguage` */
export const MODE_MANUAL = 'manual';

/**
 * 语言模式的「未选择」哨兵值。
 *
 * 为什么默认值是空串而不是 `'auto'`：`readField(config, 'languageMode')` 读到的是
 * **已经过 schema 解析**的值，只要写了 `.default('auto')` 就永远无法区分
 * 「用户显式选了自动」与「用户从没设置过」。而这两者必须区分 ——
 * 0.1.x 用户可能手选过 `targetLanguage: ja`，升级后若一律按 auto 处理，
 * 界面语言 `zh` 会把 `ja` 静默覆盖成 `zh-CN`，那是破坏性升级。
 *
 * 三态判定见 {@link effectiveMode}。
 */
export const MODE_UNSET = '';

/** 与 Config.targetLanguage 的 pattern 同一条正则（01-mechanism.md 4.1） */
const BCP47 = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/**
 * 归一化一个语言标识：去首尾空白、下划线转连字符、校验 BCP-47。
 *
 * 下划线格式必须处理：macOS 的 `AppleLocale` 给 `zh_CN`，`AppleLanguages` 给
 * `zh-Hans-CN`（04-auto-language.md 7.3 节的实测表）。虽然 0.2.0 的 Host 侧
 * 只读 `locale.preference`（永远是 DSH 的语言包 id），但归一化放在这里可以让
 * Client 侧与未来的系统语言路径共用同一套规则。
 *
 * @param {unknown} raw 原始标识
 * @returns {string | null} 合法标识，或 null
 */
export function normalizeLocaleId(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.trim().replace(/_/g, '-');
  if (!text) return null;
  return BCP47.test(text) ? text : null;
}

/**
 * 把界面语言（或外部语言包 id）映射成 `targetLanguage`。
 *
 * 映射表只有四条（票 #14 裁决二）：
 *
 * | 输入 | 输出 | 依据 |
 * | --- | --- | --- |
 * | `zh` | `zh-CN` | 官方两处先例都把 `zh*` 定为简体：`dsh-client-locale/lib/client.js:1174`、`/lib/main.js:7607-7616` |
 * | `en` | `en` | `FALLBACK_LOCALE = 'en'`，且正则接受裸 `en` |
 * | 其他合法 id（`ja` / `ko` / 外部语言包） | 原样透传 | 外部语言包 id 本身就是合法 BCP-47 |
 * | 缺失 / 空串 / 非法 | `null`（由调用方兜底） | 不编造假信号 |
 *
 * **不做的事**：不猜繁简。DSH 内置语言只有 `zh` / `en`，`zh` 不区分简繁；
 * 0.2.0 也没有系统语言信号可用。繁体用户请把 `languageMode` 设为 `manual`
 * 并手动选 `zh-TW`（README 与设置卡片都写明了这条）。
 *
 * @param {unknown} preference 界面语言 id
 * @returns {string | null}
 */
export function mapPreference(preference) {
  const id = normalizeLocaleId(preference);
  if (!id) return null;
  const primary = id.split('-')[0].toLowerCase();
  if (primary === 'zh') return 'zh-CN';
  if (primary === 'en') return 'en';
  return id;
}

/**
 * 判定**有效模式**（三态 → 两态）。
 *
 * | `languageMode` | `targetLanguage` | 有效模式 | 理由 |
 * | --- | --- | --- | --- |
 * | `'auto'` | 任意 | `auto` | 用户显式选了自动 |
 * | `'manual'` | 任意 | `manual` | 用户显式选了手动 |
 * | `''`（未设） | 等于默认值 | `auto` | 从没改过语言 → 跟随界面语言 |
 * | `''`（未设） | 不等于默认值 | `manual` | **老用户手选过语言 → 尊重既有选择，绝不覆盖** |
 *
 * 最后一行是 0.2.0 的**迁移规则**：0.1.x 的 `cordis.patch.yml` 里可能写着
 * `targetLanguage: ja` 而没有 `languageMode`，升级后必须继续用 `ja`。
 *
 * @param {{ languageMode?: unknown, targetLanguage?: unknown, defaultLanguage?: string }} input
 * @returns {'auto' | 'manual'}
 */
export function effectiveMode({ languageMode, targetLanguage, defaultLanguage = 'zh-CN' }) {
  const mode = typeof languageMode === 'string' ? languageMode.trim().toLowerCase() : '';
  if (mode === MODE_MANUAL) return MODE_MANUAL;
  if (mode === MODE_AUTO) return MODE_AUTO;
  // 未设置：只有「用户从没改过 targetLanguage」才按自动处理
  const target = normalizeLocaleId(targetLanguage) ?? defaultLanguage;
  return target === defaultLanguage ? MODE_AUTO : MODE_MANUAL;
}

/**
 * 解析最终生效的 `targetLanguage`。
 *
 * 优先级（04-auto-language.md 6.1 判定链的 0.2.0 子集）：
 *
 * ```
 * manual 态 → targetLanguage（默认 zh-CN）
 * auto   态 → mapPreference(preference) ?? targetLanguage（默认 zh-CN）
 * ```
 *
 * `preference` 读不到时**退化为配置值**，不猜 `en-US`、不读 `Intl`、不起子进程
 * （04-auto-language.md 第 4 节的结论：Host 侧没有任何可靠的系统语言信号）。
 *
 * @param {{ mode?: unknown, preference?: unknown, fallback?: unknown, defaultLanguage?: string }} input
 *   `mode` 是**原始的** `languageMode` 值（可以是 `''`），不是 `effectiveMode()` 的结果 ——
 *   本函数内部会先做三态判定，保证「老用户迁移」规则在任何调用点都生效。
 * @returns {string} 合法 BCP-47 标签
 */
export function resolveTargetLanguage({ mode, preference, fallback, defaultLanguage = 'zh-CN' }) {
  const base = normalizeLocaleId(fallback) ?? defaultLanguage;
  const effective = effectiveMode({ languageMode: mode, targetLanguage: fallback, defaultLanguage });
  if (effective === MODE_MANUAL) return base;
  return mapPreference(preference) ?? base;
}

/**
 * 解析来源，用于 UI 上「为什么是这个语言」那一行。
 *
 * - `ui`：来自界面语言（`preference` 映射成功）
 * - `fallback`：没识别到，用了 `targetLanguage` 配置值
 * - `manual`：手动模式，不做识别
 *
 * @param {{ mode?: unknown, preference?: unknown, fallback?: unknown, defaultLanguage?: string }} input
 * @returns {'manual' | 'ui' | 'fallback'}
 */
export function resolveSource({ mode, preference, fallback, defaultLanguage = 'zh-CN' }) {
  const effective = effectiveMode({ languageMode: mode, targetLanguage: fallback, defaultLanguage });
  if (effective === MODE_MANUAL) return 'manual';
  return mapPreference(preference) ? 'ui' : 'fallback';
}
