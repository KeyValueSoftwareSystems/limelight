#!/usr/bin/env python3
"""Show what a calibration request gets back, and what to do with each answer.

Calibration is everything decided before the song plays: how hard to push, what
the palette is, where the grid can be trusted, how many big gestures the song
can afford, and which fixtures matter when. All of that is answerable from one
request, and this prints the request, the real response, and the reading.

    python3 tools/calibration_demo.py                 # the worked example
    python3 tools/calibration_demo.py a-song.score    # your own score

With no file it uses a stand-in built in the pipeline's shape. Its GRID is real
-- Levels, as measured -- and every other number is illustrative, so read the
shape and the reasoning, not the values. Point it at a real score for real ones.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "hub"))
import score_api as S  # noqa: E402

# The request a rig makes once, at load time. Nothing here is per-frame.
REQUEST = {
    "score": "levels",
    "fields": ["song", "grid", "loudness", "feel", "key",
               "sections", "layers", "curves", "stems",
               "moments", "tension", "releases", "chord_changes"],
    "curves": ["energy", "brightness", "air", "pump"],
    "stems": ["drums", "bass", "vocals"],
    "moments": {"min_weight": 0.55},
}


def stand_in():
    """A score in the pipeline's shape. Grid measured; the rest illustrative."""
    bars = 124
    def wave(lo, hi, period, phase=0.0):
        import math
        return [round(lo + (hi - lo) * (0.5 + 0.5 * math.sin(
            2 * math.pi * (i / period + phase))), 3) for i in range(bars)]
    return {
        "score": "levels", "version": 3,
        "song": {"length_s": 237.1},
        "grid": {"bpm": 128.01, "first_beat_s": 0.2233, "beats_per_bar": 4,
                 "bars": bars, "first_bar": 0, "last_bar": 123,
                 "holds_from_s": 0.2233, "holds_to_s": 231.4},
        "key": {"root": "C#", "scale": "minor", "confidence": 0.61, "tuned_to_hz": 440.2},
        "chords": {"root": "C#", "scale": "minor", "confidence": 0.55,
                   "changes_per_beat": 0.062},
        "loudness": {"integrated_lufs": -7.2, "range_lu": 4.1, "dynamic_complexity": 2.8},
        "feel": {"danceability": 1.42, "onsets_per_second": 7.9},
        "parts": [
            {"from_bar": 0,  "to_bar": 8,   "role": "intro",     "nth": 1, "like": "A",
             "returns": True,  "feels": "no drums", "fullness": 0.21, "rise": 0.08,
             "playing": ["other"],
             "stems": {"drums": {"is": "none", "level": 0.02}, "bass": {"is": "none", "level": 0.04},
                       "vocals": {"is": "none", "level": 0.0}, "other": {"is": "full", "level": 0.61}}},
            {"from_bar": 9,  "to_bar": 24,  "role": "drop",      "nth": 1, "like": "B",
             "returns": True,  "feels": "drums in", "fullness": 0.93, "rise": 0.11,
             "playing": ["drums", "bass", "other"],
             "stems": {"drums": {"is": "full", "level": 0.95}, "bass": {"is": "full", "level": 0.88},
                       "vocals": {"is": "none", "level": 0.03}, "other": {"is": "full", "level": 0.72}}},
            {"from_bar": 25, "to_bar": 40,  "role": "breakdown", "nth": 1, "like": "C",
             "returns": False, "feels": "drums out", "fullness": 0.38, "rise": 0.44,
             "playing": ["other", "vocals"],
             "stems": {"drums": {"is": "none", "level": 0.05}, "bass": {"is": "some", "level": 0.28},
                       "vocals": {"is": "full", "level": 0.81}, "other": {"is": "full", "level": 0.66}}},
            {"from_bar": 41, "to_bar": 72,  "role": "drop",      "nth": 2, "like": "B",
             "returns": True,  "feels": "full", "fullness": 1.0, "rise": 0.03,
             "playing": ["drums", "bass", "vocals", "other"],
             "stems": {"drums": {"is": "full", "level": 1.0}, "bass": {"is": "full", "level": 0.94},
                       "vocals": {"is": "some", "level": 0.42}, "other": {"is": "full", "level": 0.8}}},
            {"from_bar": 73, "to_bar": 123, "role": "outro",     "nth": 1, "like": "D",
             "returns": False, "feels": "drums out", "fullness": 0.3, "rise": -0.35,
             "playing": ["other"],
             "stems": {"drums": {"is": "some", "level": 0.22}, "bass": {"is": "none", "level": 0.06},
                       "vocals": {"is": "none", "level": 0.0}, "other": {"is": "full", "level": 0.58}}},
        ],
        "bars": {
            "intensity":  wave(0.2, 1.0, 32),
            "brightness": wave(0.15, 0.75, 32, 0.05),
            "air":        wave(0.1, 1.0, 16, 0.1),
            "pump":       wave(0.05, 0.8, 64),
            "pace":       wave(0.6, 2.2, 16),
            "width":      wave(0.1, 0.9, 32),
            "drums":      wave(0.0, 1.0, 32, 0.02),
            "bass":       wave(0.0, 0.95, 32, 0.02),
            "vocals":     wave(0.0, 0.85, 48, 0.3),
            "other":      wave(0.3, 0.9, 24),
            "chord":      [["C#m", "A", "E", "B"][(i // 4) % 4] for i in range(bars)],
            "chord_sure": [0.6] * bars,
        },
        "phrases": [
            {"from_bar": 25, "to_bar": 32, "in": "breakdown", "in_nth": 1,
             "doing": "establishing", "also": ["thinning"], "sure": 0.7,
             "says": "drums out, voice in", "energy": 0.31, "rise": 0.12,
             "playing": ["vocals", "other"], "has_break": False},
            {"from_bar": 33, "to_bar": 40, "in": "breakdown", "in_nth": 1,
             "doing": "intensifying", "also": ["expanding"], "sure": 0.82,
             "says": "voice and chords holding", "energy": 0.52, "rise": 0.61,
             "playing": ["vocals", "other", "bass"], "has_break": True},
        ],
        "phrase_grid": {"every_bars": 8, "from_bar": 1, "boundaries_on_grid": True},
        "tension": [round(min(1.0, (i % 128) / 128 * 1.4), 3) for i in range(bars * 4)],
        "releases": [{"at_s": 16.7, "size": 0.72}, {"at_s": 75.2, "size": 0.94},
                     {"at_s": 135.6, "size": 0.61}],
        "moments": [
            {"at": {"bar": 9,  "beat": 1}, "is": "entrance",   "what": "drums",   "sure": 0.94, "weight": 0.91},
            {"at": {"bar": 24, "beat": 3}, "is": "fill",       "what": "drums",   "sure": 0.71, "weight": 0.58},
            {"at": {"bar": 25, "beat": 1}, "is": "exit",       "what": "the band","sure": 0.89, "weight": 0.86},
            {"at": {"bar": 33, "beat": 1}, "is": "entrance",   "what": "voice",   "sure": 0.83, "weight": 0.74},
            {"at": {"bar": 37, "beat": 1}, "is": "rise",       "what": "a sweep", "sure": 0.77, "weight": 0.69,
             "for_beats": 16},
            {"at": {"bar": 41, "beat": 1}, "is": "release",    "what": "the band","sure": 0.96, "weight": 0.98},
            {"at": {"bar": 52, "beat": 4}, "is": "accent",     "what": "drums",   "sure": 0.52, "weight": 0.31},
            {"at": {"bar": 57, "beat": 1}, "is": "hook",       "what": "the riff","sure": 0.8,  "weight": 0.72},
            {"at": {"bar": 73, "beat": 1}, "is": "exit",       "what": "drums",   "sure": 0.85, "weight": 0.64},
        ],
        "made_by": {"voice_from": "roformer", "pipeline": "listen"},
        "profile": {"user": "alnas",
                    "colours": [{"name": "magenta", "hex": "#ff00ff"},
                                {"name": "cyan", "hex": "#00ffff"}]},
    }


def main(argv):
    if argv:
        raw = json.load(open(argv[0]))
        REQUEST["score"] = raw.get("score", REQUEST["score"])
        made_up = False
    else:
        raw = stand_in()
        made_up = True

    resp = S.handle(REQUEST, lambda name, profile=None: raw)

    print("REQUEST -- sent once, at load time\n")
    print(json.dumps(REQUEST, indent=2))
    print("\n\nRESPONSE -- produced by hub/score_api.py, not written by hand\n")
    print(json.dumps(resp, indent=2, default=str)[:1]  # keep the full dump below
          if False else json.dumps(trim(resp), indent=2))
    if made_up:
        print("\n[the grid is real; every other value is illustrative -- "
              "run this against a real .score for real ones]")
    print()
    reading(resp)


def trim(r, keep=6):
    """Long arrays print their head and their length, so the shape stays readable."""
    out = {}
    for k, v in r.items():
        if isinstance(v, list) and len(v) > keep:
            out[k] = v[:keep] + [f"... {len(v) - keep} more"]
        elif isinstance(v, dict):
            inner = {}
            for k2, v2 in v.items():
                if isinstance(v2, list) and len(v2) > keep:
                    inner[k2] = v2[:keep] + [f"... {len(v2) - keep} more"]
                elif isinstance(v2, dict):
                    inner[k2] = {k3: (v3[:keep] + [f"... {len(v3) - keep} more"]
                                      if isinstance(v3, list) and len(v3) > keep else v3)
                                 for k3, v3 in v2.items()}
                else:
                    inner[k2] = v2
            out[k] = inner
        else:
            out[k] = v
    return out


def reading(r):
    """Turn the response into the decisions it is there to support."""
    say = print
    say("HOW TO READ IT FOR CALIBRATION")
    say("=" * 60)

    ld = r.get("loudness") or {}
    if ld:
        lufs, rng = ld.get("integrated_lufs"), ld.get("range_lu")
        say(f"\n1. How hard to push.  {lufs} LUFS, {rng} LU of range.")
        say("   A small range means the track is already squashed, so the rig has")
        say("   to supply the dynamics the music will not. Scale your levels to")
        say("   this rather than to a fixed maximum, or a quiet song never lifts")
        say("   and a loud one sits pinned.")

    g = r.get("grid") or {}
    if g.get("holds_from") or g.get("holds_to"):
        say(f"\n2. Where the grid can be trusted.  measured {g.get('holds_from')} "
            f"to {g.get('holds_to')}, song runs to bar {g.get('last_bar')}.")
        say("   Outside that the bar lines are extrapolated. Keep tightly-timed")
        say("   gestures inside it and stay plainer outside.")

    ms = r.get("moments") or []
    if ms:
        big = [m for m in ms if (m.get("weight") or 0) >= 0.8]
        say(f"\n3. The gesture budget.  {len(ms)} moments above the weight you asked")
        say(f"   for, {len(big)} of them above 0.80.")
        for m in sorted(ms, key=lambda x: -(x.get('weight') or 0))[:4]:
            say(f"     bar {m['at']['bar']:>3} beat {m['at']['beat']}  "
                f"{m.get('is','?'):<9} {str(m.get('what','')):<9} weight {m.get('weight')}")
        say("   Spend the big looks on the top few. Contrast is the whole effect,")
        say("   and a blackout means nothing if it happens every eight bars.")

    secs = r.get("sections") or []
    if secs:
        say(f"\n4. The map, and what repeats.  {len(secs)} sections.")
        for s in secs:
            rep = f"  <- same material as {s['repeat']}" if s.get("repeat") else ""
            say(f"     bar {s['from']['bar']:>3}-{s['to']['bar'] - 1:<3} {str(s.get('name')):<10}"
                f" full {s.get('fullness')}  rise {s.get('rise')}{rep}")
        say("   Light a returning section the way you lit it before. Recognition is")
        say("   most of what makes a show feel composed instead of generated.")

    pres = ((r.get("layers") or {}).get("presence") or {}).get("spans") or []
    if pres:
        voc = [p for p in pres if p.get("stem") == "vocals"]
        say(f"\n5. Which fixtures matter when.  {len(pres)} presence spans"
            + (f", voice in for {len(voc)} of them." if voc else "."))
        for p in voc[:3]:
            say(f"     voice {p['state']:<5} bar {p['from']['bar']}-{p['to']['bar'] - 1}")
        say("   Give the voice its own fixtures and release them when it stops.")

    sub = ((r.get("layers") or {}).get("subsection") or {}).get("spans") or []
    if sub:
        say(f"\n6. What happens inside a section.  {len(sub)} subsections.")
        for p in sub:
            say(f"     bar {p['from']['bar']:>3}-{p['to']['bar'] - 1:<3} {p.get('doing'):<14}"
                f" \"{p.get('says')}\"")
        say("   Hold the section's look and push it where the music pushes.")

    ten = r.get("tension") or {}
    rel = r.get("releases") or []
    if ten or rel:
        say(f"\n7. When to build.  tension per beat from bar {ten.get('from_bar')}, "
            f"{len(rel)} releases.")
        for x in rel:
            say(f"     release at bar {x['at']['bar']} beat {x['at']['beat']}, size {x.get('size')}")
        say("   Start moving on the rise, commit on the release. Reacting after it")
        say("   is what makes a rig look like it is watching rather than playing.")

    cur = r.get("curves") or {}
    if cur:
        say(f"\n8. What modulates inside a bar.  curves: {', '.join(cur.keys())}.")
        say("   brightness -> colour temperature, air -> how open it reads,")
        say("   pump -> whether the rig breathes with the track.")
        say("   air is the one that catches a filter build where energy stays flat.")

    k = r.get("key") or {}
    prof = r.get("profile") or {}
    if k or prof:
        say(f"\n9. Palette.  key {k.get('root')} {k.get('scale')} "
            f"(confidence {k.get('confidence')}); "
            f"profile {prof.get('user')}: "
            f"{', '.join(c['name'] for c in prof.get('colours', []))}")
        say("   The profile is the consumer's own layer -- your colours for this")
        say("   song, stored on the hub, not the author's intent. Author intent")
        say("   arrives as enforced metadata and you are obliged to respect it.")

    say("\n10. The one number still worth tuning by hand: the physical delay")
    say("    between sending DMX and the lamp responding. That is constant and")
    say("    real. Audio start-up delay is not yours to tune any more -- the")
    say("    measured clock never introduces it.")
    say("")


if __name__ == "__main__":
    main(sys.argv[1:])
