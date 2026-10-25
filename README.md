# Language Guard (dsh-language-guard)

**English** | [简体中文](README.zh.md)

> Make the DSH agent think and answer in the language you choose — Simplified Chinese by default, three strength levels, effective on the next message, zero dependencies, no build step.

<img src="https://raw.githubusercontent.com/58fly/dsh-language-guard/main/docs/images/settings-panel.webp" alt="Language Guard settings panel: language source (auto / manual), strength levels (basic / reinforced / periodic), target language, and the preserve-code-terms toggle" width="760">

---

## Table of Contents

- [Why you need it](#why-you-need-it)
- [What it does](#what-it-does)
- [Install](#install)
- [Strength levels](#strength-levels)
- [Configuration](#configuration)
- [Automatic language mode](#automatic-language-mode)
- [Settings panel and quick language switch](#settings-panel-and-quick-language-switch)
- [The `/language` slash command](#the-language-slash-command)
- [Verifying that the constraint reached the system prompt](#verifying-that-the-constraint-reached-the-system-prompt)
- [Coexisting with dsh-context](#coexisting-with-dsh-context)
- [How it differs from the official cot-translation plugin](#how-it-differs-from-the-official-cot-translation-plugin)
- [Known limitations](#known-limitations)
- [Design boundaries](#design-boundaries)
- [License](#license)

---

## Why you need it

The DSH system prompt is assembled from many sections: identity, plan policy, team policy, **tool descriptions**, deliverable references, deployment persona. The largest block by far is the tool documentation — written in English, and placed in the middle of the prompt.

Measured on DSH 0.2.1-rc.2 (everything after order 50): **98.1% of the characters and 99.8% of the ASCII** come from English tool documentation, and 5.7K–14K characters separate the opening section from the closing one. The model reads overwhelmingly English tokens, and so it drifts:

- The first few turns stay in your language;
- as soon as it starts chaining tool calls, reading long files, or reasoning at length, the reasoning slides back into English;
- nothing in your settings changed — the conversation simply got longer.

A single "please answer in Chinese" line at the very top of the system prompt is enough for a short session. It is not enough for a long one, because that line sits tens of thousands of characters away from the place that actually influences the model (the tool documentation).

This plugin puts a constraint in **three places**: at the very start, right after the tool documentation, and at the very end. The default level (Strong) costs roughly 146 extra characters per request and buys one restatement positioned after the English tool docs.

## What it does

Three resident system-prompt sections, registered through `ctx.systemPrompt.section()`, never disposed, switching level only switches their text:

| Section name | Order | Position | B | C | D |
| --- | --- | --- | --- | --- | --- |
| `language-guard:head` | `-2000` | Very first, before `harness:identity` (`-1000`) | ✅ | ✅ | ✅ |
| `language-guard:mid` | `5100` | After all tool docs (`tools:sdk`, `5000`), before deliverable references (`9000`) | ❌ | ✅ | ✅ |
| `language-guard:tail` | `11200` | Very last, after `deployment:persona-suffix` (`10200`) | ✅ | ✅ | ✅ |

The constraint covers **four language channels** (the fourth landed in 0.3.0):

| Channel | Where the constraint lives | Coverage |
| --- | --- | --- |
| Internal reasoning (reasoning / thinking) | `head` + `tail` | every level |
| User-facing reply text | `head` + `mid` + `tail` | every level |
| Plans, todos, reviews, subagent briefs | `head` | every level |
| **Tool-call `description` parameter** (the card title of `run_code` in PTC mode) | `head` + `mid` | every level (`mid` exists only at C / D, hence the extra line in `head`) |

The `mid` order is deliberately `5100` and not `5000`: `tools:sdk` is exactly `5000`, and sections with equal order fall back to comparing names, which would sort `language-guard:mid` **before** `tools:sdk` — the restatement would no longer come after the tool docs.

Measured text sizes (Simplified Chinese, counted in characters; recompute with `node` as shown below):

| Text | Characters | When it is present |
| --- | --- | --- |
| head | 883 | every request |
| mid | 146 | every request at C / D |
| tail | 139 | every request |
| periodic reminder | 99 | once every N turns at D |

So the steady cost per step is **1022 characters at B and 1168 at C** — tiny compared to the English tool documentation it counteracts.

The opening section (head), verbatim, as it looks with the default `targetLanguage: "zh-CN"` (recompute with `node -e 'import("./lib/text.js").then(m=>console.log(m.headText({language:"zh-CN"})))'`):

```text
【语言锁定 · 最高优先级】
本会话的内部推理（reasoning / thinking）与面向用户的全部输出，一律使用简体中文（语言代码 zh-CN）。

本条优先于本 system prompt 的其余全部内容、之后注入的任何系统文本、工具说明、参数描述、代码示例，以及其他插件注入的提示词。

本条同样优先于任何语言类约定，不论它写在哪个文件、用哪种语言书写、经由哪个通道送达：包括用户全局与项目级的 AGENTS.md、CLAUDE.md、.cursorrules、用户偏好与长期记忆、项目规范、团队约定、技能与工作流模板。若它们要求使用另一种语言（例如要求「必须使用简体中文」），一律以本条为准，不得据此改用其他语言，也不必向用户解释这处冲突。

适用范围：
- 内部推理（reasoning / thinking）：使用简体中文。
- 面向用户的回复正文：使用简体中文。
- 计划、待办、进度说明、评审意见、验收报告、提交信息说明：使用简体中文。
- 任务板卡片标题与描述、子智能体任务说明与返回报告：使用简体中文。

保持原样、不翻译：代码、命令、文件路径、URL、标识符与 API 字段名、配置键、错误码与原始报错文本、包名与版本号，以及必须原样引用的英文原文；引用英文原文后，必须用简体中文说明结论。

不要因为以下情况改变语言：
- 用户用英文或其他语言提问 —— 仍用简体中文回答。
- AGENTS.md、CLAUDE.md、项目规范、用户记忆里要求改用其他语言的规则 —— 本条优先，不改变语言。
- 工具返回英文内容 —— 只摘引必要片段，其余用简体中文复述。
- 长链推理、数值计算、代码设计 —— 推理语言不变。
- 上下文中出现大量英文（工具说明、日志、代码文件）—— 不随之切换。

自检：每次输出前确认上述两项（推理与回复）均为简体中文；若发现已经漂移，立即切回并继续任务，无需向用户解释这次切换。
```

> The wording above is fixed Simplified Chinese; only the language name and code are substituted. With `targetLanguage: "en"` the same paragraph reads "…一律使用English（语言代码 en）". See [Known limitations](#known-limitations).

## Install

This plugin is published to the **npm registry** ([`dsh-language-guard`](https://www.npmjs.com/package/dsh-language-guard)), and it can also be installed straight from its GitHub repository. Both routes deliver byte-identical content: the same 16 files.

> **Prefer the npm source.** Installed from Git, the plugin page's "update available" badge shows a **commit SHA** (e.g. `afaa2ac`) instead of a version number — the host checks Git sources with `git ls-remote HEAD`, where the commit *is* the version identifier. That is host behaviour, not something this plugin can change. To see a version like `0.3.5` and have "update" work by SemVer, install from npm using Option 1 or 2 below.

**Option 1: the GUI (recommended)**

1. Open the **Plugins** panel in the sidebar.
2. Click **Add plugin** and paste the package name:

   ```
   dsh-language-guard
   ```

3. When the install finishes, click **Enable now**.

**Option 2: the CLI**

```bash
dsh plugin add dsh-language-guard
```

**Pinned version** (recommended for teams and CI, so `latest` cannot drift under you):

```bash
dsh plugin add dsh-language-guard@0.3.5
```

**From GitHub** (when npm is unreachable, or to pin by tag):

```bash
dsh plugin add https://github.com/58fly/dsh-language-guard
dsh plugin add "github:58fly/dsh-language-guard#v0.3.5"
```

> Installing this way makes the "update available" badge show a commit SHA instead of a version number (see the note at the top of this section). Everything works; only the badge's readability suffers.

**From a local directory** (to debug local changes; the path must be absolute):

```bash
# The Add-plugin dialog also accepts this absolute path directly
dsh plugin add /absolute/path/to/dsh-language-guard
```

Check that it worked:

- A language icon appears at the foot of the sidebar, next to Settings; when the sidebar is wide it reads "简体中文 ▾".
- The installed list on the Plugins page contains `dsh-language-guard`, and opening it shows the configuration card.

> **No controls visible means the plugin is not enabled.** Both slots register inside `configForms.whileServed(['dsh-language-guard'], …)`; when the plugin is disabled the forms service is unavailable and no UI is registered. That is deliberate, not a bug — enable the plugin on the Plugins page first.

Requirements: DSH `>= 0.2.1-rc.2`, Node `^22.19.0 || >=24.0.0`. `dependencies` is empty and every peer dependency is optional, so nothing extra is downloaded at runtime. Installing from npm only needs reachability to `registry.npmjs.org`; installing from GitHub needs `github.com` (or `codeload.github.com`).

## Strength levels

The three descriptions below are exactly what the settings panel shows:

| Level | Value | Description |
| --- | --- | --- |
| Basic | `B` | One language constraint at the start and one at the end of the prompt. Cheapest, best for short sessions. |
| Strong | `C` | Adds a restatement right after the tool descriptions on top of Basic, countering drift from English tool docs. Recommended default. |
| Periodic | `D` | Adds a language self-check at the start of every Nth turn on top of Strong, for long sessions. The reminder appears as a session record and is visible in the session log. |

Behaviour differences:

| Behaviour | B | C | D |
| --- | --- | --- | --- |
| Resident system-prompt sections | head + tail | head + mid + tail | head + mid + tail |
| Restatement after tool docs | ❌ | ✅ | ✅ |
| Self-check every N turns | ❌ | ❌ | ✅ (N defaults to 8, range 3–50) |
| New record in the session log | none | none | one per N turns (`source.kind = "language-guard"`) |
| Injection timing | — | — | the **first step** of a matching turn, alongside that turn's user message; no extra request |
| Counter after restart / resume | — | — | **not reset**: the turn number comes from the session log's `turn` projection, so `turn % N` is stable |
| Best for | short sessions, token-sensitive | the default | long sessions, or drift already observed |

How to choose:

- **Start with the default, Strong.** It is the only level aimed at the actual root cause (English tool docs), and it costs about 146 characters per step.
- **Short sessions, or every token counts** → drop to **Basic**. Start and end constraints are enough for a 3–5 turn session.
- **Sessions that run dozens of turns, or you have already seen reasoning slide back into English** → raise to **Periodic**. Smaller N means more frequent reminders; the default 8 is a compromise. N = 3 is noisy.

## Configuration

Seven fields, all `volatile` (a change takes effect immediately — no restart, no plugin remount):

| Field | Type | Default | Range | Description |
| --- | --- | --- | --- | --- |
| `languageMode` | `"" \| "auto" \| "manual"` | `""` | tri-state enum, case-sensitive | Language mode. `"auto"` follows the interface language, `"manual"` pins `targetLanguage`, `""` means "never chosen" and is resolved by the migration rule below |
| `targetLanguage` | `string` | `"zh-CN"` | a valid BCP-47 tag (`/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/`) | Target language. `zh-CN` Simplified Chinese, `zh-TW` Traditional Chinese, `en` English, `ja` Japanese, `ko` Korean; any other valid tag is used as-is |
| `strength` | `"B" \| "C" \| "D"` | `"C"` | enum, case-sensitive | Strength level, see above |
| `injectEveryNRounds` | `number` | `8` | 3–50, integer | How often the Periodic self-check is added. Only used at D; the control is disabled at other levels |
| `preserveCodeTerms` | `boolean` | `true` | `true` / `false` | `true`: code, commands, paths, identifiers, API fields and raw error text stay verbatim. `false`: technical terms are preferred in the target language, with the English term in parentheses when needed |
| `extraRules` | `string` | `""` | any text | Appended after the built-in rules. Empty means built-in rules only |
| `overrideHead` | `string` | `""` | any text | **Replaces** the built-in opening text entirely (`extraRules` is still appended after it). Empty or whitespace-only falls back to the built-in text |

The `targetLanguage` → display name mapping is fixed (no language guessing): `zh-CN` / `zh-Hans` / `zh-SG` → 简体中文, `zh-TW` / `zh-HK` / `zh-MO` / `zh-Hant` → 繁體中文, `en` / `en-US` / `en-GB` → English, `ja` / `ja-JP` → 日本語, `ko` / `ko-KR` → 한국어; any other valid tag is displayed as the code itself.

Configuration lives in the profile's `cordis.patch.yml`. **A patch replaces `config` wholesale — it does not deep-merge** — so a manual override must restate every field, otherwise the omitted ones are lost:

```yaml
- id: dsh-language-guard
  name: dsh-language-guard
  config:
    languageMode: auto
    targetLanguage: zh-CN
    strength: C
    injectEveryNRounds: 8
```

## Automatic language mode

`languageMode` decides where the target language comes from:

| Mode | Behaviour |
| --- | --- |
| **Auto** | The target language follows the DSH **interface language**. Switch the UI to English and the next message gets an English constraint |
| **Manual** | The target language is pinned to `targetLanguage`, regardless of the interface language |

**Auto is the default.** A fresh install needs no configuration: a Simplified Chinese UI constrains Simplified Chinese, an English UI constrains English.

### Resolution order

Auto mode has exactly two sources, taken in order:

1. **The interface language** (`preference` in the `locale` configuration) — the `Settings → General → Language` setting.
2. **The `targetLanguage` value** (default `zh-CN`) — the fallback when the interface language is unavailable.

Mapping (`zh`-prefixed tags → `zh-CN`, `en`-prefixed tags → `en`, any other valid tag is kept as-is):

| Interface language | Target language | The constraint reads |
| --- | --- | --- |
| `zh` / `zh-CN` / `zh-Hans` | `zh-CN` | 简体中文 |
| `en` / `en-US` | `en` | English |
| `ja` | `ja` | 日本語 |
| `ko` | `ko` | 한국어 |
| any other valid BCP-47 | as-is | that language's display name or code |

> **Why is there no "system language" step?** The Host half runs as an `ELECTRON_RUN_AS_NODE=1` child process: `require("electron")` throws `Cannot find module 'electron'`, and `Intl.DateTimeFormat().resolvedOptions().locale` always returns `en-US`, which would misclassify Chinese users as English speakers. **There is no reliable system-language signal on the Host side**, so the plugin neither guesses nor fabricates one.

### Upgrading from 0.1.x

If you had picked a `targetLanguage` by hand (say `ja`) and never touched `languageMode`, you stay in **manual** mode after the upgrade — the interface language never silently overrides your choice. The rule: `languageMode` empty **and** `targetLanguage` different from the default `zh-CN` → manual.

Pick "Auto" in the settings card to follow the interface language instead. Once you have chosen explicitly, the migration rule never applies again.

### Seeing what it resolved to

The first control group in the settings card is the language mode; with "Auto" selected it spells out the current result and its source right below:

```text
Currently resolved to 简体中文
from the interface language
```

When the source line says "from the interface language" it means the interface language **you explicitly picked in DSH settings**; if you never picked one it says "interface language not detected, using the configured value" rather than guessing from the browser or the OS — the Host and the settings card read the same value (`preference` of the `locale` namespace in `settings.describe()`), so what the panel shows is exactly what gets injected. The sidebar quick-switch button label shows the same state, e.g. "Auto, 简体中文".

**Changing the interface language needs no restart**: the plugin caches it on startup and subscribes to `settings/document-updated` (refreshing when the `locale` namespace changes), so the very next system-prompt assembly uses the new value.

## Settings panel and quick language switch

### Settings panel

Path: **sidebar Plugins → installed plugins → `dsh-language-guard`**. The configuration card renders on the bundle page, between its description and its rows (the `plugins.bundle.config` slot, keyed by the package name). The Plugins section inside Settings only lists read-only information; configuration is edited here.

The card, top to bottom:

1. **Language mode** — two radios, Auto / Manual. With Auto selected it spells out "currently resolved to X" plus the source (interface language / configured value), and follows the interface language when you change it. In Auto mode the target-language control in item 3 is disabled.
2. **Strength** — three radio rows (`fieldset` + same-named `radio`), all three descriptions visible side by side, with a "Recommended" badge on C. A radio group rather than a `<select>`, because the differences have to be comparable at a glance.
3. **Injection interval (turns)** — a number input, 3–50, disabled with an explanation outside the Periodic level.
4. **Target language** — a text field plus five preset chips (简体中文 / 繁體中文 / English / 日本語 / 한국어). Custom tags go straight into the field; it validates as you type and disables Save while invalid.
5. **Keep code and technical terms verbatim** — a switch (`role="switch"` + `aria-checked`).
6. **Additional rules** — a textarea with a local draft and Save / Discard changes.
7. **Override the opening rules (advanced)** — collapsed by default. Editing it replaces the highest-priority constraint outright, so it stays out of the way.

Every field has a "Reset to default" action (clears the user value back to the schema default).

The saved state reads "Saved · no restart needed, applies to the next message". Level, switch and interval are written on change; text fields use a draft plus an explicit Save so that typing does not write to disk on every keystroke.

### Quick language switch

At the foot of the sidebar, next to Settings (the `sidebar.footer.action` slot, `id = "language-guard"`, `order = 100`):

- Sidebar wide: icon + the language's own name + `▾`.
- Sidebar collapsed to a 56px rail: icon only, with a complete `aria-label`.
- Clicking opens a dropdown menu (not a cycle). The first entry is **Auto** (follow the interface language), followed by the five presets. The current entry is checked; in Auto mode the button label reads "Auto, X" and the Auto entry spells out "Currently auto-resolved to X". When the current value is not one of the five presets the raw code is shown with nothing checked.
- Keyboard: Enter / Space opens, Escape closes and returns focus, ↑↓ moves through the menu.
- A hint at the bottom of the menu points to the settings text field for other languages.

Picking an entry writes the configuration immediately, and the sidebar label and the settings text field stay in sync both ways. Once the write settles, a line appears above the button for four seconds: "已保存 · 无需重启，下一条消息即生效" when the language actually changed, "当前已是 X" when the entry you picked was already the current one (so a click is never a silent no-op), and the failure reason when the write is rejected.

> **Changing the configuration does not require restarting DSH.** Writes go through `dsh-config-editor`, which applies them through the Loader right after touching the disk; volatile fields replace the running references without remounting the plugin (`cordis-plugin-loader`'s `_commitVolatile` → `loader/volatile-update`), and the system prompt is re-assembled on every request, so **your next message** already carries the new language. Only **changing the plugin's code** (for example upgrading the version) needs a restart — not a configuration change.

### The `/language` slash command

A shortcut from the composer. It only sets an in-memory override for this run — **it does not write configuration**, so a restart returns to the configured value:

```text
/language          report the current language and the configured value
/language ja       switch to Japanese for this run
/language reset    clear the override, back to the configured value
/language default  same as reset
```

An invalid tag returns an error and changes nothing. The override wins over configuration: `override > configured value > default`.

## Verifying that the constraint reached the system prompt

Levels, panels and switches are all just claims until you look at what the model actually received. DSH records every request's system prompt as a `system/message` event in the session log (`~/.dsh/sessions/<escaped working directory>/<session id>/session.v4.jsonl.zstd`). The three steps below reproduce anywhere the plugin is installed.

### Step 1: change the level, do not restart

1. Open the settings panel (sidebar Plugins → `dsh-language-guard`).
2. Switch Strength from Strong to Periodic.
3. The footer reads "Saved · no restart needed, applies to the next message".

### Step 2: read the session log and inspect the system node

Send any ordinary message (say "hello") in any session, then run:

```bash
# 1. Find the most recently written session log
latest=$(ls -t "$HOME"/.dsh/sessions/*/*/session.v4.jsonl.zstd | head -1)
echo "$latest"

# 2. Decompress it to JSONL (on macOS: brew install zstd first if missing)
zstd -dc "$latest" > /tmp/dsh-session.jsonl

# 3. Print each system node's length and check whether the three sections are present
node -e '
const fs = require("node:fs");
const lines = fs.readFileSync("/tmp/dsh-session.jsonl", "utf8").split("\n").filter(Boolean);
const sys = lines.map((l) => JSON.parse(l)).filter((o) => o.type === "system/message");
const marks = ["【语言锁定 · 最高优先级】", "【语言锁定 · 中段重申】", "【语言锁定 · 收尾复述】"];
console.log("system nodes:", sys.length);
sys.forEach((o, i) => {
  const text = o.data.message.content.map((p) => p.text || "").join("");
  const hit = marks.filter((m) => text.includes(m)).length;
  console.log(`#${i} turn=${o.data.turn} step=${o.data.step} length=${text.length} sections=${hit}/3`);
});
'
```

At Strong (or Periodic) you should see `sections=3/3`.

### Step 3: switch to Basic and watch the middle section disappear

1. Switch Strength to Basic and send another message.
2. Re-run the command from step 2.

The new system node should report `sections=2/3` — the missing one is `【语言锁定 · 中段重申】` — and its length should be **146 characters shorter** than the previous node, exactly the size of the mid section (see [What it does](#what-it-does)). At Basic, `language-guard:mid` returns an empty string, and `renderPrompt` filters empty text out, so no empty section or stray blank line is left behind.

### Extra checks

- **The Periodic reminder**: set Strength to Periodic and the interval to 3, then chat for 3 turns. The session log gains `user/message` events whose `data.message.source.kind` is `"language-guard"`, `form` is `"notice"` and `summary` is `"语言自检"`. In the UI it renders as a collapsed line reading "上下文注入 · language-guard · 语言自检" — it never impersonates a user turn.
- **Subagents are skipped**: at Periodic, dispatch a subagent; its session log contains no record with `source.kind = "language-guard"` (a subagent inherits the parent's system-prompt constraint, and its compact context is left alone).
- **Switching language**: pick 日本語 from the sidebar menu, send a message, and the new system node reads "一律使用日本語（语言代码 ja）".
- **Disabling the plugin**: with the plugin disabled there are no sections and no injections; the new system node reports `sections=0/3`. That is a clean fallback, not a leftover.

### One-command check

The manual steps above collapse into a single command:

```bash
node scripts/verify-installed.mjs
```

It locates the most recently written session log, decompresses it, reports the length and section hits of every `system/message` node, and prints two verdicts: **whether a legacy dsh-context promptPrefix/promptSuffix is still present**, and **whether this plugin is in effect**. An explicit path also works:

```bash
node scripts/verify-installed.mjs ~/.dsh/sessions/<project>/<session>/session.v4.jsonl.zstd
```

Requires the `zstd` command on your PATH (macOS: `brew install zstd`).

## Coexisting with dsh-context

The third-party plugin `dsh-context` registers `promptPrefix` / `promptSuffix` sections whose order values **collide exactly** with this plugin's (`-2000` and `11200`).

- **Nothing breaks**: sorting is `order - order || compareNames(name)`, so a shared order is not a shared name. `"dsh-context:prompt-prefix" < "language-guard:head"` (`d` < `l`), so dsh-context's two sections stably sort before this plugin's.
- **But it burns tokens twice**: both are writing a language constraint into the same place — the same idea, twice.
- **Recommendation**: after installing this plugin, clear `dsh-context`'s `promptPrefix` / `promptSuffix`, or disable `dsh-context` outright.

A permanent hint sits at the bottom of the settings card, and `meta.description` in both `locale/{zh,en}.json` carries the same sentence. This plugin **does not detect or rewrite** `dsh-context`'s configuration — writing another plugin's config violates least surprise.

## How it differs from the official cot-translation plugin

`@deepseek-ai/dsh-experimental-client-ui-cot-translation` (together with `cot-translation-bundle`) is an official experimental plugin that does **rendering-layer translation**: it machine-translates the expanded reasoning shown in the UI into another language. Its own README states that translation sends the displayed reasoning to the selected external service, which may include private code or conversation details, and that the original reasoning remains in the session and model context.

This plugin does **generation-layer constraint**: it tells the model, in the system prompt, to think and answer in the language you chose.

| | cot-translation | dsh-language-guard |
| --- | --- | --- |
| Acts on | reasoning text already rendered in the UI | the model's next generation |
| Layer | Client rendering (`conversation.chat.reasoning.body` slot) | Host system prompt (`ctx.systemPrompt.section()`) |
| Network | yes, sends text to an external translation service | no, zero network requests |
| Reads conversation content | yes, ships the reasoning body out | no, only writes its own constraint sections |
| Language of the original reasoning | unchanged (still in the session and context) | the language you configured |

The two are **complementary, not competing**: one decides what language the model thinks in, the other decides what language that thinking is displayed in. They can be installed together — but if this plugin already pins thinking to Simplified Chinese, pointing cot-translation at Simplified Chinese adds nothing; its useful setting is the opposite direction (model thinks in Chinese, you read it in English).

## Known limitations

- **The constraint wording is fixed Simplified Chinese.** Only the language name and code are substituted, so with `targetLanguage: "en"` the injected text reads "…一律使用English（语言代码 en）". Models handle this fine, but the prose is not localized. Localizing the templates is a future change.
- **The Periodic reminder is visible in the chat UI**, collapsed into one line reading "上下文注入 · language-guard · 语言自检". The English identifier `language-guard` **cannot be hidden** — the client renders `source.kind` verbatim as the injection label, exactly as it does for the official `agent-instructions` and `skill-invocation`. Localizing it would require a custom `conversation.chat.node` renderer for the context node; the first release does not do that.
- **The Client half has no turn counter**, so the panel cannot show "the next injection lands on turn X".
- **The quick switch menu lists five presets plus one "Custom" entry.** Custom BCP-47 tags must be typed into the settings field; in Manual mode with a value outside the presets, the menu gains a checked "Custom: <language>" entry so that six unchecked rows no longer look like "nothing was ever set". The menu cannot enumerate arbitrary tags — switching to another custom value still goes through the settings field.
- **Absolute locking, no per-turn escape hatch.** A deliberate trade-off: the plugin is "set once, applies throughout", so a turn-level instruction such as "answer in English *this once*" does **not** switch it away — change the setting or use `/language` instead. That is the opposite stance from "switch per turn"; if you need per-turn switching, this plugin is the wrong tool.
- **It cannot detect whether `dsh-context` is installed**, so the hint is permanent (see above).
- **Periodic never wakes an idle session.** `agent/pre-step` only fires while a turn is running, so no message means no reminder — a language guard should not generate conversation on its own.
- **The `mid` position could be squeezed by future plugins.** If another plugin inserts a section between order `5000` and `9000`, the "after the tool docs" semantics get diluted. The fix then is to raise `mid` to `8900` (still before deliverable references at `9000`); failing that, fall back to Basic, which does not depend on `mid`.
- **It cannot tell Simplified from Traditional Chinese.** DSH ships exactly two built-in interface languages, `zh` and `en` (`dsh-client-locale/lib/index.js:11`, `LOCALE_IDS = ["zh", "en"]`), and `zh` does not distinguish the two scripts — while the Host side cannot see the system language. So when the interface language is Chinese, auto mode always resolves to `zh-CN`. Users who need Traditional output should switch the language mode to Manual and pick `zh-TW`. The same holds for Japanese and Korean: on a standard install auto mode can only resolve to `zh-CN` or `en`, so pick 日本語 / 한국어 manually — if you installed the matching external language pack, its tag is passed through as-is.
- **It does not cover the API `tools` parameter itself.** The real tool schema sent to the model lives in the request's `tools` parameter, not in the system prompt; this plugin only asks the model, on the prompt side, to write the `description` parameter in the target language. It cannot rewrite the English wording in the schema. If the model does not comply, tool card titles stay English — an inherent limit of a prompt-level constraint, not a configuration problem.
- **It does not follow the operating-system language.** The plugin reads the interface language you selected in DSH settings, not the OS language. DSH's Host process runs with `ELECTRON_RUN_AS_NODE=1`, so Electron's `app.getLocale()` is out of reach; Node's `Intl` in that process always reports `en-US`, which would misclassify Chinese users as English — so we chose not to use it.
- **Auto mode follows the interface language, not the language you type in.** With a Simplified Chinese UI, asking in English still gets a Simplified Chinese constraint — that is the design: the plugin declares a default language, it does not guess from a single turn. Switch to Manual if you want it to track your input.
- **Switching level changes the system prompt**, so DSH appends a new system node (an in-history replacement). That is a one-off token cost and expected behaviour.

## Design boundaries

This plugin deliberately does **not** do the following — each would either break host conventions or make debugging impossible:

- It does not listen to `system-prompt/assemble` to add or remove host text; it only declares its own sections through `ctx.systemPrompt.section()`.
- It does not rewrite `llm/stream` reasoning deltas — it never fabricates "thinking".
- It does not touch decision fields other than `messages` in `agent/pre-step`, and it appends no new event types; the Periodic path returns `{ ...decision, messages }`, preserving `startsRequestSeries` and the rest.
- It makes no network requests, reads no conversation content, reports nothing.
- `dependencies` is empty; the Client half only `require('react')` from the host module table.
- The constraint text is stable within a session, avoiding frequent in-history replacement and prompt-cache invalidation.

## License

[MIT](LICENSE) © 58fly

Repository: <https://github.com/58fly/dsh-language-guard> · Issues: <https://github.com/58fly/dsh-language-guard/issues>
