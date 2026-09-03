#!/usr/bin/env python3
"""Compose songs, map first, then audio. Stdlib only.

    python3 synth/compose.py            # every song
    python3 synth/compose.py 03         # just level 03

Ten songs of rising difficulty. Each one adds ONE thing, so when a listener's
score drops you know which thing did it. A level that changed three things at
once would tell you nothing.

Why author the map first: we write the arrangement, render the audio from it,
then measure the map back out of the individual instrument tracks. Every field
is exact because we caused it -- stems is the real presence of an instrument we
played, energy is the real loudness of the mix we mixed. That makes these maps
the answer key, and it is the only reason a score means anything.

Audio is never committed. It regenerates from this file, identically, on every
machine -- 12 KB of code instead of 40 MB of wav.
"""
import json, math, os, struct, sys, wave

SR = 32000
HERE = os.path.dirname(os.path.abspath(__file__))
BPB = 4

def midi(n): return 440.0 * (2.0 ** ((n - 69) / 12.0))

CHORDS = [("Am", [57, 60, 64]), ("F", [53, 57, 60]), ("C", [48, 55, 64]), ("G", [55, 59, 62])]
LEAD = [69, 72, 71, 67, 69, 76, 74, 72]


def envelope(n, atk, dec):
    a = max(1, int(atk * SR))
    return [min(1.0, i / a) * math.exp(-max(0, i - a) / (dec * SR)) for i in range(n)]

def tone(freq, dur, atk=0.002, dec=0.09, kind="sine"):
    n = int(dur * SR); e = envelope(n, atk, dec); out = []; ph = 0.0
    for i in range(n):
        ph += 2 * math.pi * freq / SR
        v = math.sin(ph) if kind == "sine" else \
            (math.sin(ph) + 0.42 * math.sin(2 * ph) + 0.20 * math.sin(3 * ph)) / 1.62
        out.append(v * e[i])
    return out

def _noise(n, dec, seed, hp=True):
    s, prev, out = seed, 0.0, []
    for i in range(n):
        s = (1103515245 * s + 12345) & 0x7FFFFFFF
        x = (s / 0x3FFFFFFF) - 1.0
        v = (x - prev) if hp else (x + prev) * 0.5
        prev = x
        out.append(v * math.exp(-i / (dec * SR)))
    return out

def kick_v():
    n, ph, out = int(0.16 * SR), 0.0, []
    for i in range(n):
        f = 92.0 - 50.0 * (i / n) ** 0.5
        ph += 2 * math.pi * f / SR
        out.append(math.sin(ph) * math.exp(-i / (0.052 * SR)))
    return out

KICK = kick_v()
HAT  = [v * 0.55 for v in _noise(int(0.05 * SR), 0.011, 8675309)]
CLAP = [v * 0.75 for v in _noise(int(0.13 * SR), 0.042, 1234567, hp=False)]
RISE = None  # built lazily, only the last level needs it

def riser(dur=1.6):
    """One long upward sweep. Used once in the whole ladder, on purpose."""
    n, ph, out = int(dur * SR), 0.0, []
    for i in range(n):
        f = 220.0 * (2.0 ** (2.4 * i / n))
        ph += 2 * math.pi * f / SR
        out.append(math.sin(ph) * (i / n) ** 2 * 0.5)
    return out


def add(buf, src, at, g):
    i = int(at * SR)
    for k, v in enumerate(src):
        j = i + k
        if 0 <= j < len(buf): buf[j] += v * g


# ---- the ladder -------------------------------------------------------------
# mix keys: kick clap hat bass pad lead
def S(slug, title, teaches, bpm, plan, **kw):
    return dict(slug=slug, title=title, teaches=teaches, bpm=bpm, plan=plan, **kw)

SONGS = [
 S("01-pulse", "Pulse", "Find the beat. Nothing else is happening.", 120.0,
   [("intro", "A", 1, 16, {"kick": 1.0})], bar_cue=False),

 S("02-backbeat", "Backbeat", "Find the bar. The clap on 2 and 4 is the only cue.", 120.0,
   [("intro", "A", 1, 16, {"kick": 1.0, "clap": 0.8})]),

 S("03-offbeat", "Offbeat", "Do not get pulled onto the offbeat. The hats are busier than the kick.",
   124.0, [("intro", "A", 1, 16, {"kick": 1.0, "hat": 0.75})], hats="eighths"),

 S("04-odd-tempo", "Odd Tempo", "126.4 bpm and a phase that is not on a tidy boundary.",
   126.4, [("intro", "A", 1, 8, {"kick": 1.0, "hat": 0.6}),
           ("verse", "B", 1, 12, {"kick": 1.0, "hat": 0.6, "bass": 0.8})], phase=0.317),

 S("05-sections", "Sections", "Structure arrives: an arc from quiet to loud and back.", 128.0,
   [("intro", "A", 1, 4, {"pad": 0.55}),
    ("verse", "B", 1, 8, {"pad": 0.55, "bass": 0.7, "hat": 0.45}),
    ("drop", "C", 1, 8, {"pad": 0.6, "bass": 1.0, "hat": 0.7, "kick": 1.0, "clap": 0.7}),
    ("outro", "D", 1, 4, {"pad": 0.45})]),

 S("06-repeat", "Repeat", "The same section twice. A show should make the second one bigger.",
   126.0, [("intro", "A", 1, 4, {"pad": 0.55}),
           ("verse", "B", 1, 6, {"pad": 0.55, "bass": 0.7, "hat": 0.45}),
           ("drop", "C", 1, 8, {"pad": 0.6, "bass": 1.0, "hat": 0.7, "kick": 1.0, "clap": 0.7}),
           ("break", "D", 1, 2, {"pad": 0.5}),
           ("drop", "C", 2, 8, {"pad": 0.66, "bass": 1.0, "hat": 0.8, "kick": 1.0, "clap": 0.85}),
           ("outro", "E", 1, 2, {"pad": 0.45})]),

 S("07-voice", "Voice", "A lead that vacates the drop and stands alone before the second one.",
   124.0, [("intro", "A", 1, 4, {"pad": 0.55}),
           ("verse", "B", 1, 8, {"pad": 0.55, "bass": 0.7, "hat": 0.45, "lead": 0.8}),
           ("drop", "C", 1, 8, {"pad": 0.6, "bass": 1.0, "hat": 0.7, "kick": 1.0, "clap": 0.7}),
           ("break", "D", 1, 2, {"pad": 0.45, "lead": 0.9}),
           ("drop", "C", 2, 8, {"pad": 0.66, "bass": 1.0, "hat": 0.8, "kick": 1.0, "clap": 0.85}),
           ("outro", "E", 1, 2, {"pad": 0.45, "lead": 0.4})]),

 S("08-syncopation", "Syncopation", "Ghost notes off the grid. Most hits are not on a beat.",
   125.0, [("intro", "A", 1, 4, {"pad": 0.5}),
           ("verse", "B", 1, 8, {"pad": 0.5, "bass": 0.75, "hat": 0.5, "lead": 0.7}),
           ("drop", "C", 1, 10, {"pad": 0.6, "bass": 1.0, "hat": 0.7, "kick": 1.0, "clap": 0.7}),
           ("outro", "D", 1, 4, {"pad": 0.45})], ghosts=True, hats="eighths"),

 S("09-half-time", "Half Time", "The drums halve while the tempo does not. Do not follow them down.",
   128.0, [("intro", "A", 1, 4, {"pad": 0.5}),
           ("verse", "B", 1, 8, {"pad": 0.5, "bass": 0.75, "hat": 0.5, "kick": 0.9, "clap": 0.7}),
           ("half", "C", 1, 8, {"pad": 0.55, "bass": 0.8, "kick": 1.0, "clap": 0.8}),
           ("drop", "D", 1, 8, {"pad": 0.6, "bass": 1.0, "hat": 0.75, "kick": 1.0, "clap": 0.8}),
           ("outro", "E", 1, 4, {"pad": 0.45})], halftime=("half",)),

 S("10-everything", "Everything", "Swing, human timing, wide dynamics, and one sound that "
   "happens once and is buried.", 122.0,
   [("intro", "A", 1, 4, {"pad": 0.5}),
    ("verse", "B", 1, 8, {"pad": 0.5, "bass": 0.7, "hat": 0.45, "lead": 0.75}),
    ("build", "C", 1, 6, {"pad": 0.55, "bass": 0.8, "hat": 0.6, "kick": 0.6}),
    ("drop", "D", 1, 10, {"pad": 0.6, "bass": 1.0, "hat": 0.75, "kick": 1.0, "clap": 0.8}),
    ("break", "E", 1, 2, {"pad": 0.45, "lead": 0.9}),
    ("drop", "D", 2, 10, {"pad": 0.66, "bass": 1.0, "hat": 0.85, "kick": 1.0, "clap": 0.9}),
    ("outro", "F", 1, 4, {"pad": 0.45})],
   swing=0.16, humanise_ms=7.0, ghosts=True, hats="eighths", buried=True),
]


def build(spec):
    bpm = spec["bpm"]; beat = 60.0 / bpm; bar = beat * BPB
    phase = spec.get("phase", 0.0)
    swing = spec.get("swing", 0.0)
    hum = spec.get("humanise_ms", 0.0) / 1000.0
    halftime = set(spec.get("halftime", ()))
    plan = spec["plan"]
    bars = sum(p[3] for p in plan)
    dur = phase + bars * bar + beat
    n = int(dur * SR) + SR
    tracks = {k: [0.0] * n for k in ("kick", "clap", "hat", "bass", "pad", "lead")}

    rng = [spec["slug"].__hash__() & 0x7FFFFFFF or 12345]
    def jitter():
        if hum <= 0: return 0.0
        rng[0] = (1103515245 * rng[0] + 12345) & 0x7FFFFFFF
        return ((rng[0] / 0x3FFFFFFF) - 1.0) * hum

    def eighth(t0, k):
        """Position of the k-th eighth in a bar, with swing pushing the odd ones late."""
        t = t0 + k * beat / 2
        if swing and k % 2 == 1: t += beat * 0.5 * swing
        return t

    sections, chapters, bar_chord = [], [], []
    b0 = 0
    for name, sid, rep, nb, mix in plan:
        at = phase + b0 * bar
        chapters.append({"at": round(at, 6), "name": name})
        sections.append({"at": round(at, 6), "to": round(phase + (b0 + nb) * bar, 6),
                         "name": name, "id": sid, "repeat": rep, "arc": round(b0 / bars, 3)})
        half = name in halftime
        for k in range(nb):
            bi = b0 + k; t0 = phase + bi * bar
            cname, notes = CHORDS[bi % len(CHORDS)]
            bar_chord.append({"at": round(t0, 6), "chord": cname, "confidence": 1.0})
            if "pad" in mix:
                for nt in notes:
                    add(tracks["pad"], tone(midi(nt), bar * 0.98, atk=0.09, dec=1.6), t0, mix["pad"] * 0.30)
            if "bass" in mix:
                step = beat if half else beat / 2
                cnt = BPB if half else 8
                for e in range(cnt):
                    add(tracks["bass"], tone(midi(notes[0] - 24), step * 0.46, dec=0.10, kind="saw"),
                        t0 + e * step + jitter(), mix["bass"] * 0.55)
            if "kick" in mix:
                hits = [0, 2] if half else list(range(BPB))
                for bt in hits:
                    add(tracks["kick"], KICK, t0 + bt * beat + jitter(), mix["kick"])
            if "clap" in mix:
                hits = [2] if half else [1, 3]
                for bt in hits:
                    add(tracks["clap"], CLAP, t0 + bt * beat + jitter(), mix["clap"])
            if "hat" in mix:
                if spec.get("hats") == "eighths":
                    for e in range(8):
                        g = mix["hat"] * (0.45 if e % 2 == 0 else 1.0)
                        add(tracks["hat"], HAT, eighth(t0, e) + jitter(), g)
                else:
                    for bt in range(BPB):
                        add(tracks["hat"], HAT, t0 + bt * beat + jitter(), mix["hat"])
            if spec.get("ghosts") and ("kick" in mix or "hat" in mix):
                for frac in (0.375, 0.875):        # deliberately not on any beat
                    add(tracks["hat"], HAT, t0 + frac * bar + jitter(), 0.22)
            if "lead" in mix:
                for q in range(BPB):
                    nt = LEAD[(bi * BPB + q) % len(LEAD)]
                    add(tracks["lead"], tone(midi(nt), beat * 0.9, atk=0.006, dec=0.26),
                        t0 + q * beat + jitter(), mix["lead"] * 0.34)
        b0 += nb

    buried_at = None
    if spec.get("buried"):
        global RISE
        if RISE is None: RISE = riser()
        # one sound, once, at a fifth of the level of everything around it
        drop2 = [i for i, p in enumerate(plan) if p[0] == "drop" and p[2] == 2]
        bstart = sum(p[3] for p in plan[:drop2[0]]) if drop2 else bars // 2
        buried_at = round(phase + (bstart * bar) - 1.6, 6)
        add(tracks["pad"], RISE, buried_at, 0.19)

    mix_buf = [0.0] * n
    for t in tracks.values():
        for i, v in enumerate(t): mix_buf[i] += v
    peak = max(1e-9, max(abs(x) for x in mix_buf))
    mix_buf = [x * (0.90 / peak) for x in mix_buf]

    downs = [round(phase + i * bar, 6) for i in range(bars)]
    beats = [round(phase + i * beat, 6) for i in range(bars * BPB)]

    def rms_per_bar(buf):
        out = []
        for i in range(bars):
            a, b = int((phase + i * bar) * SR), int((phase + (i + 1) * bar) * SR)
            seg = buf[a:b]
            out.append(math.sqrt(sum(x * x for x in seg) / max(1, len(seg))))
        return out

    drums = [tracks["kick"][i] + tracks["clap"][i] + tracks["hat"][i] for i in range(n)]
    canon = {"drums": drums, "bass": tracks["bass"], "other": tracks["pad"], "vocals": tracks["lead"]}
    stems, instruments = {}, {}
    for k, t in canon.items():
        r = rms_per_bar(t); mx = max(r) or 1.0
        stems[k] = [round(v / mx, 4) for v in r]
    for k in ("guitar", "piano"):
        stems[k] = [0.0] * bars
    for k, t in tracks.items():
        r = rms_per_bar(t); mx = max(r) or 1.0
        instruments[k] = [round(v / mx, 4) for v in r]
    mr = rms_per_bar(mix_buf); mm = max(mr) or 1.0
    energy = [[downs[i], round(mr[i] / mm, 4)] for i in range(bars)]

    moments, spans = [], []
    for i, (name, sid, rep, nb, mix) in enumerate(plan):
        at = round(phase + sum(p[3] for p in plan[:i]) * bar, 6)
        if name == "drop":
            moments.append({"at": at, "kind": "drop", "size": 0.9 if rep == 1 else 1.0,
                            "note": f"authored: full arrangement enters, pass {rep}"})
        if name == "break":
            moments.append({"at": at, "kind": "quiet", "note": "authored: drums and bass leave"})
            if "lead" in mix:
                moments.append({"at": round(at + bar, 6), "kind": "spotlight", "of": "vocals",
                                "note": "authored: lead alone before the next drop"})
        if name == "build":
            spans.append({"kind": "build", "from": at, "to": round(at + nb * bar, 6),
                          "rise": "steady", "bars": nb})
        if name == "outro":
            moments.append({"at": at, "kind": "return", "note": "authored: pad alone"})
    moments.sort(key=lambda m: m["at"])

    m = {
        "map": "0.3",
        "song": {"title": spec["title"], "artist": "limelight synth", "length": round(dur, 3)},
        "level": {"n": int(spec["slug"][:2]), "teaches": spec["teaches"]},
        "made_by": {"how": "synthetic", "who": "synth/compose.py",
                    "why": "Authored map-first, audio rendered from it, map then measured back out "
                           "of the individual instrument tracks. Every field is exact because we "
                           "caused it.",
                    "warning": "AUTHORED. This is an answer key, not evidence about real music."},
        "grid": {"period": round(beat, 6), "phase": phase, "bpm": bpm, "bar_phase": 0,
                 "locked": True, "how": "authored"},
        # A map must not claim a fact its audio cannot carry. Level 01 is identical
        # kicks on every beat, so nothing in the signal says which one is the "one".
        # Declaring downbeats there would grade a listener on something we invented.
        "beats": beats,
        "downbeats": downs if spec.get("bar_cue", True) else [],
        **({} if spec.get("bar_cue", True) else {"downbeats_note":
            "EMPTY BY DESIGN. Every kick is identical, so the bar is not recoverable from this "
            "audio. Level 02 adds a clap on 2 and 4, which is the first cue that makes it "
            "knowable. A listener reporting downbeats here is inventing them."}),
        "beats_window": [0.0, round(dur, 3)],
        "chapters": chapters,
        "sections": {"how": "authored arrangement", "entries": sections},
        "spans": spans, "moments": moments, "energy": energy, "confidence": 1.0,
        "stems": {"model": "authored", "rate": "per_downbeat", "sources": stems, "at": downs,
                  "instruments": instruments,
                  "note": "Measured per bar from each instrument's own track before mixing. drums is "
                          "kick plus clap plus hat, other is the pad, vocals is the lead. guitar and "
                          "piano are explicit zeros -- an absent field would read as 0.5."},
        "observations": {"key": {"estimate": "A minor", "how": "authored", "confidence": 1.0},
                         "chords": {"rate": "per_bar", "how": "authored", "events": bar_chord}},
        "arrangement": [{"name": p[0], "id": p[1], "repeat": p[2], "bars": p[3],
                         "plays": sorted(p[4])} for p in plan],
    }
    if buried_at is not None:
        # NOT a moment. `moments` is the interface tier with exactly six kinds and it
        # is a one-way door -- validate.py refused a seventh, correctly. A once-only
        # sound is an observation: append-only, and a reader that does not know the
        # field ignores it.
        m["observations"]["singular"] = {
            "how": "authored", "events": [{
                "at": buried_at, "for": 1.6, "where": "other",
                "gesture": {"rise": 1.0, "sharp": 0.1, "wide": 0.7, "wet": 0.8},
                "depth": 0.19, "once": 1, "rarity": 1.0,
                "note": "Happens ONCE in the whole ladder, at about a fifth of the level around "
                        "it. Deliberately not named by what made it: a reader needs to know it "
                        "rose, smeared and spread, not what instrument it was."}],
            "note": "Sounds with no relative anywhere else in the song. Described by gesture "
                    "rather than by name, because a reverse cymbal and a reversed voice are the "
                    "same instruction to a light rig."}
    if swing: m["observations"]["swing"] = {"amount": swing, "how": "authored",
                                            "note": "odd eighths pushed late by this fraction of half a beat"}
    if hum: m["observations"]["microtiming"] = {"unit": "seconds", "jitter_max": round(hum, 4),
                                                "how": "authored", "feel": "human"}
    return m, mix_buf


def write_wav(path, buf):
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, x)) * 32767)) for x in buf))


def main(argv):
    want = argv[1] if len(argv) > 1 else None
    sd = os.path.join(HERE, "songs"); os.makedirs(sd, exist_ok=True)
    od = os.path.join(HERE, "out"); os.makedirs(od, exist_ok=True)
    print(f"  {'level':<16} {'bpm':>6} {'secs':>6} {'bars':>5} {'moments':>8}   teaches")
    for spec in SONGS:
        if want and not spec["slug"].startswith(want): continue
        m, mix = build(spec)
        json.dump(m, open(os.path.join(sd, spec["slug"] + ".map.json"), "w"), indent=1)
        write_wav(os.path.join(od, spec["slug"] + ".wav"), mix)
        print(f"  {spec['slug']:<16} {m['grid']['bpm']:>6} {m['song']['length']:>6.1f} "
              f"{len(m['energy']):>5} {len(m['moments']):>8}   {spec['teaches'][:58]}")

if __name__ == "__main__":
    main(sys.argv)
