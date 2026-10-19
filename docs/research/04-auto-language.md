# 调研：自动识别语言环境的信号来源与 BCP-47 映射规则

对应 wayfinder 票 #13。结论全部来自源码取证（`app.asar` 内）与本机实测，不含推测。

- DSH 运行时版本：`0.2.1-rc.2`（`dsh-client-locale` 0.2.1-rc.2，`schemastery` 3.18.5）
- 源码读取：`python3 /Volumes/data/dsh-cn-think/asar_tool.py cat <asar内路径>`
- 实测环境：macOS，系统语言 `zh-Hans-CN`，Electron 44.7.0

---

## 0. 结论速查

| 问题 | 结论 |
|---|---|
| Host 能不能读界面语言 | **能**，走 `ctx.settings.describe()` 找 `ns === "locale"` 的 `value.preference`（路径 A）。无任何权限限制，官方主进程自己也这么做 |
| 跨插件读别人命名空间会被拦吗 | **不会**。`SettingsForms#describe()` 不检查调用者身份，遍历所有 `state === 2` 且有 volatile 字段的 entry |
| `preference` 缺失时 `value` 长什么样 | `value` 是 `{}`（空对象，不是 `undefined` 也不是 `null`），`value.preference === undefined` |
| 路径 C（OS 语言）能用吗 | **不能**。Host 进程 `LANG=C.UTF-8` → `Intl.DateTimeFormat().resolvedOptions().locale === "en-US"`，与系统语言 `zh-Hans-CN` 完全脱节 |
| Host 侧存在可靠的系统语言信号吗 | **没有**。四条路全断：`Intl`/`LANG` 恒 `en-US`；`require("electron")` → `MODULE_NOT_FOUND`；`process.binding("electron_common_app")` → `No such module`；`dsh-desktop-host` 不 import electron 也不暴露 locale 能力。**结论：不要硬编假信号** |
| Host 能调 `app.getPreferredSystemLanguages()` 吗 | **不能**。Host 是 `ELECTRON_RUN_AS_NODE=1` 的子进程（`process.type === undefined`），Electron 的 app 模块整个不存在 |
| 路径 B 写盘代价 | 每次 `form.set()` = 读 96 KB / 36 个文件 + 改 YAML AST + 原子写 `cordis.patch.yml` + 文件锁 + reconcile；频率等于用户切语言次数，与官方 `setLocale` 同量级 |
| `describe()` 能每 step 调吗 | **不能**。实测单次 ≈ 0.79 ms（仅读盘）+ 1.17 ms（schema 投影），必须缓存 + 事件驱动 |
| `zh` 映射成什么 | **`zh-CN`**，依据是官方两处先例都把 `zh*` 映射成 `zh-CN`；繁体细分靠 Client 侧系统语言列表二次判定 |
| 与 6 字段怎么共存 | 定案**方案甲**：新增 `languageMode: 'auto' \| 'manual'`，`targetLanguage` 仅在 manual 生效 |
| 方案乙为什么不选 | 实测 `targetLanguage: "auto"` 被现有正则拒绝：`$.targetLanguage expect string to match regexp /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/` |
| 解析结果变化要重启吗 | 不要。Host 侧缓存 + 监听 `settings/document-updated`，section `text()` 每次 assemble 重新求值 |
| `describe()` 什么时候调 | **只在 `languageMode !== 'manual'` 时**，且只在 apply 与 `settings/document-updated` 时调，绝不进 `text()` |
| 检测不到语言时兜底用什么 | `targetLanguage` 配置值（默认 `zh-CN`）。**不编造假信号** |

---

## 0.1 captain 裁决（2026-10-19，优先于本文其余章节）

本文是完整调研，包含若干**在 0.2.0 不实现**的规格。实现时以本节为准：

| 本文原结论 | 0.2.0 裁决 | 理由 |
|---|---|---|
| §8.3 / §9.1 H1：新增 `languageMode` + `detectedLanguage`，字段 6 → 8 | **只加 `languageMode`，字段 6 → 7；`detectedLanguage` 不实现** | 路径 B 被砍（见下），该字段失去存在理由，留着就是半成品字段 |
| §3 / §6.2 / §9.2 C3：路径 B（Client 回写 `detectedLanguage`） | **完全不实现** | ① 每次写都改用户手写的 `cordis.patch.yml`（`dsh-config-editor/lib/index.js:69-135`：文件锁 + 读 96 KB/36 文件 + YAML AST 改写 + 原子写 + reconcile）；② 多端共享同一 `$DSH_HOME` 会互相覆盖；③ 检测值伪装成用户偏好 |
| §7.3：`zh` 要看 `osLanguages` 首项判断简繁 → `zh-TW` / `zh-CN`；§9.1 H5/H6 要求 `mapUiLocale(uiLocale, osLanguages)` 与 `normalizeOsTag` 全表 12 行 | **判定为「未实现的规格」**。0.2.0 的映射只有 4 条：`zh`→`zh-CN`、`en`→`en`、其他合法 BCP-47 外部语言包 id 原样透传、缺失/空/非法→`targetLanguage`（默认 `zh-CN`） | `osLanguages` 只能从 Client 侧 `globalThis.__DSH_LOCALE__?.read()` / `navigator.languages` 拿，Host 侧拿不到；路径 B 又被砍，繁简细分在 Host 上**无处落地**。禁止实现一个「Host 拿不到输入」的映射表 |
| §8.3 迁移规则「`targetLanguage` 非默认 → 按 manual」 | **保留，但 `languageMode` 的 schema 默认值必须改成空串 `''`** | 若默认 `'auto'`，schema 会抹掉「用户没设过」这个信息，老用户手选的 `targetLanguage` 会被静默覆盖 |
| §7.5 来源文案 3 行（界面语言 / 系统语言 / 兜底） | **只剩 2 行**（界面语言 / 配置兜底） | 系统语言信号不存在 |
| §9.2 C7 新增 7 个 i18n 键（含 `mode.source.client`） | **6 个** | `mode.source.client` 服务路径 B，随路径 B 一起砍 |

**繁体怎么办**：写成已知限制 —— 「DSH 内置界面语言只有 `zh` / `en`，`zh` 不区分简繁；界面语言为「中文」时自动模式一律解析为 `zh-CN`。需要繁体输出的用户请切到「手动」并选 `zh-TW`。」

---

## 1. 问题与已定案前提

用户已澄清定案三点：

1. **识别信号**：界面语言为主，系统语言兜底。
2. **自动决定的对象**：只自动选**目标语言**，不自动选三档强度。
3. **自动与手动的关系**：自动 / 手动两态，**默认自动**。

技术难点在于：本插件的三段 system prompt 由 **Host** 生成，而「界面语言」这个概念在 DSH 里是 **Client 侧**的值（`ctx.locale.getSnapshot().active`）。

---

## 2. 路径 A：Host 读 `settings.describe()` 的 locale 命名空间

### 2.1 源码事实

**locale 的 Config 声明**（`/dsh/node_modules/@deepseek-ai/dsh-client-locale/lib/index.js:13-18`）：

```js
const LocaleSettingsFields = { [LOCALE_PREFERENCE_FIELD]: z.string().pattern(LOCALE_ID_PATTERN).required(false) };
const Config = z.object({ [LOCALE_PREFERENCE_FIELD]: LocaleSettingsFields[LOCALE_PREFERENCE_FIELD].volatile() });
```

其中 `:5 const LOCALE_SETTINGS_NAMESPACE = "locale"`、`:7 const LOCALE_PREFERENCE_FIELD = "preference"`、`:9 LOCALE_ID_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u`。

**`settings` 是 Host 服务**（`/dsh/node_modules/@deepseek-ai/dsh-settings/lib/index.js:322-330`）：

```js
var SettingsForms = class extends Service {
  static inject = ["configEditor", "profileContext"];
  constructor(ownerContext) { super(ownerContext, "settings"); ... }
```

→ 任何 Host 插件 `ctx.inject(["settings"])` 即可拿到，**没有 ACL、没有 scope 校验、没有调用者白名单**。

**`describe()` 的收录规则**（`dsh-settings/lib/index.js:413-452`）：

```js
describe(options) {
  const descriptors = this.ownerContext.configEditor.configuration().flatMap(({ entry, inherited, override }) => {
    const schema = this.schema(entry);
    if (schema === void 0 || entry.fiber === void 0 || entry.fiber.runtime === null || entry.fiber.state !== 2) return [];
    const form = volatileForm(schema);
    if (form === void 0) return [];
    ...
    return [{ autoGenerate, ns: entry.options.id, schema: form.toJSON(), revision, applies: "live", value, base, user }];
  });
  return descriptors;
}
```

关键：
- `:417` 只要求 entry **处于激活态**（`fiber.state === 2`），**不检查调用者是谁**。
- `:418-419` 只要求**有 volatile 字段**（`volatileForm`，`:122-131`）。
- `:443` `ns: entry.options.id` —— 即 patch 里的 `id`，本机是 `locale`。
- `:436` `value = projectForm(form, plainConfig(entry.fiber.config))`。

`projectForm`（`:141-147`）按 schema 声明的字段投影，**缺失字段直接不进 value**：

```js
function projectForm(schema, value) {
  if (schema.type === "object" && value !== null && typeof value === "object" && !isExpression(value))
    return Object.fromEntries(Object.entries(schema.dict ?? {}).flatMap(([key, child]) => {
      const field = Reflect.get(value, key);
      return field === void 0 ? [] : [[key, projectForm(child, field)]];
    }));
  return value;
}
```

`configure({ auto: false })` 只影响**是否自动生成设置页**（`:426` `autoGenerate`），**不影响 describe 收录** —— locale 的 Host 半身 `:22-26` 正是 `configure({ auto: false })`，而它依然会被 describe 返回。

### 2.2 官方先例：主进程自己就是这么读的

`/lib/main.js:8927-8931`：

```js
const localePreference = (namespaces) => {
  const locale = namespaces.find((item) => record$3(item) && item.ns === "locale");
  if (!record$3(locale) || !record$3(locale.value) || locale.value.preference !== void 0 && typeof locale.value.preference !== "string") throw new Error("desktop welcome: invalid locale preference");
  return locale.value.preference ?? null;
};
```

`/lib/main.js:8989-8997`：

```js
async readLocalePreference() {
  const settings = await invoke({ namespace: "settings", method: "describe", args: {} });
  if (!record$3(settings) || !Array.isArray(settings.namespaces)) throw new Error("desktop welcome: missing settings namespaces");
  return localePreference(settings.namespaces);
}
```

→ **「按 `ns === "locale"` 找行、取 `value.preference`、缺失时用 `?? null`」就是官方的标准读法**。这直接证明路径 A 合规、被官方采纳。

### 2.3 实测：value 的形状

用 asar 里**真实的** `@deepseek-ai/schemastery@3.18.5`（`/dsh/node_modules/@deepseek-ai/schemastery/lib/index.mjs`）与 `@deepseek-ai/cosmokit`，逐行照抄 `dsh-settings` 的 `volatileForm` / `projectForm` / `plainConfig` / `plainSchema`（`lib/index.js:97-147`）复现 describe 的投影：

| 配置里的 preference | describe 返回行 | `value.preference` | 按官方 `?? null` |
|---|---|---|---|
| **未设置**（用户从未选过语言） | `{"ns":"locale","value":{}}` | `undefined` | `null` |
| `"zh"` | `{"ns":"locale","value":{"preference":"zh"}}` | `"zh"` | `"zh"` |
| `"en"` | `{"ns":"locale","value":{"preference":"en"}}` | `"en"` | `"en"` |
| `"ja"`（外部语言包） | `{"ns":"locale","value":{"preference":"ja"}}` | `"ja"` | `"ja"` |
| `"zh-CN"`（用户手填地区标签） | `{"ns":"locale","value":{"preference":"zh-CN"}}` | `"zh-CN"` | `"zh-CN"` |

`volatileForm(LocaleConfig)` 实测**返回非 undefined**（form schema 里 `preference` 的 `meta.required: false`），所以 locale 一定被 describe 收录。

**本机现状**：`~/.dsh/profiles/desktop/cordis.patch.yml` 首条就是

```yaml
- id: locale
  name: "@deepseek-ai/dsh-client-locale"
  config:
    preference: zh
```

→ 本机路径 A 能直接读到 `"zh"`。

### 2.4 路径 A 的两个硬限制

**限制 1：`preference` 缺失时读不到任何东西。**

`preference` 缺失意味着用户从未在 UI 里点过语言选择器。此时 Client 的 `active` 是 `provisional`（浏览器派生值）：

`dsh-client-locale/lib/client.js:1343-1346`：

```js
resolveActive() {
  if (this.preference === void 0) return this.provisional;
  return this.catalog.get(localeKey(this.preference))?.id ?? this.provisional;
}
```

`provisional` 来自 `detectBrowserLocale`（`:1476-1489`）：遍历 `navigator.languages`，先精确匹配 locale id，再按主语言子标签匹配。**这个值 Host 侧完全不可见。**

**限制 2：`describe()` 开销不能忽略。**

`describe()` 每次都走 `configEditor.configuration()` → `loadProfileDirectory()`（`/dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:1015-1051`），而后者**全部是同步 `readFileSync`**（`readProfileManifest` `:905-909`、`loadOverlayPatches` `:3961-3968`）。

本机实测（`/tmp/measure-describe.mjs`，模拟同一读盘集合，50 次平均）：

```json
{ "bundles": 22, "filesRead": 36, "patchFiles": 17, "totalBytes": 96378, "avgMsPerDescribeRead": 0.793 }
```

加上 schema 投影（`/tmp/bench-form.mjs`，20 个 entry × 12 字段，200 次平均）：

```json
{ "schemas": 20, "fieldsPerSchema": 12, "avgMsPerDescribeSchemaPass": 1.173 }
```

→ 单次 `describe()` 约 **2–5 ms**（读盘 + schema，不含 YAML parse）。而 `assemble()` 是**每 step 一次**（`dsh-agent-loop/lib/index.js:907`）。**绝不能把 `describe()` 放进 section 的 `text()` 函数里每步调用**，必须缓存。

### 2.5 路径 A 能否感知变化：`settings/document-updated`

`/dsh/node_modules/@deepseek-ai/dsh-tool-cordis/lib/types/api-catalog.js:4395-4402`：

```
name: 'settings/document-updated',
mode: 'emit',
signature: '\'settings/document-updated\'(ns: SettingsNamespace, revision: number): void',
summary: 'One profile entry\'s form values, availability, or page policy changed.',
description: '... Form clients re-read its schema, resolved values, and revision.'
```

emit 点：`dsh-settings/lib/index.js:435`（raw 或 autoGenerate 变化）与 `:461`（entry 消失）。这是 Host 侧事件，Host 插件可直接 `ctx.on("settings/document-updated", (ns) => { if (ns === "locale") refresh(); })`。

**注意**：`:435` 的 emit 条件是比较 `raw`（`JSON.stringify([uid, schema.toJSON(), config])`）与 `autoGenerate`。locale preference 变化必然改变 `raw`，所以一定会触发。但 `:435` 在 `describe()` 内部 —— **只有有人调 describe 才会 emit**。Client 侧写盘后会通过 RPC 触发一次 describe（`dsh-api-settings-controller`），所以链路成立。

---

## 3. 路径 B：Client 把 `active` 写回本插件 config

### 3.1 机制

新增 volatile 字段 `detectedLanguage`，Client 在挂载时与 `locale/change` 时 `form.set('detectedLanguage', active)`。

Client 侧 `ConfigForm.set`（`/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings/lib/client.js:1140-1146`）：

```js
set(field, value) { return this.mutate([{ op: "set", path: [field], value }]); }
```

`mutate`（`:1165-1182`）走 `this.ctx.remote.settings.mutate(namespace, ops, revision)` —— **跨网络 RPC 到 Host settings 服务**。

### 3.2 写盘代价（这是路径 B 的关键风险）

Host 侧落到 `dsh-settings/lib/index.js:470-473 update()` → `:501-537 write()` → `configEditor.edit(entry, change)`。

`/dsh/node_modules/@deepseek-ai/dsh-config-editor/lib/index.js:69-135`：

```js
async edit(entry, change) {
  const run = async () => {
    const path = this.documentPath;                                  // :71
    await withFileLock(join(this.ownerContext.profileContext.dir, "package.json"), async () => {   // :72
      ...
      await reconcileProfilePatches(this.ownerContext.root, beforePatches, "dsh");                 // :75
      ...
      const before = await readFile(path, "utf8");                   // :86
      const document = parseDocument(before, {...});                 // :91
      ...
      document.setIn([index, "config"], document.createNode(next));   // :110
      await writeFileAtomic(path, String(document), { mode: 384 });   // :123
      await reconcileProfilePatches(this.ownerContext.root, patches, "dsh", [entry.options.id]);   // :125
    });
  };
  const hmr = this.ownerContext.get("hmr");
  await (hmr === void 0 ? run() : hmr.runExclusive(run));             // :133-134
}
```

`:24-26` 明确 `documentPath` = `profileContext.patchPath`，即 **`~/.dsh/profiles/desktop/cordis.patch.yml` 本身**。

→ **每次 `form.set()` 都是一次完整的「文件锁 → 读 96 KB → 改 YAML AST → 原子写盘 → reconcile」往返，并且改的是用户手写的配置文件。**

### 3.3 但写盘频率不是问题

官方 locale 插件自己就在写同一个文件：`dsh-client-locale/lib/client.js:1278-1284`

```js
setLocale(id) {
  ...
  this.preference = match.id;
  if (this.snapshot.active !== match.id) this.publish(match.id, true);
  this.host?.set(LOCALE_PREFERENCE_FIELD, match.id);   // 写盘
}
```

且注释 `:1269-1275` 明说「即使 id 已与生效 locale 相同也会持久化」。→ **「用户切语言时写一次 `cordis.patch.yml`」是官方既有行为，路径 B 不引入新的副作用类别。**

前提是：**值不变就不写**。Client 侧必须在写之前比对：

```js
const prev = configForms.get(SELF_NS)?.getSnapshot()?.value?.detectedLanguage;
if (active !== prev) form.set('detectedLanguage', active);
```

不比对的话，`locale/change` + 挂载 + revision 变化会重复写盘。

### 3.4 路径 B 的唯一优势

能拿到**真正生效的** `active`，覆盖路径 A 拿不到的两类情况：
1. `preference` 从未设置（走浏览器派生 `provisional`）；
2. `preference` 指向一个未注册的外部语言包 id（`resolveActive` 回落到 `provisional`，见 `:1343-1346`）。

### 3.5 检测值写进持久配置的代价：为什么默认不做

把「检测结果」写进 `cordis.patch.yml`，等价于把**一次环境观测**变成**用户的持久偏好**。三个后果：

1. **检测值会伪装成用户意图。** 用户从没选过 `ja`，但因为某天界面语言是 `ja`，配置文件里就永久留下 `detectedLanguage: ja`。之后即使界面切回中文，只要 `preference` 缺失，判定链就会读到这条陈旧值。
2. **多端共享同一个 home 会互相覆盖。** `cordis.patch.yml` 是**按 profile 而非按会话/按设备**的：Desktop 与 Web、两台机器共用 `~/.dsh` 时写的是同一份文件。A 端界面语言 `zh`、B 端 `en`，两端会反复把对方的值覆盖掉，且每次覆盖都是一次完整写盘（§3.2）。
3. **写盘链路本身有成本与失败面。** 文件锁 + 读 96 KB / 36 文件 + YAML AST 改写 + 原子写 + reconcile，任一步失败都要回滚（`dsh-config-editor/lib/index.js:127`）。

**有没有「不落盘」的 Client → Host 通道？** 查过，都不合适：

- **session command**（官方唯一承认的 Client-callable Host entry point，`references/user-actions.md`：「The UI action calls it through a Client-callable Host entry point found with inspection, such as a session command that `ctx.remote.commands.execute()` runs」）：`ctx.remote.commands.execute(sessionId, line, attachments)` 会 **durably log `command/run` / `command/done`，并在每个标签页渲染成 persistent flow node**（`/dsh/node_modules/@deepseek-ai/dsh-client-ui-commands/lib/client.js:1706-1725` 注释原文：「the host executor durably logged the lifecycle (`command/run`/`command/done`) and the outcome renders as a persistent flow node」）。用命令传一个高频的环境观测，会把用户的时间线塞满命令记录 —— **不可接受**。
- **自定义 RPC**：官方文档没有把「插件自建 Client↔Host RPC」列为支持路径（`user-actions.md` 只承认 session command 与 agent tool 两种入口）。依赖它等于赌内部实现。

**定案：路径 B 保留为可选增强，但默认不启用**，且启用时必须满足三条：
1. 只在 `active !== prev` 时写；
2. UI 明确标注该值是**检测值**（`自动（跟随界面）`），不参与 manual 态；
3. 文档写明多端共享 home 时会互相覆盖。

**更好的替代（推荐给实现工程师）**：既然路径 A 在本机已能拿到 `zh`，**先只做 A**。把 B 作为后续 issue，等真的出现「`preference` 从未设置」的用户反馈再补。

---

## 4. 路径 C：纯 OS 语言

### 4.1 Host 进程的真实环境

Host 后端由主进程 spawn（`/lib/main.js:3791-3811`）：

```js
const entry = join(this.runtimeDir, "node_modules", "@deepseek-ai", "dsh-desktop-host", "lib", "index.js");
const child = spawn(this.node, ["--expose-internals", ..., entry, ...], {
  cwd: this.projectDir,
  env: desktopNodeEnvironment(this.node, void 0, this.environment),   // :3804
  stdio: ["ignore", "pipe", "pipe", "ipc"]
});
```

`desktopNodeEnvironment`（`/lib/main.js:3649-3658`）：

```js
function desktopNodeEnvironment(executable, bin, environment) {
  return {
    ...environment,
    ELECTRON_RUN_AS_NODE: "1",
    ...bin === void 0 ? {} : { DSH_DESKTOP_NODE_EXECUTABLE: executable, PATH: `${bin}${delimiter}${environment.PATH ?? ""}` }
  };
}
```

→ Host 是 **`ELECTRON_RUN_AS_NODE=1` 的 Electron 子进程**，环境变量原样继承主进程。

### 4.2 实测：`Intl` 与系统语言完全脱节

| 场景 | 命令 | `Intl.DateTimeFormat().resolvedOptions().locale` |
|---|---|---|
| 本机 Host 进程环境（`LANG=C.UTF-8`） | `node -e '...'` | **`en-US`** |
| 剥掉 LANG/LC_ALL | `env -u LANG -u LC_ALL -u LC_MESSAGES -u LANGUAGE node -e '...'` | `en-US` |
| **Electron 44.7.0 as node**（与 Host 同运行时） | `ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" -e '...'` | **`en-US`** |
| 同上但 `LANG=zh_CN.UTF-8` | 加 `LANG=zh_CN.UTF-8 LC_ALL=zh_CN.UTF-8` | `zh-CN` |
| 同上但 `LANG=ja_JP.UTF-8` | — | `ja-JP` |

**而 macOS 的真实系统语言是 `zh-Hans-CN`**：

| 探测方式 | 结果 |
|---|---|
| `defaults read -g AppleLanguages` | `("zh-Hans-CN")` |
| `defaults read -g AppleLocale` | `zh_CN` |
| `osascript -l JavaScript` 读 `NSLocale.currentLocale.localeIdentifier` | `zh_CN`（lang=zh、region=CN） |
| **Swift Foundation（Electron 同源）** | `Locale.preferredLanguages = ["zh-Hans-CN"]`；`Locale.current.identifier = zh_CN`；`current.language.maximalIdentifier = zh-Hans-CN` |

→ **`Intl` 只看 `LANG` 环境变量，完全不看 NSLocale。Host 进程 `LANG=C.UTF-8` → 永远 `en-US`，即使系统语言是中文。**

### 4.3 Host 也调不到 Electron API

**先确认 Host 到底在不在 Electron 进程里**：在。进程树（由 captain 用 `ps` 实测；本会话沙箱禁止执行 `ps`，报 `bash: /bin/ps: Operation not permitted`，故引用其观测）：

```
42989  /Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness              ← Electron 主进程
43665  └─ 同上二进制 --expose-internals .../dsh-desktop-host/lib/index.js .../profiles/desktop   ← 我们的 Host
42992  Helper --type=utility --lang=en-US
43003  Helper (Renderer) --lang=en-US
```

**但「在 Electron 二进制里」不等于「能用 Electron API」**。实测（本机，与 Host 完全同一启动方式）：

```
$ ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" -e '...'
{
  "versions_electron": "44.7.0",          ← 确实是 Electron 二进制
  "process_type": "(undefined)",           ← 既不是 main 也不是 renderer，是纯 Node 模式
  "electronRunAsNode": "1",
  "LANG": "C.UTF-8",
  "require_electron": "FAIL: Cannot find module 'electron'",
  "resolved": "FAIL: MODULE_NOT_FOUND"
}
```

进一步用内部 binding 探测（Host 启动时带 `--expose-internals`，所以这个探测在 Host 里同样成立）：

```
electron_common_app        → FAIL: No such module: electron_common_app
electron_common_app_bundle → FAIL: No such module: electron_common_app_bundle
electron_browser_app       → FAIL: No such module: electron_browser_app
electron_common_v8_util    → OK        ← 只有通用 v8 工具，与 app/locale 无关
```

→ **`ELECTRON_RUN_AS_NODE=1` 下 Electron 的 app 模块整个不注册**，`app.getLocale()` / `app.getPreferredSystemLanguages()` 完全不可达。

**再看 asar 内部有没有别的入口**：全库 grep `from "electron"` / `require("electron")` / `app.getLocale`，命中只有：

```
/lib/main.js                  ← 主进程
/lib/preload-app.cjs          ← preload
/lib/preload-mandatory.cjs
/lib/preload-platform-account.cjs
/node_modules/electron-updater/*   ← 第三方
```

**没有任何 `dsh/*` 包引用 electron**，`dsh-desktop-host/lib/index.js` 也不 import 它、不暴露任何 locale 能力（captain 已 grep `locale`/`Locale`/`app.getLocale` 零命中，本节复核一致）。

**Host 也没有 IPC 通道**：主进程只把 `systemLanguages` 塞进 `localeBootstrap` 给 **renderer**（`/lib/main.js:12499-12506`），Host 与主进程之间只有 `dsh-desktop-host` 自己的控制协议（`/lib/main.js:3818-3837` 处理 `ready`/`shutdown`/`fatal`），没有语言查询。

### 4.4 结论：Host 侧没有可靠的系统语言信号

四条路逐一实测，全部不可用：

| 候选 | 实测结果 | 判定 |
|---|---|---|
| `Intl.DateTimeFormat().resolvedOptions().locale` | `en-US`（系统语言实为 `zh-Hans-CN`） | ❌ 会把中文用户误判成英文，**比没有更糟** |
| `process.env.LANG` / `LC_ALL` | `LANG=C.UTF-8`、`LC_ALL` 未设 | ❌ 同上 |
| `require("electron")` → `app.getLocale()` | `MODULE_NOT_FOUND`；内部 binding `No such module` | ❌ 不可达 |
| `defaults read -g AppleLocale`（spawn 子进程） | 能拿到 `zh_CN`，但 macOS 专属、需 spawn（Host 是 Electron 沙箱子进程，`ps` 类系统调用可能被拒）、Windows/Linux 无此命令 | ❌ 跨平台不可用，不值得为兜底引入平台分支 |
| `dsh-desktop-host` 自带能力 | 不 import electron，不暴露 locale | ❌ 不存在 |

→ **结论：Host 侧没有可靠的系统语言信号。不要硬编一个假信号。** 兜底应退化为配置值 `targetLanguage`（默认 `zh-CN`），而不是猜一个 `en-US`。

---

## 5. 三条路径对比

| 维度 | A：`settings.describe()` 读 locale ns | B：Client 回写 `detectedLanguage` | C：OS 语言 |
|---|---|---|---|
| **Host 能否拿到** | ✅ 能（`ctx.inject(["settings"])`） | ✅ 能（读自己 config） | ❌ 不能（`Intl` 恒为 `en-US`） |
| **是否反映界面语言** | 部分：只反映**用户显式选过**的值 | ✅ 完全：就是 `getSnapshot().active` | ❌ 完全不反映 |
| **`preference` 缺失时** | 读不到（`value === {}`） | ✅ 仍能拿到浏览器派生值 | ❌ 永远 `en-US` |
| **外部语言包** | ✅ 若 preference 指向它 | ✅ 一定拿到 | ❌ |
| **写盘** | ❌ 不写 | ✅ 每次变化写一次 `cordis.patch.yml` | ❌ 不写 |
| **单次开销** | ≈ 2–5 ms（必须缓存） | 读自己的 volatile 引用，≈ 0 | ≈ 0 |
| **感知变化** | `settings/document-updated`（`api-catalog.js:4396`） | 自己的 config volatile 引用 | 无（进程环境不变） |
| **权限/合规** | ✅ 官方主进程同款做法（`main.js:8927`） | ✅ 与官方 `setLocale` 同量级写盘 | ✅ 但无用 |
| **代码量** | 中（缓存 + 事件订阅 + 缺省处理） | 中（Client 比对 + 写回 + 首次挂载时序） | 低 |
| **失败模式** | 用户没选过语言 → 拿不到 | 时序：Client 未挂载时 Host 已有值？ | 语言永远错 |

---

## 6. 推荐方案：A 为主、B 为补、C 弃用

### 6.1 判定链（Host 侧）

```
1. settings.describe() 里 ns === "locale" 的 value.preference
   ├─ 存在且非空 → 作为「界面语言」
   └─ 缺失 → 进入 2

2. 本插件 config 的 detectedLanguage（Client 回写的 active）
   —— 可选增强，默认不启用（理由见 §3.5）；未启用时直接跳到 3
   ├─ 存在且非空 → 作为「界面语言」
   └─ 缺失 → 进入 3

3. targetLanguage 配置值（默认 "zh-CN" = DEFAULT_LANGUAGE）
   —— 不编造假信号，不猜 en-US
```

**第 3 步为什么是 `targetLanguage` 而不是硬编码常量**：`languageMode` 的迁移规则（§8.3）会把「用户手选过非默认 `targetLanguage`」判为 `manual`，所以在正常的 auto 态下 `targetLanguage` 就是默认值 `zh-CN` —— 两步等价。但保留「读配置值」这一步让迁移规则与兜底链自洽：万一日后放开限制，兜底也会尊重用户既有设定，而不是悄悄改回默认。

**为什么 A 在 B 之前**：A 零写盘、零时序依赖、官方同款；B 只在 A 无解时补位。

**为什么 B 不是主路径**：B 依赖 Client 已挂载并完成首次写回。冷启动时 Host 可能先于 Client 求值 section（`assemble` 在 preStep 里，Client 可能还没连上），此时只能退回 A 或配置值。把 A 放前面可以让「用户显式选过语言」这个最常见情况在冷启动就正确。

### 6.2 Client 侧回写规则（路径 B 的可选实现，默认不启用）

```js
// client.js，在 locale 服务可用后
const SELF_NS = 'language-guard';            // 本插件的 config entry id
const sync = () => {
  const active = locale.getSnapshot().active;               // 最终生效语言
  const form = configForms.get(SELF_NS);
  if (!form) return;
  const prev = form.getSnapshot()?.value?.detectedLanguage;
  if (active === prev) return;                              // 值不变就不写盘
  form.set('detectedLanguage', active);
};
ctx.effect(() => locale.subscribe(sync), 'language-guard: detected language sync');
sync();                                                      // 挂载时先同步一次
```

要点：
1. **只在 `active !== prev` 时写**。否则 `locale.subscribe` 会在词典注册（revision 变化）时也触发，导致无谓写盘。
2. **用 `locale.subscribe` 而不是 `ctx.on("locale/change")`**。`locale/change` 只在 active 真变时发（`dsh-client-locale/lib/client.js:1449`），但首次挂载时如果 active 已等于默认值就不会发事件；`subscribe` 覆盖得更全。
3. **`detectedLanguage` 必须是 volatile**，否则 `form.set` 抛 `Config field "detectedLanguage" is not volatile`（`dsh-settings/lib/index.js:507`）。
4. **写的是本插件自己的 ns**，不是 locale 的 ns —— 不能去改别人的配置。

### 6.3 Host 侧缓存与刷新

```js
// lib/index.js
let cachedUiLocale = null;   // 模块级或 apply 内闭包

const readLocalePreference = () => {
  try {
    const rows = ctx.settings.describe();                    // 同步，≈2–5 ms
    const row = rows.find((r) => r.ns === 'locale');
    const pref = row?.value?.preference;
    return typeof pref === 'string' && pref ? pref : null;
  } catch { return null; }
};

// manual 态完全不碰 describe：直接返回 null，解析链落到 targetLanguage
const shouldAutoDetect = () => readField(config, 'languageMode') !== 'manual';

const refreshUiLocale = () => {
  if (!shouldAutoDetect()) { cachedUiLocale = null; return; }
  cachedUiLocale = readLocalePreference() ?? readField(config, 'detectedLanguage') ?? null;
};

ctx.inject(['settings'], (child) => {
  refreshUiLocale();                                          // 首次读（仅 auto）
  child.effect(() => child.on('settings/document-updated', (ns) => {
    if (ns === 'locale' || ns === 'language-guard') refreshUiLocale();
  }), 'language-guard: ui locale cache');
});
```

要点：
1. **`describe()` 只在 apply 时和事件触发时调**，不进 `text()`。
2. 事件监听要同时覆盖 `locale`（preference 变化）与本插件 ns（`detectedLanguage` 变化）。
3. `settings` 用懒注入 —— 与现有 `ctx.inject(["settings"], ...)` 一致，缺 settings 的部署仍能工作，只是 auto 退化为常量兜底。
4. **只在 `languageMode !== 'manual'` 时调 `describe()`** —— manual 态用户已明确指定语言，读 describe 纯属浪费（每次 ≈2–5 ms，且要遍历全部 entry 做 `schema.toJSON()` + `JSON.stringify`）。从 manual 切回 auto 时由 `settings/document-updated`（ns = `language-guard`）触发一次刷新，无需额外轮询。
5. **重复调 `describe()` 不会引发事件风暴**：`dsh-settings/lib/index.js` 里 `emit("settings/document-updated", ...)` 受 `previous?.raw !== raw || previous.autoGenerate !== autoGenerate` 保护，而 `raw = JSON.stringify([fiber.uid, schema.toJSON(), entry.options.config ?? {}])` 是稳定值 —— 正常重复调用不 emit，不会自触发死循环。

### 6.4 为什么不需要重启

- section 的 `text()` 是函数，`assemble()` 每 step 求值一次（`dsh-system-prompt/lib/index.js:388`）。
- `cachedUiLocale` 是闭包变量，`refreshUiLocale()` 一改，下一次 `text()` 立刻读到新值。
- 三段 section 的 `interpolate: false` 保持不变（文本由我们自己的 `text()` 拼装）。

→ **解析结果变化后，下一个 step 的 system prompt 就是新语言，无需重启、无需重新注册 section。**

---

## 7. 界面语言 → BCP-47 映射规则

### 7.1 核心矛盾

`dsh-client-locale` 的内置语言只有两个（`lib/index.js:11` 与 `lib/client.js:922`）：

```js
const LOCALE_IDS = ["zh", "en"];
```

**`zh` 不区分简繁。** 而本插件的 `targetLanguage` 是 BCP-47，需要 `zh-CN` / `zh-TW` 级别的区分（简体与繁体的用词差异很大，`zh` 单独存在时模型可能给出繁体输出）。

### 7.2 官方两处先例都把 `zh*` 映射成 `zh-CN`

**先例 1**（`dsh-client-locale/lib/client.js:1174`，写 `<html lang>`）：

```js
const language = snapshot.active === "zh" ? "zh-CN" : snapshot.active;
```

**先例 2**（`/lib/main.js:7608-7616`，主进程选词典）：

```js
function resolveDesktopLocale(locale) {
  return locale.toLowerCase().startsWith("zh") ? { id: "zh-CN", messages: zh } : { id: "en", messages: en };
}
```

→ 官方对 `zh` 的既定语义就是**简体中文**。

### 7.3 映射规则表

设 `uiLocale` 为 §6.1 判定链得出的界面语言 id，`osLanguages` 为 Client 侧从 `globalThis.__DSH_LOCALE__?.read()` 拿到的系统语言有序列表（仅 Desktop 有；Web 为 `navigator.languages`）。

| 输入 | 输出 `targetLanguage` | 判定依据 |
|---|---|---|
| `zh`（内置，最常见） | 看 `osLanguages`：首项匹配 `zh-Hant` / `zh-TW` / `zh-HK` / `zh-MO` → **`zh-TW`**；否则 → **`zh-CN`** | 官方把 `zh` 定为 `zh-CN`（`client.js:1174`、`main.js:7608`）；繁体细分只能靠系统语言二次判定 |
| `en`（内置） | **`en`** | `dsh-client-locale/lib/client.js:1135 FALLBACK_LOCALE = "en"`，且正则接受裸 `en` |
| `ja` / `ko` / 其他**外部语言包 id** | **原样透传**（`ja` → `ja`） | `addLanguage` 要求 id 是 BCP-47 风格（`client.js:1297-1320`），本身就是合法 targetLanguage |
| OS 标签 `zh-Hans-CN` | **`zh-CN`** | 保留 script=Hans、丢弃 region（`targetLanguage` 只影响模型用哪种语言思考，不需要地区变体） |
| OS 标签 `zh-Hant-TW` | **`zh-TW`** | 保留 script=Hant，映射到 BCP-47 的繁体常用标签 |
| OS 标签 `zh-Hans-HK` | **`zh-CN`** | script 优先于 region：`Hans` 一律简体 |
| OS 标签 `ja-JP` | **`ja`** | 丢 region，保留主语言 |
| OS 标签 `en-US` / `en-GB` | **`en`** | 同上；`en` 已是插件预设 |
| OS 标签 `ko-KR` | **`ko`** | 同上 |
| OS 标签 `fr-FR` | **`fr`** | 同上 |
| 无法识别 / 空 | **`zh-CN`** | = `DEFAULT_LANGUAGE`（`lib/state.js:25`），与 0.1.0 行为一致 |

**归一化规则（`normalizeOsTag`）**：

```
0. 先把下划线换成连字符：tag.replace(/_/g, '-')
   —— 系统侧两种格式都会出现：AppleLocale 给 "zh_CN"，AppleLanguages 给 "zh-Hans-CN"
1. 取主语言 primary = tag.split('-')[0].toLowerCase()
2. 若 primary === 'zh'：
     script = 标签里形如 4 字母的段（Hans / Hant），大小写不敏感
     若 script === 'hant' → 'zh-TW'
     若 script === 'hans' → 'zh-CN'
     否则若 region ∈ {TW, HK, MO} → 'zh-TW'
     否则 → 'zh-CN'
3. 否则 → primary（丢弃所有子标签）
```

**下划线格式的实测来源**（§4.2 表）：

| 探测方式 | 原始值 | 归一化后 | 结果 |
|---|---|---|---|
| `defaults read -g AppleLocale` | `zh_CN` | `zh-CN` | `zh-CN` |
| `defaults read -g AppleLanguages` | `zh-Hans-CN` | 不变 | `zh-CN` |
| Swift `Locale.current.identifier` | `zh_CN` | `zh-CN` | `zh-CN` |
| Swift `Locale.preferredLanguages[0]` | `zh-Hans-CN` | 不变 | `zh-CN` |

→ **两种格式都归一到同一个结果**，这保证了「不管走哪条系统探测路，映射结果一致」。

**不做的事**：不把 `en-US` 原样透传成 `targetLanguage`。理由：`targetLanguage` 的语义是「让模型用哪种语言思考」，地区变体对思考语言没有意义，反而让设置卡片里出现一堆 `en-US`/`en-GB` 噪声。

### 7.4 兜底顺序（完整）

```
targetLanguage（auto 态下的解析结果）
  = map(uiLocale, osLanguages)

uiLocale =
  1. settings.describe() → ns==="locale" → value.preference（存在且非空）
  2. 本插件 config → detectedLanguage（Client 回写的 active；可选增强，默认不启用）
  3. targetLanguage 配置值（默认 "zh-CN"）—— 不编造假信号

osLanguages =
  1. globalThis.__DSH_LOCALE__?.read() → languages   （Desktop，来自 app.getPreferredSystemLanguages()，main.js:12077）
  2. navigator.languages                              （Web）
  3. []                                               （都拿不到 → 映射规则里 osLanguages 为空 → zh 走 zh-CN 分支）
```

> **注意 `osLanguages` 与路径 C 的区别**：`osLanguages` 只用于**细分 `zh` 的简繁**（`zh` → `zh-CN` 还是 `zh-TW`），且只在 **Client** 侧取（Desktop 经 `__DSH_LOCALE__` IPC 从主进程拿真实系统语言，Web 用 `navigator.languages`）。它**不是** Host 侧的兜底信号 —— Host 侧根本没有可靠系统语言（§4.4）。这条分工是本节与 §4 结论能同时成立的关键。

### 7.5 用户可解释性：把「为什么是这个语言」显示出来

设置卡片与侧栏菜单在 auto 态下必须显示**来源**，不能只显示结果：

| 来源 | 文案（zh） | 文案（en） |
|---|---|---|
| 界面语言 | 跟随界面语言（`{preference}`） | Following UI language (`{preference}`) |
| Client 回写 | 跟随当前界面（`{detected}`） | Following current interface (`{detected}`) |
| 配置兜底 | 未能识别，使用当前设定 `{fallback}` | Not detected, using configured `{fallback}` |

---

## 8. 与现有 6 个字段的关系

### 8.1 现有 6 字段（`/Volumes/data/dsh-cn-think/lib/index.js:182-226`）

```js
export const Config = z.object({
  targetLanguage: z.string().default('zh-CN').pattern(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/).volatile(),
  strength: z.union([z.const('B'), z.const('C'), z.const('D')]).default('C').volatile(),
  injectEveryNRounds: z.number().min(3).max(50).step(1).default(8).volatile(),
  preserveCodeTerms: z.boolean().default(true).volatile(),
  extraRules: z.string().default('').volatile(),
  overrideHead: z.string().default('').volatile(),
});
```

### 8.2 三方案对比

| 方案 | 实现 | 优点 | 缺点 | 结论 |
|---|---|---|---|---|
| **甲** `languageMode: 'auto' \| 'manual'` | 新增枚举字段；`targetLanguage` 仅 manual 生效 | 语义清晰；`targetLanguage` 的 BCP-47 契约完全不动；已装用户配置零迁移 | 多一个字段 | ✅ **定案** |
| **乙** `targetLanguage` 允许 `'auto'` | 放宽正则 | 少一个字段 | **实测破坏现有校验**：`"auto"` → `REJECT: $.targetLanguage expect string to match regexp /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/`；且 Client 侧 `client.js:32` 有同款正则，`/language` 命令、chips 高亮、`resolveLanguage` 全部要改；已装用户若手填过 `auto` 会被静默当成语言标签 | ❌ 否 |
| **丙** `autoDetect: boolean` | 布尔开关与 `targetLanguage` 并列 | 少一个枚举值 | 「两个布尔/两个值同时为真」的语义歧义（auto=true 时 targetLanguage 是什么？）；无法表达「未来第三种模式」；UI 上要解释两个控件的联动 | ❌ 否 |

### 8.3 方案甲的具体改动

```js
// lib/index.js，Config 新增一个字段（放在 targetLanguage 之前）
languageMode: z
  .union([z.const('auto'), z.const('manual')])
  .default('auto')
  .description('语言模式。auto=自动跟随界面语言（默认）；manual=固定使用 targetLanguage。')
  .volatile(),

detectedLanguage: z
  .string()
  .default('')
  .description('内部字段：Client 回写的当前界面语言。仅 languageMode=auto 且读不到 locale.preference 时使用。')
  .volatile(),
```

字段总数从 6 变 8。**既有 6 个字段的名字、类型、默认值、语义一律不动**，已装用户的 `cordis.patch.yml` 无需迁移（新字段走 default）。

`lib/state.js` 的 `resolveLanguage(configured)` 需要扩展成：

```js
export function resolveLanguage(configured, { mode, autoValue } = {}) {
  if (languageOverride) return languageOverride;           // /language 命令优先级最高（不变）
  if (mode === 'manual') {                                  // manual 走原逻辑
    const raw = typeof configured === 'string' ? configured.trim() : '';
    return raw || DEFAULT_LANGUAGE;
  }
  return autoValue || DEFAULT_LANGUAGE;                     // auto 走解析结果
}
```

**`/language` 命令的语义**：命令是「临时覆盖」，优先级最高，两种模式下都生效。执行 `/language` 时自动切到 manual（否则用户会疑惑为什么下一轮又变回去）—— 这一点要在命令实现里明确。

### 8.4 auto 态下的 UI 规格（不能「点了没反应」）

**侧栏快速切换菜单**（`client.js:779-825` 现有实现）：

```
┌──────────────────────────────┐
│ 目标语言                      │
│ 当前：自动（简体中文）          │   ← 必须显示解析结果
├──────────────────────────────┤
│ ✓ 自动（跟随界面）             │   ← 第 1 项，默认选中
│   简体中文                    │
│   繁體中文                    │
│   English                    │
│   ……                          │
├──────────────────────────────┤
│ 其他语言可在 设置 → 插件 →     │
│ 语言守卫 中填写。              │
└──────────────────────────────┘
```

- 菜单第 1 项固定是「自动（跟随界面）」，`aria-checked` 反映 `languageMode === 'auto'`。
- 菜单头部的「当前：」在 auto 态显示 `自动（{解析结果 label}）`，**不能只写「自动」**。
- 选中任一具体语言 → `form.set('languageMode', 'manual')` + `form.set('targetLanguage', code)`，**两次写要在同一个 `mutate` 批次里**（`ConfigForm.mutate` 支持 ops 数组，`dsh-client-ui-settings/lib/client.js:1165`），避免中途 revision 变化导致半截状态。

**设置卡片**（`client.js:610-648` 现有实现）：

```
┌─ 语言模式 ────────────────────────────┐
│  ● 自动（跟随界面语言）                 │
│    当前解析：简体中文（zh-CN）           │
│    来源：界面语言 preference=zh         │  ← 必须显示来源
│  ○ 手动                               │
│    [ 目标语言输入框 ]  [简体][繁體][EN] │  ← manual 才可编辑
└───────────────────────────────────────┘
```

- auto 态下 `targetLanguage` 输入框与 chips 全部 `disabled`，但**显示解析结果**（不是清空）。
- 「来源」一行用 §7.5 的文案表，让人知道是「界面语言」还是「默认兜底」。

---

## 9. 实现清单（给实现工程师）

### 9.1 Host 侧（`lib/index.js`、`lib/state.js`）

| # | 改动 | 位置 | 验收 |
|---|---|---|---|
| H1 | Config 新增 `languageMode`（默认 `'auto'`）与 `detectedLanguage`（默认 `''`），均 `.volatile()` | `lib/index.js:182` 前 | `volatileForm` 返回 8 个字段 |
| H2 | 新增 `readLocalePreference()`：`ctx.settings.describe()` 找 `ns==='locale'`，取 `value.preference`，非字符串/空串返回 `null`，异常吞掉返回 `null` | `lib/index.js` | 无 settings 时不抛 |
| H3 | 新增 `cachedUiLocale` + `refreshUiLocale()`：`readLocalePreference() ?? readField(config,'detectedLanguage') ?? null`；**入口先判 `shouldAutoDetect()`（`languageMode !== 'manual'`），manual 态直接置 `null` 并返回** | `lib/index.js` | manual 态不调用 `describe()` |
| H4 | `ctx.inject(['settings'], child => { refreshUiLocale(); child.effect(() => child.on('settings/document-updated', ns => {...})) })` | `lib/index.js` | 不新增根 `inject` 依赖 |
| H5 | 新增 `mapUiLocale(uiLocale, osLanguages)` 实现 §7.3 映射表 | `lib/state.js` | 覆盖表里 12 行 |
| H6 | 新增 `normalizeOsTag(tag)` 实现 §7.3 归一化 | `lib/state.js` | `zh-Hant-TW`→`zh-TW`、`en-US`→`en` |
| H7 | `resolveLanguage` 增加 `{mode, autoValue}` 参数，`/language` 覆盖仍最优先 | `lib/state.js:52` | 旧调用行为不变 |
| H8 | 三段 `text()` 改为 `text: () => headText({ language: effectiveLanguage(), ... })`，`effectiveLanguage()` = `resolveLanguage(targetLanguage, {mode: languageMode(), autoValue: mapUiLocale(cachedUiLocale, osLanguages)})` | `lib/index.js` | 换语言后下一 step 生效 |
| H9 | **不得**监听 `system-prompt/assemble`（现有 C4 门禁继续为空） | — | grep 为空 |

**`osLanguages` 在 Host 侧拿不到**，只有 Client 有。所以 H8 里的 `osLanguages` 只能来自 Client 一并回写（`detectedLanguage` 存的是 active，不含 osLanguages）。

**简化方案（推荐）**：把繁简判定也交给 Client —— Client 回写的不是 `active`，而是**已经映射好的 BCP-47 标签**。这样 Host 侧只需要：

```js
autoValue = cachedUiLocale ? mapUiLocale(cachedUiLocale, []) : null
```

即 Host 侧映射表退化为「只处理内置 `zh`/`en` 与外部包 id」，繁简细分由 Client 完成（Client 能读 `__DSH_LOCALE__` 与 `navigator.languages`）。

→ **定案：`detectedLanguage` 存的是 Client 已经映射好的 `targetLanguage` 值**（如 `zh-TW`），不是原始 `active`。Host 侧 `mapUiLocale` 只需处理 `preference` 这一条来源。

### 9.2 Client 侧（`client.js`）

| # | 改动 | 验收 |
|---|---|---|
| C1 | `ctx.inject(['locale'])` 拿 `locale` 服务（`dsh-client-locale/lib/client.js:1526` `ctx.provide("locale", locale)`） | — |
| C2 | 新增 `mapActiveToTargetLanguage(active)`：内置 `zh` → 看系统语言判简繁；`en` → `en`；其他 → 原样 | 覆盖 §7.3 |
| C3 | `locale.subscribe(sync)` + 挂载时 `sync()`；`sync()` 内比对 `prev !== next` 才 `form.set('detectedLanguage', next)`。**可选增强，默认不启用**（§3.5：检测值会变持久值、多端会互相覆盖） | 值不变不写盘 |
| C4 | 侧栏菜单第 1 项「自动（跟随界面）」，头部显示解析结果 | §8.4 |
| C5 | 设置卡片新增「语言模式」单选组；auto 态禁用 `targetLanguage` 输入框但显示解析结果与来源 | §8.4 |
| C6 | 切换语言时 `mutate([{op:'set',path:['languageMode'],value:'manual'},{op:'set',path:['targetLanguage'],value:code}])` 单批 | 无半截状态 |
| C7 | 新增 i18n 键（中英双份）：`mode.title` / `mode.auto` / `mode.manual` / `mode.current` / `mode.source.ui` / `mode.source.client` / `mode.source.fallback` | `locale/{zh,en}.json` 对齐 |

### 9.3 兼容性检查

| 检查项 | 期望 |
|---|---|
| 已装用户的 `cordis.patch.yml` 只有旧 6 字段 | 新字段走 default，`languageMode` 变 `auto` —— **注意：这是行为变化**，老用户升级后如果 preference 是 `zh`，`targetLanguage` 仍是 `zh-CN`，无感 |
| 老用户显式设过 `targetLanguage: 'ja'` | 升级后 `languageMode` 默认 `auto`，会**覆盖**他的手选 `ja` → **必须迁移**：若 `targetLanguage` 存在且 ≠ `'zh-CN'`，把 `languageMode` 的 default 改成 `'manual'` |
| `/language` 命令 | 优先级不变，且执行时切 manual |
| 三档强度 | 完全不受影响（auto 只选语言） |

**迁移规则（关键）**：`languageMode` 的 default 不能无脑设 `'auto'`。实现时应在 `apply()` 里做一次性判定：

```js
const rawTarget = readField(config, 'targetLanguage');
const rawMode = readField(config, 'languageMode');
// languageMode 未显式设置（= default）且用户改过 targetLanguage → 视为 manual
if (rawMode === undefined || rawMode === 'auto') {
  if (typeof rawTarget === 'string' && rawTarget && rawTarget !== 'zh-CN') return 'manual';
}
```

或更简单：把 `languageMode` 的 schema default 设为 `'auto'`，但在 `apply()` 里检测「`targetLanguage` 非默认且 `languageMode` 是 default 值」时按 manual 处理，并在设置卡片上提示「检测到你设过固定语言，已切到手动」。

---

## 10. 风险清单

| # | 风险 | 严重度 | 缓解 |
|---|---|---|---|
| R1 | `describe()` 放进 `text()` 会每 step 读 96 KB 盘 | **blocker** | 缓存 + `settings/document-updated`（§6.3） |
| R2 | `preference` 缺失时路径 A 无解 | high | 退化为 `targetLanguage` 配置值（默认 `zh-CN`）；路径 B 可选补位（§6.2） |
| R3 | Client 回写污染 `cordis.patch.yml` | medium | 值不变不写；写的是本插件自己的 ns；与官方 `setLocale` 同量级（§3.3） |
| R4 | 冷启动时 Client 未挂载，`detectedLanguage` 为空 | medium | 判定链把 A 放前面；空则退化为配置值 |
| R5 | `languageMode` 默认 `auto` 覆盖老用户手选的 `targetLanguage` | **high** | §9.3 迁移规则 |
| R6 | `settings` 服务缺失（headless 部署） | low | 懒注入；`readLocalePreference` 异常吞掉返回 `null` |
| R7 | locale 插件未激活（`fiber.state !== 2`）时 describe 不返回它 | low | 视为「读不到」，退化为配置值 |
| R8 | 繁体细分需要 Client 侧系统语言，Web 模式只能靠 `navigator.languages` | low | 已覆盖；退化到 `zh-CN` |
| R9 | `settings/document-updated` 只在有人调 `describe()` 时才 emit（`dsh-settings/lib/index.js:435`） | medium | 写盘链路本身会触发 describe（`write()` 末尾 `:536 this.describe()`），链路成立；若仍担心，可在 `agent/pre-step` 里低频兜底刷新（如每 10 轮） |
| R10 | 检测值变成持久值：用户没选过 `ja`，配置里却留下 `detectedLanguage: ja`，日后 `preference` 缺失时被当成偏好 | **high** | 默认不启用路径 B（§3.5）；启用则 UI 必须标为「检测值」且不参与 manual |
| R11 | 多端共享同一 `~/.dsh` 时互相覆盖：A 端 `zh`、B 端 `en` 会反复覆写同一份 `cordis.patch.yml`，每次都是完整写盘 | **high** | 同上：默认不启用；若启用需在文档写明该限制 |
| R12 | 想用 `Intl` / `LANG` 做系统语言兜底 → 中文用户被误判成 `en-US` | **blocker（若采用）** | 明确禁止（§4.4）；Host 侧不编造假信号 |
| R13 | `describe()` 在 manual 态被无谓调用（每次 2–5 ms 且遍历全部 entry） | medium | `shouldAutoDetect()` 门控：`languageMode === 'manual'` 时直接返回 `null`（§6.3 要点 4） |

---

## 11. 证据索引

| 结论 | 文件 | 行 |
|---|---|---|
| locale 命名空间与字段常量 | `/dsh/node_modules/@deepseek-ai/dsh-client-locale/lib/index.js` | 5、7、9、11、13、18 |
| locale Host 侧 `configure({auto:false})` | 同上 | 22-26 |
| `settings` 是 Host Service | `/dsh/node_modules/@deepseek-ai/dsh-settings/lib/index.js` | 322-330 |
| `describe()` 收录规则 | 同上 | 413-452（`417` 激活判定、`418-419` volatile 判定、`443` ns） |
| `volatileForm` | 同上 | 122-131 |
| `projectForm` | 同上 | 141-147 |
| `plainConfig` / `plainSchema` | 同上 | 97-117 |
| `write()` 的 volatile 校验与写盘 | 同上 | 501-537 |
| `settings/document-updated` emit | 同上 | 435、461 |
| 事件签名 | `/dsh/node_modules/@deepseek-ai/dsh-tool-cordis/lib/types/api-catalog.js` | 4395-4402 |
| configEditor 写 `cordis.patch.yml` | `/dsh/node_modules/@deepseek-ai/dsh-config-editor/lib/index.js` | 24-26、69-135 |
| `loadProfileDirectory` 同步读盘 | `/dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js` | 1015-1051、905-909、3961-3968 |
| Client `ConfigForm.set` / `mutate` | `/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings/lib/client.js` | 1140-1146、1165-1182 |
| `LOCALE_IDS` | `dsh-client-locale/lib/client.js` | 922 |
| `FALLBACK_LOCALE = "en"` | 同上 | 1135 |
| `BUILT_IN_LOCALE_METADATA` | 同上 | 1141-1147 |
| `<html lang>` 里 `zh` → `zh-CN` | 同上 | 1174 |
| `resolveActive()` | 同上 | 1343-1346 |
| `setLocale()` 写盘 | 同上 | 1278-1284 |
| `addLanguage()` | 同上 | 1297-1320 |
| `locale/change` 只在 active 变时发 | 同上 | 1443-1455 |
| `detectBrowserLocale` | 同上 | 1476-1489 |
| `ctx.provide("locale", locale)` | 同上 | 1526 |
| `__DSH_LOCALE__` bridge | `/lib/preload-app.cjs` | 877-882 |
| `app.getPreferredSystemLanguages()` | `/lib/main.js` | 12077 |
| `resolveDesktopLocale`（`zh*` → `zh-CN`） | 同上 | 7608-7616 |
| `resolveDesktopStartupLocale` | 同上 | 7623-7631 |
| 官方跨插件读 locale ns | 同上 | 8927-8931、8989-8997 |
| `localeBootstrap` IPC | 同上 | 12499-12506 |
| Host 是 `ELECTRON_RUN_AS_NODE` 子进程 | 同上 | 3791-3811、3649-3658 |
| `require("electron")` 在 as-node 下失败（实测） | 本机实测，见 §4.3 输出 | — |
| Electron app binding 在 as-node 下不存在（实测） | 同上 | — |
| asar 内仅 main/preload/electron-updater 引用 electron | `/lib/main.js`、`/lib/preload-*.cjs`、`node_modules/electron-updater/*` | — |
| 官方 Client→Host 入口只承认 session command | `/dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/references/user-actions.md` | 「One operation, two callers」节 |
| 命令执行落 `command/run`/`command/done` 并渲染流程节点 | `/dsh/node_modules/@deepseek-ai/dsh-client-ui-commands/lib/client.js` | 1706-1725 |
| 现有 6 字段 | `/Volumes/data/dsh-cn-think/lib/index.js` | 182-226 |
| `DEFAULT_LANGUAGE` | `/Volumes/data/dsh-cn-think/lib/state.js` | 25 |
| `resolveLanguage` | 同上 | 52-56 |

### 复现命令

```bash
# 路径 A：用真 schemastery 复现 describe 投影（含方案乙的 auto 拒绝）
node /tmp/lgtest/test-describe.mjs

# describe 的读盘开销
node /tmp/measure-describe.mjs

# describe 的 schema 投影开销
node /tmp/lgtest/bench-form.mjs

# 路径 C：Electron 同运行时下的 Intl
ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
  -e 'console.log(Intl.DateTimeFormat().resolvedOptions().locale, process.env.LANG)'

# 路径 C 死路的决定性证据：app 模块与内部 binding 都不可达
ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" -e '
console.log("versions.electron =", process.versions.electron);
console.log("process.type =", process.type);
try { require("electron"); } catch (e) { console.log("require(electron) →", e.message.split("\n")[0]); }
for (const n of ["electron_common_app","electron_common_app_bundle","electron_browser_app","electron_common_v8_util"]) {
  try { process.binding(n); console.log(n, "→ OK"); } catch (e) { console.log(n, "→", e.message); }
}'

# asar 内谁引用 electron（应只有 main/preload/electron-updater）
python3 /Volumes/data/dsh-cn-think/asar_tool.py grep 'from "electron"|require\("electron"\)|app\.getLocale'

# 路径 C：系统语言真值（Electron 同源）
swift -module-cache-path /tmp/swiftcache /tmp/lang.swift
defaults read -g AppleLanguages
defaults read -g AppleLocale
```
