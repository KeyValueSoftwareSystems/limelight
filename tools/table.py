import re
import sys
from pathlib import Path

BPM = re.compile(r"bpm\s+([\d.]+)\s+essentia hears ([\d.]+)")
RES = re.compile(r"residual\s+([\d.]+) ms rms\s+worst\s+([\d.]+) ms\s+(\d+)/(\d+) beats")
DRI = re.compile(r"drift\s+[\d.]+ -> [\d.]+ bpm \(([\d.]+)%")
MET = re.compile(r"beats_per_bar\s+(\d+)\s+(\d+)% of downbeat gaps")


def blocks(text):
    parts = re.split(r"^  ([a-z0-9-]+)\s*$", text, flags=re.M)
    for i in range(1, len(parts) - 1, 2):
        yield parts[i], parts[i + 1]


def main():
    log = Path(sys.argv[1] if len(sys.argv) > 1 else "work/batch.log").read_text()
    print(f"  {'song':<28}{'bpm':>9}{'essentia':>10}{'bar':>5}{'resid':>9}{'loose':>10}{'drift':>8}   ")
    print("  " + "-" * 78)
    for slug, body in blocks(log):
        b, r, d, m = BPM.search(body), RES.search(body), DRI.search(body), MET.search(body)
        if not (b and r and d and m):
            continue
        bpm, ess = float(b.group(1)), float(b.group(2))
        rms, loose, total = float(r.group(1)), int(r.group(3)), int(r.group(4))
        drift, bpb = float(d.group(1)), int(m.group(1))
        holds = rms < 25 and drift < 0.25
        agree = min(abs(bpm - ess), abs(bpm - ess * 2), abs(bpm * 2 - ess)) < 2.0
        note = "grid holds" if holds else "NO FIXED GRID"
        if holds and not agree:
            note += ", essentia disagrees"
        print(f"  {slug:<28}{bpm:>9.2f}{ess:>10.2f}{bpb:>5}{rms:>8.1f}m{loose:>6}/{total:<4}{drift:>7.2f}%   {note}")


if __name__ == "__main__":
    main()
