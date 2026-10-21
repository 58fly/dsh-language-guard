#!/usr/bin/env bash
# dsh-language-guard 验收自检脚本（对应 docs/验收清单.md 第五节的机械可判项）
#
# 用法：在包根目录执行
#   bash scripts/verify-checklist.sh; echo "exit=$?"
# 注意：不要用管道截取输出（`| tail` 会把退出码换成 tail 的），要看退出码就单独 echo $?。
#
# CI 模式：LG_CI=1 bash scripts/verify-checklist.sh
#   只降级两条与环境绑定的判据，其余照常跑：
#   - R16 加 --ignore-scripts，跳过 prepublishOnly 的 tag 校验（CI checkout 默认不拉 tag）
#   - R23 打印 SKIP，因为打包字节数随 npm 版本漂移，跨机器不可移植
#   两条都仍由本机发布流程（npm test）承担，所以 CI 绿不代表它们通过了。
#
# 退出码：
#   0  机械可判项全部通过
#   1  存在真实不通过项（必须修）
#   2  存在「尚未实现」项（lib/ 或 client.js 还没落盘，不是崩溃，也不是通过）
#
# 设计要点：
#   1. 入口文件路径不写死，从 package.json 的 exports["."] 读；读不到才回退 lib/index.js。
#   2. 每个依赖具体文件的条目先判文件是否存在；不存在输出 `TODO` 并计入 missing，
#      绝不让 grep 对缺失文件返回非 0 而被误判成 PASS，也不会让 node 抛栈崩掉整个脚本。
#   3. Host 侧判据扫整个 lib/ 目录（实现分散在 lib/index.js、lib/cycle.js 等），
#      只有 C1 / C9 这类「必须在入口文件里」的条目才锁定入口文件。
#   4. 工作区没有 node_modules（干净 checkout / CI）时，自动为 peer 依赖建临时 stub，
#      跑完由 trap 删除；已有真实依赖时一律不动。
#   5. 只覆盖机械可判项；B5、D9、D11、E4、F2 与全部 R 组（发布）仍需按表人工核对并留证。

set -u

pkg=package.json
pass=0
fail=0
missing=0
skipped=0
stub_dirs=""
# CI 模式：GitHub Actions 里 checkout 默认不拉 tag，npm 版本也可能与本机不同，
# 因此 R16 / R23 两条与环境绑定的判据要各自降级（详见下方 npm 产物判据段）。
ci_mode="${LG_CI:-0}"
# npm 相关判据（A7 / R1 / R2 / R16）的临时目录。
# 必须显式给 --cache：本机 ~/.npm 存在 root-owned 文件，不指定会 EPERM（npm error code EPERM /
# path ~/.npm/_cacache/tmp/...）。指定到临时目录后 npm pack / publish --dry-run 均可用。
npm_cache="${TMPDIR:-/tmp}/dsh-lg-npm-cache.$$"
pack_tmp="${TMPDIR:-/tmp}/dsh-lg-pack.$$"
m_tmp="${TMPDIR:-/tmp}/dsh-lg-mode.$$"

cleanup() {
  if [ -n "${stub_dirs}" ]; then
    for d in ${stub_dirs}; do rm -rf "$d"; done
    rmdir node_modules/@deepseek-ai 2>/dev/null || true
    rmdir node_modules 2>/dev/null || true
  fi
  rm -rf "${npm_cache}" "${pack_tmp}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# 只看「代码行」的匹配：排除整行注释（* / // / /* 开头），避免注释里写了自己该满足的约束造成假通过。
# hits <ERE> <路径...>：存在代码行命中返回 0
# hits_n <ERE> <路径...>：代码行命中次数（按出现次数计）
#
# 匹配逻辑放在 scripts/grepcode.mjs，不再用 grep 管道。原因：这套管道依赖三处实现相关的行为——
# `-r` 是否加 `file:line:` 前缀、`-o` 与 `-E` 的组合、ERE 里 `\*` / `\,` 这类未定义转义。
# 在 macOS（BSD grep）上 74 项全过，到 CI（GNU grep）上 C9 与 M12 各错一边，且本地无法复现。
# 改用 node 后两个平台执行同一份代码，本地验过的结果在 CI 必然一致。
script_dir=$(cd "$(dirname "$0")" && pwd)
grepcode="${script_dir}/grepcode.mjs"
hits() {
  node "$grepcode" "$@" >/dev/null 2>&1
}
hits_n() {
  node "$grepcode" --count "$@" 2>/dev/null | tr -d ' '
}

chk() { # chk <条目> <命令>；失败时把命令自身的诊断输出缩进打印（如 F18 的「实际 …」）
  local out
  if out=$(eval "$2" 2>&1); then
    echo "PASS $1"
    pass=$((pass + 1))
  else
    echo "FAIL $1"
    if [ -n "${out}" ]; then
      printf '%s\n' "${out}" | head -5 | sed 's/^/       /'
    else
      # 静默失败是排查盲区：退出码非 0 却没有任何输出时，连命令是哪一段都看不出来。
      # CI 上 C9 / M12 就是这样红的——日志只有一行 FAIL。这里补上命令首行（截断）。
      printf '%s\n' "       (退出码非 0 且无输出) 命令：$(printf '%s' "$2" | head -1 | cut -c1-120)"
    fi
    fail=$((fail + 1))
  fi
}

todo() { # todo <条目> <说明>
  echo "TODO $1 (尚未实现：$2)"
  missing=$((missing + 1))
}

note() { # note <条目> <说明>：本条在当前运行环境下不适用，跳过但不计入通过/未实现
  echo "SKIP $1 ($2)"
  skipped=$((skipped + 1))
}

if [ ! -f "$pkg" ]; then
  echo "FATAL 当前目录没有 $pkg，请在包根目录运行本脚本（pwd=$(pwd)）" >&2
  exit 1
fi

# ---- peer 依赖 stub（仅在缺失时创建，退出时删除） ---------------------------
make_schemastery_stub() {
  local dir="node_modules/@deepseek-ai/schemastery"
  [ -d "$dir" ] && return 0
  mkdir -p "$dir" || return 1
  printf '{"name":"@deepseek-ai/schemastery","version":"0.0.0-verify-stub","type":"module","main":"./index.mjs","exports":{".":"./index.mjs"}}\n' > "$dir/package.json"
  cat > "$dir/index.mjs" <<'STUB'
// 仅用于 import 语法检查的链式 stub：任何属性访问与方法调用都返回自身。
const chain = new Proxy(function () {}, {
  get(_t, prop) {
    if (prop === 'then') return undefined;
    return chain;
  },
  apply() {
    return chain;
  },
});
const z = {
  string: chain, number: chain, boolean: chain, object: chain, array: chain,
  union: chain, const: chain, literal: chain, enum: chain, any: chain, unknown: chain,
};
export default z;
STUB
  stub_dirs="${stub_dirs} ${dir}"
}

make_llm_stub() {
  local dir="node_modules/@deepseek-ai/dsh-llm"
  [ -d "$dir" ] && return 0
  mkdir -p "$dir" || return 1
  printf '{"name":"@deepseek-ai/dsh-llm","version":"0.0.0-verify-stub","type":"module","main":"./index.mjs","exports":{".":"./index.mjs"}}\n' > "$dir/package.json"
  cat > "$dir/index.mjs" <<'STUB'
// 仅用于 import 语法检查的 stub。
export function createUserMessage(input) {
  return { role: 'user', ...input };
}
export default { createUserMessage };
STUB
  stub_dirs="${stub_dirs} ${dir}"
}

stubbed=0
if [ ! -d node_modules/@deepseek-ai/schemastery ] || [ ! -d node_modules/@deepseek-ai/dsh-llm ]; then
  if make_schemastery_stub && make_llm_stub; then
    stubbed=1
  fi
fi

# ---- 入口与两半身的可用性探测 ----------------------------------------------
entry=$(node -e "const p=require('./${pkg}');const e=p.exports&&p.exports['.'];process.stdout.write(typeof e==='string'?e:'')" 2>/dev/null || true)
[ -n "${entry}" ] || entry=lib/index.js

host="${entry}"
hostdir=lib
host_ok=0
[ -f "${host}" ] && host_ok=1

client=client.js
client_ok=0
[ -f "${client}" ] && client_ok=1

run_host() { # 锁定入口文件
  if [ "${host_ok}" = 1 ]; then chk "$1" "$2"; else todo "$1" "缺少 Host 入口 ${host}"; fi
}

run_lib() { # 扫整个 lib/ 目录
  if [ "${host_ok}" = 1 ] && [ -d "${hostdir}" ]; then
    chk "$1" "$2"
  else
    todo "$1" "缺少 Host 入口 ${host} 或 ${hostdir}/ 目录"
  fi
}

run_client() {
  if [ "${client_ok}" = 1 ]; then chk "$1" "$2"; else todo "$1" "缺少 ${client}"; fi
}

run_both() {
  if [ "${host_ok}" = 1 ] && [ "${client_ok}" = 1 ]; then
    chk "$1" "$2"
  else
    todo "$1" "缺少 ${host} 或 ${client}"
  fi
}

echo "== 入口：${host}（来自 ${pkg} 的 exports[\".\"]）  client：${client} =="
if [ "${stubbed}" = 1 ]; then
  echo "NOTE 工作区缺 peer 依赖，已临时创建 stub（仅用于 import 语法检查，脚本退出时自动删除）"
fi

# ---- A. 包与 manifest -------------------------------------------------------
chk A1 "node -e \"const p=require('./${pkg}');process.exit(p.name==='dsh-language-guard'?0:1)\""

if [ "${host_ok}" = 1 ]; then
  chk A2 "node --input-type=module -e \"const fs=await import('node:fs');const p=JSON.parse(fs.readFileSync('${pkg}','utf8'));await import(p.exports['.'])\""
else
  todo A2 "${pkg} 的 exports[\".\"] = ${host}，文件不存在"
fi

chk A3 "test -f cordis.patch.yml && grep -q 'insert' cordis.patch.yml"
chk A4 "node -e \"process.exit(require('./${pkg}').dsh.manifestVersion===1?0:1)\""
chk A5 "node -e \"const p=require('./${pkg}');process.exit(p.engines&&typeof p.engines.dsh==='string'&&p.engines.dsh.length>0?0:1)\""

if [ "${client_ok}" = 1 ]; then
  chk A6 "test -f icon.svg && ls locale/*.json >/dev/null 2>&1 && test -f client.js && node -e \"const e=require('./${pkg}').exports;process.exit(e['./client']&&e['./locale/*.json']&&e['./icon']?0:1)\""
else
  todo A6 "缺少 ${client}（A6 要求 ./client 键指向存在的文件）"
fi

# A9：仓库里不得存在直接写 profile 目录的脚本（安装一律走 install_bundle / dsh plugin add）。
# 必须排除本脚本自身——它含这些字面量（用来搜别人），不排除就会命中自己造成自指假阳性。
chk A9 "! grep -rnE --exclude=verify-checklist.sh 'DSH_HOME|profiles/[A-Za-z0-9_-]*/cordis\\.patch|profiles/.*/node_modules' scripts lib client.js 2>/dev/null | grep -vE ':[0-9]+:[[:space:]]*(\\*|//|/\\*)' | grep -q ."
chk A8 "python3 -c \"import yaml,sys;d=yaml.safe_load(open('cordis.patch.yml'));r=d[0]['insert'];sys.exit(0 if len(r)==1 and r[0].get('id')=='dsh-language-guard' else 1)\""

# ---- B. locale 与 icon ------------------------------------------------------
chk B1 "node -e \"const m=require('./locale/en.json');process.exit(m.meta&&m.meta.title&&m.meta.description&&String(m.meta.title).length>=4&&String(m.meta.description).length>=4?0:1)\""
chk B2 "node -e \"const m=require('./locale/zh.json');process.exit(m.meta&&m.meta.title&&m.meta.description&&String(m.meta.title).length>=4&&String(m.meta.description).length>=4?0:1)\""
chk B3 "test \$(stat -f%z icon.svg 2>/dev/null || stat -c%s icon.svg) -le 262144"
chk B4 "grep -q '<svg' icon.svg"
# B6：图标来源/授权在 README 中说明（官方 host-plugin.md 要求「图标原创或授权可再分发」）。
chk B6 "grep -qiE 'icon|图标' README.md && grep -qiE 'icon|图标' README.zh.md && grep -qiE 'MIT|original|原创|own work|自绘' README.md && grep -qiE 'MIT|原创|自绘' README.zh.md"

# ---- C. Host 半侧 ----------------------------------------------------------
run_host C1 "node --input-type=module -e \"const m=await import('./${host}');process.exit('default' in m?1:0)\""
run_lib C2 "grep -rq 'ctx.effect' ${hostdir}"
run_lib C3 "grep -rq 'systemPrompt.section' ${hostdir}"
run_both C4 "! hits 'system-prompt/assemble' ${hostdir} ${client}"

# C5：D 档周期提醒走 agent/pre-step waterfall 改写 messages（官方允许，见 practices.md:16）。
# 允许出现，但四条硬约束缺一不可；同时仍禁止 append 新 type 的 session 事件。
run_lib C5 "hits 'agent/pre-step' ${hostdir} \
  && hits 'await next\\(\\)' ${hostdir} \
  && hits \"kind === 'reject'\" ${hostdir} \
  && hits '\\.\\.\\.decision' ${hostdir} \
  && hits 'step !== 1|step === 1' ${hostdir} \
  && hits 'turn % ' ${hostdir} \
  && ! hits 'session\\.append|appendPluginRecord' ${hostdir}"

run_lib C6 "grep -rq 'inject' ${hostdir}"

# C7：注册在插件根 ctx，payload 自带 agent，不持有 per-agent 状态（不需要 disposer 表）。
run_lib C7 "hits \"ctx\\.on\\(['\\\"]agent/pre-step['\\\"]\" ${hostdir} \
  && ! hits 'agent\\.ctx|new Map\\(|new WeakMap\\(' ${hostdir}"

run_lib C8 "! hits 'setInterval' ${hostdir} || hits 'clearInterval' ${hostdir}"

# C9：只数字段级调用（行首缩进 + `.volatile(),`），不把注释里的说明文字算进去。
# 两段都显式打印实际值：CI 上这条曾静默失败（无任何输出），排查时连是哪一段红的都看不出来。
run_host C9 "c=\$(hits_n '^[[:space:]]*\.volatile\(\),' ${host}); [ \"\$c\" -eq 7 ] || { echo \"volatile 字段级调用数=\$c（期望 7）\"; exit 1; }; python3 -c \"import yaml,sys;r=yaml.safe_load(open('cordis.patch.yml'))[0]['insert'][0];ok=set(r)=={'id','name'};print('insert 键=',sorted(r)) if not ok else None;sys.exit(0 if ok else 1)\""

run_lib C10 "! hits 'appendPluginRecord|session\.append' ${hostdir}"
run_both C11 "! hits 'querySelector|innerHTML' ${hostdir} ${client}"

# ---- D. Client 半侧 --------------------------------------------------------
# D1：三处联合断言。client.js 还没落盘时是「尚未实现」而不是缺陷，所以包一层判存在性。
if [ "${client_ok}" = 1 ]; then
  chk D1 "node -e \"const fs=require('fs'),p=require('./${pkg}'),c=p.dsh&&p.dsh.client,ok=!!c&&c.platform==='web'&&c.immediately===true&&Array.isArray(c.inject)&&c.inject.length>0&&!c.external&&!!p.exports['./client']&&fs.existsSync(p.exports['./client'])&&p.files.includes('client.js');process.exit(ok?0:1)\""
else
  todo D1 "缺少 ${client}（D1 要求 dsh.client + exports[\"./client\"] + files 三处齐备）"
fi
run_client D2 "grep -qE 'id: *[\"'\\'']dsh-language-guard[\"'\\'']' ${client}"

# D3：只禁周期性定时器；addEventListener 是 02-panel.md 明确要求的（点击外部关闭 / Escape），
# 改为断言「监听与移除成对」，既允许必需功能，又能抓「注册了不清理」的真实缺陷。
run_client D3 "[ \"\$(hits_n 'addEventListener' ${client})\" -eq \"\$(hits_n 'removeEventListener' ${client})\" ] && ! hits 'setInterval\(' ${client}"

run_client D4 "! grep -qE -e 'createRoot' -e 'document.body' ${client}"
run_both D5 "! hits '[Ii]frame' ${hostdir} ${client}"
run_both D6 "! hits 'dsh-client-ui-primitives' ${hostdir} ${client} ${pkg}"

# D7：白名单 = `--dsw-alias-*` + 官方真实存在的非 alias token（--dsw-focus-ring-color）。
run_client D7 "! (grep -vE '^[[:space:]]*(\*|//|/\*)' ${client} | grep -o -- '--dsw-[a-zA-Z0-9-]*' | grep -v '^--dsw-alias-' | grep -v '^--dsw-focus-ring-color\$' | grep -q .)"
run_client D8 "! (grep -vE '^[[:space:]]*(\*|//|/\*)' ${client} | grep -oE -e '#[0-9a-fA-F]{3,8}\b' -e 'rgba?\(' -e 'hsla?\(' | grep -q .)"
run_client D9 "grep -q 'locale.register' ${client}"

# D10：不调用 addLanguage；用 register 且 NS 严格为 languageGuard。
run_both D10 "! hits 'addLanguage' ${hostdir} ${client} \
  && grep -qE \"NS = 'languageGuard'|NS='languageGuard'\" ${client} \
  && grep -q 'locale.register(NS' ${client}"

run_client D13 "grep -q 'dsh-context' ${client} && grep -q 'dsh-context' locale/zh.json && grep -q 'dsh-context' locale/en.json"

# ---- E. 验证与证据（可机械复算部分） ----------------------------------------
# E1：JS 语法与 manifest 校验先于安装完成。node --check 在 type=module 的包里按 ESM 解析，
# 不需要 peer 依赖即可验语法，因此不受 A2/C1 的 stub 影响。
if [ "${host_ok}" = 1 ] && [ "${client_ok}" = 1 ]; then
  chk E1 "node --check ${host} && node --check ${client} && node -e \"JSON.parse(require('fs').readFileSync('${pkg}','utf8'))\" && python3 -c \"import yaml;yaml.safe_load(open('cordis.patch.yml'))\""
else
  todo E1 "缺少 ${host} 或 ${client}"
fi

# ---- F. 功能（可机械复算部分） ----------------------------------------------
# F18：四段文本字符数与 docs/decisions/01-mechanism.md 第 0 节表格一致。
# 该数字曾被算成 556（形参名传成 targetLanguage，⟨LANG⟩ 未替换）与估算值 200/350/110，故必须复算。
if [ -f lib/text.js ]; then
  chk F18 "node --input-type=module -e \"const m=await import('./lib/text.js');const h=m.headText({language:'zh-CN'}),d=m.midText({language:'zh-CN'}),t=m.tailText({language:'zh-CN'}),r=m.reminderText({language:'zh-CN'});const ok=h.length===883&&d.length===146&&t.length===139&&r.length===99&&h.length+t.length===1022&&h.length+d.length+t.length===1168;if(!ok)console.log('实际',h.length,d.length,t.length,r.length,'B='+(h.length+t.length),'C='+(h.length+d.length+t.length));process.exit(ok?0:1)\""
else
  todo F18 "缺少 lib/text.js"
fi

# F19：约束文本必须显式压过 AGENTS.md 一类语言约定。
# 背景：0.1.0 的首段只声明「优先于英文内容」，而用户全局 AGENTS.md 常写着「必须使用简体中文」，
# 模型据此改回中文，表现为「选了日语却没变化」。0.1.1 起首段必须点名 AGENTS.md。
if [ -f lib/text.js ]; then
  chk F19 "grep -q 'AGENTS.md' lib/text.js && grep -q 'AGENTS.md' README.md && grep -q 'AGENTS.md' README.zh.md && grep -q 'AGENTS.md' docs/decisions/01-mechanism.md"
else
  todo F19 "缺少 lib/text.js"
fi

# F3：三档为原生 radio group，三档说明并列常驻（非 select、非 tooltip）。
# 实现里用 LEVELS.map 生成三行，所以 `type: 'radio'` 只出现 1 处即正确——不能按「出现 3 次」判。
run_client F3 "grep -q \"type: 'radio'\" ${client} \
  && grep -q 'LEVELS = \[.B., .C., .D.\]' ${client} \
  && ! grep -q '<select' ${client} \
  && ! hits 'title=.*(基础|强化|周期)' ${client}"

# F4：三档 order 落点为 -2000 / 5100 / 11200，且不出现被推翻的 5000（会落到 tools:sdk 之前）。
run_lib F4 "hits 'order: -2000' ${hostdir} \
  && hits 'order: 5100' ${hostdir} \
  && hits 'order: 11200' ${hostdir} \
  && ! hits 'order: 5000' ${hostdir}"

# F5：D 档走 agent/pre-step 改写 decision.messages，不走 agent.inject（inject 进 inbox、不唤醒驱动器）。
run_lib F5 "hits 'agent/pre-step' ${hostdir} \
  && hits '\\.\\.\\.decision' ${hostdir} \
  && ! hits 'agent\\.inject' ${hostdir}"

# F6：快速语言切换落在侧栏底部 sidebar.footer.action（scope root，常驻），不是 composer.dock。
run_client F6 "grep -q \"inject('sidebar.footer.action'\" ${client} \
  && grep -q \"id: 'language-guard'\" ${client} \
  && grep -q 'order: 100' ${client}"

# F15：周期档 N 可配置（字段 injectEveryNRounds，3–50）且带 .volatile()，改后不重启即生效。
# 判据必须锁定到该字段本身：全局数 .volatile() 有 6 个，删掉任意一个都还有 5 个，会假通过。
chk F15 "node -e \"const fs=require('fs');let src='';for(const f of fs.readdirSync('lib'))if(f.endsWith('.js'))src+=fs.readFileSync('lib/'+f,'utf8');const i=src.indexOf('injectEveryNRounds: z');if(i<0)process.exit(1);const j=src.indexOf('preserveCodeTerms:',i);const seg=src.slice(i,j>i?j:i+400);process.exit(seg.includes('.volatile()')&&/min\\(\\s*\\d/.test(seg)&&/max\\(\\s*\\d/.test(seg)?0:1)\""

# ---- M. 自动语言模式（0.2.0，票 #14）----------------------------------------
# M1：Host 与 Client 两侧的映射表必须一致（Client 是独立 bundle，无法 import 包内文件，
#     只能镜像一份；镜像漂移是本功能最可能的静默失效点，所以必须机械比对）。
chk M1 "node -e \"const fs=require('fs');const L=fs.readFileSync('lib/language.js','utf8');const C=fs.readFileSync('client.js','utf8');const pat=/if \\(primary === 'zh'\\) return 'zh-CN';\\s*\\n\\s*if \\(primary === 'en'\\) return 'en';/;process.exit(pat.test(L)&&pat.test(C)?0:1)\""

# M2：三态迁移规则两侧一致（未设模式 + 非默认 targetLanguage → manual）。
chk M2 "node -e \"const fs=require('fs');const L=fs.readFileSync('lib/language.js','utf8');const C=fs.readFileSync('client.js','utf8');const pat=/return target === defaultLanguage \\? MODE_AUTO : MODE_MANUAL/;process.exit(pat.test(L)&&pat.test(C)?0:1)\""

# M3：Config 的 languageMode 默认值必须是空串（三态哨兵），不能是 'auto'。
# 写成 'auto' 就无法区分「显式自动」与「从没设置过」，老用户手选的语言会被静默覆盖。
# 判据体写成独立 .cjs（内联 -e 里的引号嵌套会被 bash 解析期吃掉，本脚本踩过这个坑）。
mkdir -p "${m_tmp}" 2>/dev/null || true
cat >"${m_tmp}/m3.cjs" <<'M3EOF'
const fs = require('fs');
const src = fs.readdirSync('lib').filter((f) => f.endsWith('.js'))
  .map((f) => fs.readFileSync('lib/' + f, 'utf8')).join('');
const i = src.indexOf('languageMode: z');
if (i < 0) { console.log('缺 languageMode 字段'); process.exit(1); }
const seg = src.slice(i, i + 400);
const hasEmpty = seg.includes(".default('')");
const hasVolatile = seg.includes('.volatile()');
if (!hasEmpty || !hasVolatile) console.log('default 空串:', hasEmpty, ' volatile:', hasVolatile);
process.exit(hasEmpty && hasVolatile ? 0 : 1);
M3EOF
chk M3 "node '${m_tmp}/m3.cjs'"

# M4：设置卡片必须有模式 radio group（自动/手动），且自动态禁用语言输入。
run_client M4 "grep -q \"name: 'language-guard-mode'\" \${client} \
  && grep -q \"name: 'language-guard-strength'\" \${client} \
  && hits 'disabled: readOnly \\|\\| auto' \${client}"

# M5：快速切换菜单必须含「自动」项（不能只列 5 个预设，否则自动模式在侧栏无处可切）。
run_client M5 "grep -q \"kind: 'auto'\" \${client} \
  && grep -q 'quick.menu.auto' \${client}"

# M6：section 的 text() 不得读盘。界面语言必须走 apply 期缓存 + 事件刷新，
# 不能在每次装配时调 settings.describe（单次约 2–5 ms，且要遍历全部 entry 做 schema 投影）。
chk M6 "node -e \"const fs=require('fs');const src=fs.readdirSync('lib').filter(f=>f.endsWith('.js')).map(f=>fs.readFileSync('lib/'+f,'utf8')).join('');const t=src.indexOf('ctx.systemPrompt.section');const seg=src.slice(t,t+2000);process.exit(/describe\\(/.test(seg)?1:0)\""

# M7：Host 必须在 settings 服务可用后刷新界面语言缓存，并订阅 document-updated。
run_lib M7 "hits 'settings/document-updated' \${hostdir} \
  && hits 'refreshPreference' \${hostdir}"

# M8：解析器单测必须存在且可跑（纯函数模块，不依赖 DSH 运行时）。
chk M8 "[ -f scripts/verify-language.mjs ] && node scripts/verify-language.mjs >/dev/null"

# M9：字典 zh / en 的键集合必须完全一致（漏一个键在英文界面就会显示 key 原文）。
mkdir -p "${m_tmp}" 2>/dev/null || true
cat >"${m_tmp}/m9.cjs" <<'M9EOF'
const fs = require('fs');
const src = fs.readFileSync('client.js', 'utf8');
const zh = src.slice(src.indexOf('const zh = {'), src.indexOf('const en = {'));
const en = src.slice(src.indexOf('const en = {'), src.indexOf('const CSS = `'));
const keys = (block) => [...block.matchAll(/^\s+'([^']+)':/gm)].map((m) => m[1]);
const zk = keys(zh); const ek = keys(en);
const onlyZh = zk.filter((k) => !ek.includes(k));
const onlyEn = ek.filter((k) => !zk.includes(k));
if (onlyZh.length || onlyEn.length) console.log('仅 zh:', onlyZh.join(',') || '(无)', ' 仅 en:', onlyEn.join(',') || '(无)');
process.exit(onlyZh.length || onlyEn.length ? 1 : 0);
M9EOF
chk M9 "node '${m_tmp}/m9.cjs'"

# M10：自动态必须在卡片里显示「当前解析成哪种语言」，且要区分来源。
#      0.1.0 的教训就是「点了没反应」，自动模式没有回显等于没做。
run_client M10 "hits 'mode.current' \${client} \
  && hits 'mode.source' \${client} \
  && hits 'lg-mode-current' \${client}"

# M11：README 中英两版结构必须对等（行数 / 二级章节 / 三级章节 / 代码块 / 表格行数一致）。
#      两版是同一份内容的两种语言，任何一版单独加内容都会让另一版失去同步；
#      人工逐节对照会漏（0.2.0 就漏过一次：中文版多两条已知限制，行数 414 vs 412），
#      所以这里机械比对结构计数。
cat >"${m_tmp}/m11.cjs" <<'M11EOF'
const fs = require('fs');
const stat = (file) => {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const count = (re) => lines.filter((l) => re.test(l)).length;
  return {
    lines: lines.length - (lines[lines.length - 1] === '' ? 1 : 0),
    h2: count(/^## /),
    h3: count(/^### /),
    fences: count(/^```/),
    rows: count(/^\| /),
  };
};
const en = stat('README.md');
const zh = stat('README.zh.md');
const keys = ['lines', 'h2', 'h3', 'fences', 'rows'];
const diff = keys.filter((k) => en[k] !== zh[k]).map((k) => `${k}: en=${en[k]} zh=${zh[k]}`);
if (diff.length) console.log(diff.join('  '));
process.exit(diff.length ? 1 : 0);
M11EOF
chk M11 "node '${m_tmp}/m11.cjs'"

# M12：Client 侧「界面语言」必须与 Host 同源（读 describe 镜像的 locale.preference），
#      不许读 ctx.locale.getSnapshot().active。
#      两者在「用户从未在设置里选过界面语言」时必然分叉：Host 拿到 undefined 走兜底
#      targetLanguage（默认 zh-CN），而 active 是浏览器/系统语言派生的 provisional
#      （dsh-client-locale/lib/client.js 的 resolveActive：preference === void 0 时返回
#      provisional），英文系统用户会看到面板写「来自界面语言 · English」、实际注入简体中文。
#      这条判据是那个缺陷的回归防护，删掉它等于允许面板撒谎。
run_client M12 "for p in 'configForms\.get\(UI_LOCALE_NS\)' 'UI_LOCALE_NS = .locale.' 'preference'; do if ! hits \"\$p\" ${client}; then echo \"缺少: \$p\"; exit 1; fi; done; for p in 'locale\.getSnapshot' 'localeFace'; do if hits \"\$p\" ${client}; then echo \"不应出现: \$p\"; exit 1; fi; done"

# M13：docs/验收清单.md 不得再嵌入脚本全文。
#      0.2.0 期间清单里嵌入过脚本全文，随后脚本从 400 行长到 539 行，副本漂移 139 行
#      而人工对照没发现——嵌入副本必然漂移。唯一真源是 scripts/verify-checklist.sh，
#      清单只写判据文字与运行方式。这条判据防止有人再把全文粘回去。
# 判据用脚本独有的函数定义行，不用 shebang：清单里若引用 shebang 字样会自指 FAIL。
chk M13 "! grep -q '^run_client()' docs/验收清单.md && ! grep -q '^m_tmp=' docs/验收清单.md"

# M14：Client 镜像段与 lib/language.js 必须**运行时行为等价**。
#      client.js 里的「语言模式常量与解析规则」是 lib/language.js 的手抄副本
#      （Client 是独立 bundle，factory 只能 require('react')，不能相对 import 包内文件），
#      抄两份就必须有判据守住一致性。此前这里是**零覆盖**：
#        - scripts/verify-language.mjs 只 import lib/language.js，从不读 client.js；
#        - M1 只比 mapPreference 的 zh/en 两条规则、M2 只比 effectiveMode 的三元式，
#          都是源文本正则抽查，不是行为断言；
#        - 于是把 client.js 的 MODE_MANUAL 改成 MODE_AUTO，全仓仍然绿。
#      0.2.1 就因此漏过一处真实分叉：Host 用默认参数（只对 undefined 兜底），
#      Client 用 `||`（对任何假值兜底），defaultLanguage 传 '' / null 时两侧判定相反。
#      M14 跑 scripts/verify-mirror.mjs：把镜像段抽出来动态 import，与 lib/language.js
#      在 MODES × LANGS × FALLBACKS × DEFAULTS 上逐条比输出（≥1 万组输入、5 个函数）。
#      这是本仓库唯一真正守住镜像段一致性的判据，删掉它等于放任漂移。
chk M14 "node scripts/verify-mirror.mjs"

# ---- npm 产物判据（A7 / R1 / R2 / R16）------------------------------------
# 一次 npm pack --dry-run 供 A7 / R1 共用，避免重复调用。
# 所有 npm 调用都必须带 --cache 指向临时目录，否则本机 ~/.npm 的 root-owned 文件会 EPERM
# （npm error code EPERM / path ~/.npm/_cacache/tmp/...）。
# 判据体写成独立 .cjs 文件而不是内联 -e：内联正则里一旦出现 `${}` 字面量，bash 会在解析期
# 报 bad substitution，整条 chk 调用被跳过——既不 PASS 也不 FAIL，静默漏检（本脚本踩过）。
mkdir -p "${npm_cache}" "${pack_tmp}" "${m_tmp}" 2>/dev/null || true
npm_ok=0
if command -v npm >/dev/null 2>&1; then
  if npm pack --dry-run --json --cache "${npm_cache}" >"${pack_tmp}/pack.json" 2>"${pack_tmp}/pack.err"; then
    npm_ok=1
  fi
fi

cat >"${pack_tmp}/a7.cjs" <<'A7EOF'
// A7：pack 产物必须被 files 白名单覆盖，且不含 node_modules / .env / 测试脚本 / 临时文件。
const fs = require('fs');
const pk = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))[0];
const pkg = require(process.argv[3]);
const files = pkg.files || [];
const leakRe = /^(node_modules|\.env|scripts\/|asar_tool|.*\.tgz|\.git)/;
const cover = (f) => {
  if (f === 'package.json' || f === 'README.md') return true; // npm 总是包含
  return files.some((g) => {
    if (g === f) return true;
    if (g.endsWith('/*')) return f.startsWith(g.slice(0, -2) + '/');
    if (g.includes('*')) {
      const re = new RegExp('^' + g.split('*').map((q) => q.replace(/[.]/g, '\\.')).join('[^/]*') + '$');
      return re.test(f);
    }
    return f.startsWith(g + '/');
  });
};
const list = pk.files.map((f) => f.path);
const leak = list.filter((x) => leakRe.test(x));
const uncovered = list.filter((f) => !cover(f));
if (leak.length || uncovered.length) console.log('泄漏:', leak.join(',') || '(无)', ' 未覆盖:', uncovered.join(',') || '(无)');
process.exit(leak.length || uncovered.length ? 1 : 0);
A7EOF

cat >"${pack_tmp}/r1.cjs" <<'R1EOF'
// R1：产物集合与期望集合逐项相等（无缺失、无多余）。
const fs = require('fs');
const got = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))[0].files.map((f) => f.path).sort();
const want = [
  'CHANGELOG.md', 'LICENSE', 'README.md', 'README.zh.md', 'client.js', 'cordis.patch.yml', 'icon.svg',
  'lib/commands.js', 'lib/cycle.js', 'lib/index.js', 'lib/language.js', 'lib/state.js', 'lib/text.js',
  'locale/en.json', 'locale/zh.json', 'package.json',
];
const miss = want.filter((x) => !got.includes(x));
const extra = got.filter((x) => !want.includes(x));
if (miss.length || extra.length) console.log('缺失:', miss.join(',') || '(无)', ' 多余:', extra.join(',') || '(无)');
process.exit(miss.length || extra.length ? 1 : 0);
R1EOF

cat >"${pack_tmp}/r2.cjs" <<'R2EOF'
// R2：真打一次 tarball，`tar -tzf` 列表必须与 dry-run 列表一致。
const fs = require('fs');
const cp = require('child_process');
const dir = process.argv[2];
const tgz = fs.readdirSync(dir).filter((f) => f.endsWith('.tgz'))[0];
if (!tgz) { console.log('未生成 tarball'); process.exit(1); }
const tar = cp.execSync(`tar -tzf "${dir}/${tgz}"`, { encoding: 'utf8' })
  .trim().split('\n').filter((x) => x && !x.endsWith('/'))
  .map((x) => x.replace(/^package\//, '')).sort();
const dry = JSON.parse(fs.readFileSync(`${dir}/pack.json`, 'utf8'))[0].files.map((f) => f.path).sort();
const a = tar.join('|'); const b = dry.join('|');
if (a !== b) console.log('tar:', a, '\ndry:', b);
process.exit(a === b ? 0 : 1);
R2EOF

cat >"${pack_tmp}/r23.cjs" <<'R23EOF'
// R23：文档里声明的「当前 pack 尺寸」必须等于本次实测值。
//      原因：README.md / README.zh.md 都在 files 白名单里，改一次 README 就让 size 变化，
//      而文档里的数字是人手抄进去的——0.2.0 期间文档写 53284 B、实测已变 53657 B，
//      差 373 B，人工对照没发现。凡在文档里写死产物尺寸，就必须由脚本守住。
//
//      判据用「必须包含实测值」而不是「不许出现别的数字」：文档里合法保留了历史版本的
//      尺寸（0.1.0 的 40011、0.1.1 的 41221、0.1.2 的 41240），反向断言会把它们全判成错。
//      正向断言只在「当前值没被写进文档」时失败，正是要防的那种漂移。
const fs = require('fs');
const actual = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))[0];
const need = [
  { file: 'docs/发布说明.md', patterns: [actual.size + ' B', actual.unpackedSize + ' B'] },
  { file: 'docs/实现说明.md', patterns: ['size: ' + actual.size, 'unpackedSize: ' + actual.unpackedSize] },
];
const bad = [];
for (const item of need) {
  if (!fs.existsSync(item.file)) { bad.push(item.file + ': 文件不存在'); continue; }
  const text = fs.readFileSync(item.file, 'utf8');
  for (const p of item.patterns) if (!text.includes(p)) bad.push(item.file + ': 缺 "' + p + '"');
}
if (bad.length) console.log('实测 entryCount=' + actual.entryCount + ' size=' + actual.size + ' unpackedSize=' + actual.unpackedSize + '\n  未同步：\n  ' + bad.join('\n  '));
process.exit(bad.length ? 1 : 0);
R23EOF

if [ "${npm_ok}" = 1 ]; then
  # 传绝对路径：.cjs 在 ${pack_tmp} 里，require('./package.json') 会相对该目录解析而不是 cwd。
  chk A7 "node '${pack_tmp}/a7.cjs' '${pack_tmp}/pack.json' \"\$(pwd)/${pkg}\""
  chk R1 "node '${pack_tmp}/r1.cjs' '${pack_tmp}/pack.json'"
  chk R2 "npm pack --cache '${npm_cache}' --pack-destination '${pack_tmp}' >/dev/null 2>&1 && node '${pack_tmp}/r2.cjs' '${pack_tmp}'"
  # R16 测的是「npm 侧打包/白名单/名称校验全绿」。本地跑完整链路（含 prepublishOnly
  # → verify-release.mjs 的 tag 校验）；CI 里 checkout 默认不拉 tag，那条校验必然失败，
  # 故 CI 用 --ignore-scripts 跳过 prepublishOnly，只保留 npm 自身的校验。
  # --ignore-scripts 只用于这里的 dry-run 测试；真实 npm publish 仍由 prepublishOnly 把守，
  # AGENTS.md 明确禁止在真实发布时使用它。
  if [ "${ci_mode}" = 1 ]; then
    chk R16 "npm publish --dry-run --ignore-scripts --cache '${npm_cache}' >'${pack_tmp}/pub.log' 2>&1; ! grep -q 'npm error' '${pack_tmp}/pub.log'"
  else
    chk R16 "npm publish --dry-run --cache '${npm_cache}' >'${pack_tmp}/pub.log' 2>&1; ! grep -q 'npm error' '${pack_tmp}/pub.log'"
  fi
  # R23 是打包体积的精确字节断言。此前一直假设「npm pack 的产物字节随 npm 版本变化，
  # 跨机器不可移植」而在 CI 跳过——但那是推断，从未实测。跳过 R23 意味着：只改
  # README/CHANGELOG 却没同步 docs/ 里的尺寸数字时，CI 发布照样通过，缺口由此产生。
  # 现在改为在 CI 也跑：若字节真的跨环境稳定，这条假设不成立，缺口自然消失；
  # 若真的漂移，r23.cjs 会把 CI 实测值打印出来，据实判断该改断言还是该保留跳过。
  chk R23 "node '${pack_tmp}/r23.cjs' '${pack_tmp}/pack.json'"
else
  todo A7 "npm 不可用或 npm pack 失败（见 ${pack_tmp}/pack.err）"
  todo R1 "npm 不可用或 npm pack 失败"
  todo R2 "npm 不可用或 npm pack 失败"
  todo R16 "npm 不可用"
  todo R23 "npm 不可用"
fi

# ---- R. 发布（机械可判部分） ------------------------------------------------
chk R3 "node -e \"const f=require('./${pkg}').files||[];const need=['client.js','cordis.patch.yml','icon.svg'];process.exit(f.length&&need.every(x=>f.includes(x))&&f.some(x=>x==='lib'||x.startsWith('lib/'))?0:1)\""
chk R4 "node -e \"const s=require('./${pkg}').scripts||{};process.exit(Object.keys(s).some(k=>/^(pre|post)?(install|prepare|pack)\$/.test(k))?1:0)\""
chk R5 "test -f LICENSE && grep -qi 'MIT License' LICENSE && node -e \"process.exit(require('./${pkg}').license==='MIT'?0:1)\""
chk R9 "node -e \"const r=require('./${pkg}').repository;process.exit(r&&r.type==='git'&&/58fly\\/dsh-language-guard/.test(r.url)?0:1)\""
chk R10 "node -e \"const a=require('./${pkg}').author;process.exit(a&&(typeof a==='string'?a.length>0:!!a.name)?0:1)\""
chk R18 "node -e \"process.exit(require('./${pkg}').publishConfig&&require('./${pkg}').publishConfig.access==='public'?0:1)\""
chk R22 "node -e \"const p=require('./${pkg}');process.exit(p.private?1:0)\""
chk R7 "grep -q 'README.zh.md' README.md && grep -q 'README.md' README.zh.md"
chk R6 "grep -q 'dsh-context' README.md && grep -q 'dsh-context' README.zh.md && grep -qiE 'sidebar|侧栏' README.md && grep -qE '侧栏' README.zh.md && grep -q '^## Automatic language mode' README.md && grep -q '^## 自动语言模式' README.zh.md && grep -q 'languageMode' README.md && grep -q 'languageMode' README.zh.md"
chk R11 "node -e \"const p=require('./${pkg}');const ok=u=>typeof u==='string'&&/^https:\\/\\//.test(u)&&/58fly\\/dsh-language-guard/.test(u);process.exit(ok(p.homepage)&&ok((p.bugs&&p.bugs.url)||'')?0:1)\""
chk R13 "node -e \"const p=require('./${pkg}');const d=(p.engines||{}).node||'';const segs=d.split('||').map(x=>{const m=x.match(/\\d+/);return m?+m[0]:null}).filter(x=>x!==null);process.exit(segs.length&&Math.min(...segs)>=22?0:1)\""
chk R12 "node -e \"const k=require('./${pkg}').keywords||[];process.exit(k.includes('dsh-plugin')&&k.includes('deepseek-harness')?0:1)\""

# ---- 汇总（结论同时写 stdout 与 stderr，管道截断时仍能看到） ----------------
summary="PASS ${pass}   FAIL ${fail}   TODO(尚未实现) ${missing}"
if [ "${skipped}" -gt 0 ]; then
  summary="${summary}   SKIP(环境不适用) ${skipped}"
fi
echo "----"
echo "${summary}"

if [ "${fail}" -gt 0 ]; then
  echo "结论：不通过（存在真实缺陷，逐条看 FAIL）" >&2
  exit 1
fi
if [ "${missing}" -gt 0 ]; then
  echo "结论：尚未实现（不是失败，也不能算通过；等 lib/ 与 client.js 落盘后重跑）" >&2
  exit 2
fi
echo "结论：机械可判项全部通过；人工项（B5/D9/D11/E4/F2/R 组）仍需按表留证"
exit 0
