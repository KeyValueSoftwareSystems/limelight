#!/usr/bin/env python3
"""Find the sidechain pump: the duck-and-swell that a compressor puts on a mix
when it is keyed off the kick.

This is the defining production element of the record Renjith wants to light.
Every kick ducks the whole mix and it breathes back over the following beat, and
a rig that breathes with it is playing the song rather than merely being on time.

How it is measured. The kick itself must be excluded or it drowns the thing we
are looking for, so the envelope is taken above 250 Hz where the duck shows and
the thump does not. That envelope is then folded over the beat period using the
map's own grid: every beat is laid on top of every other beat and averaged, so a
modulation locked to the beat survives and everything else averages away.

What makes it a real detector rather than a number that always comes out. Music
without sidechain DECAYS between hits, because that is what sound does. Music
with sidechain RISES between hits, because the compressor is letting go. So the
measurement is the sign of the slope from just after one kick to just before the
next, and it does not care how loud or how varied the record is.

Folding the whole beat was tried first and failed, honestly: the trough and peak
it found were the kick's own envelope ramping up and decaying, in every band from
30 Hz to 8 kHz, and it reported no pump on Levels, which certainly pumps. The
window here starts 18% into the beat so the kick transient is past, and ends at
72% so the next one has not begun.

Calibrated against real records and against songs that cannot pump, since
compose.py is additive synthesis with no compressor in it anywhere:

    Levels          +0.13 to +0.26 by chapter, +0.17 overall   pumps
    The Nights      -0.03 to +0.06                             barely
    10-everything   -0.13 to -0.05                             no, and decays

Usage:  python3 listen/pump.py <slug> [--write]
"""
import sys, os, json, math, wave, array

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BINS = 24                    # phase bins across one beat


def envelope(wav, hp_hz=250.0, hop_s=0.005):
    with wave.open(wav, "rb") as w:
        sr, n, ch = w.getframerate(), w.getnframes(), w.getnchannels()
        raw = w.readframes(n)
    a = array.array("h")
    a.frombytes(raw[:len(raw) - (len(raw) % 2)])
    if ch > 1:
        a = a[::ch]
    # one-pole high pass: the signal minus its own low end, so the kick body goes
    al = math.exp(-2 * math.pi * hp_hz / sr)
    hop = max(1, int(sr * hop_s))
    env, y = [], 0.0
    for i in range(0, len(a) - hop, hop):
        acc = 0.0
        for v in a[i:i + hop]:
            y = (1 - al) * v + al * y
            d = v - y                       # what is left above hp_hz
            acc += d * d
        env.append(math.sqrt(acc / hop))
    return env, hop / sr


def fold(env, dt, beats, t0=None, t1=None):
    """Average one beat's worth of envelope across every beat in a window."""
    acc = [0.0] * BINS
    cnt = [0] * BINS
    for i in range(len(beats) - 1):
        b, nb = beats[i], beats[i + 1]
        if t0 is not None and b < t0: continue
        if t1 is not None and b > t1: continue
        per = nb - b
        if per <= 0 or per > 2.0: continue
        for k in range(BINS):
            t = b + per * (k + 0.5) / BINS
            j = int(t / dt)
            if 0 <= j < len(env):
                acc[k] += env[j]
                cnt[k] += 1
    if min(cnt) == 0:
        return None
    return [acc[k] / cnt[k] for k in range(BINS)]


LO, HI = 0.18, 0.72          # the window between one kick and the next


def recovery(env, dt, beats, t0=None, t1=None):
    """How much the mix climbs between kicks. Positive is a pump; a record with no
    sidechain decays here and comes out negative."""
    vals = []
    for i in range(len(beats) - 1):
        b, nb = beats[i], beats[i + 1]
        if t0 is not None and b < t0: continue
        if t1 is not None and b > t1: continue
        per = nb - b
        if per <= 0 or per > 2.0: continue
        ja, jb = int((b + per * LO) / dt), int((b + per * HI) / dt)
        if ja < 0 or jb >= len(env) or jb - ja < 3: continue
        seg = env[ja:jb]
        third = max(1, len(seg) // 3)
        first = sum(seg[:third]) / third
        last = sum(seg[-third:]) / third
        if first + last > 0:
            vals.append((last - first) / (last + first))
    if not vals:
        return 0.0, 0
    return sum(vals) / len(vals), len(vals)


def release(shape):
    """Where in the beat the recovery has gone 63% of its way -- the compressor's
    release, read off the folded curve rather than assumed."""
    seg = shape[int(BINS * LO):int(BINS * HI)]
    if len(seg) < 3: return None
    lo, hi = min(seg), max(seg)
    if hi <= lo: return None
    target = lo + 0.63 * (hi - lo)
    for k, v in enumerate(seg):
        if v >= target:
            return round((LO + (k / len(seg)) * (HI - LO)), 3)
    return None


def analyse(slug, write=False):
    wav = os.path.join(ROOT, "synth", "out", slug + ".wav")
    mp = None
    for cand in (os.path.join(ROOT, "synth", "truth", slug + ".map.json"),
                 os.path.join(ROOT, "synth", "songs", slug + ".map.json")):
        if os.path.exists(cand):
            mp = cand
            break
    if not os.path.exists(wav) or not mp:
        return {"song": slug, "error": "no audio or no map"}
    m = json.load(open(mp))
    beats = m.get("beats") or []
    if not beats:
        per, ph = m["grid"]["period"], m["grid"]["phase"]
        beats = [ph + i * per for i in range(int((m["song"]["length"] - ph) / per))]

    env, dt = envelope(wav)
    shape = fold(env, dt, beats)
    if shape is None:
        return {"song": slug, "error": "not enough beats"}
    depth, nbeats = recovery(env, dt, beats)
    present = bool(depth >= 0.10)
    rel = release(shape)

    # per chapter, because a record pumps in the drop and not in the intro
    per_section = []
    chs = m.get("chapters", [])
    for i, c in enumerate(chs):
        t0 = c["at"]
        t1 = chs[i + 1]["at"] if i + 1 < len(chs) else m["song"]["length"]
        d, n = recovery(env, dt, beats, t0, t1)
        if n >= 8:
            per_section.append([round(t0, 3), round(d, 4), bool(d >= 0.10)])

    peak = max(shape) or 1.0
    out = {
        "how": ("envelope above 250 Hz so the kick body is excluded, measured from 18% "
                "to 72% of each beat so neither the kick's attack nor the next one is "
                "in the window. Music without sidechain DECAYS between hits; music with "
                "it RISES, because the compressor is letting go. The sign of that slope "
                "is the whole test. Calibrated on records that cannot pump: the "
                "synthetic ladder is additive synthesis with no compressor in it, and "
                "comes out negative."),
        "rate": "per_beat_phase",
        "bins": BINS,
        "present": present,
        "depth": round(depth, 4),
        "beats_measured": nbeats,
        "release_at_beat_fraction": rel,
        "shape": [round(v / peak, 4) for v in shape],
        "per_chapter": per_section,
        "made_by": {"how": "model", "who": "listen/pump.py",
                    "reproduce": f"python3 listen/pump.py {slug}"},
    }
    if write:
        m.setdefault("observations", {})["pump"] = out
        json.dump(m, open(mp, "w"), indent=1)
        out["written_to"] = os.path.relpath(mp, ROOT)
    return {"song": slug, "present": out["present"], "depth": out["depth"],
            "shape": out["shape"], "written_to": out.get("written_to")}


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    wr = "--write" in sys.argv
    for slug in args:
        r = analyse(slug, wr)
        if "error" in r:
            print(f"{slug:16} {r['error']}")
            continue
        bar = "".join(" ▁▂▃▄▅▆▇█"[min(8, int(v * 8.99))] for v in r["shape"])
        print(f"{slug:16} pump={'YES' if r['present'] else 'no ':3} "
              f"recovery={r['depth']:+.4f}  |{bar}|"
              + (f"  -> {r['written_to']}" if r.get("written_to") else ""))
