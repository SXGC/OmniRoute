import json, subprocess, sys
from collections import OrderedDict
commit=sys.argv[1]
def load(s): return json.loads(s, object_pairs_hook=OrderedDict)
def show(ref,p): return subprocess.run(["git","show",f"{ref}:{p}"],capture_output=True,text=True,check=True).stdout
def added(old,new,path=()):
    out=[]
    prev=None
    for k,v in new.items():
        if k not in old: out.append((path,prev,k,v))
        elif isinstance(v,dict) and isinstance(old[k],dict): out+=added(old[k],v,path+(k,))
        prev=k
    return out
for p in sys.argv[2:]:
    raw=open(p).read()
    cur=load(raw)
    assert json.dumps(cur,indent=2,ensure_ascii=False)+"\n"==raw, f"roundtrip mismatch {p}"
    adds=added(load(show(commit+"^",p)),load(show(commit,p)))
    for path,prev,k,v in adds:
        node=cur
        for seg in path: node=node[seg]
        if k in node: print("exists",p,path,k); continue
        items=list(node.items()); idx=len(items)
        if prev is not None and prev in node: idx=[i for i,(kk,_) in enumerate(items) if kk==prev][0]+1
        items.insert(idx,(k,v)); node.clear(); node.update(items)
        print("added",p,".".join(path+(k,)))
    open(p,"w").write(json.dumps(cur,indent=2,ensure_ascii=False)+"\n")
