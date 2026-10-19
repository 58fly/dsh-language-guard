/**
 * `/language` 斜杠命令：输入框里的快捷方式。
 *
 * 它**不是**面板上的「快速语言切换」——那个由 client.js 的侧栏按钮承担
 * （docs/decisions/03-manifest.md 第 2.2 节）。命令的作用是「不打开设置页、
 * 不改配置文件，临时切换本会话的语言」，因此只写内存覆盖值，不写 Config。
 *
 * `commands` 服务用 `ctx.inject` 懒注册：缺该服务的部署（无交互 UI 的 headless
 * 场景）不该让插件永久 pending，否则 system prompt 的 section 永远不会注册。
 */

import { clearLanguageOverride, setLanguageOverride } from './state.js';
import { languageLabel } from './text.js';

/** 与 Config.targetLanguage 的 pattern 保持同一正则（01-mechanism.md 4.1） */
const BCP47 = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/** 把解析来源翻译成给人看的一句话 */
function sourceHint(source) {
  if (source === 'ui') return '跟随界面语言';
  if (source === 'fallback') return '未识别到界面语言，用配置值兜底';
  return '手动模式';
}

/**
 * 注册 `/language` 命令。
 *
 * 与自动模式的关系：命令写的是**内存覆盖值**，优先级高于自动解析与配置值，
 * 两种模式下都生效；`reset` 清除覆盖后回到当前模式的解析结果。命令本身
 * **不写配置**，所以不会改变 `languageMode` —— 自动模式不会因为一次临时
 * 切换就被静默改成手动（票 #14 禁止项）。
 *
 * @param {any} ctx 插件根上下文
 * @param {{
 *   language: () => string,
 *   configured: () => string,
 *   mode?: () => 'auto' | 'manual',
 *   source?: () => 'manual' | 'ui' | 'fallback',
 * }} options
 */
export function registerCommands(ctx, { language, configured, mode, source }) {
  ctx.inject(['commands'], (child) => {
    child.effect(
      () =>
        child.commands.register({
          name: 'language',
          description: '切换本会话的目标语言（只影响当前进程，不写入配置）',
          input: { hint: '<语言标签，如 ja；reset 恢复配置值>' },
          handler: ({ rawInput }) => {
            const raw = typeof rawInput === 'string' ? rawInput.trim() : '';

            if (!raw) {
              const current = language();
              const saved = configured();
              const currentMode = typeof mode === 'function' ? mode() : 'manual';
              const origin =
                currentMode === 'manual'
                  ? '手动模式'
                  : `自动模式，${sourceHint(typeof source === 'function' ? source() : 'ui')}`;
              const suffix =
                currentMode === 'auto' && current !== saved ? `（配置值：${saved}）` : '';
              return {
                kind: 'success',
                text: `当前目标语言：${languageLabel(current)}（${current}）· ${origin}${suffix}`,
              };
            }

            if (raw === 'reset' || raw === 'default') {
              clearLanguageOverride();
              const restored = language();
              const currentMode = typeof mode === 'function' ? mode() : 'manual';
              const where = currentMode === 'manual' ? '配置中的目标语言' : '自动解析结果';
              return {
                kind: 'success',
                text: `已恢复为${where}：${languageLabel(restored)}（${restored}）`,
              };
            }

            if (!BCP47.test(raw)) {
              return {
                kind: 'error',
                text: `不是合法的 BCP-47 语言标签：${raw}（示例：zh-CN、zh-TW、en、ja、ko）`,
              };
            }

            setLanguageOverride(raw);
            return {
              kind: 'success',
              text: `本会话目标语言已切换为 ${languageLabel(raw)}（${raw}），下一条消息起生效。`,
            };
          },
        }),
      'language-guard: /language command',
    );
  });
}
