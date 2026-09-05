#!/usr/bin/env python3
"""Fill in fields a map can carry but does not, from data it already holds.

    python3 synth/upgrade_map.py synth/truth/levels.map.json

Derives nothing from thin air. Every field it adds comes from numbers already in
the file, and each one records how it was derived and what it is not. If a source
is missing the field is skipped rather than guessed.
"""
import json, math, os, sys, argparse


def accents_from_onset(m):
    """Percussive events from the onset curve, with each hit told whether it sits
    on the grid. 'Three hits around second two' is unanswerable from `beats`,
    which is the whole reason this field exists."""
    fr = (m.get("observations") or {}).get("frames") or {}
    on, hop, t0 = fr.get("onset"), fr.get("hop_s"), fr.get("t0", 0.0)
    if not on or not hop: return None
    lo, hi = min(on), max(on)
    if hi <= lo: return None
    norm = [(v - lo) / (hi - lo) for v in on]
    # a peak has to beat its neighbours and a local floor, so a loud passage does
    # not report every frame as a hit
    W = max(1, int(0.75 / hop))
    ev = []
    for i in range(1, len(norm) - 1):
        v = norm[i]
        if v < 0.12 or v < norm[i - 1] or v < norm[i + 1]: continue
        a, b = max(0, i - W), min(len(norm), i + W)
        local = sum(norm[a:b]) / (b - a)
        if v < local * 2.2: continue
        ev.append({"at": round(t0 + i * hop, 4), "strength": round(v, 4)})
    thinned = []
    for e in ev:                       # nobody stabs twice inside 80 ms
        if thinned and e["at"] - thinned[-1]["at"] < 0.08:
            if e["strength"] > thinned[-1]["strength"]: thinned[-1] = e
            continue
        thinned.append(e)
    per, ph = m["grid"]["period"], m["grid"]["phase"]
    off = 0
    for e in thinned:
        k = round((e["at"] - ph) / per)
        e["on_grid"] = abs(e["at"] - (ph + k * per)) <= 0.05
        if not e["on_grid"]: off += 1
    pct = 100.0 * off / max(1, len(thinned))
    return {"of": "mix", "how": "peaks in the musicstate onset curve, thinned to 80 ms apart",
            "events": thinned,
            "note": f"{len(thinned)} hits, {pct:.1f}% of them off the beat grid. NOT beats and not "
                    f"moments. A reader asked to punctuate the percussion cannot get these times "
                    f"from `beats`, which is why the field exists.",
            "caveat": "Derived from a full-mix onset curve, so it hears hats and synth stabs as "
                      "readily as drums. Onsets on a separated drum stem would be cleaner."}


def brightness_from_bands(m):
    """Texture, not level: where the energy sits in the spectrum."""
    fr = (m.get("observations") or {}).get("frames") or {}
    lo, mi, hi, hop = fr.get("low"), fr.get("mid"), fr.get("high"), fr.get("hop_s")
    if not (lo and mi and hi and hop): return None
    downs = m.get("downbeats") or []
    if not downs: return None
    out = []
    for i, t in enumerate(downs):
        a = int(t / hop)
        b = int((downs[i + 1] if i + 1 < len(downs) else t + (downs[1] - downs[0])) / hop)
        a, b = max(0, a), min(len(lo), max(a + 1, b))
        L = sum(lo[a:b]) / (b - a); M = sum(mi[a:b]) / (b - a); H = sum(hi[a:b]) / (b - a)
        tot = L + M + H
        out.append([round(t, 4), round((M + 2 * H) / tot, 4) if tot > 1e-9 else 0.0])
    return {"rate": "per_downbeat", "how": "(mid + 2*high) / total band energy, per bar",
            "values": out,
            "note": "Where the sound sits in the spectrum, not how loud it is. A bar can be quiet "
                    "and bright, or loud and dark, and a room should look different in each."}


def vocal_silence(m):
    st = ((m.get("stems") or {}).get("sources") or {}).get("vocals")
    at = (m.get("stems") or {}).get("at") or m.get("downbeats") or []
    if not st or not at: return None
    thr = 0.12
    spans, cur = [], None
    for i, v in enumerate(st):
        t = at[i] if i < len(at) else None
        if t is None: break
        if v < thr:
            if cur is None: cur = [t, t]
            else: cur[1] = t
        elif cur is not None:
            if cur[1] - cur[0] >= 2.0: spans.append([round(cur[0], 3), round(cur[1], 3)])
            cur = None
    if cur and cur[1] - cur[0] >= 2.0: spans.append([round(cur[0], 3), round(cur[1], 3)])
    total = sum(b - a for a, b in spans)
    return {"how": f"stems.vocals below {thr}, runs of two seconds or more", "spans": spans,
            "silent_seconds": round(total, 1),
            "note": "Where the voice is absent. The cleanest structural signal in most records, "
                    "and what lets a reader spotlight a singer who is actually singing."}


def microtiming(m, acc):
    if not acc or not acc.get("events"): return None
    per, ph = m["grid"]["period"], m["grid"]["phase"]
    sub = per / 4.0
    devs = []
    for e in acc["events"]:
        k = round((e["at"] - ph) / sub)
        devs.append((e["at"] - (ph + k * sub)) * 1000.0)
    devs.sort()
    n = len(devs)
    if not n: return None
    med = devs[n // 2]
    within = sum(1 for d in devs if abs(d) <= 15) / n * 100
    return {"unit": "ms from the nearest 1/16 of a beat", "quantisation": "1/16",
            "median": round(med, 2), "within_15ms_pct": round(within, 1),
            "feel": "machine-tight" if within > 85 else "human",
            "how": "deviation of each accent from the nearest sixteenth",
            "note": "Measured against the grid the music is actually played on. Measuring against "
                    "the nearest BEAT instead reports half a beat of scatter and calls it feel, "
                    "which is an artifact of assigning subdivision hits to beats."}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path"); ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()
    m = json.load(open(a.path))
    obs = m.setdefault("observations", {})
    added = []

    if "accents" not in m:
        acc = accents_from_onset(m)
        if acc: m["accents"] = acc; added.append(f"accents ({len(acc['events'])} hits)")
    acc = m.get("accents")

    for name, fn in (("brightness", brightness_from_bands), ("vocal_silence", vocal_silence)):
        if name not in obs:
            v = fn(m)
            if v: obs[name] = v; added.append(name)
    if "microtiming" not in obs and acc:
        v = microtiming(m, acc)
        if v: obs["microtiming"] = v; added.append("microtiming")

    if not added:
        print("  nothing to add — everything derivable is already there"); return
    m.setdefault("made_by", {}).setdefault("upgrades", []).append(
        {"by": "synth/upgrade_map.py", "added": added,
         "note": "Derived from numbers already in this file. Nothing was invented, and a field "
                 "whose source was missing was skipped rather than guessed."})
    print("  added: " + ", ".join(added))
    for k in ("accents",):
        if k in m: print(f"    {k}: {m[k]['note'][:96]}")
    for k in ("brightness", "vocal_silence", "microtiming"):
        if k in obs: print(f"    {k}: {str(obs[k].get('note') or obs[k])[:96]}")
    if a.dry: print("  --dry, not written"); return
    import shutil; shutil.copyfile(a.path, a.path + ".bak")
    json.dump(m, open(a.path, "w"), indent=1)
    print(f"  wrote {a.path}  ({os.path.getsize(a.path)/1024:.0f} KB, .bak kept)")

if __name__ == "__main__":
    main()
