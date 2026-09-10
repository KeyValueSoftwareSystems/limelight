# The video IR — the video reader's output

**This format belongs to the video reader only.** It is not universal, in exactly
the way `readers/lights/FRAME.md` is not universal. The lighting reader emits a
frame of fixture states; this emits an edit decision list. The universal artifact
is the *map*, which knows about neither.

There is deliberately **no shared "creative IR"** between the two readers. It was
considered and refused: an `IMPACT` that means "cut" here and "cue" there is a
shared vocabulary, not a shared artifact, and a third file that both readers
translate through would add a layer, cost a synchronisation, and carry no
information that the map does not already have. Rule 8 — one writer per fact.

## Shape

```json
{ "ir": "0.1",
  "made_by": { "how": "policy", "who": "readers/video/policy_rules.js",
               "brief": "premium-restraint", "map": "synth/maps/amal/levels.map.json" },
  "song":   { "slug": "levels", "length_s": 213.4 },
  "format": { "width": 1920, "height": 1080, "fps": 25 },
  "timeline": [
    { "start": 0.0, "end": 4.24, "clip_id": "mixkit-1090", "shot": 0, "in_s": 1.3,
      "because": { "rule": "section-start", "salience": 0.72,
                   "evidence": ["chapter:verse@3.97", "phrase_grid@3.97"] } } ],
  "holds": [
    { "start": 40.0, "end": 70.0, "reason": "preserve headroom for drop@93.6",
      "evidence": ["moment:drop@93.6", "brief.restraint.hold_before_major_s"] } ],
  "budget": { "allowed": 32, "spent": 27,
              "why_underspent": "headroom reserved before drop@93.6" } }
```

## The rules the compiler relies on

1. **`timeline` is contiguous and covers `[0, song.length_s]`.** No gaps, no
   overlaps, sorted by `start`. A gap is not "black" — it is a bug, and
   `compile.py` refuses the file rather than rendering something plausible.
2. **`end - start` is the shot's on-screen duration**, and `in_s` is where in the
   source clip it starts. `in_s + (end - start)` must fit inside that clip.
3. **Times are seconds, decimal, from the start of the song.** Rule 6, and the
   same rule the map obeys.
4. **`clip_id` must exist in `assets/INDEX.json`.** The IR references clips; it
   never embeds them, and never names a file path.
5. **`because` is required on every entry.** A cut with no reason is a cut
   nobody can audit, and §25 of the brief this lane was built from asks that
   every creative action be traceable back to musical evidence. `evidence` holds
   map-relative references, not restated numbers, so the map stays the one
   writer.

## Holds are not gaps

A `hold` is an interval the policy deliberately declined to cut in. It always
lies *inside* a timeline entry — a hold is a long shot plus the reason it is
long. It is recorded separately because "no cut here" and "no cut here **on
purpose, to buy contrast for the drop at 93.6**" are different claims, and only
the second one can be judged.

If `holds` is empty, the policy never chose to do nothing. That is a legitimate
answer for a brief with a large budget and a lie for one with `min_rest_s: 10`.

## What is deliberately absent

No filter graphs, no codec settings, no `filter_complex`, no transition names
tied to an implementation. The IR says *what should happen*; `compile.py` decides
how to execute it, and is the only thing here that knows ffmpeg exists.

No colour, no LUT, no grade. Those are real, and they are the next renderer-side
decision — but nothing measures them yet, and a field nobody writes is a field
that will be filled with a guess.
