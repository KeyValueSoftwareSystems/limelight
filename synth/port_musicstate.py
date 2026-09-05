#!/usr/bin/env python3
"""Port a musicstate file into a Limelight map. Stdlib only.

    python3 synth/port_musicstate.py levels.musicstate.json [--who dheeraj]

musicstate carries real things our format has no home for, so this is a
translation rather than a rename, and every decision it makes is recorded in the
output rather than being silent.
"""
import json, os, sys, argparse

HERE = os.path.dirname(os.path.abspath(__file__))
CANON = ("drums", "bass", "other", "vocals", "guitar", "piano")
KINDS = {"build", "drop", "stop", "quiet", "spotlight", "return"}


def merge_runs(sections):
    """Consecutive sections with the same label are one section.

    allin1 emits fixed phrase-length blocks -- at 128 bpm its 15.00 s segments are
    exactly 8 bars, which is the unit house music is built from, so the boundaries
    are real. But four consecutive blocks all labelled 'chorus' is one chorus, not
    four, and a reader that cannot tell a repeat from a continuation will escalate
    in the wrong place."""
    out = []
    for s in sections:
        if out and out[-1]["label"] == s["label"]:
            out[-1]["t1"] = s["t1"]
        else:
            out.append(dict(s))
    return out


def port(ms, vec_name=None):
    meta, dur = ms["meta"], ms["source"]["duration_s"]
    beats = ms["beats"]
    per = 60.0 / meta["tempo_bpm"]
    phase = beats[0] if beats else 0.0
    downs = ms.get("downbeats", [])

    runs = merge_runs(ms.get("sections", []))
    chapters, entries, seen = [], [], {}
    for r in runs:
        lab = r["label"]
        chapters.append({"at": round(r["t0"], 6), "name": lab})
        sid = lab[:1].upper()
        seen[sid] = seen.get(sid, 0) + 1
        entries.append({"at": round(r["t0"], 6), "to": round(r["t1"], 6), "name": lab,
                        "id": sid, "repeat": seen[sid],
                        "arc": round(r["t0"] / dur, 3) if dur else 0.0})

    moments, dropped = [], []
    for e in ms.get("events", []):
        k = e.get("type")
        if k in KINDS:
            m = {"at": round(e["t"], 6), "kind": k, "confidence": e.get("conf")}
            if k == "drop": m["size"] = round(min(1.0, e.get("conf", 0.5) + 0.2), 3)
            moments.append(m)
        else:
            dropped.append(k)
    moments.sort(key=lambda m: m["at"])

    # a build followed by a drop is a span with a shape; a lone build is not
    spans = []
    for i, m in enumerate(moments):
        if m["kind"] != "build": continue
        nxt = next((x for x in moments[i + 1:] if x["kind"] == "drop"), None)
        if nxt and nxt["at"] > m["at"]:
            spans.append({"kind": "build", "from": m["at"], "to": nxt["at"],
                          "rise": "steady", "bars": round((nxt["at"] - m["at"]) / (per * 4), 1),
                          "how": "derived: musicstate build event to the next drop event"})

    stems = {}
    st = ms.get("stems") or {}
    names, pd = st.get("names", []), st.get("per_downbeat") or []
    stem_at = []
    if names and pd:
        # rows are dicts carrying their own time, which is better than ours -- a
        # presence curve that does not say when it was sampled has to be aligned
        # by trusting a separate list stayed the same length
        rows = [r if isinstance(r, dict) else dict(zip(names, r)) for r in pd]
        stem_at = [round(float(r["t"]), 6) for r in rows if "t" in r]
        for k in CANON:
            stems[k] = [round(float(r.get(k, 0.0)), 4) for r in rows]

    obs = {}
    sem = ms.get("semantic") or {}
    if sem.get("status") == "ok":
        obs["semantic"] = {
            "how": sem.get("backend"), "mood": sem.get("mood"),
            "danceability": sem.get("danceability"), "voice": sem.get("voice"),
            "genre_top": sem.get("genre_top"),
            "note": "Whole-song judgements, not per-moment. party and danceability are the two a "
                    "lighting recipe can act on directly; the rest are context.",
        }
    fr = ms.get("frames") or {}
    if fr.get("n"):
        b = fr.get("bands") or {}
        obs["frames"] = {
            "how": "librosa, per hop", "hop_s": fr["hop_s"], "t0": fr.get("t0", 0.0),
            "n": fr["n"],
            "rms": [round(v, 4) for v in fr.get("rms", [])],
            "onset": [round(v, 4) for v in fr.get("onset", [])],
            "low": [round(v, 4) for v in b.get("low", [])],
            "mid": [round(v, 4) for v in b.get("mid", [])],
            "high": [round(v, 4) for v in b.get("high", [])],
            "note": "A continuous stream at about 43 Hz, which nothing else in this format "
                    "provides. Beats and moments say when something happens; this says what the "
                    "sound is doing between them, split into three bands. It is what lets a "
                    "reader follow texture rather than only punctuation.",
        }
    if meta.get("key"):
        obs["key"] = {"estimate": f"{meta['key']} {meta.get('mode','')}".strip(),
                      "how": "musicstate", "confidence": (ms.get("confidence_by_field") or {}).get("key")}

    m = {
        "map": "0.3",
        "song": {"title": os.path.basename(ms["source"].get("path", "?")),
                 "artist": "?", "length": round(dur, 3)},
        "made_by": {
            "how": "model",
            "who": ms.get("provenance", {}).get("tool", "musicstate"),
            "why": "Ported from musicstate. Beats, downbeats and labelled sections come from "
                   "allin1; energy and the frame stream from librosa; per-stem presence from "
                   "htdemucs; mood and danceability from Essentia; embeddings from MERT.",
            "ported_by": "synth/port_musicstate.py",
            "analyzers": ms.get("provenance", {}).get("analyzers", []),
            "port_notes": [
                f"{len(ms.get('sections', []))} sections merged to {len(runs)}: consecutive blocks "
                "with the same label are one section, not several.",
                "spans derived by pairing each build event with the next drop event.",
                f"moment kinds not in our six were dropped: {sorted(set(dropped)) or 'none'}.",
                "guitar and piano are explicit zeros — htdemucs 4-stem does not separate them, and "
                "an absent field would read as 0.5.",
            ],
        },
        "grid": {"period": round(per, 6), "phase": round(phase, 4),
                 "bpm": meta["tempo_bpm"], "bar_phase": 0, "locked": False,
                 "how": "allin1 beat tracking",
                 "note": "beats start at the first tracked beat, not at t=0"},
        "beats": [round(b, 6) for b in beats],
        "downbeats": [round(b, 6) for b in downs],
        "beats_window": [0.0, round(dur, 3)],
        "chapters": chapters,
        "sections": {"how": "allin1 labelled segments, consecutive same-label runs merged",
                     "entries": entries},
        "spans": spans, "moments": moments,
        "energy": [[round(t, 6), round(v, 4)] for t, v in ms.get("energy", [])],
        "confidence": round(sum((ms.get("confidence_by_field") or {}).values())
                            / max(1, len(ms.get("confidence_by_field") or {})), 3),
        "confidence_by_field": ms.get("confidence_by_field", {}),
        "stems": {"model": st.get("model", "?"), "rate": "per_downbeat", "sources": stems,
                  "at": stem_at or [round(b, 6) for b in downs][:len(pd)],
                  "vocal_present_fraction": st.get("vocal_present_fraction"),
                  "note": "Four-stem htdemucs mapped onto the six canonical names."},
        "observations": obs,
    }
    emb = ms.get("embedding") or {}
    if emb.get("status") == "ok":
        m["vectors"] = {k: emb[k] for k in ("model", "rate", "rows", "dim", "dtype") if k in emb}
        m["vectors"]["file"] = vec_name or emb.get("file")
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src"); ap.add_argument("--who", default="dheeraj")
    ap.add_argument("--song", default=None)
    a = ap.parse_args()
    ms = json.load(open(a.src))
    slug = a.song or os.path.basename(a.src).split(".")[0]
    m = port(ms, vec_name=f"{slug}.{a.who}.vec.f16")
    d = os.path.join(HERE, "maps", a.who); os.makedirs(d, exist_ok=True)
    out = os.path.join(d, f"{slug}.map.json")
    json.dump(m, open(out, "w"), indent=1)
    print(f"  {slug}  {m['song']['length']}s  {m['grid']['bpm']} bpm  "
          f"{len(m['beats'])} beats  {len(m['downbeats'])} downbeats")
    print(f"  chapters {len(m['chapters'])}  sections {len(m['sections']['entries'])}  "
          f"moments {len(m['moments'])}  spans {len(m['spans'])}")
    print(f"  observations: {', '.join(m['observations'])}")
    print(f"  -> {os.path.relpath(out, os.path.dirname(HERE))}  "
          f"({os.path.getsize(out)/1024:.0f} KB)")

if __name__ == "__main__":
    main()
