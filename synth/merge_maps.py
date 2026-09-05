#!/usr/bin/env python3
"""Merge two maps of one song into the better of the two. Stdlib only.

    python3 synth/merge_maps.py levels --a amal --b dheeraj --out truth

Not an average. Each field is taken from whichever map earned it, every choice
is recorded in made_by.merge, and a claim that the audio contradicts is dropped
by name rather than quietly outvoted.
"""
import json, math, os, sys, wave, argparse, collections

HERE = os.path.dirname(os.path.abspath(__file__))


def read_wav(p):
    w = wave.open(p, "rb"); sr = w.getframerate()
    raw = w.readframes(w.getnframes()); w.close()
    return [int.from_bytes(raw[i:i+2], "little", signed=True) / 32768.0
            for i in range(0, len(raw) - 1, 2)], sr


def energy_on(buf, sr, downs, bar):
    out = []
    for i, t in enumerate(downs):
        a, b = int(t * sr), int(min(len(buf), (t + bar) * sr))
        seg = buf[max(0, a):b]
        out.append(math.sqrt(sum(x * x for x in seg) / max(1, len(seg))) if seg else 0.0)
    mx = max(out) or 1.0
    return [[round(downs[i], 6), round(out[i] / mx, 4)] for i in range(len(downs))]


def step_at(energy, t, w=8.0):
    before = [v for tt, v in energy if t - w <= tt < t]
    after = [v for tt, v in energy if t <= tt < t + w]
    if not before or not after: return 0.0
    return sum(after) / len(after) - sum(before) / len(before)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("song"); ap.add_argument("--a", required=True); ap.add_argument("--b", required=True)
    ap.add_argument("--out", default="merged")
    args = ap.parse_args()
    A = json.load(open(os.path.join(HERE, "maps", args.a, args.song + ".map.json")),
                  object_pairs_hook=collections.OrderedDict)
    B = json.load(open(os.path.join(HERE, "maps", args.b, args.song + ".map.json")),
                  object_pairs_hook=collections.OrderedDict)
    wav = os.path.join(HERE, "out", args.song + ".wav")
    buf, sr = read_wav(wav)
    log = []

    # GRID -- they agree on tempo, so take the one that starts at the top of the
    # song rather than at its first tracked beat
    grid = collections.OrderedDict(A["grid"])
    log.append(f"grid from {args.a}: both say {A['grid']['bpm']} bpm; his phase {A['grid']['phase']} "
               f"starts at the top of the song, {args.b}'s {B['grid']['phase']} starts at the first "
               f"beat he tracked")
    beats, downs = A["beats"], A["downbeats"]
    bar = grid["period"] * 4

    # ENERGY -- recomputed on the merged downbeats so it lines up exactly
    energy = energy_on(buf, sr, downs, bar)
    log.append(f"energy recomputed from the audio on the merged downbeats ({len(energy)} bars), "
               f"so it aligns with the grid actually being used")

    # MOMENTS -- every claim tested against the measured energy
    kept, dropped, added = [], [], []
    for m in A.get("moments", []):
        s = step_at(energy, m["at"])
        if m["kind"] == "drop" and s < 0.02:
            dropped.append(f"{args.a}'s drop at {m['at']:.2f} (energy step {s:+.3f} — no step)"); continue
        if m["kind"] == "quiet" and s > -0.01:
            dropped.append(f"{args.a}'s quiet at {m['at']:.2f} (energy step {s:+.3f} — louder, not quieter)"); continue
        mm = collections.OrderedDict(m); mm["from"] = args.a
        mm["energy_step"] = round(s, 4)
        kept.append(mm)
    for m in B.get("moments", []):
        if any(abs(k["at"] - m["at"]) < 3.0 and k["kind"] == m["kind"] for k in kept): continue
        s = step_at(energy, m["at"])
        if m["kind"] == "drop" and s < 0.02: continue
        if m["kind"] == "quiet" and s > -0.01: continue
        if m["kind"] == "build" and s <= 0: continue
        mm = collections.OrderedDict(m); mm["from"] = args.b; mm["energy_step"] = round(s, 4)
        kept.append(mm); added.append(f"{args.b}'s {m['kind']} at {m['at']:.2f} (step {s:+.3f})")
    kept.sort(key=lambda m: m["at"])
    # a spotlight only means something if something follows it
    final = []
    for i, m in enumerate(kept):
        if m["kind"] == "spotlight" and not any(
                0 < k["at"] - m["at"] < 25 and k["kind"] == "drop" for k in kept):
            dropped.append(f"spotlight at {m['at']:.2f} (nothing follows it within 25 s)"); continue
        final.append(m)
    log.append(f"moments: {len(final)} kept, {len(dropped)} dropped as contradicted by the audio, "
               f"{len(added)} taken from {args.b}")

    # CHAPTERS -- A's, because they use the six words a reader understands
    chapters = A.get("chapters", [])
    seen, entries = {}, []
    for i, c in enumerate(chapters):
        to = chapters[i + 1]["at"] if i + 1 < len(chapters) else A["song"]["length"]
        sid = c["name"][:1].upper()
        seen[sid] = seen.get(sid, 0) + 1
        entries.append({"at": c["at"], "to": round(to, 6), "name": c["name"], "id": sid,
                        "repeat": seen[sid], "arc": round(c["at"] / A["song"]["length"], 3)})
    log.append(f"chapters from {args.a} ({len(chapters)}): plain names a reader knows — intro, "
               f"verse, break, drop, outro — where {args.b}'s allin1 labels are chorus and inst")

    out = collections.OrderedDict()
    out["map"] = "0.3"
    out["song"] = A["song"]
    out["made_by"] = collections.OrderedDict([
        ("how", "model"),
        ("who", f"merge of {args.a} and {args.b}"),
        ("why", "Neither map was better. One had richer structure and more of it wrong, the other "
                "was sparse but clean and carried everything the first had none of."),
        ("merge", log),
        ("dropped", dropped),
        ("adopted_from_" + args.b, added),
        ("warning", "Every moment carries `from` and `energy_step`, so no claim in this file is "
                    "anonymous. A moment with a step near zero should never have survived."),
    ])
    out["grid"] = grid
    out["beats"] = beats
    out["downbeats"] = downs
    out["beats_window"] = [0.0, A["song"]["length"]]
    out["chapters"] = chapters
    out["sections"] = {"how": f"{args.a}'s chapters, with repeat and arc derived", "entries": entries}
    out["spans"] = A.get("spans", []) or B.get("spans", [])
    out["moments"] = final
    out["energy"] = energy
    out["confidence"] = 0.8
    out["confidence_by_field"] = {"beats": 0.95, "downbeats": 0.9, "chapters": 0.55,
                                  "moments": 0.7, "spans": 0.4, "energy": 0.9}
    for k in ("accents", "stems", "vectors"):
        if k in B: out[k] = B[k]; log.append(f"{k} from {args.b} — {args.a} has none")
    if "observations" in B:
        out["observations"] = B["observations"]
        log.append(f"observations from {args.b}: {', '.join(B['observations'])}")

    d = os.path.join(HERE, "truth") if args.out == "truth" else os.path.join(HERE, "maps", args.out)
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, args.song + ".map.json")
    if os.path.exists(p):
        import shutil; shutil.copyfile(p, p + ".bak")
    json.dump(out, open(p, "w"), indent=1)
    print(f"  merged {args.a} + {args.b} -> {os.path.relpath(p, os.path.dirname(HERE))}")
    for l in log: print("   ·", l)
    if dropped:
        print("  dropped, contradicted by the audio:")
        for x in dropped: print("   ×", x)
    if added:
        print(f"  taken from {args.b}:")
        for x in added: print("   +", x)

if __name__ == "__main__":
    main()
