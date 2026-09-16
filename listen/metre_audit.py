import json,sys,subprocess,os
import numpy as np, librosa

def analyse(sg):
    sp=subprocess.run(["node","-e",f"console.log(require('./protocol/fixture.js').pick('{sg}'))"],
                      capture_output=True,text=True).stdout.strip()
    if not sp or not os.path.exists(sp): return None
    sc=json.load(open(sp))
    bt=np.array([b["t"] for b in (sc.get("beats") or []) if isinstance(b,dict) and "t" in b])
    if len(bt)<40: return None
    audio=f"hub/files/audio/{sg}.mp3"
    if not os.path.exists(audio): return None
    y,sr=librosa.load(audio,sr=22050,mono=True)
    hop=256
    chroma=librosa.feature.chroma_cqt(y=y,sr=sr,hop_length=hop)
    ct=librosa.times_like(chroma,sr=sr,hop_length=hop)
    idx=np.searchsorted(ct,bt)
    bs=[]
    for i in range(len(bt)-1):
        a,b=idx[i],max(idx[i]+1,idx[i+1])
        seg=chroma[:,a:min(b,chroma.shape[1])]
        bs.append(seg.mean(axis=1) if seg.size else np.zeros(12))
    B=np.array(bs)
    B=(B-B.mean(axis=0))/(B.std(axis=0)+1e-9)
    n=len(B)
    out={}
    for lag in range(2,17):
        if n-lag<12: continue
        a,b=B[:n-lag],B[lag:]
        num=float(np.sum(a*b)); den=float(np.sqrt(np.sum(a*a)*np.sum(b*b)))+1e-9
        out[lag]=num/den
    if not out: return None
    wide={}
    for lag in range(1,20):
        if n-lag<12: continue
        a,b=B[:n-lag],B[lag:]
        wide[lag]=float(np.sum(a*b))/(float(np.sqrt(np.sum(a*a)*np.sum(b*b)))+1e-9)
    contrast={}
    for lag in out:
        neigh=[wide[l] for l in (lag-1,lag+1) if l in wide]
        if not neigh: continue
        contrast[lag]=out[lag]-sum(neigh)/len(neigh)
    if not contrast: return None
    out=contrast
    vals=np.array(list(out.values())); mean,sd=vals.mean(),vals.std()+1e-9
    z={k:(v-mean)/sd for k,v in out.items()}
    best=max(z,key=z.get)
    prime=best
    flags=[i for i,b in enumerate(sc.get("beats") or []) if isinstance(b,dict) and b.get("downbeat")]
    assumed=int(round(np.median(np.diff(flags)))) if len(flags)>3 else None
    stated=(sc.get("grid") or {}).get("beats_per_bar")
    return dict(song=sg,z=z,best=best,prime=prime,assumed=assumed,stated=stated)

print("strongest lag is the PHRASE (2 or 4 bars), not the bar. What tests the stated")
print("bar is whether the peaks are all multiples of it.\n")
print(f"{'song':28s} {'bar':>4s} {'phrase':>6s} {'top lags (z)':>30s}  verdict")
for sg in sys.argv[1:]:
    try: r=analyse(sg)
    except Exception as e: print(f"{sg:28s} ERR {str(e)[:40]}"); continue
    if not r: print(f"{sg:28s} (insufficient)"); continue
    top=sorted(r["z"].items(),key=lambda kv:-kv[1])[:4]
    tops=", ".join(f"{k}:{v:+.1f}" for k,v in top)
    bar=r["stated"]
    strong=[k for k,v in top if v>0.8]
    if not bar:
        verdict="no stated bar"
    elif strong and all(k%bar==0 for k in strong):
        verdict=f"consistent with {bar}"
    else:
        odd=[k for k in strong if k%bar]
        verdict=f"NOT multiples of {bar}: {odd}"
    print(f"{r['song']:28s} {str(bar):>4s} {r['prime']:>6d}  {tops:>30s}  {verdict}",flush=True)
