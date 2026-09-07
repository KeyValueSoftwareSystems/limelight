#!/usr/bin/env python3
"""Is each `drop` in the map on the beat the kick actually arrives on?

Renjith heard that a drop on the-nights landed two beats late against the map,
and a step test in the kick band confirmed it: 1,820 at the claimed moment,
17,060 two beats later. A model had placed it and an ear caught it.

`moments` is the interface tier, so a drop in the wrong place is wrong for every
reader downstream and no amount of recipe work can recover it. This runs the same
test on every drop in every map we wrote: measure kick-band energy in a short
window at the claimed time and at each of the surrounding beats, and report any
beat that is dramatically louder than the one the map chose.

It does not move anything. A drop inside an already-loud passage cannot be placed
by a step test at all -- the kick is loud on every beat either side -- and those
are reported as unplaceable rather than nudged on a hunch.
"""
import json, math, os, sys, glob

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "listen"))
import ear

WIN_S = 0.09          # a kick transient, not a bar
BEATS_EITHER_SIDE = 3
STEP_FACTOR = 3.0     # "dramatically louder" -- Renjith's case was 9x


def kick_energy(band, rate, t):
    i0 = max(0, int((t - WIN_S * 0.25) * rate))
    i1 = min(len(band), int((t + WIN_S * 0.75) * rate))
    if i1 <= i0:
        return 0.0
    return sum(abs(band[i]) for i in range(i0, i1)) / (i1 - i0)


def check(song, map_path):
    wav = os.path.join("synth", "out", song + ".wav")
    if not os.path.exists(wav):
        print("  %-16s no audio at %s" % (song, wav)); return
    m = json.load(open(map_path))
    drops = [x for x in (m.get("moments") or []) if x.get("kind") == "drop"]
    if not drops:
        print("  %-16s no drops in the map" % song); return
    per = (m.get("grid") or {}).get("period") or 0.5

    x, sr = ear.read_audio(wav)
    dec, drate = ear.block_average_decimate(x, sr, 2000.0)
    band = ear.bandpass(dec, drate, ear.KICK_LO_HZ, ear.KICK_HI_HZ)

    print("  %-16s %d drops, period %.4f" % (song, len(drops), per))
    for d in drops:
        at = d.get("at")
        if at is None:
            continue
        here = kick_energy(band, drate, at)
        rows = []
        for k in range(-BEATS_EITHER_SIDE, BEATS_EITHER_SIDE + 1):
            rows.append((k, kick_energy(band, drate, at + k * per)))
        best = max(rows, key=lambda r: r[1])
        # unplaceable: the kick is already loud on every beat around it
        near = [v for _, v in rows]
        quiet = min(near) or 1e-9
        if max(near) / quiet < STEP_FACTOR:
            print("    %8.3f  unplaceable (kick within %.1fx across %d beats)"
                  % (at, max(near) / quiet, len(rows)))
            continue
        if best[0] == 0:
            print("    %8.3f  ok            here %8.0f  (loudest of its neighbours)" % (at, here))
        else:
            print("    %8.3f  %+d BEATS OFF  here %8.0f -> %8.0f at %+.3f s   %.1fx"
                  % (at, best[0], here, best[1], best[0] * per,
                     best[1] / (here or 1e-9)))


if __name__ == "__main__":
    args = sys.argv[1:]
    paths = args or sorted(glob.glob("maps/model/*.map.json"))
    print("\n=== are the drops on the beat the kick arrives on? ===")
    for p in paths:
        stem = os.path.basename(p)[: -len(".map.json")]
        song = stem.split(".")[0]
        check(song, p)
    print("\n  Nothing is moved by this script. A moment is interface tier and")
    print("  belongs to whoever measured it; this only says where to look.")
