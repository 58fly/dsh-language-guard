/**
 * dsh-language-guard —— Host 半。
 *
 * 职责：
 * 1. 注册三个常驻 system prompt section（head / mid / tail），切档只切 `text()` 的返回值；
 * 2. D 档注册 `agent/pre-step` 监听，每 N 轮追加一条语言自检提醒；
 * 3. 提供 `/language` 斜杠命令与设置表单（settings 服务懒注入）。
 *
 * 合规边界（docs/decisions/01-mechanism.md 第 1 节）：
 * - 不监听系统提示词装配事件去增删文本（只用 section 注册，验收 C4 会 grep 该事件名，必须为空）；
 * - 不改写流式响应中的推理增量（那会破坏日志与签名回放）；
 * - 不 append 新 type 的 session 事件（提醒走既有 user/message）；
 * - section 文本在一次会话内稳定，不依赖轮次、时间或随机数。
 *
 * 唯一的真源是 docs/decisions/01-mechanism.md；文案在 lib/text.js 里逐字照抄。
 */

import z from '@deepseek-ai/schemastery';

import { headText, midText, tailText } from './text.js';
import {
  DEFAULT_LANGUAGE,
  DEFAULT_STRENGTH,
  normalizeBoolean,
  normalizeInterval,
  normalizeStrength,
  normalizeText,
  resolveLanguage,
} from './state.js';
import { registerCycle } from './cycle.js';
import { registerCommands } from './commands.js';

/**
 * 只声明 `systemPrompt`：它是本插件的核心依赖，缺了就没有任何意义。
 * `settings` / `commands` 用 `ctx.inject([...])` 懒注入 —— 缺这两个服务的部署
 * （headless、无交互 UI）仍然应该把语言约束注入 system prompt，而不是永久 pending。
 */
export const inject = ['systemPrompt'];

/**
 * section 名与 order 固定，永不注销；切档只切 text 返回值（01-mechanism.md 2.2）。
 * order 直接写字面量：注册接口要求有限数字，且 mid 必须用 5100（tools:sdk 恰好是 5000，
 * 同序时 `language-guard:mid` 会按 name 字典序排到工具说明之前）。
 */
const HEAD_SECTION = 'language-guard:head';
const MID_SECTION = 'language-guard:mid';
const TAIL_SECTION = 'language-guard:tail';

/**
 * 读取一个配置字段的当前值。
 * volatile 引用只有 `get()`（写入由宿主 Loader 负责），因此这里只读不写。
 * @param {any} config 插件配置对象
 * @param {string} field 字段名
 * @returns {unknown}
 */
function readField(config, field) {
  const ref = config?.[field];
  if (ref !== undefined && ref !== null && typeof ref.get === 'function') return ref.get();
  return ref;
}

export function apply(ctx, config) {
  let warnedStrength = false;
  let warnedInterval = false;

  /** 输出一次告警，避免每步刷屏 */
  const warnOnce = (kind, message) => {
    if (kind === 'strength' ? warnedStrength : warnedInterval) return;
    if (kind === 'strength') warnedStrength = true;
    else warnedInterval = true;
    try {
      const logger = typeof ctx.logger === 'function' ? ctx.logger('language-guard') : ctx.logger;
      logger?.warn?.(message);
    } catch {
      // 日志不可用不应影响提示词注入
    }
  };

  /** 当前档位（规范化 + 兜底） */
  const strength = () => {
    const result = normalizeStrength(readField(config, 'strength'));
    if (!result.valid) {
      warnOnce('strength', `未知的强度档位，已回退到 "${DEFAULT_STRENGTH}"（可选值：B / C / D）`);
    }
    return result.value;
  };

  /** 当前注入间隔（规范化 + 兜底） */
  const interval = () => {
    const result = normalizeInterval(readField(config, 'injectEveryNRounds'));
    if (!result.valid) {
      warnOnce('interval', `注入间隔超出 3–50 的范围，已按 ${result.value} 处理`);
    }
    return result.value;
  };

  /** 当前目标语言（`/language` 内存覆盖 > 配置值 > 默认值） */
  const language = () => {
    const raw = readField(config, 'targetLanguage');
    return resolveLanguage(typeof raw === 'string' ? raw : DEFAULT_LANGUAGE);
  };

  /** 配置里的目标语言（不受 `/language` 覆盖影响） */
  const configuredLanguage = () => {
    const raw = readField(config, 'targetLanguage');
    const text = typeof raw === 'string' ? raw.trim() : '';
    return text || DEFAULT_LANGUAGE;
  };

  const preserveCodeTerms = () => normalizeBoolean(readField(config, 'preserveCodeTerms'));
  const extraRules = () => normalizeText(readField(config, 'extraRules'));
  const overrideHead = () => normalizeText(readField(config, 'overrideHead'));

  // —— 三个常驻 section：一次性注册、永不 dispose，切档只切 text 返回值 ——
  // 空字符串会被 renderPrompt 的 `.filter(text => text.length > 0)` 过滤，
  // 因此 B 档的 mid 返回 "" 等价于「该段不存在」，不会留下空行。
  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: HEAD_SECTION,
        order: -2000,
        interpolate: false,
        text: () =>
          headText({
            language: language(),
            preserveCodeTerms: preserveCodeTerms(),
            overrideHead: overrideHead(),
            extraRules: extraRules(),
          }),
      }),
    'language-guard: head section',
  );

  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: MID_SECTION,
        order: 5100,
        interpolate: false,
        text: () => (strength() === 'B' ? '' : midText({ language: language() })),
      }),
    'language-guard: mid section',
  );

  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: TAIL_SECTION,
        order: 11200,
        interpolate: false,
        text: () => tailText({ language: language(), preserveCodeTerms: preserveCodeTerms() }),
      }),
    'language-guard: tail section',
  );

  // —— D 档周期提醒：注册在插件根 ctx，payload 自带 agent ——
  ctx.effect(
    () => registerCycle(ctx, { strength, interval, language }),
    'language-guard: periodic reminder',
  );

  // —— `/language` 斜杠命令：输入框里的快捷方式，不写配置 ——
  registerCommands(ctx, { language, configured: configuredLanguage });

  // —— 设置表单：auto:false 表示不在设置页自动生成页面，只提供 volatile 配置表单 ——
  ctx.inject(['settings'], (child) => {
    child.effect(
      () => child.settings.configure({ auto: false }, ctx.fiber),
      'language-guard: settings form',
    );
  });
}

/**
 * 配置 schema（01-mechanism.md 4.1 逐字）。
 *
 * 用 `@deepseek-ai/schemastery`，**不是** zod：设置页的 volatileForm 只认
 * schemastery 的 schema 与 `meta.volatile`。`.volatile()` 必须加在**每个字段**上，
 * 不能加在根对象（会报 `volatile fields require a fixed object path without an
 * enclosing volatile field`）。
 */
export const Config = z.object({
  targetLanguage: z
    .string()
    .default('zh-CN')
    .pattern(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/)
    .description(
      '目标语言（BCP-47 语言标签）。默认 zh-CN。常见值：zh-CN 简体中文、zh-TW 繁體中文、en English、ja 日本語、ko 한국어。',
    )
    .volatile(),

  strength: z
    .union([z.const('B'), z.const('C'), z.const('D')])
    .default('C')
    .description(
      '强度档位。B=基础（提示词首尾两段约束）；C=强化（首尾两段 + 工具说明后重申，推荐）；D=周期（强化 + 每 N 轮注入一次语言自检）。',
    )
    .volatile(),

  injectEveryNRounds: z
    .number()
    .min(3)
    .max(50)
    .step(1)
    .default(8)
    .description('D 档每多少轮注入一次语言自检（3–50，默认 8）。仅 strength=D 时生效。')
    .volatile(),

  preserveCodeTerms: z
    .boolean()
    .default(true)
    .description('保持代码、命令、路径、标识符与英文报错原样，不翻译。默认开启。')
    .volatile(),

  extraRules: z
    .string()
    .default('')
    .description('附加约束，追加在内置规则之后（团队或项目自定义条款）。留空则只用内置规则。')
    .volatile(),

  overrideHead: z
    .string()
    .default('')
    .description('高级：完全替换首段内置规则文本。留空使用内置规则；非空时 extraRules 仍会追加在其后。')
    .volatile(),
});
