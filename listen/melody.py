"""observations.melody from the note transcription, top voice only.

Why this exists. The first melody on Levels came from autocorrelation f0 on the
vocals stem, and it ran the whole length of the song -- 276 notes, including
long stretches where nobody is singing, because an autocorrelation always
returns a period whether or not there is a pitch to find. Only 81 of those 276
sit under any transcribed vocal note. It was answering a question the audio had
not asked.

pyin replaced it on three songs and scored 1.00 there. It declined Levels: the
chopped soul sample is voiced for 4.2% of the record by pyin's own probability,
below the floor, and a field is left alone rather than guessed.

observations.notes now holds a real polyphonic transcription per stem. The
melody is the top voice of the vocal transcription -- the skyline, the note a
listener hears as the tune when two sound at once. That is a derivation of a
measurement already in the file, by the same writer, not a second opinion about
the same fact (rule 8).

The old estimate is kept beside it under `superseded` so the two can be told
apart later.
"""
import json,os,sys

ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
try:
    from mapio import map_path
except ImportError:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from mapio import map_path
SUNG_LO,SUNG_HI=48,84        # C3..C6, the range a lead vocal occupies
MIN_AMP=0.30                 # basic-pitch's own confidence, below which it is guessing

def skyline(notes):
    """One note at a time: where notes overlap, keep the highest and trim the rest."""
    out=[]
    for n in sorted(notes,key=lambda n:(n[0],-n[2])):
        s,d,midi=n[0],n[1],n[2]
        if out:
            p=out[-1]; pe=p[0]+p[1]
            if s<pe-1e-6:
                if midi<=p[2]:
                    s=pe; d=n[0]+n[1]-s          # start after the higher note finishes
                    if d<=0.04: continue
                else:
                    p[1]=round(max(0.0,s-p[0]),3)  # the higher note interrupts
                    if p[1]<=0.04: out.pop()
        out.append([round(s,3),round(d,3),int(midi),n[3],n[4]])
    return out

def analyse(slug,write=False):
    p=map_path(slug)
    if not p: return {"error":"no map for "+slug}
    m=json.load(open(p)); o=m.setdefault("observations",{})
    src=((o.get("notes") or {}).get("sources") or {}).get("vocals")
    if src is None: return {"error":"no observations.notes.sources.vocals -- run listen/notes.py first"}
    kept=[n for n in src if SUNG_LO<=n[2]<=SUNG_HI and n[4]>=MIN_AMP]
    if len(kept)<20: return {"error":"only %d vocal notes in the sung range"%len(kept)}
    line=skyline(kept)
    old=o.get("melody")
    mel={"rate":"per_note","unit":"[start_s, duration_s, midi, name, confidence]",
         "how":"top voice of observations.notes.sources.vocals -- the polyphonic "
               "transcription of the separated vocal, restricted to MIDI %d-%d and "
               "confidence >= %.2f, then reduced to one note at a time by keeping the "
               "higher pitch wherever two overlap"%(SUNG_LO,SUNG_HI,MIN_AMP),
         "not":"not the lead line of the record. On a song whose hook is played rather "
               "than sung this describes the voice and nothing else; the instrument "
               "stems are transcribed too, in observations.notes, and are not merged in "
               "here because which stem carries the tune is a judgement nothing in this "
               "pipeline has measured.",
         "start_times":"already carry the -25 ms separator latency from observations.stem_latency",
         "notes":line}
    if old is not None:
        mel["superseded"]={"was":old.get("how"),"n_notes":len(old.get("notes") or []),
                           "why":"an autocorrelation returns a period whether or not a pitch "
                                 "is there, so it claimed a note for the whole record; only "
                                 "%d of its %d notes lay under any transcribed vocal note"
                                 %(sum(1 for n in (old.get("notes") or []) if any(b[0]-0.05<=n[0]<b[0]+b[1]+0.05 for b in src)),
                                   len(old.get("notes") or []))}
    o["melody"]=mel
    if write:
        json.dump(m,open(p,"w"),indent=1,ensure_ascii=False); open(p,"a").write("\n")
    return {"kept":len(kept),"line":len(line),"was":len((old or {}).get("notes") or []),
            "span":"%.1f-%.1f s"%(line[0][0],line[-1][0])}

if __name__=="__main__":
    args=[a for a in sys.argv[1:] if not a.startswith("--")]; write="--write" in sys.argv
    for slug in (args or ["levels"]):
        r=analyse(slug,write)
        print("  %-16s %s"%(slug,r.get("error") or
              "%d vocal notes -> %d in the melody (was %d), %s%s"%(r["kept"],r["line"],r["was"],r["span"]," -> written" if write else "")))
