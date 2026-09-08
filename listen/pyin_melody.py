#!/usr/bin/env python3
"""The sung melody by probabilistic YIN on the vocals stem. Needs the CUDA venv (librosa).

    $LIMELIGHT_PY_AUDIO listen/pyin_melody.py starlight [--write]

pyin (Mauch & Dixon 2014) tracks f0 with a voicing PROBABILITY per frame, which
is the thing plain autocorrelation lacks: it knows when nobody is singing. Fewer
notes come out and the ones that do are right -- checked against the mix, every
claimed pitch is the loudest thing sounding on three of four songs.

Where the voice is sparse -- Levels is a chopped vocal sample -- pyin voices too
little of the song to say anything, and the autocorrelation melody already in
the map stays. The rule is about the signal (under FALLBACK_VOICED of beats
voiced), not about any score, and the field says which estimator it came from.
Same octave rule as stempitch: a sung fundamental lives above C3.
"""
import sys, os, json, math, subprocess, array, warnings; warnings.filterwarnings("ignore")
import numpy as np, librosa
HERE=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.dirname(HERE); sys.path.insert(0,HERE)
import stempitch
try:
    from mapio import stems_dir
except ImportError:
    import sys as _s, os as _o
    _s.path.insert(0, _o.path.dirname(_o.path.abspath(__file__)))
    from mapio import stems_dir
STEMS = stems_dir()
SR=16000; HOP=256; PROB=0.50; FALLBACK_VOICED=0.15
NAMES=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"]

def decode(p,sr):
    out=subprocess.run(["ffmpeg","-v","error","-i",p,"-ac","1","-ar",str(sr),"-f","s16le","-"],stdout=subprocess.PIPE,check=True).stdout
    a=array.array("h"); a.frombytes(out); return np.asarray(a,np.float32)/32768.0
def midi_name(hz):
    mi=int(round(69+12*math.log2(hz/440.0))); return mi,"%s%d"%(NAMES[mi%12],mi//12-1)
try:
    from mapio import map_path
except ImportError:
    import sys as _s, os as _o
    _s.path.insert(0, _o.path.dirname(_o.path.abspath(__file__)))
    from mapio import map_path

def analyse(slug, write=False):
    mp=map_path(slug); vp="%s/%s/vocals.mp3"%(STEMS,slug)
    if not mp or not os.path.exists(vp): return {"song":slug,"error":"no map or vocals stem"}
    m=json.load(open(mp)); beats=m["beats"]; per=m["grid"]["period"]
    y=decode(vp,SR)
    f0,vflag,vprob=librosa.pyin(y,fmin=80,fmax=1000,sr=SR,hop_length=HOP,frame_length=2048)
    t=librosa.frames_to_time(np.arange(len(f0)),sr=SR,hop_length=HOP)
    x8=list(decode(vp,8820))
    notes=[];clar=[]
    for b in beats:
        sel=(t>=b)&(t<b+min(0.26,per*0.8)); f=f0[sel]; p=vprob[sel]; ok=~np.isnan(f)
        if ok.sum()<2 or p.mean()<PROB: notes.append(None); clar.append(round(float(p.mean()),3) if len(p) else 0.0); continue
        hz=float(np.median(f[ok])); hz=stempitch.fix_octave(x8,int(b*8820),int(8820*0.26),hz,8820,1050.0,lo_sung=125.0)
        notes.append(hz); clar.append(round(float(p[ok].mean()),3))
    voiced=sum(1 for n in notes if n); share=voiced/len(beats)
    if share<FALLBACK_VOICED:
        if write:
            mel=m["observations"].get("melody")
            if isinstance(mel,dict):
                mel["pyin_declined"]=("pyin voiced %.0f%% of beats (%d of %d), under the %.0f%% floor; the "
                                      "autocorrelation estimate stays" % (100*share,voiced,len(beats),100*FALLBACK_VOICED))
                json.dump(m,open(mp,"w"),indent=1); open(mp,"a").write("\n")
        return {"song":slug,"fallback":True,"voiced_pct":round(100*share,1)}
    names=[midi_name(h)[1] if h else None for h in notes]; ev=[]; i=0
    while i<len(names):
        if not names[i]: i+=1; continue
        j=i
        while j+1<len(names) and names[j+1]==names[i]: j+=1
        t0=beats[i]; t1=beats[j+1] if j+1<len(beats) else beats[j]+per
        mi,nm=midi_name(notes[i]); ev.append([round(t0,3),round(max(0.05,t1-t0),3),mi,nm,round(max(clar[i:j+1]),3)]); i=j+1
    obs={"rate":"per_beat","format":"[start_s, duration_s, midi, name, amplitude]",
         "how":("librosa.pyin on the separated vocals stem, 80-1000 Hz, frame 2048 / hop 256 at 16 kHz; "
                "per beat the median voiced f0 over the first quarter of the beat, kept only when mean "
                "voicing probability >= %.2f; octave settled on the stem itself (a sung fundamental lives "
                "above C3); consecutive beats on one pitch merged into one note" % PROB),
         "not":("every beat. pyin voices %.0f%% of beats here and claims nothing for the rest, which is a "
                "smaller and more honest list than autocorrelation produced" % (100*share)),
         "estimator":"pyin","voiced_beats":voiced,"total_beats":len(beats),"note_events":len(ev),
         "per_beat":names,"clarity":clar,"notes":ev}
    if write:
        old=m["observations"].get("melody")
        if isinstance(old,dict) and old.get("estimator")!="pyin":
            obs["superseded"]={"estimator":"autocorrelation","note_events":old.get("note_events"),"how":old.get("how")}
        m["observations"]["melody"]=obs; json.dump(m,open(mp,"w"),indent=1); open(mp,"a").write("\n")
    return {"song":slug,"fallback":False,"voiced_pct":round(100*share,1),"events":len(ev)}

if __name__=="__main__":
    args=[a for a in sys.argv[1:] if not a.startswith("--")]; write="--write" in sys.argv
    for slug in (args or ["levels","starlight","mizhiyoram","dont-look-down"]):
        r=analyse(slug,write)
        if "error" in r: print("  %-16s %s"%(slug,r["error"])); continue
        print("  %-16s %s" % (slug, ("pyin declined: voiced %.1f%% of beats, autocorrelation stays"%r["voiced_pct"]) if r["fallback"]
              else "pyin: %d note events, voiced %.1f%% of beats%s"%(r["events"],r["voiced_pct"],"  -> written" if write else "")))
