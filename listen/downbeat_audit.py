import json,sys,subprocess,os,bisect,random
import numpy as np, librosa

def near(t,arr,tol):
    if not len(arr): return False
    j=bisect.bisect_left(arr,t)
    return min((abs(t-arr[k]) for k in (j-1,j) if 0<=k<len(arr)),default=9)<=tol

def analyse(sg):
    sp=subprocess.run(["node","-e",f"console.log(require('./protocol/fixture.js').pick('{sg}'))"],
                      capture_output=True,text=True).stdout.strip()
    if not sp or not os.path.exists(sp): return None
    sc=json.load(open(sp))
    B=sc.get("beats") or []
    bt=np.array([b["t"] for b in B if isinstance(b,dict) and "t" in b])
    didx=[i for i,b in enumerate(B) if isinstance(b,dict) and b.get("downbeat")]
    if len(bt)<32 or len(didx)<4: return None
    period=int(round(np.median(np.diff(didx))))
    if period<2 or period>8: return None
    cur=didx[0]%period
    ch=np.array(sorted({round(c["start"],3) for c in sc.get("btc_chords_raw",[]) if "start" in c}))
    if len(ch)<8: return None
    res={}
    for ph in range(period):
        ts=bt[[i for i in range(len(bt)) if i%period==ph]]
        res[ph]=100*float(np.mean([near(t,ch,0.10) for t in ts]))
    best=max(res,key=res.get)
    ordered=sorted(res.values(),reverse=True)
    margin=ordered[0]-ordered[1]
    nulls=[]
    for _ in range(300):
        ts=bt[[i for i in range(len(bt)) if i%period==random.randrange(period)]]
        ts=ts+random.uniform(0,10)
        nulls.append(100*float(np.mean([near(t,ch,0.10) for t in ts])))
    nm,nsd=float(np.mean(nulls)),max(0.5,float(np.std(nulls)))
    return dict(song=sg,period=period,cur=cur,best=best,scores=res,
                margin=margin,sd=(res[best]-nm)/nsd,off=(best-cur)%period)

songs=sys.argv[1:]
print(f"{'song':30s} {'metre':>5s} {'now':>3s} {'best':>4s} {'off':>3s} {'hit%now':>8s} {'hit%best':>8s} {'margin':>7s} {'sd':>5s}")
bad=[]
for sg in songs:
    try: r=analyse(sg)
    except Exception as e: print(f"{sg:30s} ERR {e}"); continue
    if not r: print(f"{sg:30s} (insufficient data)"); continue
    flag=""
    if r["off"] and r["margin"]>=8 and r["sd"]>=1.5: flag=" <-- RE-PHASE"; bad.append((sg,r["off"]))
    elif r["off"]: flag=" (weak)"
    print(f"{r['song']:30s} {r['period']:>5d} {r['cur']:>3d} {r['best']:>4d} {r['off']:>3d} "
          f"{r['scores'][r['cur']]:>7.1f}% {r['scores'][r['best']]:>7.1f}% {r['margin']:>6.1f} {r['sd']:>5.1f}{flag}",flush=True)
print(f"\n{len(bad)} of {len(songs)} songs need re-phasing: "+", ".join(f"{s}(+{o})" for s,o in bad))
