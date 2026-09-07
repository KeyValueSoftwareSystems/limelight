#!/usr/bin/env python3
"""What a song demands, what a rig can supply, and whether the rates meet.

The pre-flight had a gesture list I wrote by hand -- a guess at what a show wants.
This replaces the guess. A song varies along a handful of DIMENSIONS, each one
measured in the map, and each one changes at a RATE. A rig supplies capabilities,
and each capability has a rate ceiling set by physics: how fast a motor turns, how
often DMX can send a new value, how quickly a lamp can rise.

Put those two lists side by side and most of the assignment falls out as
arithmetic rather than taste. A moving head cannot express a dimension that
changes eight times a second, because its motor needs half a second to cross the
stage -- so the sixteenth-note hits must live on something that changes level, not
on something that changes position. Nobody has to have an opinion about that.

The interesting cases are the near misses. Levels swings its last sixteenth about
30 ms late, and one DMX frame at 44 Hz is 22.7 ms -- so that groove is one and a
third frames wide. It is expressible, barely, and on a slower output chain it
simply is not. That is a fact about a song meeting a fact about a wire, and it is
the kind of thing you want to learn before the truck is loaded.

    python3 readers/lights/dimensions.py levels
    python3 readers/lights/dimensions.py levels --rig small
"""
import sys, os, json, glob, math

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
DMX_HZ = 44.0          # DMX512 at full 512-channel universes: 22.7 ms per frame


def measure(m):
    """Each dimension, how fast it moves in THIS song, and what it needs from a rig."""
    g = m["grid"]; per = g["period"]; dur = m["song"]["length"]
    obs = m.get("observations") or {}
    n = lambda x: len(x or [])
    D = []

    D.append(dict(key="pulse", what="the beat",
                  rate=1.0 / per, field="grid",
                  needs="level", why="a lamp changing brightness"))
    D.append(dict(key="metre", what="the bar",
                  rate=1.0 / (per * 4), field="grid.bar_phase",
                  needs="level", why="brightness contrast between beats"))

    ev = (m.get("accents") or {}).get("events") or []
    D.append(dict(key="hits", what="drum hits between the beats",
                  rate=(len(ev) / dur) if dur else 0, field="accents",
                  needs="level", why="short, hard brightness changes"))

    ch = (obs.get("chords") or {}).get("events") or []
    changes = sum(1 for i in range(1, len(ch)) if ch[i]["chord"] != ch[i-1]["chord"])
    D.append(dict(key="harmony", what="the chords moving",
                  rate=(changes / dur) if dur else 0, field="observations.chords",
                  needs="colour", why="the only way a lamp says harmony"))

    inst = obs.get("instruments") or {}
    dens = inst.get("density_per_bar") or []
    dchg = sum(1 for i in range(1, len(dens)) if abs(dens[i][1] - dens[i-1][1]) > 0.08)
    D.append(dict(key="density", what="how full the arrangement is",
                  rate=(dchg / dur) if dur else 0, field="observations.instruments",
                  needs="count", why="expressed by HOW MANY lamps are lit, so it needs many"))

    mel = (obs.get("melody") or {}).get("notes") or []
    voiced = [x for x in mel if x]
    D.append(dict(key="pitch", what="the tune rising and falling",
                  rate=(len(voiced) / dur) if dur else 0, field="observations.melody",
                  needs="position", why="pitch has an axis, so it wants a row to walk along",
                  usable_rate=1.0 / (per * 4)))   # a phrase, not a note

    en = m.get("energy") or []
    D.append(dict(key="energy", what="loud and quiet",
                  rate=(len(en) / dur) if dur else 0, field="energy",
                  needs="level", why="the size of the whole rig"))

    chs = m.get("chapters") or []
    D.append(dict(key="structure", what="parts of the song",
                  rate=(len(chs) / dur) if dur else 0, field="chapters",
                  needs="level", why="a change of look, so it needs everything"))

    mo = [x for x in (m.get("moments") or []) if x.get("kind") == "drop"]
    D.append(dict(key="impact", what="drops",
                  rate=(len(mo) / dur) if dur else 0, field="moments",
                  needs="strobe", why="everything at once, and a strobe if there is one"))

    gr = obs.get("groove")
    if gr:
        # Swing is the SPREAD between the sixteenths, not the largest single offset.
        # A uniform bias on every slot is a detector lag and moves nothing musically;
        # what a listener hears is one sixteenth sitting later than its neighbours.
        # Measuring the max absolute value gave 18 ms and the verdict "impossible";
        # the spread is 32 ms and the verdict is "tight but expressible", which is a
        # different instruction to the person building the rig.
        vals = [v for v in (gr.get("by_sixteenth") or {}).values() if v is not None]
        swing_beats = (max(vals) - min(vals)) if len(vals) > 1 else 0
        D.append(dict(key="groove", what="how far off the grid the hits sit",
                      rate=None, field="observations.groove",
                      needs="timing", why="a hit placed to the millisecond",
                      detail_s=swing_beats * per))
    return D


def rig_rates(lay):
    """What each capability can do, in changes per second, from the layout's own numbers."""
    lim = lay.get("limits") or {}
    caps = {}
    have = lambda c: [f for f in lay["fixtures"] if c in (f.get("can") or [])]

    if have("level"):
        caps["level"] = dict(hz=DMX_HZ, n=len(have("level")),
                             why=f"a level can change every DMX frame, {1000/DMX_HZ:.0f} ms")
    if have("colour"):
        caps["colour"] = dict(hz=DMX_HZ, n=len(have("colour")),
                              why="colour is just more channels, so the same ceiling")
    if have("strobe"):
        caps["strobe"] = dict(hz=lim.get("max_strobe_hz", 4.0), n=len(have("strobe")),
                              why=f"the layout caps it at {lim.get('max_strobe_hz', 4.0)} Hz")
    if have("move"):
        pan = lim.get("max_pan_per_s")
        # to be useful a move must cross a visible fraction of the rig -- call it a
        # third of range -- so the rate is how often it can do that
        hz = (pan / 0.33) if pan else None
        caps["move"] = dict(hz=hz, n=len(have("move")),
                            why=(f"{pan} of range per second, and a move worth seeing crosses "
                                 f"about a third of it" if pan else "no max_pan_per_s stated"))
    caps["count"] = dict(hz=DMX_HZ, n=len(lay["fixtures"]),
                         why="how many lamps there are to switch in and out")
    caps["position"] = dict(hz=DMX_HZ, n=len(have("level")),
                            why="a row of lamps lit in turn -- no motor needed",
                            spread=True)
    caps["timing"] = dict(hz=DMX_HZ, n=len(lay["fixtures"]),
                          why=f"one DMX frame is {1000/DMX_HZ:.1f} ms; nothing lands finer")
    return caps


def main():
    slug = sys.argv[1] if len(sys.argv) > 1 else "levels"
    mp = next((c for c in (os.path.join(ROOT, "synth", "truth", slug + ".map.json"),
                           os.path.join(ROOT, "synth", "songs", slug + ".map.json"))
               if os.path.exists(c)), None)
    if not mp:
        print(f"no map for {slug}"); return
    m = json.load(open(mp))
    D = measure(m)
    only = sys.argv[sys.argv.index("--rig") + 1] if "--rig" in sys.argv else None

    print(f"{slug} asks for these dimensions\n")
    print(f"  {'dimension':11} {'changes/s':>10}  {'needs':9} what it is")
    for d in D:
        r = "-" if d["rate"] is None else f"{d['rate']:.2f}"
        print(f"  {d['key']:11} {r:>10}  {d['needs']:9} {d['what']}")
        if d.get("usable_rate"):
            print(f"  {'':11} {d['usable_rate']:10.2f}  {'':9} "
                  f"...but only usable at phrase rate; per-note is a strobe")
        if d.get("detail_s") is not None:
            print(f"  {'':11} {'':>10}  {'':9} "
                  f"...the swing is {d['detail_s']*1000:.0f} ms wide")

    for p in sorted(glob.glob(os.path.join(HERE, "*", "layout.json"))):
        lay = json.load(open(p))
        name = lay.get("room") or os.path.basename(os.path.dirname(p))
        if only and name != only: continue
        caps = rig_rates(lay)
        print(f"\n{name}: {len(lay['fixtures'])} fixtures")
        for d in D:
            c = caps.get(d["needs"])
            if not c:
                print(f"   NO      {d['key']:11} nothing in this rig can {d['needs']}")
                continue
            hz = c["hz"]
            want = d.get("usable_rate") or d["rate"]
            if hz is None:
                print(f"   ?       {d['key']:11} {c['why']}")
            elif d["key"] == "groove":
                frame = 1000 / DMX_HZ
                sw = d["detail_s"] * 1000
                verdict = "yes" if sw > frame else "NO"
                print(f"   {verdict:7} {d['key']:11} the swing is {sw:.0f} ms and one frame is "
                      f"{frame:.0f} ms -- {sw/frame:.1f} frames wide")
            elif want and want > hz:
                print(f"   NO      {d['key']:11} wants {want:.2f}/s, {d['needs']} manages "
                      f"{hz:.2f}/s -- {c['why']}")
            elif want:
                head = hz / want if want else 0
                if head < 2:
                    print(f"   TIGHT   {d['key']:11} wants {want:.2f}/s against {hz:.2f}/s, "
                          f"only {head:.1f}x headroom")
    print()


if __name__ == "__main__":
    main()
