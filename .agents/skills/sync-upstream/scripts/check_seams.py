#!/usr/bin/env python3
"""校验 .fork/seams.json 与 .fork/notes/ 的一致性。

用法: python3 check_seams.py [target-ref]   # 默认 origin/release/v* 中 semver 最高的
检查: 每个被 fork 修改的上游文件都有 claimed 登记；每条登记都有 note、每个 note 都有登记；
      seamBudget == 登记条数。任一不满足则以 1 退出。
"""
import json, os, subprocess, sys

def git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout

target = sys.argv[1] if len(sys.argv) > 1 else sorted(
    git("for-each-ref", "--format=%(refname:short)", "refs/remotes/origin/release/v*").split(),
    key=lambda r: [int(x) if x.isdigit() else x for x in r.rsplit("v", 1)[-1].split(".")],
)[-1]

data = json.load(open(".fork/seams.json"))
exempt = data.get("exemptGlobs", [])
claimed = {s["path"] for s in data["seams"] if s.get("status") == "claimed"}
modified = git("diff", "--name-only", "--diff-filter=MD", target).split()
notes = {
    os.path.relpath(os.path.join(root, f), ".fork/notes")[: -len(".md")]
    for root, _, files in os.walk(".fork/notes") for f in files if f.endswith(".md")
}

from fnmatch import fnmatch
problems = []
for m in modified:
    if m.startswith(".fork/") or any(fnmatch(m, g) for g in exempt):
        continue
    if m not in claimed:
        problems.append(f"未登记的上游文件改动: {m}")
for p in claimed - notes:
    problems.append(f"登记缺少 note: {p}")
for p in notes - claimed:
    problems.append(f"note 没有对应登记: {p}")
for p in claimed:
    if p not in modified:
        problems.append(f"登记的文件已与上游一致，应撤销 seam: {p}")
if data["seamBudget"] != len(data["seams"]):
    problems.append(f"seamBudget={data['seamBudget']} 与登记条数 {len(data['seams'])} 不一致")

print(f"target: {target}  claimed: {len(claimed)}  budget: {data['seamBudget']}")
for p in problems:
    print("✗", p)
print("OK" if not problems else f"{len(problems)} 个问题")
sys.exit(1 if problems else 0)
