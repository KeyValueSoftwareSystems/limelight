#!/usr/bin/env python3
"""Compose a whole short song, map first, then its audio. Stdlib only.

    python3 synth/compose.py              # writes synth/songs/*.map.json + .wav

Why this exists: the four grid cases are test signals, not music, and they carry
no energy or sections, so no reader can make a show from them. The alternative
we reached for was The Nights -- and that map's structure is disputed, its
chords agree with its own notes 69% of the time, and one moment in it has been
verified by a human. Grading against it means grading against a file we cannot
vouch for.

So: author the arrangement, render each instrument to its own track, and measure
the map from those tracks. Every field is then exact rather than estimated --
`stems` is the real presence of a real instrument because we played it, `energy`
is the actual loudness of the actual mix, `chords` are the chords we chose. That
is a canonical map, which this project has never had. A show built from it is
correct by construction, so it is a reference worth comparing against.
"""
import json, math, os, struct, sys, wave

SR = 32000
HERE = os.path.dirname(os.path.abspath(__file__))

def midi(n): return 440.0 * (2.0 ** ((n - 69) / 12.0))

# A minor: i - VI - III - VII, the most ordinary loop there is, on purpose
KEY = "A minor"
CHORDS = [("Am", [57, 60, 64]), ("F", [53, 57, 60]), ("C", [48, 55, 64]), ("G", [55, 59, 62])]
LEAD = [69, 72, 71, 67, 69, 76, 74, 72]          # A minor pentatonic-ish phrase
BPM, BEATS_PER_BAR = 120.0, 4

# Which instruments play in which section, and how hard. This IS the arrangement,
# and because the map is measured from what it produces, it is also the truth.
PLAN = [
    ("intro",  "A", 1, 4,  {"pad": 0.55}),
    ("verse",  "B", 1, 6,  {"pad": 0.55, "bass": 0.70, "hat": 0.40}),
    ("build",  "C", 1, 4,  {"pad": 0.60, "bass": 0.75, "hat": 0.62, "kick": 0.55}),
    ("drop",   "D", 1, 6,  {"pad": 0.62, "bass": 1.00, "hat": 0.72, "kick": 1.00, "lead": 0.85}),
    ("break",  "E", 1, 2,  {"pad": 0.50, "lead": 0.55}),
    ("drop",   "D", 2, 6,  {"pad": 0.66, "bass": 1.00, "hat": 0.80, "kick": 1.00, "lead": 1.00}),
    ("outro",  "F", 1, 2,  {"pad": 0.45}),
]

def env(n, atk, dec):
    a = max(1, int(atk * SR))
    return [min(1.0, i / a) * math.exp(-max(0, i - a) / (dec * SR)) for i in range(n)]

def tone(freq, dur, atk=0.002, dec=0.09, kind="sine"):
    n = int(dur * SR); e = env(n, atk, dec); out = []
    ph = 0.0
    for i in range(n):
        ph += 2 * math.pi * freq / SR
        if kind == "sine": v = math.sin(ph)
        else:  # a soft saw: three harmonics, enough body to hear a bass note
            v = (math.sin(ph) + 0.42 * math.sin(2 * ph) + 0.20 * math.sin(3 * ph)) / 1.62
        out.append(v * e[i])
    return out

def kick():
    n, ph, out = int(0.16 * SR), 0.0, []
    for i in range(n):
        f = 92.0 - 50.0 * (i / n) ** 0.5
        ph += 2 * math.pi * f / SR
        out.append(math.sin(ph) * math.exp(-i / (0.052 * SR)))
    return out

def hat():
    n, s, prev, out = int(0.05 * SR), 8675309, 0.0, []
    for i in range(n):
        s = (1103515245 * s + 12345) & 0x7FFFFFFF
        x = (s / 0x3FFFFFFF) - 1.0
        hp = x - prev; prev = x
        out.append(hp * math.exp(-i / (0.011 * SR)) * 0.55)
    return out

KICK, HAT = kick(), hat()

def add(buf, src, at, g):
    i = int(at * SR)
    for k, v in enumerate(src):
        j = i + k
        if 0 <= j < len(buf): buf[j] += v * g

def compose():
    beat = 60.0 / BPM; bar = beat * BEATS_PER_BAR
    bars = sum(p[3] for p in PLAN)
    dur = bars * bar
    n = int(dur * SR) + SR
    tracks = {k: [0.0] * n for k in ("kick", "hat", "bass", "pad", "lead")}

    sections, chapters, bar_chord = [], [], []
    b0 = 0
    for name, sid, rep, nb, mix in PLAN:
        at = b0 * bar
        chapters.append({"at": round(at, 6), "name": name})
        sections.append({"at": round(at, 6), "to": round((b0 + nb) * bar, 6), "name": name,
                         "id": sid, "repeat": rep, "arc": round(b0 / bars, 3)})
        for k in range(nb):
            bi = b0 + k; t0 = bi * bar
            cname, notes = CHORDS[bi % len(CHORDS)]
            bar_chord.append({"at": round(t0, 6), "chord": cname, "confidence": 1.0})
            if "pad" in mix:
                for nt in notes:
                    add(tracks["pad"], tone(midi(nt), bar * 0.98, atk=0.09, dec=1.6), t0, mix["pad"] * 0.30)
            if "bass" in mix:
                for e8 in range(8):                        # eighth-note root pattern
                    add(tracks["bass"], tone(midi(notes[0] - 24), beat * 0.46, dec=0.10, kind="saw"),
                        t0 + e8 * beat / 2, mix["bass"] * 0.55)
            if "kick" in mix:
                for bt in range(BEATS_PER_BAR):            # four on the floor
                    add(tracks["kick"], KICK, t0 + bt * beat, mix["kick"])
            if "hat" in mix:
                for e8 in range(8):
                    g = mix["hat"] * (0.5 if e8 % 2 == 0 else 1.0)   # offbeat emphasis
                    add(tracks["hat"], HAT, t0 + e8 * beat / 2, g)
            if "lead" in mix:      # stands in for a voice, so the spotlight is real
                for q in range(4):
                    nt = LEAD[(bi * 4 + q) % len(LEAD)]
                    add(tracks["lead"], tone(midi(nt), beat * 0.9, atk=0.006, dec=0.26),
                        t0 + q * beat, mix["lead"] * 0.34)
        b0 += nb

    mix_buf = [0.0] * n
    for t in tracks.values():
        for i, v in enumerate(t): mix_buf[i] += v
    peak = max(1e-9, max(abs(x) for x in mix_buf))
    scale = 0.90 / peak
    mix_buf = [x * scale for x in mix_buf]

    # measure the map from what we actually rendered, per bar
    downs = [round(i * bar, 6) for i in range(bars)]
    beats = [round(i * beat, 6) for i in range(int(dur / beat))]
    def rms_per_bar(buf):
        out = []
        for i in range(bars):
            a, b = int(i * bar * SR), int((i + 1) * bar * SR)
            seg = buf[a:b]
            out.append(math.sqrt(sum(x * x for x in seg) / max(1, len(seg))))
        return out
    # The six stem names are a CONTRACT, stated in MAP.md and read by the recipe
    # as drums / bass / other / vocals / guitar / piano. The first version of this
    # file invented its own names, so four of five lookups fell through to the 0.5
    # neutral -- which cost the moving heads their gating and put 693 pops into a
    # 60-second show. Instruments map onto the contract; the finer detail is kept
    # alongside rather than lost.
    drums = [tracks["kick"][i] + tracks["hat"][i] for i in range(n)]
    canon = {"drums": drums, "bass": tracks["bass"], "other": tracks["pad"],
             "vocals": tracks["lead"]}
    stems, instruments = {}, {}
    for k, t in canon.items():
        r = rms_per_bar(t); mx = max(r) or 1.0
        stems[k] = [round(v / mx, 4) for v in r]
    for k in ("guitar", "piano"):
        stems[k] = [0.0] * bars          # explicitly absent, which 0.5 would not say
    for k, t in tracks.items():
        r = rms_per_bar(t); mx = max(r) or 1.0
        instruments[k] = [round(v / mx, 4) for v in r]
    mr = rms_per_bar(mix_buf); mm = max(mr) or 1.0
    energy = [[downs[i], round(mr[i] / mm, 4)] for i in range(bars)]

    # moments and spans, from the arrangement rather than from opinion
    moments, spans = [], []
    for i, (name, sid, rep, nb, mix) in enumerate(PLAN):
        at = round(sum(p[3] for p in PLAN[:i]) * bar, 6)
        if name == "drop":
            moments.append({"at": at, "kind": "drop", "size": 0.9 if rep == 1 else 1.0,
                            "note": f"authored: full arrangement enters, pass {rep}"})
        if name == "break":
            moments.append({"at": at, "kind": "quiet", "note": "authored: kick and bass leave"})
            moments.append({"at": round(at + bar, 6), "kind": "spotlight", "of": "lead",
                            "note": "authored: lead alone over pad for one bar before the second drop"})
        if name == "build":
            spans.append({"kind": "build", "from": at, "to": round(at + nb * bar, 6),
                          "rise": "steady", "bars": nb})
        if name == "outro":
            moments.append({"at": at, "kind": "return", "note": "authored: pad alone"})

    m = {
        "map": "0.3",
        "song": {"title": "First Light", "artist": "limelight synth", "length": round(dur, 3)},
        "made_by": {"how": "synthetic", "who": "synth/compose.py",
                    "why": "A whole song authored map-first, then rendered. Every field is exact "
                           "because we caused it: stems is the measured presence of an instrument "
                           "we played, energy is the measured loudness of the mix we mixed, chords "
                           "and sections are what we chose. This is the canonical map -- a show "
                           "built from it is correct by construction.",
                    "warning": "AUTHORED. Not a listening record. Use it as the reference a "
                               "listener is graded against, never as evidence about real music."},
        "grid": {"period": round(beat, 6), "phase": 0.0, "bpm": BPM, "bar_phase": 0, "locked": True,
                 "how": "authored; the renderer places every event on this grid"},
        "beats": beats, "downbeats": downs,
        "beats_window": [0.0, round(dur, 3)],
        "chapters": chapters,
        "sections": {"how": "authored arrangement", "entries": sections},
        "spans": spans, "moments": moments, "energy": energy,
        "confidence": 1.0,
        "stems": {"model": "authored", "rate": "per_downbeat", "sources": stems,
                  "at": downs, "instruments": instruments,
                  "instruments_note": "The finer arrangement behind the six canonical stems: "
                                      "drums is kick plus hat, other is the pad, vocals is the "
                                      "lead line. guitar and piano are explicitly zero because "
                                      "this song has neither -- an absent field would read as 0.5.",
                  "note": "Measured per bar from each instrument's own track before mixing, "
                          "normalised to that instrument's own maximum -- the same shape the "
                          "Demucs-derived field has, but exact."},
        "observations": {"key": {"estimate": KEY, "how": "authored", "confidence": 1.0},
                         "chords": {"rate": "per_bar", "how": "authored", "events": bar_chord}},
        "arrangement": [{"name": p[0], "id": p[1], "repeat": p[2], "bars": p[3],
                         "plays": sorted(p[4])} for p in PLAN],
    }
    return m, mix_buf, tracks


def write_wav(path, buf):
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, x)) * 32767)) for x in buf))


def main():
    out = os.path.join(HERE, "songs"); os.makedirs(out, exist_ok=True)
    os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
    m, mix, tracks = compose()
    slug = "first-light"
    json.dump(m, open(os.path.join(out, slug + ".map.json"), "w"), indent=1)
    write_wav(os.path.join(HERE, "out", slug + ".wav"), mix)
    print(f"  {m['song']['title']}  {m['song']['length']}s  {BPM} bpm  "
          f"{len(m['downbeats'])} bars  {len(m['beats'])} beats")
    for name, sid, rep, nb, plays in [(p[0], p[1], p[2], p[3], sorted(p[4])) for p in PLAN]:
        print(f"    {name:7s} id {sid} rep {rep}  {nb:2d} bars   {' '.join(plays)}")
    print(f"  moments: {', '.join(x['kind'] for x in m['moments'])}")
    print(f"  energy: min {min(e[1] for e in m['energy']):.2f} max {max(e[1] for e in m['energy']):.2f}")
    print(f"  wrote synth/songs/{slug}.map.json and synth/out/{slug}.wav")

if __name__ == "__main__":
    main()
