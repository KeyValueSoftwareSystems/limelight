import json,sys,subprocess,os,bisect,random,shutil,time
import numpy as np, librosa

MARGIN_MIN=8.0
SD_MIN=1.5

def near(t,arr,tol):
    if not len(arr): return False
    j=bisect.bisect_left(arr,t)
    return min((abs(t-arr[k]) for k in (j-1,j) if 0<=k<len(arr)),default=9)<=tol

def score_path(sg):
    r=subprocess.run(["node","-e",f"console.log(require('./protocol/fixture.js').pick('{sg}'))"],
                     capture_output=True,text=True).stdout.strip()
    return r if r and os.path.exists(r) else None

def analyse(sg,audio):
    sp=score_path(sg)
    if not sp: return None
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
    y,sr=librosa.load(audio,sr=22050,mono=True)
    S=np.abs(librosa.stft(y,n_fft=2048,hop_length=256))
    fr=librosa.fft_frequencies(sr=sr,n_fft=2048)
    low=S[fr<120].sum(axis=0); lt=librosa.times_like(low,sr=sr,hop_length=256)
    low=low/(np.percentile(low,99)+1e-9)
    chord={}; lowe={}
    for ph in range(period):
        ts=bt[[i for i in range(len(bt)) if i%period==ph]]
        chord[ph]=100*float(np.mean([near(t,ch,0.10) for t in ts]))
        lowe[ph]=float(np.mean(low[np.clip(np.searchsorted(lt,ts),0,len(low)-1)]))
    best=max(chord,key=chord.get)
    ordered=sorted(chord.values(),reverse=True)
    margin=ordered[0]-ordered[1]
    nulls=[]
    for _ in range(300):
        ts=bt[[i for i in range(len(bt)) if i%period==random.randrange(period)]]+random.uniform(0,10)
        nulls.append(100*float(np.mean([near(t,ch,0.10) for t in ts])))
    nm,nsd=float(np.mean(nulls)),max(0.5,float(np.std(nulls)))
    sd=(chord[best]-nm)/nsd
    return dict(sp=sp,sc=sc,B=B,period=period,cur=cur,best=best,chord=chord,low=lowe,
                margin=margin,sd=sd,off=(best-cur)%period,
                low_agrees=(max(lowe,key=lowe.get)==best))

apply="--apply" in sys.argv
songs=[a for a in sys.argv[1:] if not a.startswith("--")]
stamp=time.strftime("%Y%m%d-%H%M%S")
changed=[]
for sg in songs:
    audio=f"hub/files/audio/{sg}.mp3"
    if not os.path.exists(audio): print(f"{sg:30s} no audio"); continue
    try: r=analyse(sg,audio)
    except Exception as e: print(f"{sg:30s} ERR {e}"); continue
    if not r: print(f"{sg:30s} insufficient data"); continue
    ok = r["off"]!=0 and r["margin"]>=MARGIN_MIN and r["sd"]>=SD_MIN
    agree = "low-end agrees" if r["low_agrees"] else "low-end DISAGREES"
    status = "RE-PHASE" if ok else ("ok" if r["off"]==0 else "weak, left alone")
    print(f"{sg:30s} metre {r['period']} phase {r['cur']}->{r['best']} (+{r['off']})  "
          f"chord {r['chord'][r['cur']]:.1f}%->{r['chord'][r['best']]:.1f}%  "
          f"margin {r['margin']:.1f} sd {r['sd']:.1f}  {agree}  [{status}]")
    if ok and apply:
        shutil.copy2(r["sp"], r["sp"]+f".bak-{stamp}")
        B=r["B"]; period=r["period"]; best=r["best"]
        for i,b in enumerate(B):
            if not isinstance(b,dict): continue
            if i%period==best: b["downbeat"]=True
            elif "downbeat" in b: del b["downbeat"]
        r["sc"]["beats"]=B
        r["sc"].setdefault("provenance",{})["downbeat_phase"]={
            "corrected_from":r["cur"],"to":best,"metre":period,
            "chord_hit_before":round(r["chord"][r["cur"]],1),
            "chord_hit_after":round(r["chord"][best],1),
            "margin":round(r["margin"],1),"sd":round(r["sd"],1),
            "low_end_agrees":bool(r["low_agrees"]),"tool":"tools/fixdownbeats.py"}
        json.dump(r["sc"],open(r["sp"],"w"))
        changed.append(sg)
if apply: print(f"\nrewrote {len(changed)}: "+", ".join(changed))
else: print("\n(dry run — pass --apply to write)")
