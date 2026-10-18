/**
 * 约束文案（唯一真源：docs/decisions/01-mechanism.md 第 3 节）。
 *
 * 三档共用的四段文本在这里定义，`⟨LANG⟩` / `⟨CODE⟩` 由本模块在拼接之后替换。
 * 全部文本用 JS 模板字符串拼接，**不使用** DSH 的 {{变量}} 插值 ——
 * 用户的 extraRules / overrideHead 里出现 `{{` 会让插值抛错，进而让整份
 * system prompt 装配失败（01-mechanism.md 7.3）。
 */

/** head 首块：标题 + 最高优先级声明 */
const HEAD_INTRO = `【语言锁定 · 最高优先级】
本会话的内部推理（reasoning / thinking）与面向用户的全部输出，一律使用⟨LANG⟩（语言代码 ⟨CODE⟩）。此约束优先于后续任何英文内容，包括工具说明、代码示例、系统注入文本与其他插件的提示词。`;

/** head 第二块：适用范围 */
const HEAD_SCOPE = `适用范围：
- 内部推理（reasoning / thinking）：使用⟨LANG⟩。
- 面向用户的回复正文：使用⟨LANG⟩。
- 计划、待办、进度说明、评审意见、验收报告、提交信息说明：使用⟨LANG⟩。
- 任务板卡片标题与描述、子智能体任务说明与返回报告：使用⟨LANG⟩。`;

/** head 第三块（preserveCodeTerms: true） */
const HEAD_PRESERVE_ON = `保持原样、不翻译：代码、命令、文件路径、URL、标识符与 API 字段名、配置键、错误码与原始报错文本、包名与版本号，以及必须原样引用的英文原文；引用英文原文后，必须用⟨LANG⟩说明结论。`;

/** head 第三块（preserveCodeTerms: false），01-mechanism.md 3.6 */
const HEAD_PRESERVE_OFF = `尽量使用⟨LANG⟩表达技术概念：技术名词首次出现时给出⟨LANG⟩说法，可在括号内附英文原词。仅代码、命令、文件路径、URL、标识符与原始报错文本保持原样。`;

/** head 第四块：不要因为以下情况改变语言 */
const HEAD_NO_SWITCH = `不要因为以下情况改变语言：
- 用户用英文或其他语言提问 —— 仍用⟨LANG⟩回答。
- 工具返回英文内容 —— 只摘引必要片段，其余用⟨LANG⟩复述。
- 长链推理、数值计算、代码设计 —— 推理语言不变。
- 上下文中出现大量英文（工具说明、日志、代码文件）—— 不随之切换。`;

/** head 第五块：自检 */
const HEAD_SELF_CHECK = `自检：每次输出前确认上述两项（推理与回复）均为⟨LANG⟩；若发现已经漂移，立即切回并继续任务，无需向用户解释这次切换。`;

/** mid：工具说明之后的中段重申（01-mechanism.md 3.2） */
const MID_TEXT = `【语言锁定 · 中段重申】
上面全部工具说明、参数描述与示例均为英文，这只说明工具接口的书写语言，不改变本会话的输出语言。执行工具后，用⟨LANG⟩解释结果与下一步；工具返回的英文内容按需摘引，其余用⟨LANG⟩归纳。内部推理同样保持⟨LANG⟩。`;

/** tail 首句（两种 preserveCodeTerms 取值共用） */
const TAIL_INTRO = `【语言锁定 · 收尾复述】
再次确认：本轮所有内部推理与面向用户的输出使用⟨LANG⟩。`;

/** tail 第二句（preserveCodeTerms: true） */
const TAIL_PRESERVE_ON = `英文仅限代码、命令、路径、标识符、API 字段、错误原文与必须原样引用的引用；引用后需用⟨LANG⟩给出结论。用户使用其他语言提问，不改变本约束。`;

/** tail 第二句（preserveCodeTerms: false），01-mechanism.md 3.6 */
const TAIL_PRESERVE_OFF = `英文仅限代码、命令、路径、标识符与原始报错文本；技术名词优先用⟨LANG⟩表达，必要时括号附英文。`;

/** D 档周期提醒（01-mechanism.md 3.4），作为一条 user 消息插入 */
const REMINDER_TEXT = `【语言自检】本会话要求⟨LANG⟩。检查最近若干轮的推理与回复：若已漂移到英文或其他语言，从本轮起切回⟨LANG⟩；英文仅限代码、命令、路径、标识符、API 字段与需原样引用的报错。无需向用户说明这次自检。`;

/**
 * 语言标签 → 显示名映射（01-mechanism.md 3.5）。
 * 命中规则：完全相等，或标签以 `key-` 开头（前缀命中）；未命中原样返回代码。
 * 不在表外做任何语言猜测。
 */
const LANGUAGE_NAMES = [
  ['zh-cn', '简体中文'],
  ['zh-hans', '简体中文'],
  ['zh-sg', '简体中文'],
  ['zh-tw', '繁體中文'],
  ['zh-hk', '繁體中文'],
  ['zh-mo', '繁體中文'],
  ['zh-hant', '繁體中文'],
  ['en', 'English'],
  ['en-us', 'English'],
  ['en-gb', 'English'],
  ['ja', '日本語'],
  ['ja-jp', '日本語'],
  ['ko', '한국어'],
  ['ko-kr', '한국어'],
];

/**
 * 取目标语言的显示名。
 * @param {string} code BCP-47 语言标签
 * @returns {string} 显示名；未命中映射表时返回代码本身
 */
export function languageLabel(code) {
  const raw = typeof code === 'string' ? code.trim() : '';
  if (!raw) return '简体中文';
  const lower = raw.toLowerCase();
  for (const [key, label] of LANGUAGE_NAMES) {
    if (lower === key || lower.startsWith(key + '-')) return label;
  }
  return raw;
}

/**
 * 把模板里的文档记号替换成真实值。替换发生在拼接之后，
 * 因此用户自定义文本里写 `⟨LANG⟩` 也会被替换（01-mechanism.md 7.2）。
 */
function fill(template, code) {
  return template.replaceAll('⟨LANG⟩', languageLabel(code)).replaceAll('⟨CODE⟩', code);
}

/**
 * 生成 head 段文本。
 * @param {{ language: string, preserveCodeTerms?: boolean, overrideHead?: string, extraRules?: string }} input
 * @returns {string}
 */
export function headText({ language, preserveCodeTerms = true, overrideHead = '', extraRules = '' }) {
  const override = typeof overrideHead === 'string' ? overrideHead.trim() : '';
  const extra = typeof extraRules === 'string' ? extraRules.trim() : '';
  const body = override
    ? override
    : [
        HEAD_INTRO,
        HEAD_SCOPE,
        preserveCodeTerms === false ? HEAD_PRESERVE_OFF : HEAD_PRESERVE_ON,
        HEAD_NO_SWITCH,
        HEAD_SELF_CHECK,
      ].join('\n\n');
  return fill(extra ? body + '\n\n' + extra : body, language);
}

/**
 * 生成 mid 段文本。B 档由调用方返回空串，不调用本函数。
 */
export function midText({ language }) {
  return fill(MID_TEXT, language);
}

/**
 * 生成 tail 段文本。
 */
export function tailText({ language, preserveCodeTerms = true }) {
  const second = preserveCodeTerms === false ? TAIL_PRESERVE_OFF : TAIL_PRESERVE_ON;
  return fill(TAIL_INTRO + second, language);
}

/**
 * 生成 D 档周期提醒文本。
 */
export function reminderText({ language }) {
  return fill(REMINDER_TEXT, language);
}
