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
import feel as F
import moments as M
import words as W
import acoustic as A


WAVDIRS = ("work/wav", "wav", "../work/wav")


def _wav_for(slug):
    """The source audio for a slug, if this machine happens to have it."""
    here = os.path.dirname(os.path.abspath(__file__))
    roots = [os.path.abspath(os.path.join(here, "..", "..")), os.getcwd()]
    for root in roots:
        for d in WAVDIRS:
            at = os.path.join(root, d, slug + ".wav")
            if os.path.isfile(at):
                return at
    return None


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
        capped = ""
        cap = score.get("caption")
        if cap:
            lean = W.strip_claims(cap)
            if lean != cap:
                score["caption"] = lean
                capped = "caption claims stripped"
        sound = ""
        heard = score.get("acoustic")
        wav = _wav_for(slug)
        if wav and not heard:
            try:
                heard = A.series(wav, (score.get("stems_temporal") or {}).get("window_s") or 0.5)
            except Exception as e:
                print(f"{slug}: acoustic failed ({type(e).__name__}: {e})")
                heard = None
            if heard:
                score["acoustic"] = heard
                sound = f"+acoustic {len(heard['loudness'])} windows"
        feels = ""
        spans = score.get("emotion") or ([] if not score.get("sections") else None)
        base = score.get("emotion") or None
        if base or score.get("sections"):
            got = F.clean_emotion(base, (score.get("song") or {}).get("length_s"),
                                  score.get("stems_temporal"), score.get("sections"),
                                  score.get("stems"), heard,
                                  score.get("btc_chords_raw"), score.get("beats"))
            if got:
                before = score.get("emotion") or []
                score["emotion"] = got
                (score.setdefault("unavailable", {}) or {}).pop("emotion", None)
                if not score.get("unavailable"):
                    score.pop("unavailable", None)
                feels = (f"+emotion from {len(got)} sections" if not before
                         else f"emotion remeasured ({len(got)} spans)")
        was = len(score.get("moments") or [])
        try:
            got = M.find(score.get("stems_temporal"),
                         [b["t"] for b in score.get("beats") or [] if "t" in b],
                         score.get("grid"), score.get("btc_chords_raw"),
                         score.get("melody"), score.get("rhythm"),
                         score.get("stems"), heard)
        except Exception as e:
            print(f"{slug}: moments failed ({type(e).__name__}: {e})")
            got = None
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
        if feels:
            note.append(feels)
        if capped:
            note.append(capped)
        print(f"{slug}: moments {was} -> {len(got or [])}  {shape}"
              + (f"   {' '.join(note)}" if note else ""))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(2)
    main(sys.argv[1:])
