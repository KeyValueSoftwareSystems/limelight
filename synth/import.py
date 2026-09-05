#!/usr/bin/env python3
"""Turn a song you made into a map. Stdlib only.

    python3 synth/import.py incoming/night-drive.song.json

You bring the audio and the few facts only the author knows. This measures
everything that CAN be measured from the audio and takes the rest from you,
and it marks which is which -- because a value we guessed and a value you knew
must never look the same in the file.

What you must tell us (you know these; you made the song):
    bpm             the tempo you set in the DAW
    first_downbeat  seconds to the start of bar 1
    sections        name + length in bars, in order

What this measures from your audio (not guessed):
    energy          loudness per bar, normalised
    length          from the file itself
    stems           only if you export stems -- otherwise presence comes from
                    the instrument list you gave, marked as authored

Audio never enters git. Keep the wav in synth/incoming/, which is ignored.
"""
import hashlib, json, math, os, sys, wave


def _sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""): h.update(chunk)
    return h.hexdigest()

HERE = os.path.dirname(os.path.abspath(__file__))
CANON = ("drums", "bass", "other", "vocals", "guitar", "piano")


def to_wav(path):
    """Accept an mp3 and convert it once, because nobody exports 16-bit wav by hand.

    The conversion is deterministic and the .wav lands next to the source, so
    everyone who starts from the same mp3 gets the same samples. That matters:
    two rips of one track have different encoder padding, and mp3 decoding alone
    shifted a whole map by 50 ms the last time we measured it."""
    if path.lower().endswith(".wav"): return path
    out = os.path.splitext(path)[0] + ".wav"
    if os.path.exists(out) and os.path.getmtime(out) >= os.path.getmtime(path): return out
    import subprocess
    print(f"  converting {os.path.basename(path)} -> 16-bit wav ...")
    r = subprocess.run(["ffmpeg", "-nostdin", "-y", "-i", path, "-ac", "1",
                        "-ar", "44100", "-sample_fmt", "s16", out],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit("ffmpeg failed:\n" + r.stderr[-500:])
    return out


def read_wav(path):
    with wave.open(path, "rb") as w:
        sr, n, ch, sw = w.getframerate(), w.getnframes(), w.getnchannels(), w.getsampwidth()
        raw = w.readframes(n)
    if sw != 2:
        raise SystemExit(f"{path}: need 16-bit wav, got {sw*8}-bit. Export again as 16-bit.")
    step = 2 * ch
    mono = [int.from_bytes(raw[i:i+2], "little", signed=True) / 32768.0
            for i in range(0, len(raw) - step + 1, step)]
    return mono, sr


def rms_per_bar(buf, sr, first, bar, bars):
    out = []
    for i in range(bars):
        a, b = int((first + i * bar) * sr), int((first + (i + 1) * bar) * sr)
        seg = buf[max(0, a):min(len(buf), b)]
        out.append(math.sqrt(sum(x * x for x in seg) / max(1, len(seg))))
    return out


def build(spec, base):
    bpm = float(spec["bpm"])
    beat = 60.0 / bpm
    bpb = int(spec.get("beats_per_bar", 4))
    bar = beat * bpb
    first = float(spec["first_downbeat"])
    secs = spec["sections"]
    bars = sum(int(s["bars"]) for s in secs)

    wav = os.path.join(base, spec["audio"])
    if not os.path.exists(wav):
        raise SystemExit(f"cannot find {wav}")
    wav = to_wav(wav)
    buf, sr = read_wav(wav)
    dur = len(buf) / sr

    covered = first + bars * bar
    if covered > dur + bar:
        print(f"  !! your sections describe {covered:.1f}s but the audio is {dur:.1f}s long")
    if dur - covered > bar * 2:
        print(f"  !! {dur - covered:.1f}s of audio after your last section — is a section missing?")

    beats = [round(first + i * beat, 6) for i in range(int((dur - first) / beat))]
    downs = [round(first + i * bar, 6) for i in range(bars)]

    chapters, sections, seen = [], [], {}
    b0 = 0
    for s in secs:
        at = round(first + b0 * bar, 6)
        name = s["name"]
        sid = s.get("id") or name[:1].upper()
        seen[sid] = seen.get(sid, 0) + 1
        chapters.append({"at": at, "name": name})
        sections.append({"at": at, "to": round(first + (b0 + int(s["bars"])) * bar, 6),
                         "name": name, "id": sid, "repeat": seen[sid],
                         "arc": round(b0 / bars, 3)})
        b0 += int(s["bars"])

    mr = rms_per_bar(buf, sr, first, bar, bars)
    mm = max(mr) or 1.0
    energy = [[downs[i], round(mr[i] / mm, 4)] for i in range(bars)]

    stems, how_stems = {}, "authored from the instrument list"
    stem_dir = os.path.join(base, spec.get("stems_dir", ""))
    got = {}
    if spec.get("stems_dir") and os.path.isdir(stem_dir):
        for k in CANON:
            p = os.path.join(stem_dir, k + ".wav")
            if os.path.exists(p):
                sb, ssr = read_wav(p)
                r = rms_per_bar(sb, ssr, first, bar, bars)
                mx = max(r) or 1.0
                got[k] = [round(v / mx, 4) for v in r]
    if got:
        how_stems = "measured from exported stems"
        for k in CANON:
            stems[k] = got.get(k, [0.0] * bars)
    else:
        b0 = 0
        for k in CANON: stems[k] = [0.0] * bars
        for s in secs:
            plays = [p.lower() for p in s.get("plays", [])]
            for i in range(int(s["bars"])):
                for k in CANON:
                    if k in plays: stems[k][b0 + i] = 1.0
            b0 += int(s["bars"])

    moments, spans = [], []
    for i, s in enumerate(secs):
        at = round(first + sum(int(x["bars"]) for x in secs[:i]) * bar, 6)
        n = s["name"].lower()
        rep = sections[i]["repeat"]
        if "drop" in n or "chorus" in n:
            moments.append({"at": at, "kind": "drop", "size": 0.9 if rep == 1 else 1.0,
                            "note": f"authored: section '{s['name']}', pass {rep}"})
        if "break" in n or "quiet" in n:
            moments.append({"at": at, "kind": "quiet", "note": "authored"})
        if "build" in n:
            spans.append({"kind": "build", "from": at,
                          "to": round(at + int(s["bars"]) * bar, 6),
                          "rise": s.get("rise", "steady"), "bars": int(s["bars"])})
        if "outro" in n or "end" in n:
            moments.append({"at": at, "kind": "return", "note": "authored"})
    for m in spec.get("moments", []):
        moments.append({**m, "note": (m.get("note", "") + " (authored by hand)").strip()})
    moments.sort(key=lambda m: m["at"])

    return wav, {
        "map": "0.3",
        "song": {"title": spec["title"], "artist": spec.get("artist", "limelight"),
                 "length": round(dur, 3)},
        "level": {"n": spec.get("level"), "teaches": spec.get("teaches", "")},
        "made_by": {
            # A map for a record somebody else made is HAND-WRITTEN, not synthetic.
            # Synthetic means the times are causes -- audio was rendered from them.
            # Here a person listened and typed what they heard, which is a weaker
            # claim, and the two must never look the same in a file.
            "how": "hand-written" if spec.get("real") else "synthetic",
            "who": spec.get("by") or "synth/import.py",
            "why": ("Heard by a person and typed in. Tempo, bar one and the section list are what "
                    "they believe; energy is measured from the audio. Beliefs and measurements are "
                    "mixed here, which is why this is not truth."
                    if spec.get("real") else
                    "Authored by the person who wrote the song. Tempo, bar one and the section "
                    "list come from them because they set those values; energy is measured from "
                    "their audio. Nothing here was detected."),
            "warning": ("HAND-WRITTEN. One person's reading of a record, good enough to build "
                        "against and not good enough to grade against. To promote any of it to "
                        "truth, verify it with the audio playing and follow truth/PROTOCOL.md."
                        if spec.get("real") else
                        "AUTHORED. An answer key, not evidence about how music behaves in general."),
            "audio": os.path.basename(spec["audio"]),
            "audio_sha256": _sha(wav)[:16],
            "audio_note": "Audio is not in git. Everyone must start from the SAME file — two rips "
                          "of one track differ by tens of milliseconds.",
        },
        "grid": {"period": round(beat, 6), "phase": first, "bpm": bpm, "bar_phase": 0,
                 "locked": True, "how": "authored: the tempo the song was written at"},
        "beats": beats, "downbeats": downs, "beats_window": [0.0, round(dur, 3)],
        "chapters": chapters,
        "sections": {"how": "authored arrangement", "entries": sections},
        "spans": spans, "moments": moments, "energy": energy, "confidence": 1.0,
        "stems": {"model": "authored", "rate": "per_downbeat", "sources": stems, "at": downs,
                  "how": how_stems,
                  "note": "Presence per bar. Export stems named drums/bass/other/vocals/guitar/"
                          "piano.wav into a folder and point stems_dir at it to get measured "
                          "curves instead of the on/off list."},
        "observations": {k: v for k, v in {
            "key": ({"estimate": spec["key"], "how": "authored", "confidence": 1.0}
                    if spec.get("key") else None)}.items() if v},
        "arrangement": [{"name": s["name"], "bars": int(s["bars"]),
                         "plays": sorted(s.get("plays", []))} for s in secs],
    }


TEMPLATE = {
    "title": "Levels",
    "artist": "Avicii",
    "real": True,
    "by": "your name — you heard this, you own it",
    "audio": "levels.mp3",
    "stems_dir": "",
    "bpm": 126,
    "first_downbeat": 0.0,
    "beats_per_bar": 4,
    "key": "C# minor",
    "sections": [
        {"name": "intro", "bars": 8,  "plays": ["other"]},
        {"name": "verse", "bars": 16, "plays": ["other", "bass", "drums"]},
        {"name": "build", "bars": 8,  "plays": ["other", "bass", "drums"], "rise": "late"},
        {"name": "drop",  "bars": 16, "plays": ["other", "bass", "drums", "vocals"]},
        {"name": "break", "bars": 8,  "plays": ["other", "vocals"]},
        {"name": "drop",  "bars": 16, "plays": ["other", "bass", "drums", "vocals"]},
        {"name": "outro", "bars": 8,  "plays": ["other"]},
    ],
    "moments": [],
}


def main(argv):
    inc = os.path.join(HERE, "incoming")
    os.makedirs(inc, exist_ok=True)
    if len(argv) < 2 or argv[1] in ("-h", "--help"):
        t = os.path.join(inc, "TEMPLATE.song.json")
        json.dump(TEMPLATE, open(t, "w"), indent=1)
        print(__doc__)
        print(f"  wrote a template to {t}")
        print("  copy it, fill it in, put your wav next to it, then run:")
        print("      python3 synth/import.py synth/incoming/your-song.song.json")
        return 0
    p = argv[1]
    spec = json.load(open(p))
    wav, m = build(spec, os.path.dirname(os.path.abspath(p)))
    slug = spec.get("slug") or os.path.basename(p).replace(".song.json", "")
    who = (spec.get("by") or "").split()[0].lower().strip(",") or None
    # A hand-written reading of a real record is a CANDIDATE, not the answer key.
    # It goes in maps/ beside everyone else's so it can be played against them.
    if spec.get("real") and who:
        out = os.path.join(HERE, "maps", f"{slug}.{who}.map.json")
        os.makedirs(os.path.dirname(out), exist_ok=True)
    else:
        out = os.path.join(HERE, "songs", slug + ".map.json")
    json.dump(m, open(out, "w"), indent=1)
    import shutil
    shutil.copyfile(wav, os.path.join(HERE, "out", slug + ".wav"))
    print(f"  {m['song']['title']}   {m['song']['length']}s   {m['grid']['bpm']} bpm   "
          f"{len(m['downbeats'])} bars   {len(m['moments'])} moments")
    print(f"  stems: {m['stems']['how']}")
    print(f"  energy: min {min(e[1] for e in m['energy']):.2f} max {max(e[1] for e in m['energy']):.2f}")
    print(f"  audio sha256 {m['made_by']['audio_sha256']}  <- everyone must match this")
    print(f"  wrote {os.path.relpath(out, os.path.dirname(HERE))}")
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv))
