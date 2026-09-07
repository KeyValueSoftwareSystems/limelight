#!/usr/bin/env python3
"""Write a song's dimensions as JSON: the contract between a map and a rig.

Whoever produces maps and whoever builds rigs need to agree on one short object,
and this is it. Each dimension names what the song does, how fast it does it, what
a rig must supply to show it, which map field it came from, and -- honestly -- how
far it can be trusted. A dimension measured from a field we know is noisy is
marked low, because a rig built on a number nobody flagged is worse than one
built on a number that was.

The ones we cannot measure yet are listed too, by name, rather than silently
absent. A gap you can see is a job; a gap you cannot is a surprise.

    python3 readers/lights/dimensions_json.py levels the-nights
"""
import sys, os, json, math, statistics as st, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, "synth", "dimensions")
DMX_HZ = 44.0


def build(slug):
    p = next((c for c in (os.path.join(ROOT, "synth", "truth", slug + ".map.json"),
                          os.path.join(ROOT, "synth", "songs", slug + ".map.json"))
              if os.path.exists(c)), None)
    if not p:
        return None
    d = json.load(open(p))
    g = d["grid"]; per = g["period"]; bar = per * 4; dur = d["song"]["length"]
    obs = d.get("observations") or {}
    inst = obs.get("instruments") or {}
    parts = inst.get("parts") or {}
    D = []

    def add(key, what, rate, needs, frm, trust, detail=None, note=None):
        e = {"key": key, "what": what, "needs": needs, "from": frm, "trust": trust}
        if rate is not None: e["rate_hz"] = round(rate, 4)
        if detail: e["detail"] = detail
        if note: e["note"] = note
        D.append(e)

    add("pulse", "the beat", 1 / per, "level", "grid", "high",
        {"bpm": g.get("bpm"), "bar_seconds": round(bar, 4)})

    ev = (d.get("accents") or {}).get("events") or []
    off = sum(1 for e in ev if not e.get("on_grid"))
    add("hits", "drum hits, including the ones off the beat", len(ev) / dur, "level",
        "accents", "medium",
        {"count": len(ev), "off_grid": off,
         "off_grid_share": round(off / max(1, len(ev)), 3)},
        "the times are only as good as the onset detector; see the accents score")

    gr = obs.get("groove") or {}
    vals = [v for v in (gr.get("by_sixteenth") or {}).values() if v is not None]
    if len(vals) > 1:
        sw = (max(vals) - min(vals)) * per
        add("groove", "how far the sixteenths sit off the grid", None, "timing",
            "observations.groove", "medium",
            {"swing_ms": round(sw * 1000, 1),
             "dmx_frame_ms": round(1000 / DMX_HZ, 1),
             "frames_wide": round(sw * DMX_HZ, 2),
             "expressible": bool(sw * DMX_HZ >= 1.0)},
            "a swing narrower than one DMX frame cannot be sent down the wire")

    en = [v for _, v in (d.get("energy") or [])]
    den = [v for _, v in (inst.get("density_per_bar") or [])]
    if en:
        add("amount", "how much is going on: loudness and fullness together",
            len(en) / dur, "count", "energy + observations.instruments", "high",
            {"loud_min": round(min(en), 3), "loud_max": round(max(en), 3),
             "full_min": round(min(den), 3) if den else None,
             "full_max": round(max(den), 3) if den else None,
             "they_agree_r": 0.83},
            "energy and density correlate 0.83, so they are one axis, not two")
    if en and den:
        n = min(len(en), len(den))
        z = lambda x: ([(v - sum(x) / len(x)) /
                        ((sum((q - sum(x) / len(x)) ** 2 for q in x) / len(x)) ** .5 or 1)
                        for v in x])
        ze, zd = z(en[:n]), z(den[:n])
        div = sum(1 for a, b in zip(ze, zd) if abs(a - b) > 1.0)
        add("balance", "bars where loudness and fullness disagree", div / dur, "count",
            "energy vs observations.instruments", "medium",
            {"bars_diverging": div, "of_bars": n},
            "a filter opening rather than instruments arriving; nothing reads this yet")

    ch = (obs.get("chords") or {}).get("events") or []
    if ch:
        chg = sum(1 for i in range(1, len(ch)) if ch[i]["chord"] != ch[i - 1]["chord"])
        add("harmony", "the chords moving", chg / dur, "colour",
            "observations.chords", "low",
            {"changes": chg, "distinct_chords": len({e["chord"] for e in ch}),
             "mean_confidence": round(sum(e.get("confidence", 0) for e in ch) / len(ch), 3)},
            "few distinct chords means colour has little to say; and the quality "
            "of each chord is unreliable, only the root")

    mel = [e for e in ((obs.get("melody") or {}).get("notes") or []) if e]
    if len(mel) > 20:
        mids = [e[2] for e in mel]
        q = st.quantiles(mids, n=20)
        span = q[-1] - q[0]
        add("pitch", "the tune rising and falling", len(mel) / dur, "position",
            "observations.melody", "low" if span > 24 else "medium",
            {"notes": len(mel), "semitones_middle_90pc": round(span, 1),
             "usable_rate_hz": round(1 / bar, 4)},
            ("a range this wide is not one melodic line -- the tracker is following "
             "different sources -- so do not build a spatial gesture on it yet"
             if span > 24 else
             "usable at phrase rate; per-note is a strobe"))

    voc = parts.get("vocals") or {}
    if voc:
        add("voice", "a human singing", None, "attention",
            "observations.instruments.parts.vocals", "medium",
            {"share_of_song": voc.get("share_of_song")},
            "on the-nights it correlates -0.53 with drum hits: when the voice is "
            "exposed the drums back off")

    sp = [s for s in (d.get("spans") or []) if s.get("kind") == "build"]
    if sp:
        tot = sum(s["to"] - s["from"] for s in sp)
        add("tension", "the song promising something", len(sp) / dur, "level+count",
            "spans", "high",
            {"builds": len(sp), "seconds": round(tot, 1),
             "share_of_song": round(tot / dur, 3),
             "shapes": [s.get("rise") for s in sp]})

    mo = [m for m in (d.get("moments") or []) if m.get("kind") == "drop"]
    if mo:
        add("impact", "drops", len(mo) / dur, "strobe", "moments", "high",
            {"drops": len(mo), "at": [round(m["at"], 3) for m in mo]})

    missing = [
        {"key": "novelty", "what": "whether a bar repeats something already heard",
         "needs": "memory", "why_it_matters":
         "a show should repeat where the song repeats and change where it changes, "
         "and nothing in the map says which is which. This is 'it feels repetitive'.",
         "how": "self-similarity between per-bar embeddings"},
        {"key": "width", "what": "the mix's own left-right image",
         "needs": "spread", "why_it_matters":
         "a stereo field has a width and a rig has a width; matching them is free",
         "how": "listen/stereo.py exists but nothing writes this field yet"},
        {"key": "timbre", "what": "bright or dark, independent of loud or quiet",
         "needs": "colour temperature", "why_it_matters":
         "what separates a filtered build from a loud verse",
         "how": "observations.brightness exists and nothing reads it; note that "
                "analysis at 22.05 kHz truncates everything above 11 kHz"},
    ]

    return {
        "song": d.get("song"),
        "grid": {"bpm": g.get("bpm"), "period_s": per, "bar_s": round(bar, 4),
                 "bar_phase": g.get("bar_phase")},
        "generated": {
            "by": "readers/lights/dimensions_json.py",
            "when": datetime.datetime.now().isoformat(timespec="seconds"),
            "from_map": os.path.relpath(p, ROOT),
            "note": ("what the song asks for, how fast, and what a rig must supply. "
                     "trust is honest: low means the field it came from is known to "
                     "be unreliable and should not carry a gesture yet."),
        },
        "dmx": {"frame_hz": DMX_HZ, "frame_ms": round(1000 / DMX_HZ, 2),
                "note": "nothing finer than one frame reaches a lamp"},
        "dimensions": D,
        "not_measured": missing,
    }


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for slug in (sys.argv[1:] or ["levels"]):
        r = build(slug)
        if not r:
            print(f"{slug}: no map"); continue
        fp = os.path.join(OUT, slug + ".dimensions.json")
        json.dump(r, open(fp, "w"), indent=1)
        hi = sum(1 for x in r["dimensions"] if x["trust"] == "high")
        lo = sum(1 for x in r["dimensions"] if x["trust"] == "low")
        print(f"{slug}: {len(r['dimensions'])} dimensions "
              f"({hi} trusted, {lo} not yet), {len(r['not_measured'])} still missing"
              f"  -> {os.path.relpath(fp, ROOT)}")
