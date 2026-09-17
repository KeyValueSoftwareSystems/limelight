import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))


def score_for(song):
    out = (
        subprocess.check_output(
            [
                "node",
                "-e",
                "console.log(require('./protocol/fixture.js').pick(%r))" % song,
            ],
            cwd=REPO,
            stderr=subprocess.DEVNULL,
        )
        .decode()
        .strip()
    )
    return json.load(open(out))


def grid_of(sc):
    beats = [b["t"] for b in sc.get("beats", [])]
    per = (sc.get("grid") or {}).get("beats_per_bar", 4)
    flags = [i for i, b in enumerate(sc.get("beats", [])) if b.get("downbeat")]
    phase = (flags[0] % per) if flags else 0
    step = (beats[-1] - beats[0]) / (len(beats) - 1) if len(beats) > 1 else 0.5

    def seconds_at(bar, beat=1):
        i = phase + (bar - 1) * per + (beat - 1)
        if i < 0:
            return beats[0] + i * step
        if i >= len(beats):
            return beats[-1] + (i - len(beats) + 1) * step
        return beats[i]

    return per, phase, step, seconds_at


def table(song, lo=None, hi=None, floor=0.04):
    sc = score_for(song)
    per, phase, step, at = grid_of(sc)
    length = sc["song"]["length_s"]
    nbars = 1
    while at(nbars + 1) < length:
        nbars += 1

    temporal = sc.get("stems_temporal") or {}
    win = temporal.get("window_s", 0.5)
    lanes = temporal.get("stems", {})
    names = sorted(lanes)

    def level(name, a, b):
        v = lanes.get(name) or []
        i0, i1 = int(a / win), max(int(a / win) + 1, int(b / win))
        seg = v[i0:i1]
        return max(seg) if seg else 0.0

    rows = []
    for bar in range(1, nbars + 1):
        a, b = at(bar), at(bar + 1)
        playing = {n: level(n, a, b) for n in names}
        playing = {n: v for n, v in playing.items() if v >= floor}
        rows.append(
            {
                "bar": bar,
                "start": a,
                "end": b,
                "playing": playing,
                "energy": sum(playing.values()),
            }
        )

    lo = lo or 1
    hi = hi or nbars
    print(
        "  %s  %.1fs  %d bars  bar=%.2fs  downbeat phase %d"
        % (song, length, nbars, step * per, phase)
    )
    print("  a stem is listed when it reaches %.2f inside the bar\n" % floor)
    prev = set()
    secs = sc.get("sections") or []
    for r in rows:
        if not (lo <= r["bar"] <= hi):
            continue
        here = set(r["playing"])
        came = sorted(here - prev)
        went = sorted(prev - here)
        mark = ""
        for s in secs:
            if abs(s["start"] - r["start"]) < step:
                mark = "  <<< %s" % s.get("label", "section")
        top = sorted(r["playing"].items(), key=lambda kv: -kv[1])[:6]
        print(
            "  bar %3d  %6.1fs  E %5.2f  %s%s"
            % (
                r["bar"],
                r["start"],
                r["energy"],
                " ".join("%s:%.2f" % (n, v) for n, v in top),
                mark,
            )
        )
        if came:
            print("           + in   %s" % ", ".join(came))
        if went:
            print("           - out  %s" % ", ".join(went))
        prev = here


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    song = args[0] if args else "raga-of-revenge"
    lo = int(args[1]) if len(args) > 1 else None
    hi = int(args[2]) if len(args) > 2 else None
    table(song, lo, hi)
