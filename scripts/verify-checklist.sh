#!/usr/bin/env bash
# dsh-language-guard 验收自检脚本（对应 docs/验收清单.md 第四节的机械可判项）
#
# 用法：在包根目录执行
#   bash scripts/verify-checklist.sh; echo "exit=$?"
# 注意：不要用管道截取输出（`| tail` 会把退出码换成 tail 的），要看退出码就单独 echo $?。
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
stub_dirs=""

cleanup() {
  if [ -n "${stub_dirs}" ]; then
    for d in ${stub_dirs}; do rm -rf "$d"; done
    rmdir node_modules/@deepseek-ai 2>/dev/null || true
    rmdir node_modules 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# 只看「代码行」的 grep：排除整行注释（* / // / /* 开头），避免注释里写了自己该满足的约束造成假通过。
# hits <ERE> <路径...>：存在代码行命中返回 0
# hits_n <ERE> <路径...>：代码行命中次数（按出现次数计）
hits() {
  local re="$1"; shift
  grep -rnE "$re" "$@" 2>/dev/null | grep -vE ':[0-9]+:[[:space:]]*(\*|//|/\*)' | grep -q .
}
hits_n() {
  local re="$1"; shift
  grep -rnE "$re" "$@" 2>/dev/null \
    | grep -vE ':[0-9]+:[[:space:]]*(\*|//|/\*)' \
    | sed -E 's/^[^:]+:[0-9]+://' \
    | grep -oE "$re" | wc -l | tr -d ' '
}

chk() { # chk <条目> <命令>
  if eval "$2" >/dev/null 2>&1; then
    echo "PASS $1"
    pass=$((pass + 1))
  else
    echo "FAIL $1"
    fail=$((fail + 1))
  fi
}

todo() { # todo <条目> <说明>
  echo "TODO $1 (尚未实现：$2)"
  missing=$((missing + 1))
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

chk A8 "python3 -c \"import yaml,sys;d=yaml.safe_load(open('cordis.patch.yml'));r=d[0]['insert'];sys.exit(0 if len(r)==1 and r[0].get('id')=='dsh-language-guard' else 1)\""

# ---- B. locale 与 icon ------------------------------------------------------
chk B1 "node -e \"const m=require('./locale/en.json');process.exit(m.meta&&m.meta.title&&m.meta.description&&String(m.meta.title).length>=4&&String(m.meta.description).length>=4?0:1)\""
chk B2 "node -e \"const m=require('./locale/zh.json');process.exit(m.meta&&m.meta.title&&m.meta.description&&String(m.meta.title).length>=4&&String(m.meta.description).length>=4?0:1)\""
chk B3 "test \$(stat -f%z icon.svg 2>/dev/null || stat -c%s icon.svg) -le 262144"
chk B4 "grep -q '<svg' icon.svg"

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
run_host C9 "[ \"\$(hits_n '^[[:space:]]*\.volatile\(\),' ${host})\" -eq 6 ] && python3 -c \"import yaml,sys;r=yaml.safe_load(open('cordis.patch.yml'))[0]['insert'][0];sys.exit(0 if set(r)=={'id','name'} else 1)\""

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

# ---- R. 发布（机械可判部分） ------------------------------------------------
chk R3 "node -e \"const f=require('./${pkg}').files||[];const need=['client.js','cordis.patch.yml','icon.svg'];process.exit(f.length&&need.every(x=>f.includes(x))&&f.some(x=>x==='lib'||x.startsWith('lib/'))?0:1)\""
chk R4 "node -e \"const s=require('./${pkg}').scripts||{};process.exit(Object.keys(s).some(k=>/^(pre|post)?(install|prepare|pack)\$/.test(k))?1:0)\""
chk R5 "test -f LICENSE && grep -qi 'MIT License' LICENSE && node -e \"process.exit(require('./${pkg}').license==='MIT'?0:1)\""
chk R9 "node -e \"const r=require('./${pkg}').repository;process.exit(r&&r.type==='git'&&/58fly\\/dsh-language-guard/.test(r.url)?0:1)\""
chk R10 "node -e \"const a=require('./${pkg}').author;process.exit(a&&(typeof a==='string'?a.length>0:!!a.name)?0:1)\""
chk R18 "node -e \"process.exit(require('./${pkg}').publishConfig&&require('./${pkg}').publishConfig.access==='public'?0:1)\""
chk R22 "node -e \"const p=require('./${pkg}');process.exit(p.private?1:0)\""

# ---- 汇总（结论同时写 stdout 与 stderr，管道截断时仍能看到） ----------------
summary="PASS ${pass}   FAIL ${fail}   TODO(尚未实现) ${missing}"
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
