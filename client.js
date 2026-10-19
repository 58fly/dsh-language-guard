/**
 * dsh-language-guard —— Client 半。
 *
 * 唯一真源：docs/decisions/02-panel.md（交互与文案）、docs/decisions/03-manifest.md
 * 第 2.2 节（装载契约）。
 *
 * 只做两件事：
 * 1. 在「设置 → 插件 → dsh-language-guard」详情页渲染配置卡片（slot `plugins.bundle.config`）；
 * 2. 在侧栏底部渲染快速语言切换按钮（slot `sidebar.footer.action`）。
 *
 * 硬规则（逐条对应 references/ui-plugin.md 与 practices.md）：
 * - `id` 必须等于包名；`factory` 无副作用，所有注册都在 `apply` 里；
 * - 不加载任何 Harness Client 包（控件全部自绘），不替换 app root，不往 body 追加应用；
 * - 不在组件外写 DOM；样式用 `<style>` React 元素渲染，监听器在 effect 里注册并清理；
 * - 只用 `--dsw-alias-*` 主题 token，不写字面颜色，明暗适配交给宿主主题（不写任何媒体查询分支）；
 * - 所有可见文案走 `ctx.locale`，不硬编码。
 */

window.__ModuleLoader__.load({
  id: 'dsh-language-guard',

  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** locale 命名空间：同一份字典同时服务设置卡片与侧栏控件 */
    const NS = 'languageGuard';

    /** 配置表单的 entryId：cordis 行 id === 包名 */
    const ENTRY_ID = 'dsh-language-guard';

    /** 与 Host 侧 Config.targetLanguage 的 pattern 保持同一正则 */
    const BCP47 = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

    /** 三档强度的取值顺序 */
    const LEVELS = ['B', 'C', 'D'];

    /** 快速切换与设置页 chip 共用的预设（5 个高频语言） */
    const PRESETS = [
      { code: 'zh-CN', labelKey: 'language.preset.zhCN' },
      { code: 'zh-TW', labelKey: 'language.preset.zhTW' },
      { code: 'en', labelKey: 'language.preset.en' },
      { code: 'ja', labelKey: 'language.preset.ja' },
      { code: 'ko', labelKey: 'language.preset.ko' },
    ];

    /** 语言标签 → 显示名（与 Host 侧 lib/text.js 的映射表一致） */
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

    // —— 运行时 UI 字典（02-panel.md 4.4 全文；zh / en 的 key 集合必须完全一致）——

    const zh = {
      'card.title': '语言守卫',
      'strength.label': '强度档位',
      'strength.recommended': '推荐',
      'strength.basic.label': '基础',
      'strength.basic.desc': '只在提示词首尾各放一段语言约束，成本最低，适合短会话。',
      'strength.strong.label': '强化',
      'strength.strong.desc': '在基础之上，于工具说明之后补一段重申，抵消英文工具说明带来的语言漂移，推荐默认。',
      'strength.periodic.label': '周期',
      'strength.periodic.desc': '在强化之上，每 N 轮在当轮开头追加一条语言自检提醒，适合长会话；提醒会作为一条会话记录出现，可在会话日志中看到。',
      'interval.label': '注入间隔（轮）',
      'interval.hint': '仅周期档生效，3–50 轮。',
      'interval.disabled': '仅在选择「周期」档时可调。',
      'language.label': '目标语言',
      'language.hint': 'BCP-47 语言标签，例如 zh-CN、zh-TW、en、ja、ko。',
      'language.invalid': '不是合法的 BCP-47 语言标签。',
      'language.current': '当前：{code}',
      'language.preset.zhCN': '简体中文',
      'language.preset.zhTW': '繁體中文',
      'language.preset.en': 'English',
      'language.preset.ja': '日本語',
      'language.preset.ko': '한국어',
      'terms.label': '保留代码与术语原文',
      'terms.hint': '代码、命令、路径、标识符与英文报错保持原样，不翻译。',
      'advanced.summary': '覆盖首段规则（高级）',
      'advanced.label': '首段规则全文',
      'advanced.hint': '留空则使用内置规则；填入后完全替换首段内置文本，「附加约束」仍会追加在其后。',
      'extraRules.label': '附加约束',
      'extraRules.hint': '追加在内置规则之后，留空则只用内置规则。',
      'action.save': '保存',
      'action.discard': '放弃更改',
      'action.reset': '恢复默认',
      'state.saved': '已保存 · 无需重启，下一条消息即生效',
      'state.saving': '保存中…',
      'state.loading': '正在读取配置…',
      'state.unavailable': '配置暂不可用，请确认插件已启用。',
      'state.readOnly': '当前部署为只读，配置不可修改。',
      'notice.contextConflict':
        '若你同时安装了 dsh-context，建议清空它的 promptPrefix / promptSuffix —— 它注入的 section 与本插件同序，会重复消耗 token。',
      'error.saveFailed': '保存失败：{message}',
      'error.retry': '重试',
      'quick.aria': '切换目标语言，当前 {label}',
      'quick.menu.title': '目标语言',
      'quick.menu.current': '当前：{label}',
      'quick.menu.check': '已选中',
      'quick.menu.hint': '其他语言可在 设置 → 插件 → 语言守卫 中填写。',
      'quick.already': '当前已是 {label}',
    };

    const en = {
      'card.title': 'Language Guard',
      'strength.label': 'Strength',
      'strength.recommended': 'Recommended',
      'strength.basic.label': 'Basic',
      'strength.basic.desc': 'One language constraint at the start and one at the end of the prompt. Cheapest, best for short sessions.',
      'strength.strong.label': 'Strong',
      'strength.strong.desc': 'Adds a restatement right after the tool descriptions on top of Basic, countering drift from English tool docs. Recommended default.',
      'strength.periodic.label': 'Periodic',
      'strength.periodic.desc': 'Adds a language self-check at the start of every Nth turn on top of Strong, for long sessions. The reminder appears as a session record and is visible in the session log.',
      'interval.label': 'Injection interval (turns)',
      'interval.hint': 'Applies to Periodic only, 3–50 turns.',
      'interval.disabled': 'Available only when Periodic is selected.',
      'language.label': 'Target language',
      'language.hint': 'A BCP-47 language tag, e.g. zh-CN, zh-TW, en, ja, ko.',
      'language.invalid': 'Not a valid BCP-47 language tag.',
      'language.current': 'Current: {code}',
      'language.preset.zhCN': '简体中文',
      'language.preset.zhTW': '繁體中文',
      'language.preset.en': 'English',
      'language.preset.ja': '日本語',
      'language.preset.ko': '한국어',
      'terms.label': 'Keep code and technical terms verbatim',
      'terms.hint': 'Code, commands, paths, identifiers, and raw English error text stay untranslated.',
      'advanced.summary': 'Override the opening rules (advanced)',
      'advanced.label': 'Opening rules text',
      'advanced.hint': 'Leave empty to use the built-in rules. When set, it replaces the built-in opening text entirely; Additional rules are still appended after it.',
      'extraRules.label': 'Additional rules',
      'extraRules.hint': 'Appended after the built-in rules. Leave empty to use the built-in rules alone.',
      'action.save': 'Save',
      'action.discard': 'Discard changes',
      'action.reset': 'Reset to default',
      'state.saved': 'Saved · no restart needed, applies to the next message',
      'state.saving': 'Saving…',
      'state.loading': 'Reading configuration…',
      'state.unavailable': 'Configuration is unavailable. Check that the plugin is enabled.',
      'state.readOnly': 'This deployment is read-only; configuration cannot be changed.',
      'notice.contextConflict':
        "If you also use dsh-context, consider clearing its promptPrefix / promptSuffix — its sections share this plugin's order and duplicate token cost.",

      'error.saveFailed': 'Save failed: {message}',
      'error.retry': 'Retry',
      'quick.aria': 'Switch target language, currently {label}',
      'quick.menu.title': 'Target language',
      'quick.menu.current': 'Current: {label}',
      'quick.menu.check': 'Selected',
      'quick.menu.hint': 'Other languages can be entered in Settings → Plugins → Language Guard.',
      'quick.already': 'Already {label}',
    };

    // —— 样式：只用主题 token，类名 lg- 前缀，用 <style> React 元素渲染 ——

    const CSS = `
.lg-card { display: flex; flex-direction: column; gap: 20px; padding: 16px; border: 1px solid var(--dsw-alias-settings-card-stroke); border-radius: 10px; background: var(--dsw-alias-settings-card-fill); color: var(--dsw-alias-label-primary); font-size: 13px; }
.lg-summary { color: var(--dsw-alias-label-primary); font-size: 13px; }
.lg-fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
.lg-legend { padding: 0; margin: 0 0 10px; font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.lg-option { display: flex; align-items: flex-start; gap: 6px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; }
.lg-option + .lg-option { margin-top: 10px; }
.lg-option-on { border-color: var(--dsw-alias-state-business-primary); background: var(--dsw-alias-interactive-bg-hover-accent); }
.lg-radio { margin: 3px 0 0; accent-color: var(--dsw-alias-state-business-primary); flex: none; }
.lg-option-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.lg-option-title { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-primary); cursor: pointer; }
.lg-badge { font-size: 11px; font-weight: 400; color: var(--dsw-alias-state-business-primary); background: transparent; border: 0; padding: 0; }
.lg-desc { margin: 0; font-size: 12px; font-weight: 400; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
.lg-field { display: flex; flex-direction: column; gap: 6px; }
.lg-field-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.lg-label { font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.lg-input, .lg-textarea { width: 100%; box-sizing: border-box; padding: 6px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; }
.lg-input:focus-visible, .lg-textarea:focus-visible, .lg-button:focus-visible, .lg-trigger:focus-visible, .lg-chip:focus-visible, .lg-menu-item:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 1px; }
.lg-input[aria-invalid='true'] { border-color: var(--dsw-alias-state-error-primary); }
.lg-input:disabled, .lg-textarea:disabled { color: var(--dsw-alias-label-dimmed); }
.lg-textarea { min-height: 64px; resize: vertical; line-height: 1.5; }
.lg-hint { margin: 0; font-size: 12px; font-weight: 400; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
.lg-error { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-state-error-primary); }
.lg-saved { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-state-success-primary); }
.lg-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.lg-chip { padding: 2px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer; }
.lg-chip-on { border-color: var(--dsw-alias-state-business-primary); background: var(--dsw-alias-interactive-bg-hover-accent); color: var(--dsw-alias-label-primary); }
.lg-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.lg-switch { position: relative; flex: none; width: 36px; height: 20px; padding: 0; border: 1px solid var(--dsw-alias-border-l3); border-radius: 999px; background: transparent; cursor: pointer; }
.lg-switch[aria-checked='true'] { border-color: var(--dsw-alias-state-business-primary); background: var(--dsw-alias-state-business-primary); }
.lg-switch-thumb { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 999px; background: var(--dsw-alias-switch-thumb); transition: transform 120ms ease; }
.lg-switch[aria-checked='true'] .lg-switch-thumb { transform: translateX(16px); }
.lg-button { padding: 4px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; cursor: pointer; }
.lg-button:hover { background: var(--dsw-alias-interactive-bg-hover); }
.lg-button:disabled { color: var(--dsw-alias-label-dimmed); cursor: default; }
.lg-actions { display: flex; gap: 8px; justify-content: flex-end; }
.lg-details { border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 12px; }
.lg-details-summary { font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.lg-skeleton { height: 120px; border-radius: 10px; background: var(--dsw-alias-bg-skeleton); }
.lg-status { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
.lg-notice { margin: 0; padding-top: 12px; border-top: 1px solid var(--dsw-alias-border-l1); font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
.lg-root { position: relative; display: inline-flex; }
.lg-trigger { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer; }
.lg-trigger:hover { background: var(--dsw-alias-interactive-bg-hover); }
.lg-trigger:active { background: var(--dsw-alias-interactive-bg-active); }
.lg-trigger-label { max-width: 96px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lg-caret { color: var(--dsw-alias-label-tertiary); }
.lg-glyph { flex: none; display: block; }
.lg-note { position: absolute; z-index: 11; padding: 4px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: var(--dsw-alias-bg-overlay); font-size: 12px; line-height: 1.4; white-space: nowrap; color: var(--dsw-alias-state-success-primary); }
.lg-note[data-kind='error'] { color: var(--dsw-alias-state-error-primary); }
.lg-root[data-rail='true'] .lg-note { bottom: 0; left: calc(100% + 8px); }
.lg-root:not([data-rail='true']) .lg-note { bottom: calc(100% + 8px); right: 0; }
.lg-menu { position: absolute; z-index: 10; min-width: 200px; padding: 4px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: var(--dsw-alias-bg-overlay); box-shadow: 0 4px 16px var(--dsw-alias-border-l1); }
.lg-root[data-rail='true'] .lg-menu { bottom: 0; left: calc(100% + 8px); }
.lg-root:not([data-rail='true']) .lg-menu { bottom: calc(100% + 8px); left: 0; }
.lg-menu-header { padding: 4px 8px; border-radius: 4px; background: var(--dsw-alias-menu-group-header-fill); font-size: 12px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.lg-menu-current { padding: 4px 8px; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.lg-menu-item { display: flex; align-items: center; gap: 8px; width: 100%; height: 32px; padding: 0 8px; border: 0; border-radius: 4px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.lg-menu-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
.lg-menu-item[aria-checked='true'] { color: var(--dsw-alias-label-primary); }
.lg-check { flex: none; width: 14px; color: var(--dsw-alias-state-business-primary); }
.lg-menu-label { flex: 1 1 auto; }
.lg-menu-code { flex: none; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.lg-menu-hint { padding: 6px 8px 2px; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
`;

    // —— 工具函数 ——

    /** 取语言显示名（未命中映射表时原样返回代码） */
    function languageLabel(code) {
      const raw = typeof code === 'string' ? code.trim() : '';
      if (!raw) return '简体中文';
      const lower = raw.toLowerCase();
      for (const [key, label] of LANGUAGE_NAMES) {
        if (lower === key || lower.startsWith(key + '-')) return label;
      }
      return raw;
    }

    /** 极简 `{name}` 插值，与 locale 服务的占位符语法一致 */
    function format(template, vars) {
      if (typeof template !== 'string') return '';
      if (!vars) return template;
      return template.replace(/\{(\w+)\}/g, (whole, name) =>
        Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
      );
    }

    /** 用 locale 服务绑定 NS；服务不可用时回退到内置中文字典 */
    function bindTranslator(locale) {
      if (locale && typeof locale.bind === 'function') {
        try {
          const bound = locale.bind(NS);
          if (typeof bound === 'function') return bound;
        } catch {
          // 回退到内置字典
        }
      }
      return (key, vars) => format(zh[key] ?? key, vars);
    }

    /** 安全读取一次表单快照 */
    function readSnapshot(form) {
      if (form && typeof form.getSnapshot === 'function') {
        try {
          const snapshot = form.getSnapshot();
          if (snapshot && typeof snapshot === 'object') return snapshot;
        } catch {
          // 读取失败按加载中处理
        }
      }
      return { status: 'loading', value: {}, writable: false };
    }

    /**
     * 订阅配置表单控制器。
     * 控制器本身是 snapshot store（有 getSnapshot / subscribe），这里自己订阅，
     * 不依赖 renderer 生成的 hook 语义，避免选择器引用不稳定导致的重复渲染。
     */
    function useFormState(form) {
      const [snapshot, setSnapshot] = React.useState(() => readSnapshot(form));

      React.useEffect(() => {
        if (!form || typeof form.subscribe !== 'function') return undefined;
        let alive = true;
        const sync = () => {
          if (alive) setSnapshot(readSnapshot(form));
        };
        sync();
        const dispose = form.subscribe(sync);
        return () => {
          alive = false;
          if (typeof dispose === 'function') dispose();
        };
      }, [form]);

      return snapshot;
    }

    /** 恒等选择器：避免每次渲染都新建选择器函数导致重复订阅 */
    const identity = (state) => state;

    /**
     * 读取表单状态。优先用 renderer 由 `hooks: { guardForm }` 生成的 `useGuardForm`，
     * 其次用 `form` prop 自建订阅；两者都拿不到时按「加载中」处理。
     * 两个 hook 都无条件调用，保证 hook 调用顺序稳定。
     * @param {Record<string, any>} props 组件 props
     */
    function useGuardSnapshot(props) {
      const hasInjected = typeof props.useGuardForm === 'function';
      const injected = hasInjected ? props.useGuardForm(identity) : null;
      const fallback = useFormState(hasInjected ? null : props.form);
      return injected || fallback;
    }

    /**
     * 写入与状态反馈：成功显示「已保存」，失败保留用户选择并给一行 role=alert。
     */
    function useWriter(form, t) {
      const [saved, setSaved] = React.useState(false);
      const [error, setError] = React.useState(null);
      const [pending, setPending] = React.useState(false);
      const timer = React.useRef(null);
      const lastAction = React.useRef(null);

      React.useEffect(
        () => () => {
          if (timer.current) clearTimeout(timer.current);
        },
        [],
      );

      const run = React.useCallback(
        async (action) => {
          lastAction.current = action;
          setError(null);
          setPending(true);
          try {
            const ok = await action();
            if (ok === false) {
              setError(t('error.saveFailed', { message: t('state.unavailable') }));
              return false;
            }
            setSaved(true);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setSaved(false), 3000);
            return true;
          } catch (err) {
            const message = err && err.message ? err.message : String(err);
            setError(t('error.saveFailed', { message }));
            return false;
          } finally {
            setPending(false);
          }
        },
        [t],
      );

      const retry = React.useCallback(() => {
        if (lastAction.current) run(lastAction.current);
      }, [run]);

      return { saved, error, pending, run, retry };
    }

    /** 自绘「中」字形图标（不引用任何图标包） */
    function LanguageGlyph({ size }) {
      return h(
        'svg',
        {
          className: 'lg-glyph',
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('rect', {
          x: 3,
          y: 5,
          width: 18,
          height: 14,
          rx: 3,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
        }),
        h('line', {
          x1: 12,
          y1: 2.5,
          x2: 12,
          y2: 21.5,
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
        }),
      );
    }

    /** 三档强度的 radio group（原生控件，三档说明并列常驻） */
    function StrengthField({ value, disabled, onPick, t }) {
      return h(
        'fieldset',
        { className: 'lg-fieldset', disabled },
        h('legend', { className: 'lg-legend' }, t('strength.label')),
        LEVELS.map((level) => {
          const id = 'lg-strength-' + level;
          const descId = id + '-desc';
          const checked = value === level;
          const key = level === 'B' ? 'basic' : level === 'C' ? 'strong' : 'periodic';
          return h(
            'div',
            { key: level, className: checked ? 'lg-option lg-option-on' : 'lg-option' },
            h('input', {
              type: 'radio',
              id,
              name: 'language-guard-strength',
              value: level,
              checked,
              disabled,
              'aria-describedby': descId,
              className: 'lg-radio',
              onChange: () => onPick(level),
            }),
            h(
              'div',
              { className: 'lg-option-text' },
              h(
                'label',
                { htmlFor: id, className: 'lg-option-title' },
                t('strength.' + key + '.label'),
                level === 'C'
                  ? h('span', { className: 'lg-badge' }, t('strength.recommended'))
                  : null,
              ),
              h('p', { id: descId, className: 'lg-desc' }, t('strength.' + key + '.desc')),
            ),
          );
        }),
      );
    }

    /** 每字段的「恢复默认」按钮 */
    function ResetButton({ disabled, onClick, t }) {
      return h(
        'button',
        { type: 'button', className: 'lg-button', disabled, onClick },
        t('action.reset'),
      );
    }

    /** 设置卡片：view=summary 返回一行摘要，view=page 渲染完整表单 */
    function GuardSettingsCard(props) {
      const t = props.t || bindTranslator(null);
      const form = props.form;
      const snapshot = useGuardSnapshot(props);
      const writer = useWriter(form, t);

      const values = (snapshot && snapshot.value) || {};
      const status = snapshot && snapshot.status;
      const readOnly = snapshot && snapshot.writable === false;

      const [drafts, setDrafts] = React.useState(null);
      const [intervalDraft, setIntervalDraft] = React.useState(null);

      const setField = (field, value) => {
        if (typeof props.onSet === 'function') return props.onSet(field, value);
        if (form && typeof form.set === 'function') return form.set(field, value);
        return Promise.resolve(false);
      };

      const resetField = (field) => {
        if (typeof props.onUnset === 'function') return props.onUnset(field);
        if (form && typeof form.unset === 'function') return form.unset(field);
        return Promise.resolve(false);
      };

      if (props.view === 'summary') {
        return h('div', { className: 'lg-summary' }, t('card.title'));
      }

      if (status === 'loading') {
        return h(
          'div',
          { className: 'lg-card' },
          h('p', { className: 'lg-status', role: 'status' }, t('state.loading')),
          h('div', { className: 'lg-skeleton', 'aria-hidden': 'true' }),
        );
      }

      if (status === 'unavailable') {
        return h(
          'div',
          { className: 'lg-card' },
          h('p', { className: 'lg-status', role: 'status' }, t('state.unavailable')),
        );
      }

      const strength = values.strength === 'B' || values.strength === 'D' ? values.strength : 'C';
      const interval = typeof values.injectEveryNRounds === 'number' ? values.injectEveryNRounds : 8;
      const preserve = values.preserveCodeTerms !== false;
      const language = typeof values.targetLanguage === 'string' ? values.targetLanguage : 'zh-CN';

      const draft = drafts || {
        targetLanguage: language,
        extraRules: typeof values.extraRules === 'string' ? values.extraRules : '',
        overrideHead: typeof values.overrideHead === 'string' ? values.overrideHead : '',
      };

      const languageTrimmed = draft.targetLanguage.trim();
      const languageValid = BCP47.test(languageTrimmed);
      const languageDirty = languageTrimmed !== language;
      const extraDirty = draft.extraRules !== (values.extraRules || '');
      const headDirty = draft.overrideHead !== (values.overrideHead || '');
      const anyDirty = languageDirty || extraDirty || headDirty;
      const canSave = !readOnly && anyDirty && languageValid && !writer.pending;

      const saveDrafts = () => {
        const steps = [];
        if (languageDirty) steps.push(['targetLanguage', languageTrimmed]);
        if (extraDirty) steps.push(['extraRules', draft.extraRules]);
        if (headDirty) steps.push(['overrideHead', draft.overrideHead]);
        writer.run(async () => {
          for (const [field, value] of steps) {
            const ok = await setField(field, value);
            if (ok === false) return false;
          }
          setDrafts(null);
          return true;
        });
      };

      const discardDrafts = () => setDrafts(null);

      const intervalValue = intervalDraft === null ? String(interval) : intervalDraft;

      return h(
        'div',
        { className: 'lg-card' },
        h('style', null, CSS),

        readOnly ? h('p', { className: 'lg-status', role: 'status' }, t('state.readOnly')) : null,

        StrengthField({
          value: strength,
          disabled: readOnly,
          t,
          onPick: (level) => {
            if (level !== strength) setField('strength', level);
          },
        }),

        h(
          'div',
          { className: 'lg-field' },
          h(
            'div',
            { className: 'lg-field-head' },
            h('label', { className: 'lg-label', htmlFor: 'lg-interval' }, t('interval.label')),
            ResetButton({
              disabled: readOnly,
              t,
              onClick: () => resetField('injectEveryNRounds'),
            }),
          ),
          h('input', {
            id: 'lg-interval',
            key: 'lg-interval-' + String(interval),
            type: 'number',
            className: 'lg-input',
            min: 3,
            max: 50,
            step: 1,
            defaultValue: String(interval),
            disabled: readOnly || strength !== 'D',
            'aria-describedby': 'lg-interval-hint',
            onChange: (event) => setIntervalDraft(event.target.value),
            onBlur: (event) => {
              const parsed = Number(event.target.value);
              setIntervalDraft(null);
              if (!Number.isFinite(parsed)) return;
              const clamped = Math.min(50, Math.max(3, Math.round(parsed)));
              if (clamped !== interval) setField('injectEveryNRounds', clamped);
            },
            onKeyDown: (event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            },
          }),
          h(
            'p',
            { id: 'lg-interval-hint', className: 'lg-hint' },
            strength === 'D' ? t('interval.hint') : t('interval.disabled'),
          ),
        ),

        h(
          'div',
          { className: 'lg-field' },
          h(
            'div',
            { className: 'lg-field-head' },
            h('label', { className: 'lg-label', htmlFor: 'lg-language' }, t('language.label')),
            ResetButton({ disabled: readOnly, t, onClick: () => resetField('targetLanguage') }),
          ),
          h('input', {
            id: 'lg-language',
            type: 'text',
            className: 'lg-input',
            value: draft.targetLanguage,
            disabled: readOnly,
            spellCheck: false,
            autoComplete: 'off',
            'aria-invalid': languageValid ? undefined : 'true',
            'aria-describedby': 'lg-language-hint',
            onChange: (event) =>
              setDrafts({ ...draft, targetLanguage: event.target.value }),
          }),
          h(
            'p',
            { id: 'lg-language-hint', className: languageValid ? 'lg-hint' : 'lg-error' },
            languageValid
              ? t('language.hint') + ' ' + t('language.current', { code: languageLabel(language) })
              : t('language.invalid'),
          ),
          h(
            'div',
            { className: 'lg-chips' },
            PRESETS.map((preset) =>
              h(
                'button',
                {
                  key: preset.code,
                  type: 'button',
                  className:
                    language.toLowerCase() === preset.code.toLowerCase()
                      ? 'lg-chip lg-chip-on'
                      : 'lg-chip',
                  disabled: readOnly,
                  onClick: () => {
                    setDrafts({ ...draft, targetLanguage: preset.code });
                    setField('targetLanguage', preset.code);
                  },
                },
                t(preset.labelKey),
              ),
            ),
          ),
        ),

        h(
          'div',
          { className: 'lg-row' },
          h(
            'div',
            { className: 'lg-field' },
            h('span', { className: 'lg-label', id: 'lg-terms-label' }, t('terms.label')),
            h('p', { className: 'lg-hint' }, t('terms.hint')),
          ),
          h(
            'div',
            { className: 'lg-row' },
            h(
              'button',
              {
                type: 'button',
                role: 'switch',
                className: 'lg-switch',
                'aria-checked': preserve,
                'aria-labelledby': 'lg-terms-label',
                disabled: readOnly,
                onClick: () => setField('preserveCodeTerms', !preserve),
              },
              h('span', { className: 'lg-switch-thumb', 'aria-hidden': 'true' }),
            ),
            ResetButton({
              disabled: readOnly,
              t,
              onClick: () => resetField('preserveCodeTerms'),
            }),
          ),
        ),

        h(
          'div',
          { className: 'lg-field' },
          h(
            'div',
            { className: 'lg-field-head' },
            h('label', { className: 'lg-label', htmlFor: 'lg-extra' }, t('extraRules.label')),
            ResetButton({ disabled: readOnly, t, onClick: () => resetField('extraRules') }),
          ),
          h('textarea', {
            id: 'lg-extra',
            className: 'lg-textarea',
            rows: 3,
            value: draft.extraRules,
            disabled: readOnly,
            'aria-describedby': 'lg-extra-hint',
            onChange: (event) => setDrafts({ ...draft, extraRules: event.target.value }),
          }),
          h('p', { id: 'lg-extra-hint', className: 'lg-hint' }, t('extraRules.hint')),
        ),

        h(
          'details',
          { className: 'lg-details' },
          h('summary', { className: 'lg-details-summary' }, t('advanced.summary')),
          h(
            'div',
            { className: 'lg-field', style: { marginTop: '10px' } },
            h(
              'div',
              { className: 'lg-field-head' },
              h('label', { className: 'lg-label', htmlFor: 'lg-override' }, t('advanced.label')),
              ResetButton({ disabled: readOnly, t, onClick: () => resetField('overrideHead') }),
            ),
            h('textarea', {
              id: 'lg-override',
              className: 'lg-textarea',
              rows: 3,
              value: draft.overrideHead,
              disabled: readOnly,
              'aria-describedby': 'lg-override-hint',
              onChange: (event) => setDrafts({ ...draft, overrideHead: event.target.value }),
            }),
            h('p', { id: 'lg-override-hint', className: 'lg-hint' }, t('advanced.hint')),
          ),
        ),

        writer.error
          ? h(
              'div',
              { className: 'lg-field' },
              h('p', { className: 'lg-error', role: 'alert' }, writer.error),
              h(
                'button',
                { type: 'button', className: 'lg-button', onClick: writer.retry },
                t('error.retry'),
              ),
            )
          : null,

        h(
          'div',
          { className: 'lg-actions' },
          h(
            'button',
            { type: 'button', className: 'lg-button', disabled: !canSave, onClick: discardDrafts },
            t('action.discard'),
          ),
          h(
            'button',
            { type: 'button', className: 'lg-button', disabled: !canSave, onClick: saveDrafts },
            writer.pending ? t('state.saving') : t('action.save'),
          ),
        ),

        writer.saved ? h('p', { className: 'lg-saved', role: 'status' }, t('state.saved')) : null,

        // 与第三方 dsh-context 的 section 同序，重复吃 token；首版常驻提示，简单优先。
        h('p', { className: 'lg-notice' }, t('notice.contextConflict')),
      );
    }

    /** 侧栏底部的快速语言切换：图标 + 当前语言自称，点击弹下拉菜单 */
    function QuickLanguageSwitch(props) {
      const t = props.t || bindTranslator(null);
      const wide = props.wide !== false;
      const form = props.form;
      const snapshot = useGuardSnapshot(props);
      const values = (snapshot && snapshot.value) || {};
      const code = typeof values.targetLanguage === 'string' && values.targetLanguage
        ? values.targetLanguage
        : 'zh-CN';
      const label = languageLabel(code);

      const [open, setOpen] = React.useState(false);
      const [note, setNote] = React.useState(null);
      const [focusIndex, setFocusIndex] = React.useState(0);
      const rootRef = React.useRef(null);
      const buttonRef = React.useRef(null);
      const itemRefs = React.useRef([]);

      React.useEffect(() => {
        if (!open) return undefined;
        const onPointer = (event) => {
          if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
        };
        const onKey = (event) => {
          if (event.key === 'Escape') {
            setOpen(false);
            if (buttonRef.current) buttonRef.current.focus();
          }
        };
        document.addEventListener('pointerdown', onPointer);
        document.addEventListener('keydown', onKey);
        return () => {
          document.removeEventListener('pointerdown', onPointer);
          document.removeEventListener('keydown', onKey);
        };
      }, [open]);

      const pick = (value) => {
        setOpen(false);
        if (buttonRef.current) buttonRef.current.focus();
        const same = String(value).toLowerCase() === String(code).toLowerCase();
        const run =
          typeof props.onPick === 'function'
            ? props.onPick(value)
            : form && typeof form.set === 'function'
              ? form.set('targetLanguage', value)
              : Promise.resolve(false);
        Promise.resolve(run).then(
          (ok) => {
            if (ok === false) {
              setNote({ kind: 'error', text: t('error.saveFailed', { message: t('state.unavailable') }) });
            } else {
              setNote({ kind: 'ok', text: same ? t('quick.already', { label: languageLabel(value) }) : t('state.saved') });
            }
          },
          (err) => {
            const message = err && err.message ? err.message : String(err);
            setNote({ kind: 'error', text: t('error.saveFailed', { message }) });
          },
        );
      };

      React.useEffect(() => {
        if (!note) return undefined;
        const timer = setTimeout(() => setNote(null), 4000);
        return () => clearTimeout(timer);
      }, [note]);

      const focusItem = (index) => {
        const node = itemRefs.current[index];
        if (node && typeof node.focus === 'function') node.focus();
      };

      const moveFocus = (delta) => {
        const next = (focusIndex + delta + PRESETS.length) % PRESETS.length;
        setFocusIndex(next);
        focusItem(next);
      };

      return h(
        'div',
        {
          ref: rootRef,
          className: 'lg-root',
          'data-rail': wide ? undefined : 'true',
        },
        h('style', null, CSS),
        h(
          'button',
          {
            ref: buttonRef,
            type: 'button',
            className: 'lg-trigger',
            'aria-haspopup': 'menu',
            'aria-expanded': open,
            'aria-label': t('quick.aria', { label }),
            title: wide ? undefined : label,
            onClick: () => {
              setOpen((value) => !value);
              setFocusIndex(0);
            },
            onKeyDown: (event) => {
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
              event.preventDefault();
              setOpen(true);
              const current = PRESETS.findIndex(
                (preset) => preset.code.toLowerCase() === code.toLowerCase(),
              );
              const next = event.key === 'ArrowDown'
                ? (current < 0 ? 0 : (current + 1) % PRESETS.length)
                : (current <= 0 ? PRESETS.length - 1 : current - 1);
              setFocusIndex(next);
              setTimeout(() => focusItem(next), 0);
            },
          },
          h(LanguageGlyph, { size: wide ? 16 : 18 }),
          wide ? h('span', { className: 'lg-trigger-label' }, label) : null,
          wide ? h('span', { className: 'lg-caret', 'aria-hidden': 'true' }, '▾') : null,
        ),
        note
          ? h(
              'span',
              { className: 'lg-note', role: 'status', 'aria-live': 'polite', 'data-kind': note.kind },
              note.text,
            )
          : null,
        open
          ? h(
              'div',
              { className: 'lg-menu', role: 'menu', 'aria-label': t('quick.menu.title') },
              h('div', { className: 'lg-menu-header' }, t('quick.menu.title')),
              h('div', { className: 'lg-menu-current' }, t('quick.menu.current', { label })),
              PRESETS.map((preset, index) => {
                const checked = code.toLowerCase() === preset.code.toLowerCase();
                return h(
                  'button',
                  {
                    key: preset.code,
                    type: 'button',
                    role: 'menuitemradio',
                    'aria-checked': checked,
                    ref: (node) => {
                      itemRefs.current[index] = node;
                    },
                    tabIndex: index === focusIndex ? 0 : -1,
                    className: 'lg-menu-item',
                    onFocus: () => setFocusIndex(index),
                    onKeyDown: (event) => {
                      if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        moveFocus(1);
                      } else if (event.key === 'ArrowUp') {
                        event.preventDefault();
                        moveFocus(-1);
                      }
                    },
                    onClick: () => pick(preset.code),
                  },
                  h(
                    'span',
                    { className: 'lg-check', 'aria-hidden': 'true' },
                    checked ? '✓' : '',
                  ),
                  h('span', { className: 'lg-menu-label' }, t(preset.labelKey)),
                  h('span', { className: 'lg-menu-code' }, preset.code),
                );
              }),
              h('div', { className: 'lg-menu-hint' }, t('quick.menu.hint')),
            )
          : null,
      );
    }

    /**
     * 插件入口。所有注册都在这里，factory 本身无副作用。
     * @param {any} ctx Client 上下文
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'language-guard: dictionaries');

      let form = null;
      try {
        form = ctx.configForms.get(ENTRY_ID);
      } catch {
        form = null;
      }

      // 配置卡片：只在 Host 服务该 namespace 时注册；声明塌陷时自动 dispose。
      ctx.effect(
        () =>
          ctx.configForms.whileServed([ENTRY_ID], () =>
            ctx.slots.inject('plugins.bundle.config', () =>
              ctx.slots.register(
                {
                  name: 'plugins.bundle.config',
                  key: ENTRY_ID,
                  locale: NS,
                  inject: () => ({
                    form,
                    hooks: { guardForm: form },
                    onSet: (field, value) =>
                      form && typeof form.set === 'function'
                        ? form.set(field, value)
                        : Promise.resolve(false),
                    onUnset: (field) =>
                      form && typeof form.unset === 'function'
                        ? form.unset(field)
                        : Promise.resolve(false),
                  }),
                },
                GuardSettingsCard,
              ),
            ),
          ),
        'language-guard: settings card',
      );

      // 侧栏底部快速切换：同一个 whileServed 守卫，Host 未启用则不出现。
      ctx.effect(
        () =>
          ctx.configForms.whileServed([ENTRY_ID], () =>
            ctx.slots.inject('sidebar.footer.action', () =>
              ctx.slots.register(
                {
                  name: 'sidebar.footer.action',
                  id: 'language-guard',
                  order: 100,
                  locale: NS,
                  inject: () => ({
                    form,
                    hooks: { guardForm: form },
                    onPick: (value) =>
                      form && typeof form.set === 'function'
                        ? form.set('targetLanguage', value)
                        : Promise.resolve(false),
                  }),
                },
                QuickLanguageSwitch,
              ),
            ),
          ),
        'language-guard: quick switch',
      );
    }

    return {
      inject: ['slots', 'locale', 'configForms'],
      apply,
    };
  },
});
