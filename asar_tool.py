#!/usr/bin/env python3
"""极简 asar 读取器：cat / ls / tree / grep"""
import json, struct, sys

P = "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar"
_f = open(P, 'rb')
_a, _b, _c, _d = struct.unpack('<4I', _f.read(16))
HDR = json.loads(_f.read(_d).decode('utf-8'))
BASE = 8 + _b


def node_at(path):
    node = HDR
    for seg in path.strip("/").split("/"):
        if seg == "":
            continue
        node = node["files"][seg]
    return node


def cat(path):
    n = node_at(path)
    _f.seek(BASE + int(n["offset"]))
    return _f.read(n["size"])


def ls(path):
    return sorted(node_at(path).get("files", {}).keys())


def tree(path, depth=0, maxdepth=3):
    n = node_at(path)
    for k, v in sorted(n.get("files", {}).items()):
        print("  " * depth + k + ("/" if "files" in v else ""))
        if "files" in v and depth < maxdepth:
            tree(path + "/" + k, depth + 1, maxdepth)


def walk_all(node=None, prefix=""):
    node = node or HDR
    for k, v in node.get("files", {}).items():
        p = prefix + "/" + k
        if "files" in v:
            yield from walk_all(v, p)
        else:
            yield p


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "cat":
        print(cat(sys.argv[2]).decode('utf-8', 'replace'))
    elif cmd == "ls":
        print("\n".join(ls(sys.argv[2])))
    elif cmd == "tree":
        tree(sys.argv[2], maxdepth=int(sys.argv[3]) if len(sys.argv) > 3 else 3)
    elif cmd == "grep":
        import re
        pat = re.compile(sys.argv[2])
        for p in walk_all():
            try:
                t = cat(p).decode('utf-8', 'replace')
            except Exception:
                continue
            if pat.search(t):
                print(p)
