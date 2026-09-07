#!/usr/bin/env python3
"""Chords from ChordMini's BTC large-vocabulary model (170 classes). CUDA venv.

    /tmp/claude-1001/venv/bin/python listen/chordmini.py levels [--write]

A transformer chord recogniser trained on human chord annotations, run on the
mix. On Levels it returns C#m, A, E, B -- the record's actual progression -- which
no chroma method here managed, and it does so with sub-bar timing and a
vocabulary that includes sevenths and suspensions.

The repo is cloned to /tmp/claude-1001/chordmini (MIT, ptnghia-j/ChordMini) and
run with OUR torch, not its pinned one: installing its requirements would replace
the CUDA torch, which is the second trap in GPU.md. Two plotting libraries had to
be added for its import chain; neither touches torch.

Per-bar events are what a reader expects and what listen/mapeval.py scores; the
full segment list is kept alongside because a chord change inside a bar is real
information a per-bar list throws away.
"""
import os, sys, json, subprocess, bisect, collections, tempfile, shutil
HERE=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.dirname(HERE)
CM="/tmp/claude-1001/chordmini"; PY=sys.executable
CKPT="checkpoints/btc_model_large_voca.pt"

def norm(lab):
    if lab in ("N","X"): return None
    root,_,q=lab.partition(":"); return root+q.replace("min","m").replace("maj","")

def run(slug):
    wav=os.path.join(ROOT,"synth","out",slug+".wav")
    aud=tempfile.mkdtemp(prefix="cm_aud_"); out=tempfile.mkdtemp(prefix="cm_out_")
    os.symlink(wav, os.path.join(aud, slug+".wav"))
    subprocess.run([PY,"src/evaluation/test.py","--model_type","BTC","--checkpoint",CKPT,
                    "--config","config/ChordMini.yaml","--audio_dir",aud,"--save_dir",out],
                   cwd=CM, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    segs=[]
    for line in open(os.path.join(out, slug+".lab")):
        a,b,c=line.split(); segs.append((float(a),float(b),c))
    shutil.rmtree(aud); shutil.rmtree(out)
    return segs

try:
    from mapio import map_path
except ImportError:
    import sys as _s, os as _o
    _s.path.insert(0, _o.path.dirname(_o.path.abspath(__file__)))
    from mapio import map_path

def analyse(slug, write=False):
    mp=map_path(slug)
    if not mp: return {"song":slug,"error":"no map"}
    m=json.load(open(mp)); downs=m["downbeats"]; beats=m["beats"]
    bn=((m.get("observations") or {}).get("bass_notes") or {}).get("notes") or []
    segs=run(slug); starts=[s[0] for s in segs]
    ev=[]
    for d in downs:
        k=bisect.bisect_right(starts,d+0.02)-1
        if k<0: continue
        a,b,c=segs[k]
        if d>b+0.05: continue
        n=norm(c)
        if not n: continue
        # what the bass was doing in this bar, from bass_notes, for the reader
        i0=bisect.bisect_left(beats,d); i1=bisect.bisect_left(beats,d+4*m["grid"]["period"]-1e-3)
        roots=[bn[j][:-1] for j in range(i0,min(i1,len(bn))) if j<len(bn) and bn[j]]
        e={"at":round(d,3),"chord":n,"confidence":0.8}
        if roots: e["bass"]=collections.Counter(roots).most_common(1)[0][0]
        ev.append(e)
    obs={"rate":"per_bar",
         "how":("ChordMini BTC large-vocabulary model (170 classes; ptnghia-j/ChordMini, MIT) on the "
                "mix, CQT 144 bins / 24 per octave, hop 2048 at 22.05 kHz. Per bar: the segment "
                "covering the downbeat. `segments` holds the model's own boundaries."),
         "estimator":"ChordMini BTC large_voca",
         "not":("checked against an instrument by anyone here. It is a model trained on human "
                "chord annotations, which is a different thing from a human, and 'N' bars carry "
                "no chord rather than a guess"),
         "bars_named":len(ev),"bars_total":len(downs),
         "segments":[{"from":round(a,3),"to":round(b,3),"chord":norm(c) or "N"} for a,b,c in segs],
         "events":ev}
    if write:
        old=m["observations"].get("chords")
        chk=m["observations"].setdefault("chords_check",{})
        if isinstance(old,dict) and old.get("estimator")!="ChordMini BTC large_voca":
            chk["superseded_stem_estimate"]={"how":old.get("how"),"bars_named":old.get("bars_named"),
                "why":("a chord model trained on human annotations beat the stem-chroma estimate on the "
                       "audio check on three of four songs and tied on the fourth, and its labels on "
                       "Levels are the record's actual progression")}
        m["observations"]["chords"]=obs; json.dump(m,open(mp,"w"),indent=1); open(mp,"a").write("\n")
    top=collections.Counter(e["chord"] for e in ev).most_common(5)
    return {"song":slug,"bars":len(ev),"total":len(downs),"segments":len(segs),"top":top,"wrote":write}

if __name__=="__main__":
    args=[a for a in sys.argv[1:] if not a.startswith("--")]; write="--write" in sys.argv
    for slug in (args or ["levels","starlight","mizhiyoram","dont-look-down"]):
        r=analyse(slug,write)
        if "error" in r: print("  %-16s %s"%(slug,r["error"])); continue
        print("  %-16s %3d/%3d bars, %3d segments   %s%s" % (slug,r["bars"],r["total"],r["segments"]," ".join("%s x%d"%kv for kv in r["top"]),"  -> written" if write else ""))
