#!/usr/bin/env python3
"""Project a map into a protocol score.

The map is the measurement and it is in seconds, because seconds are a fact
about a recording. The score is what an application reads, and it is in bars
and beats, because bars are a fact about the music. This is the one place the
two meet, and it runs once per song rather than once per frame.

Sections come out as LAYERS rather than one flat list, because a song is
several structures at once and flattening them loses the part that matters. A
build can begin inside a break and finish inside the verse after it; the voice
is absent across three sections that have nothing else in common. Each layer is
its own timeline, and a layer may overlap any other.

    python3 protocol/make_score.py synth/truth/levels.map.json

The input is deliberately not in git -- it is the held-out reference -- so this
script is committed and its output is committed and the thing in the middle
stays on the machine that measured it.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))


def main(src, out=None):
    m = json.load(open(src))
    g = m["grid"]
    bpb = g.get("beats_per_bar", 4) or 4
    beat_s = g["period"]
    bar_s = beat_s * bpb
    phase = g.get("phase", 0.0)

    def pos(t):
        """seconds -> musical position. The only conversion in the pipeline."""
        b = (t - phase) / bar_s
        bar = int(b) + 1 if b >= 0 else int(b)          # no bar 0 dressed as bar 1
        frac = b - (bar - 1)
        return {"bar": bar, "beat": round(frac * bpb + 1, 3)}

    ent = lambda o: o if isinstance(o, list) else ((o or {}).get("entries") or [])
    length = (m.get("song") or {}).get("length") or 0

    layers = {}

    # form -- a partition. Every bar of the song is in exactly one of these.
    form = []
    for s in ent(m.get("sections")):
        a, b = s.get("at", s.get("from")), s.get("until", s.get("to"))
        if a is None or b is None: continue
        form.append({"from": pos(a), "to": pos(b), "name": s.get("name"),
                     "id": s.get("id"), "repeat": s.get("repeat")})
    if form:
        layers["form"] = {"kind": "partition",
                          "note": "intro, verse, break, drop. id and repeat say "
                                  "which of these are the same thing coming back.",
                          "spans": form}

    # build -- sparse, and the layer that proves overlap is real. A build does
    # not respect a section boundary and never has.
    builds = []
    for s in ent(m.get("spans")):
        a, b = s.get("from"), s.get("to")
        if a is None or b is None: continue
        e = {"from": pos(a), "to": pos(b), "name": s.get("kind")}
        if s.get("rise"): e["rise"] = s["rise"]
        builds.append(e)
    if builds:
        layers["build"] = {"kind": "sparse",
                            "note": "builds and the like. Crosses form boundaries "
                                    "on purpose -- that is what a build does.",
                            "spans": builds}

    # presence -- who is playing. Built from the enters/leaves the stem
    # separation reported, paired in order.
    ob = m.get("observations") or {}
    parts = ((ob.get("instruments") or {}).get("parts") or {})
    pres = []
    # Rule 8, one writer per fact. `instruments.parts.vocals` and
    # `vocal_silence` both answer "is the voice there", by different methods --
    # a hysteresis on stem level against a sustained-quiet run -- and they
    # disagree: at bar 78 the first says present and the second says silent.
    # The silence measurement is the one the map itself calls the cleanest
    # structural signal, so it keeps the fact and vocals leaves this layer.
    skip = {"vocals"} if (ob.get("vocal_silence") or {}).get("spans") else set()
    for name, p in parts.items():
        if name in skip: continue
        ins, outs = list(p.get("enters") or []), list(p.get("leaves") or [])
        for i, a in enumerate(ins):
            b = next((x for x in outs if x > a), length)
            if b > a:
                pres.append({"from": pos(a), "to": pos(b), "name": name})
    if pres:
        pres.sort(key=lambda s: (s["from"]["bar"], s["from"]["beat"]))
        layers["presence"] = {"kind": "sparse",
                              "note": "which instrument is in. Overlapping by "
                                      "nature: the drums and the voice are both "
                                      "present for most of a record.",
                              "spans": pres}

    # silence -- where the voice is absent. Named for the music, not for what a
    # reader might do about it: a lighting reader may black out here, a game may
    # do nothing at all, and the score must not assume either.
    vs = ob.get("vocal_silence") or {}
    sil = [{"from": pos(a), "to": pos(b), "name": "vocal"}
           for a, b in (vs.get("spans") or []) if b > a]
    if sil:
        layers["silence"] = {"kind": "sparse", "note": vs.get("how", ""),
                             "spans": sil}

    # phrase -- a rule, not a list, for the same reason beats are a rule.
    layers["phrase"] = {"kind": "rule", "every_bars": 8,
                        "from_bar": form[1]["from"]["bar"] if len(form) > 1 else 1,
                        "note": "hypermeter, derived. Anchored on the first full "
                                "section rather than on bar one, because the "
                                "intro is usually a pickup."}

    # beats and downbeats -- derived from the grid, and also written out, because
    # a score travelling through a registry as a file should be readable without
    # implementing the derivation first. They are [bar, beat] pairs and never
    # seconds: listing them costs bytes, listing them in seconds would cost
    # correctness, because a list of seconds is wrong the moment the tempo moves.
    # The grid stays authoritative -- if these ever disagree with it, these are
    # the ones that are wrong.
    n_beats = int((length - phase) / beat_s) + 1 if length else 0
    beats = [[i // bpb + 1, i % bpb + 1] for i in range(max(0, n_beats))]
    downbeats = [b for b in beats if b[1] == 1]

    # energy -- measured once a bar, so it ships as one number per bar rather
    # than as 127 objects each repeating a position it could have derived.
    # Same reasoning as the grid: a rule and a start, not a list of coordinates.
    en = m.get("energy") or []
    energy = None
    if en:
        first = pos(en[0][0] if isinstance(en[0], list) else en[0]["at"])
        vals = [round(float(e[1] if isinstance(e, list) else e["v"]), 4) for e in en]
        energy = {"per": "bar", "from_bar": first["bar"], "values": vals,
                  "note": "one number per bar, 0 to 1. Sample between bars by "
                          "interpolating; the client does that, not the wire."}

    moments = [{"at": pos(x.get("at", x.get("t"))), "kind": x.get("kind")}
               for x in ent(m.get("moments")) if x.get("at", x.get("t")) is not None]

    src_by = m.get("made_by") or {}
    score = {
        "score": os.path.basename(src).split(".")[0],
        "version": 2,
        "song": {"title": (m.get("song") or {}).get("title"),
                 "length_s": (m.get("song") or {}).get("length")},
        "grid": {"bpm": g["bpm"], "first_beat_s": round(phase, 4),
                 "beats_per_bar": bpb},
        "beats": {"derived_from": "grid", "as": "[bar, beat]",
                  "count": len(beats), "list": beats},
        "downbeats": {"derived_from": "grid", "as": "[bar, beat]",
                      "count": len(downbeats), "list": downbeats},
        "layers": layers,
        "energy": energy,
        "moments": moments,
        "made_by": {"how": "projected", "from": os.path.relpath(src),
                    "source_how": src_by.get("how"), "source_who": src_by.get("who"),
                    "by": "protocol/make_score.py"},
    }
    out = out or os.path.join(HERE, f"score.{score['score']}.json")
    json.dump(score, open(out, "w"), indent=1)
    print(f"{score['score']}: {score['grid']['bpm']:.1f} bpm, "
          f"{len(moments)} moments, layers:")
    for k, v in layers.items():
        n = len(v.get("spans", [])) if v["kind"] != "rule" else "rule"
        print(f"  {k:10} {v['kind']:10} {n}")
    print(f"  -> {os.path.relpath(out)}")


if __name__ == "__main__":
    a = sys.argv[1:]
    main(a[0] if a else "synth/truth/levels.map.json", a[1] if len(a) > 1 else None)
