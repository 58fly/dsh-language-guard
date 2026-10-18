/**
 * D 档（周期）实现：在 `agent/pre-step` waterfall 里改写当步的 messages。
 *
 * 为什么不用 `agent.inject()`：`inject = send(input, "next-step", false)`，消息进
 * inbox、要等下一个 step 边界才被 claim，而且不唤醒驱动器。周期提醒的最佳时机是
 * 「当轮第一个 step 已装配、模型还没开始写」——正是 `agent/pre-step` 的位置。
 * （依据与逐条理由见 docs/decisions/01-mechanism.md 6.2 节。）
 *
 * 硬约束（缺任何一条都会出问题）：
 * 1. 先 `await next()`，不拥有决策就原样返回；
 * 2. 必须 `{ ...decision, messages }` spread，保住 `startsRequestSeries` 等字段；
 * 3. 门禁 `step === 1 && decision.messages.length > 0`——缺了会让 turn 永不结束；
 * 4. 幂等：本步已有同款消息就不再追加。
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { reminderText } from './text.js';

/** 提醒消息在 source.kind 上的标记，派生历史据此区分「插件注入」与真实用户输入 */
const SOURCE_KIND = 'language-guard';

/**
 * 子代理判定：`agent` 上没有 `parent` 字段，官方写法是取两个深度的较大值。
 * 0 表示顶层会话，非 0 表示子代理（子代理继承父会话的 system prompt 约束已足够）。
 * @param {any} agent
 * @returns {number}
 */
function delegationDepthOf(agent) {
  const fromHeader = agent?.session?.header?.delegationDepth;
  const fromOptions = agent?.options?.subagentDepth;
  const depth = Math.max(Number(fromHeader ?? 0) || 0, Number(fromOptions ?? 0) || 0);
  return depth;
}

/**
 * 构造周期提醒消息。`source` 是必填项：没有标签的上下文会在派生历史里
 * 被渲染成用户提示词；`kind` 也绝不能是 `user` 或 `runtime-context`。
 * @param {string} language
 */
function buildReminder(language) {
  return createUserMessage({
    content: [{ type: 'text', text: reminderText({ language }) }],
    source: { kind: 'language-guard', form: 'notice', summary: '语言自检' },
  });
}

/**
 * 注册 D 档监听。注册在插件根 ctx 上：payload 自带 agent，本监听不持有
 * 任何 per-agent 状态，随插件卸载自动清理。
 *
 * @param {any} ctx 插件根上下文
 * @param {{ strength: () => string, interval: () => number, language: () => string }} options
 * @returns {() => void} 清理函数
 */
export function registerCycle(ctx, { strength, interval, language }) {
  return ctx.on('agent/pre-step', async ({ agent, messages, turn, step }, next) => {
    const decision = await next();

    // 不拥有决策就原样返回（绝不能替换成自己的 enter）
    if (!decision || decision.kind === 'reject') return decision;

    // 只有 D 档需要周期提醒；其余档位直接透传下游决策
    if (strength() !== 'D') return decision;

    // 门禁：只在命中轮的第一个 step、且有真实输入时插入
    if (step !== 1) return decision;
    if (!Array.isArray(decision.messages) || decision.messages.length === 0) return decision;

    const every = interval();
    if (!Number.isFinite(every) || every < 1) return decision;
    if (turn % every !== 0) return decision;

    // 幂等：本步已经带过同款消息就不再追加
    if (decision.messages.some((message) => message?.source?.kind === SOURCE_KIND)) return decision;

    // 只对顶层会话注入，不污染子代理的紧凑上下文
    if (delegationDepthOf(agent) !== 0) return decision;

    // 插在「最后一个本步 claim 到的消息」之后、runtime context 之前
    const lastClaimed = decision.messages.findLastIndex((message) => messages.includes(message));
    const entered = decision.messages.toSpliced(lastClaimed + 1, 0, buildReminder(language()));

    return { ...decision, messages: entered };
  });
}
