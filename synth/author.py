#!/usr/bin/env python3
"""Author synthetic map files. The map comes FIRST; the audio is rendered from it.

    python3 synth/author.py            # writes synth/cases/*.json

Each case targets one failure this project actually had, so the suite is a record
of our bugs rather than a wishlist. The map and the render instructions live in
one file on purpose: if they could drift apart, the truth would rot silently.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))

def grid(bpm, phase, dur, bar=4):
    per = 60.0 / bpm
    beats, n = [], 0
    while phase + n * per < dur:
        beats.append(round(phase + n * per, 6)); n += 1
    downs = beats[::bar]
    return per, beats, downs

def case(cid, title, why, bpm, phase, dur, pattern, bar=4, hold=False, bar_cue=True):
    """pattern maps a beat's position in the bar to the voices that sound on it.
    Position -1 means every beat; fractional keys land between beats."""
    per, beats, downs = grid(bpm, phase, dur, bar)
    ev = []
    for i, t in enumerate(beats):
        pos = i % bar
        for key in (-1, pos):
            for voice, gain in pattern.get(key, []):
                ev.append({"at": round(t, 6), "voice": voice, "gain": gain})
        for key, voices in pattern.items():
            if isinstance(key, float):                    # an offbeat subdivision
                for voice, gain in voices:
                    at = t + per * key
                    if at < dur: ev.append({"at": round(at, 6), "voice": voice, "gain": gain})
    ev.sort(key=lambda e: (e["at"], e["voice"]))
    return cid, {
        "map": "0.3",
        "song": {"title": title, "artist": "limelight synth", "length": round(dur, 3)},
        "made_by": {
            "how": "synthetic",
            "who": "synth/author.py",
            "why": why,
            "warning": "AUTHORED, not measured. Every time here is a cause, not an observation. "
                       "This file is ground truth for the listener precisely because the audio was "
                       "rendered from it -- never treat it as a listening record.",
        },
        "grid": {"period": round(per, 6), "phase": phase, "bpm": bpm,
                 "bar_phase": 1, "locked": True,
                 "how": "authored. the renderer places every event on this grid."},
        "beats": beats,
        # A map must not claim a fact its audio cannot support. Case 01 is identical
        # clicks with no accent, so the bar is genuinely unknowable from the signal
        # and declaring downbeats there would score the listener against something we
        # invented -- the same sin as an invented timestamp, wearing a tidier costume.
        "downbeats": downs if bar_cue else [],
        **({} if bar_cue else {"downbeats_note":
            "EMPTY BY DESIGN. The audio carries no bar cue, so any downbeat a listener "
            "reports here is invented and should be counted against it."}),
        "chapters": [{"at": 0.0, "name": "intro"}],
        "moments": [],
        "spans": [],
        "beats_window": [0.0, round(dur, 3)],
        "confidence": 1.0,
        "hold_out": hold,
        "render": {"sample_rate": 48000, "events": ev},
    }

KICK, HAT, CLICK = ("kick", 1.0), ("hat", 0.7), ("click", 1.0)

CASES = [
    case("01-metronome", "metronome 120", 
         "PHASE is what this case tests, not tempo. Identical clicks determine the set of beat "
         "times but not the period uniquely: a grid at 60 bpm is a perfect subset of one at 120, "
         "and with no accent anywhere in the signal nothing can break that tie. The tempo octave "
         "is genuinely undetermined here, which makes this the case that asks whether a listener "
         "reports the ambiguity or quietly guesses. It also carries no bar cue at all, so a "
         "listener that reports downbeats is inventing them.",
         bpm=120.0, phase=0.500, dur=20.0, pattern={-1: [CLICK]}, bar_cue=False),

    case("02-kick-hat", "kick and hat 126.4",
         "Adds a downbeat cue and takes away the round number. Kick on 1 and 3, hat on 2 and 4, "
         "tempo deliberately not 126.0 and phase deliberately not on a tidy boundary, because a "
         "hop-size grid that can only represent round tempi will look correct here and fail.",
         bpm=126.4, phase=0.317, dur=24.0,
         pattern={0: [KICK], 1: [HAT], 2: [KICK], 3: [HAT]}),

    case("03-offbeat-hats", "offbeat hats 124",
         "The 75 ms bug, on purpose. Kick on downbeats only, hats on every eighth-note offbeat, so "
         "full-mix onset energy is dominated by the hats and a naive fit locks half a subdivision "
         "early. Passing this requires fitting on the low band where the kick lives.",
         bpm=124.0, phase=0.250, dur=24.0,
         pattern={0: [KICK], 0.5: [HAT]}),

    case("04-octave-trap", "sparse kick 63",
         "The half-tempo lock. Kick on every other beat with hats between them at a fifth of the "
         "gain, so the dominant periodicity in the signal is two beats and a grid at half the true "
         "tempo is a perfect subset of the right one -- autocorrelation cannot break that tie, "
         "because every candidate at T is also a candidate at 2T. bench.py's octave check is the "
         "referee. Held out: this one is not for tuning against.",
         bpm=126.0, phase=0.284, dur=24.0,
         pattern={0: [KICK], 1: [("hat", 0.15)], 2: [KICK], 3: [("hat", 0.15)]}, hold=True),
]

def main():
    for name, c in CASES:
        path = os.path.join(HERE, "cases", name + ".json")
        json.dump(c, open(path, "w"), indent=1)
        print(f"  {name:18s} {c['grid']['bpm']:6.1f} bpm  phase {c['grid']['phase']:.3f}  "
              f"{len(c['beats']):3d} beats  {len(c['render']['events']):4d} events"
              f"{'   [held out]' if c['hold_out'] else ''}")

if __name__ == "__main__":
    main()
