#!/usr/bin/env python3
"""A MOSS-Music lyrics transcript, turned into the shape listen/hook.py reads.

    python3 listen/lyrics_moss.py <slug> <moss-output.txt> [--write]

Why this model is here at all, and why only for this.

mizhiyoram's hook was null because whisper-small cannot read the recording: it
returned zero segments from the separated vocal with the language auto-detected
and with Malayalam given explicitly, and on the raw mix it returned invented
text mixing Korean and Chinese glyphs into English. That is a tooling gap, not a
property of the record -- a listener finds the hook in one pass.

MOSS-Music-8B-Instruct is a music understanding model whose lyrics ASR is
advertised as robust to backing tracks. It is used HERE FOR LYRICS AND NOTHING
ELSE, and that restraint is the point rather than an oversight. The same model
also does chord, key and tempo reasoning and structural analysis. Taking any of
those would collapse the independence every check in listen/mapeval.py rests on:
meter is ChordMini against MERT, identity is MERT against ChordMini against drum
onsets, hook is a speech model against a pitch tracker. One model supplying two
sides of a check is that model grading itself, which is the failure this whole
line of work exists to remove. So: one field, one model, one song.

The output is written in whisper's shape -- segments with word timestamps --
because listen/hook.py already reads that and should not learn a second format.
Word times are interpolated across a line when the model gives only line times,
and `word_times` records which it was, so nobody later mistakes an interpolation
for a measurement.
"""
import sys, os, json, re

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mapio import map_path, work_dir

MODEL = "OpenMOSS-Team/MOSS-Music-8B-Instruct"

# The model emits "[MM:SS.ss - MM:SS.ss] text". The end time is read but not
# used: hook.py wants a start per line, and the next line's start is a better
# end than a model's guess at one. Several other plausible shapes are accepted
# too, because the output format is not documented anywhere.
TIME = r"(?:(?P<%s_m>\d{1,3}):)?(?P<%s_s>\d{1,3}(?:\.\d+)?)s?"
STAMP = re.compile(
    r"^\s*[\[\(]?\s*" + (TIME % ("a", "a")) +
    r"(?:\s*[-\u2013>]+\s*" + (TIME % ("b", "b")) + r")?"
    r"\s*[\]\)]?\s*[-:>]?\s*(?P<text>.*\S)?\s*$")


def _secs(m, which):
    s = m.group(which + "_s")
    if s is None:
        return None
    mm = m.group(which + "_m")
    return (int(mm) * 60 if mm else 0) + float(s)


def parse(text):
    """MOSS's transcript -> [(start_seconds, line_text)], in order."""
    out = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        m = STAMP.match(line)
        t = _secs(m, "a") if m else None
        if t is None:
            if out:                      # continuation of the previous line
                out[-1] = (out[-1][0], (out[-1][1] + " " + line).strip())
            continue
        body = (m.group("text") or "").strip()
        if body:
            out.append((t, body))
    out.sort(key=lambda x: x[0])
    return out


def to_whisper(lines, dur=None):
    """Whisper's shape, so listen/hook.py needs no new reader."""
    segs = []
    for i, (t, body) in enumerate(lines):
        end = lines[i + 1][0] if i + 1 < len(lines) else (
            (dur if dur else t + 4.0))
        end = max(end, t + 0.4)
        words = [w for w in body.split() if w]
        step = (end - t) / max(1, len(words))
        segs.append({
            "start": round(t, 3), "end": round(end, 3), "text": " " + body,
            "words": [{"word": " " + w, "start": round(t + k * step, 3),
                       "end": round(t + (k + 1) * step, 3)}
                      for k, w in enumerate(words)],
        })
    return {"segments": segs, "language": "ml",
            "model": MODEL,
            "word_times": "interpolated evenly across each line -- the model was "
                          "asked for a time per LINE, so a word time here is a "
                          "position inside a measured line, not a measured word",
            "used_for": "lyrics only. This model also does chord, key and tempo "
                        "reasoning and structural analysis; none of that is taken, "
                        "because it would put one model on both sides of a check."}


def apply(slug, path, write=False):
    txt = open(path, encoding="utf-8").read()
    lines = parse(txt)
    if len(lines) < 2:
        return {"error": "only %d timestamped lines parsed out of %d characters"
                         % (len(lines), len(txt))}
    mp = map_path(slug)
    dur = (json.load(open(mp)).get("song") or {}).get("length") if mp else None
    doc = to_whisper(lines, dur)
    nwords = sum(len(s["words"]) for s in doc["segments"])
    dst = os.path.join(os.environ.get("LIMELIGHT_LYRICS",
                                      os.path.join(work_dir(), "lyrics")),
                       slug + ".json")
    if write:
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        json.dump(doc, open(dst, "w"), ensure_ascii=False)
    return {"slug": slug, "lines": len(lines), "words": nwords,
            "first": lines[0], "last": lines[-1], "path": dst, "wrote": write}


if __name__ == "__main__":
    a = [x for x in sys.argv[1:] if not x.startswith("--")]
    if len(a) < 2:
        print("usage: lyrics_moss.py <slug> <moss-output.txt> [--write]")
        sys.exit(2)
    r = apply(a[0], a[1], "--write" in sys.argv)
    if "error" in r:
        print("  " + r["error"])
        sys.exit(1)
    print("  %-16s %d lines, %d words  %.1fs .. %.1fs%s"
          % (r["slug"], r["lines"], r["words"], r["first"][0], r["last"][0],
             "  -> " + r["path"] if r["wrote"] else ""))
    print("     first: %.1f  %s" % (r["first"][0], r["first"][1][:70]))
    print("     last:  %.1f  %s" % (r["last"][0], r["last"][1][:70]))
