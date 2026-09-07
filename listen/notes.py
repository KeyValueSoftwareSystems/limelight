#!/usr/bin/env python3
"""Note-level transcription per stem, with Spotify basic-pitch. Runs in the 3.11 venv.

    /tmp/claude-1001/bp/bin/python listen/notes.py levels [--write]

Polyphonic, per separated stem, the same settings the-nights used: onset 0.55,
frame 0.35, minimum note 70 ms, ONNX backend on CPU. Format
[start_s, duration_s, midi, name, amplitude] per stem, so a reader that handles
the-nights handles these.

Stems run 25.0 ms behind the mix they came from (observations.stem_latency,
measured by cross-correlation on all four songs), so every start time here is
moved 25 ms EARLIER to land in the record's time, and the field says so. Drums
are not transcribed: a kick is not a pitch.
"""
import os, sys, json, subprocess, tempfile, math, time, warnings; warnings.filterwarnings("ignore")
HERE=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.dirname(HERE)
STEMS="/tmp/claude-1001/stems/htdemucs_6s"; ORDER=("vocals","other","guitar","piano","bass")
ONSET,FRAME,MINLEN=0.55,0.35,70; LAT=0.025
NAMES=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"]
def name(mi): return "%s%d"%(NAMES[mi%12],mi//12-1)
try:
    from mapio import map_path
except ImportError:
    import sys as _s, os as _o
    _s.path.insert(0, _o.path.dirname(_o.path.abspath(__file__)))
    from mapio import map_path
def analyse(slug, write=False):
    from basic_pitch.inference import predict, Model
    from basic_pitch import ICASSP_2022_MODEL_PATH
    mp=map_path(slug)
    if not mp: return {"song":slug,"error":"no map"}
    model=Model(ICASSP_2022_MODEL_PATH); sources={}; t0=time.time()
    for st in ORDER:
        p=os.path.join(STEMS,slug,st+".mp3")
        if not os.path.exists(p): continue
        wav=tempfile.mktemp(suffix=".wav",prefix="bp_%s_%s_"%(slug,st))
        subprocess.run(["ffmpeg","-v","error","-y","-i",p,"-ac","1","-ar","22050",wav],check=True)
        _,_,events=predict(wav,model,onset_threshold=ONSET,frame_threshold=FRAME,minimum_note_length=MINLEN)
        os.unlink(wav)
        rows=[]
        for e in sorted(events,key=lambda e:e[0]):
            s,en,mi,amp=float(e[0])-LAT,float(e[1])-LAT,int(e[2]),float(e[3])
            if en<=0: continue
            rows.append([round(max(0.0,s),3),round(en-max(0.0,s),3),mi,name(mi),round(amp,3)])
        sources[st]=rows
    obs={"how":("Spotify basic-pitch (ICASSP 2022) via the ONNX backend, polyphonic, per stem, onset %.2f / frame %.2f / "
                "min %d ms; start times moved %.0f ms earlier to take out the separator's measured latency "
                "(observations.stem_latency)" % (ONSET,FRAME,MINLEN,LAT*1000)),
         "format":"[start_s, duration_s, midi, name, amplitude]",
         "note":("a model's transcription of a separated stem, not a score. Amplitude is the model's, not dB. "
                 "Drums are not here because a kick is not a pitch."),
         "sources":sources,"seconds":round(time.time()-t0,1)}
    if write:
        m=json.load(open(mp)); m["observations"]["notes"]=obs; json.dump(m,open(mp,"w"),indent=1); open(mp,"a").write("\n")
    return {"song":slug,"counts":{k:len(v) for k,v in sources.items()},"seconds":obs["seconds"],"wrote":write}
if __name__=="__main__":
    args=[a for a in sys.argv[1:] if not a.startswith("--")]; write="--write" in sys.argv
    for slug in (args or ["levels","starlight","mizhiyoram","dont-look-down"]):
        r=analyse(slug,write)
        if "error" in r: print("  %-16s %s"%(slug,r["error"])); continue
        print("  %-16s notes %s  %.0fs%s" % (slug,r["counts"],r["seconds"],"  -> written" if write else ""))
