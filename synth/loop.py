#!/usr/bin/env python3
"""Score a listener against the ladder. One command, ten levels.

    python3 synth/loop.py                                   # score the baseline
    python3 synth/loop.py --listener "python3 listen/mine.py"
    python3 synth/loop.py --level 03                        # just one level
    python3 synth/loop.py --cases                           # the old click-track diagnostics

Your listener is a COMMAND, not a Python import, so write it in anything. It gets
a WAV path as its last argument and prints a map to stdout. That is the whole
interface.

Levels are graded against maps we authored, so a disagreement is yours -- there
is nothing to argue about. Audio is generated, never downloaded: if a wav is
missing this runs compose.py for you.
"""
import argparse, json, os, subprocess, sys, time, importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m

R = _load("render", os.path.join(HERE, "render.py"))
B = _load("bench", os.path.join(ROOT, "bench", "bench.py"))

def sha():
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"],
                                       cwd=ROOT, text=True).strip()
    except Exception:
        return "nogit"

def levels():
    d = os.path.join(HERE, "songs")
    if not os.path.isdir(d): return []
    return sorted(f[:-9] for f in os.listdir(d) if f.endswith(".map.json"))

def audio_for(slug):
    wav = os.path.join(HERE, "out", slug + ".wav")
    if not os.path.exists(wav):
        print(f"    generating audio for {slug} ...", flush=True)
        subprocess.run([sys.executable, os.path.join(HERE, "compose.py"), slug[:2]],
                       cwd=ROOT, capture_output=True)
    return wav if os.path.exists(wav) else None

def score(truth, cand):
    res = B.run(truth, cand, quiet=True)
    gp, cp = truth["grid"], cand["grid"]
    d = abs(cp["phase"] - gp["phase"]) % gp["period"]
    gerr = min(d, gp["period"] - d) * 1000.0
    o = res["octave"]
    flag = ("half" if o["truth_halved"] > res["beats_f"] + 0.15 else
            "double" if o["cand_doubled"] > res["beats_f"] + 0.15 else "ok")
    return res, round(gerr, 1), flag

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--listener", default="python3 listen/baseline.py")
    ap.add_argument("--level", default=None, help="score one level, e.g. 03")
    ap.add_argument("--cases", action="store_true", help="the old click-track diagnostics instead")
    ap.add_argument("--no-log", action="store_true")
    a = ap.parse_args()

    print(f"\n  listener: {a.listener}\n")
    print(f"  {'level':<16} {'beats F':>8} {'grid err':>9} {'bpm':>8} {'downbeat F':>11} "
          f"{'octave':>7} {'listen':>7}   teaches")
    print("  " + "-" * 112)

    rows, passed = [], 0
    if a.cases:
        items = [(f[:-5], os.path.join(HERE, "cases", f), None)
                 for f in sorted(os.listdir(os.path.join(HERE, "cases"))) if f.endswith(".json")]
    else:
        items = [(s, os.path.join(HERE, "songs", s + ".map.json"), s) for s in levels()]
    if a.level:
        items = [i for i in items if i[0].startswith(a.level)]

    for name, mpath, slug in items:
        truth = json.load(open(mpath))
        if slug:
            wav = audio_for(slug)
            if not wav:
                print(f"  {name:<16}  no audio — run python3 synth/compose.py"); continue
        else:
            buf, sr = R.render(truth)
            wav = os.path.join(HERE, "out", name + ".wav")
            R.write_wav(wav, buf, sr)
            v = R.verify(truth, buf, sr)
            if v["missed"] or v["extra"] or (v["max_err_ms"] or 0) > v["tol_ms"]:
                print(f"  {name:<16}  RENDER CORRUPT — refusing to score against it"); continue
        t0 = time.time()
        out = subprocess.run(a.listener.split() + [wav], cwd=ROOT, capture_output=True, text=True)
        dt = time.time() - t0
        if out.returncode != 0:
            print(f"  {name:<16}  LISTENER FAILED: {out.stderr.strip()[-70:]}"); continue
        try:
            cand = json.loads(out.stdout)
        except json.JSONDecodeError:
            print(f"  {name:<16}  LISTENER PRINTED SOMETHING THAT IS NOT A MAP"); continue
        res, gerr, flag = score(truth, cand)
        ok = res["beats_f"] >= 0.90 and gerr <= 25.0 and flag == "ok"
        passed += ok
        teach = (truth.get("level") or {}).get("teaches", "")
        print(f"  {name:<16} {res['beats_f']:>8.3f} {gerr:>7.1f}ms {cand['grid']['bpm']:>8.2f} "
              f"{res['downbeats_f']:>11.3f} {flag:>7} {dt:>6.2f}s   "
              f"{'PASS  ' if ok else '      '}{teach[:44]}")
        rows.append({"level": name, "beats_f": round(res["beats_f"], 4), "grid_err_ms": gerr,
                     "bpm": cand["grid"]["bpm"], "downbeats_f": round(res["downbeats_f"], 4),
                     "octave": flag, "listen_s": round(dt, 3), "pass": int(ok)})

    if rows:
        print(f"\n  passed {passed} of {len(rows)}    "
              f"mean beats F {sum(r['beats_f'] for r in rows)/len(rows):.3f}    "
              f"total {sum(r['listen_s'] for r in rows):.1f}s")
        nxt = next((r for r in rows if not r["pass"]), None)
        if nxt: print(f"  next thing to fix: {nxt['level']}"
                      f"  (beats F {nxt['beats_f']}, grid {nxt['grid_err_ms']} ms, octave {nxt['octave']})")
        else: print("  every level passed. The Nights is the final exam: readers/lights/pack/")
    if rows and not a.no_log:
        p = os.path.join(HERE, "RESULTS.tsv")
        new = not os.path.exists(p)
        with open(p, "a") as fh:
            if new: fh.write("when\tsha\tlistener\tlevel\tbeats_f\tgrid_err_ms\tbpm\t"
                             "downbeats_f\toctave\tlisten_s\tpass\n")
            when, s = time.strftime("%Y-%m-%dT%H:%M:%S"), sha()
            for r in rows:
                fh.write(f"{when}\t{s}\t{a.listener}\t{r['level']}\t{r['beats_f']}\t"
                         f"{r['grid_err_ms']}\t{r['bpm']}\t{r['downbeats_f']}\t{r['octave']}\t"
                         f"{r['listen_s']}\t{r['pass']}\n")
        print(f"  logged to synth/RESULTS.tsv\n")

if __name__ == "__main__":
    main()
