#!/usr/bin/env python3
"""The closed loop. Author -> render -> listen -> score, one command.

    python3 synth/loop.py                                  # dev cases
    python3 synth/loop.py --all                             # includes held-out
    python3 synth/loop.py --listener "python3 mine.py"      # score your own

The listener contract is a command line, not a Python import, so it can be
written in anything: it receives a WAV path as its last argument and writes a
map to stdout. Numbers land in synth/RESULTS.tsv with the commit they came from,
so a regression is visible as a diff rather than remembered.

Held-out cases are excluded by default. Tuning against every case produces a
listener that passes this suite and fails on music, so one number is kept
un-optimised on purpose and only that one is worth believing.
"""
import argparse, json, os, subprocess, sys, time, importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m

R = _load("render", os.path.join(HERE, "render.py"))
B = _load("bench", os.path.join(ROOT, "bench", "bench.py"))

def sha():
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"],
                                       cwd=ROOT, text=True).strip()
    except Exception:
        return "nogit"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--listener", default="python3 listen/baseline.py")
    ap.add_argument("--all", action="store_true", help="include held-out cases")
    ap.add_argument("--no-log", action="store_true")
    a = ap.parse_args()

    cases = sorted(f for f in os.listdir(os.path.join(HERE, "cases")) if f.endswith(".json"))
    rows, held = [], 0
    print(f"\n  listener: {a.listener}\n")
    print(f"  {'case':18s} {'beats F':>8s} {'grid err':>9s} {'bpm':>8s} "
          f"{'downbeat F':>11s} {'octave':>7s} {'render':>7s} {'listen':>7s}")
    print("  " + "-" * 86)
    for f in cases:
        truth = json.load(open(os.path.join(HERE, "cases", f)))
        if truth.get("hold_out") and not a.all:
            held += 1; continue
        t0 = time.time()
        buf, sr = R.render(truth)
        wav = os.path.join(HERE, "out", f.replace(".json", ".wav"))
        R.write_wav(wav, buf, sr)
        v = R.verify(truth, buf, sr)
        if v["missed"] or v["extra"] or (v["max_err_ms"] or 0) > v["tol_ms"]:
            print(f"  {f[:-5]:18s}  RENDER CORRUPT -- refusing to score against it")
            continue
        t1 = time.time()
        out = subprocess.run(a.listener.split() + [wav], cwd=ROOT,
                             capture_output=True, text=True)
        t2 = time.time()
        if out.returncode != 0:
            print(f"  {f[:-5]:18s}  LISTENER FAILED: {out.stderr.strip()[:60]}")
            continue
        cand = json.loads(out.stdout)
        res = B.run(truth, cand, quiet=True)
        gp, cp = truth["grid"], cand["grid"]
        # phase error folded into the beat period: being a whole beat out is not an
        # error, being half a beat out is the worst possible answer
        d = abs(cp["phase"] - gp["phase"]) % gp["period"]
        gerr = min(d, gp["period"] - d) * 1000.0
        oct_ = res["octave"]
        flag = "half" if oct_["truth_halved"] > res["beats_f"] + 0.15 else (
               "double" if oct_["cand_doubled"] > res["beats_f"] + 0.15 else "ok")
        print(f"  {f[:-5]:18s} {res['beats_f']:8.3f} {gerr:7.1f}ms "
              f"{cp['bpm']:8.2f} {res['downbeats_f']:11.3f} {flag:>7s} "
              f"{t1-t0:6.2f}s {t2-t1:6.2f}s"
              f"{'   [held out]' if truth.get('hold_out') else ''}")
        rows.append({"case": f[:-5], "beats_f": round(res["beats_f"], 4),
                     "grid_err_ms": round(gerr, 2), "bpm": cp["bpm"],
                     "downbeats_f": round(res["downbeats_f"], 4), "octave": flag,
                     "listen_s": round(t2 - t1, 3), "held_out": bool(truth.get("hold_out"))})
    if held:
        print(f"\n  {held} case(s) held out. Run with --all before you believe a number.")
    if rows:
        scored = [r for r in rows if not r["held_out"]] or rows
        mean_f = sum(r["beats_f"] for r in scored) / len(scored)
        worst = max(scored, key=lambda r: r["grid_err_ms"])
        print(f"\n  mean beats F {mean_f:.3f} over {len(scored)} scored   "
              f"worst grid error {worst['grid_err_ms']:.1f} ms on {worst['case']}   "
              f"total listen {sum(r['listen_s'] for r in rows):.2f}s")
    if rows and not a.no_log:
        p = os.path.join(HERE, "RESULTS.tsv")
        new = not os.path.exists(p)
        with open(p, "a") as fh:
            if new: fh.write("when\tsha\tlistener\tcase\tbeats_f\tgrid_err_ms\tbpm\t"
                             "downbeats_f\toctave\tlisten_s\theld_out\n")
            when, s = time.strftime("%Y-%m-%dT%H:%M:%S"), sha()
            for r in rows:
                fh.write(f"{when}\t{s}\t{a.listener}\t{r['case']}\t{r['beats_f']}\t"
                         f"{r['grid_err_ms']}\t{r['bpm']}\t{r['downbeats_f']}\t"
                         f"{r['octave']}\t{r['listen_s']}\t{int(r['held_out'])}\n")
        print(f"  appended {len(rows)} row(s) to synth/RESULTS.tsv\n")

if __name__ == "__main__":
    main()
