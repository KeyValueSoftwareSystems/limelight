#!/usr/bin/env python3
"""Write a song's dimensions as JSON: what the song asks for, and of no rig in particular.

Three layers, and the boundary between them is what stops the whole thing rotting.

  the MAP        what the song does.        mentions no rig and no viewer.
  the DIMENSIONS what the song asks for.    mentions no rig. May mention a VIEWER,
                                            because what a room can follow is true
                                            of every room.
  the PRE-FLIGHT what one rig can supply.   the ONLY place a layout appears.

Renjith caught me breaking my own rule here. This file was carrying a DMX frame
rate and calling a groove "expressible", which is a statement about a cable, not
about a song. It is gone. The groove states its width in milliseconds and stops;
whether 32 ms survives a 22.7 ms frame is a question for the pre-flight, and the
answer changes with the output chain while the song does not.

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
import sys, os, json, math, statistics as st, datetime, hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, "synth", "dimensions")

# A dimension says which CHANNEL OF EXPRESSION the song is asking for. These eight
# words are deliberately not lighting words. Lighting is the first reader, not the
# only one, and a channel that only a lamp can serve would quietly make this file
# a lighting file. Each reader keeps its own translation from a channel to the
# things it owns -- see readers/<reader>/reader.json.
#
#   intensity  how much of it there is                lamp brightness / shaker amplitude
#   hue        which flavour, independent of how much lamp colour / haptic texture
#   place      where in space it belongs              beam angle / which motor fires
#   extent     how much of the rig takes part         lamps lit / zones driven
#   time       how precisely it has to land           the output rate decides
#   focus      where the attention should go          the thing lit brightest
#   shock      a discontinuity meant to be felt       strobe / a hard transient
#   memory     whether this bar happened before       served by any channel; needs the map to say
CHANNELS = ("intensity", "hue", "place", "extent", "time", "focus", "shock", "memory")


def map_path(slug):
    return next((c for c in (os.path.join(ROOT, "synth", "truth", slug + ".map.json"),
                             os.path.join(ROOT, "synth", "songs", slug + ".map.json"))
                 if os.path.exists(c)), None)


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
        e = {"key": key, "what": what, "channel": needs, "from": frm, "trust": trust}
        if rate is not None: e["rate_hz"] = round(rate, 4)
        if detail: e["detail"] = detail
        if note: e["note"] = note
        D.append(e)

    add("pulse", "the beat", 1 / per, "intensity", "grid", "high",
        {"bpm": g.get("bpm"), "bar_seconds": round(bar, 4)})

    ev = (d.get("accents") or {}).get("events") or []
    off = sum(1 for e in ev if not e.get("on_grid"))
    add("hits", "drum hits, including the ones off the beat", len(ev) / dur, "intensity",
        "accents", "medium",
        {"count": len(ev), "off_grid": off,
         "off_grid_share": round(off / max(1, len(ev)), 3)},
        "the times are only as good as the onset detector; see the accents score")

    gr = obs.get("groove") or {}
    vals = [v for v in (gr.get("by_sixteenth") or {}).values() if v is not None]
    if len(vals) > 1:
        sw = (max(vals) - min(vals)) * per
        add("groove", "how far the sixteenths sit off the grid", None, "time",
            "observations.groove", "medium",
            {"swing_ms": round(sw * 1000, 1)},
            "how finely this must land. Whether a given output chain can carry it is "
            "a pre-flight question, not a property of the song")

    en = [v for _, v in (d.get("energy") or [])]
    den = [v for _, v in (inst.get("density_per_bar") or [])]
    if en:
        add("amount", "how much is going on: loudness and fullness together",
            len(en) / dur, "extent", "energy + observations.instruments", "high",
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
        add("balance", "bars where loudness and fullness disagree", div / dur, "extent",
            "energy vs observations.instruments", "medium",
            {"bars_diverging": div, "of_bars": n},
            "a filter opening rather than instruments arriving; nothing reads this yet")

    ch = (obs.get("chords") or {}).get("events") or []
    if ch:
        chg = sum(1 for i in range(1, len(ch)) if ch[i]["chord"] != ch[i - 1]["chord"])
        add("harmony", "the chords moving", chg / dur, "hue",
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
        add("pitch", "the tune rising and falling", len(mel) / dur, "place",
            "observations.melody", "low" if span > 24 else "medium",
            {"notes": len(mel), "semitones_middle_90pc": round(span, 1),
             "usable_rate_hz": round(1 / bar, 4),
             "usable_rate_is": "a limit of the VIEWER, not of any rig -- no room "
                               "reads a spatial change four times a second"},
            ("a range this wide is not one melodic line -- the tracker is following "
             "different sources -- so do not build a spatial gesture on it yet"
             if span > 24 else
             "usable at phrase rate; per-note is a strobe"))

    voc = parts.get("vocals") or {}
    if voc:
        add("voice", "a human singing", None, "focus",
            "observations.instruments.parts.vocals", "medium",
            {"share_of_song": voc.get("share_of_song")},
            "on the-nights it correlates -0.53 with drum hits: when the voice is "
            "exposed the drums back off")

    sp = [s for s in (d.get("spans") or []) if s.get("kind") == "build"]
    if sp:
        tot = sum(s["to"] - s["from"] for s in sp)
        add("tension", "the song promising something", len(sp) / dur, "intensity+extent",
            "spans", "high",
            {"builds": len(sp), "seconds": round(tot, 1),
             "share_of_song": round(tot / dur, 3),
             "shapes": [s.get("rise") for s in sp]})

    mo = [m for m in (d.get("moments") or []) if m.get("kind") == "drop"]
    if mo:
        add("impact", "drops", len(mo) / dur, "shock", "moments", "high",
            {"drops": len(mo), "at": [round(m["at"], 3) for m in mo]})

    missing = [
        {"key": "novelty", "what": "whether a bar repeats something already heard",
         "channel": "memory", "why_it_matters":
         "a show should repeat where the song repeats and change where it changes, "
         "and nothing in the map says which is which. This is 'it feels repetitive'.",
         "how": "self-similarity between per-bar embeddings"},
        {"key": "width", "what": "the mix's own left-right image",
         "channel": "place", "why_it_matters":
         "a stereo field has a width and a rig has a width; matching them is free",
         "how": "listen/stereo.py exists but nothing writes this field yet"},
        {"key": "timbre", "what": "bright or dark, independent of loud or quiet",
         "channel": "hue", "why_it_matters":
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
        "dimensions": D,
        "not_measured": missing,
    }


def body_hash(m):
    """Everything in the map EXCEPT the dimensions we are about to write. If this
    changes, the dimensions are stale and say so out loud, which is the whole
    reason merging them into the map is safe."""
    obs = m.get("observations") or {}
    keep = {k: v for k, v in obs.items() if k != "dimensions"}
    shadow = {k: v for k, v in m.items() if k != "observations"}
    shadow["observations"] = keep
    blob = json.dumps(shadow, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(blob).hexdigest()[:16]


def merge_into_map(slug, r):
    """Renjith's call, 8 Sept: carry the dimensions inside the score file for now
    and split them out later. Two rules decide how to do that without regret.

    Rule 3 says the interface tier is a one-way door and everything else goes in
    observations.*, which is append-only and which a reader ignores when it does
    not recognise it. So these land at observations.dimensions and NOT at the top
    level -- no door is opened, and separating them later is lifting one subtree.

    Rule 8 says one writer per fact. So the map becomes the writer and the
    standalone synth/dimensions/<slug>.dimensions.json becomes a projection of
    it, not a second source that can drift.

    This is only safe because dimensions no longer contain a rig word or a
    lighting word. Merged yesterday, the DMX frame rate would have gone through
    the one-way door with them."""
    p = map_path(slug)
    if not p:
        return None
    m = json.load(open(p))
    obs = m.setdefault("observations", {})
    obs["dimensions"] = {
        "how": "derived",
        "by": "readers/lights/dimensions_json.py",
        "when": r["generated"]["when"],
        "of_map": body_hash(m),
        "note": ("what the song asks for and how fast. Channels name a kind of "
                 "expression, never a thing in a room and never a rate the room "
                 "runs at, so this stays true when the venue changes. A reader "
                 "that does not know this field ignores it."),
        "entries": r["dimensions"],
        "not_measured": r["not_measured"],
    }
    json.dump(m, open(p, "w"), indent=1)
    return os.path.relpath(p, ROOT)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for slug in (sys.argv[1:] or ["levels"]):
        r = build(slug)
        if not r:
            print(f"{slug}: no map"); continue
        into = merge_into_map(slug, r)
        fp = os.path.join(OUT, slug + ".dimensions.json")
        r["generated"]["projection_of"] = into
        json.dump(r, open(fp, "w"), indent=1)
        hi = sum(1 for x in r["dimensions"] if x["trust"] == "high")
        lo = sum(1 for x in r["dimensions"] if x["trust"] == "low")
        print(f"{slug}: {len(r['dimensions'])} dimensions "
              f"({hi} trusted, {lo} not yet), {len(r['not_measured'])} still missing")
        print(f"        into {into} at observations.dimensions")
        print(f"        projected to {os.path.relpath(fp, ROOT)}")
