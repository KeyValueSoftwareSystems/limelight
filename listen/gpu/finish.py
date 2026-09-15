"""Bring finished .score files up to date without a GPU run.

Everything here is derived from what the score already carries, through the
same code the pipeline calls, so a score finished by this file and a score
written by a fresh run agree.

    python3 finish.py score-out/*.score
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import moments as M


def envelope(score, slug):
    """`score` and `version` name the file and its shape to every reader."""
    fixed = []
    if score.get("score") is None:
        score["score"] = slug
        fixed.append("score")
    if score.get("version") is None:
        score["version"] = 0
        fixed.append("version")
    return fixed


def mark_downbeats(score):
    """A beat on a bar line, where the tracker's own marks were not kept."""
    beats = score.get("beats") or []
    if not beats or any(b.get("downbeat") for b in beats if isinstance(b, dict)):
        return 0
    grid = score.get("grid") or {}
    per = grid.get("beats_per_bar") or 4
    tempo = grid.get("tempo") or [{"from_beat": 0,
                                   "at_s": grid.get("first_beat_s") or 0,
                                   "bpm": grid.get("bpm") or 120}]

    def beat_of(t):
        k = 0
        while k + 1 < len(tempo) and tempo[k + 1]["at_s"] <= t:
            k += 1
        seg = tempo[k]
        return seg["from_beat"] + (t - seg["at_s"]) / (60.0 / seg["bpm"])

    n = 0
    for b in beats:
        if not isinstance(b, dict) or b.get("t") is None:
            continue
        if int(round(beat_of(b["t"]))) % per == 0:
            b["downbeat"] = True
            n += 1
    return n


def main(paths):
    for path in paths:
        slug = os.path.basename(path)[:-len(".score")]
        try:
            with open(path) as fh:
                score = json.load(fh)
        except Exception as e:
            print(f"{slug}: unreadable ({e})")
            continue
        said = envelope(score, slug)
        downs = mark_downbeats(score)
        was = len(score.get("moments") or [])
        got = M.find(score.get("stems_temporal"),
                     [b["t"] for b in score.get("beats") or [] if "t" in b],
                     score.get("grid"), score.get("btc_chords_raw"),
                     score.get("melody"), score.get("rhythm"),
                     score.get("emotion"))
        if got:
            score["moments"] = got
        with open(path, "w") as fh:
            json.dump(score, fh)
        kinds = {}
        for m in score.get("moments") or []:
            kinds[m["type"]] = kinds.get(m["type"], 0) + 1
        shape = " ".join(f"{k}:{v}" for k, v in sorted(kinds.items()))
        note = []
        if said:
            note.append("+" + ",".join(said))
        if downs:
            note.append(f"+{downs} downbeats")
        print(f"{slug}: moments {was} -> {len(got or [])}  {shape}"
              + (f"   {' '.join(note)}" if note else ""))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(2)
    main(sys.argv[1:])
