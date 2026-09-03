---
name: limelight-add-song
description: Use when adding a level to the Limelight ladder, or importing a song a human wrote. Covers both paths — a generated song via compose.py, and a real recording via import.py — and the rules that keep the answer sheet trustworthy.
---

# Add a song to the ladder

Two paths. Both keep the rule that makes the ladder worth anything: **the answer sheet comes from
authoring, never from listening.**

## A generated song

Add one row to `SONGS` in `synth/compose.py` for the arrangement, and one to `IDENTITY` for its key,
chord progression, melody, bass feel and tempo. Then `python3 synth/compose.py 11`.

Both tables matter. The first version of the ladder had ten arrangements over one tune — same key,
same four chords, same melody, tempos all between 120 and 128 — which is two sounds pretending to be
ten. Check the new song differs from every existing one in key, progression and tempo.

## A song a human wrote

`python3 synth/import.py` writes a template. The author supplies only what they alone can know: the
tempo they set, seconds to the start of bar 1, the section list in bars, and which instruments play
in each. Everything else is measured from the audio. If they export stems named
`drums/bass/other/vocals/guitar/piano.wav`, presence is measured exactly instead of taken from the
on/off list — and the file records which of the two it was.

16-bit wav only; the importer refuses anything else rather than reading it wrong. Audio goes in
`synth/incoming/`, which is gitignored.

## Rules

- **Each level adds exactly one new difficulty** over the level before it. Three changes at once
  makes a falling score meaningless.
- **Never claim a fact the audio cannot carry.** If a song has no bar cue, `downbeats` is empty with
  a note, not filled in from the grid.
- Set `made_by.how` to `synthetic`. It is not `hand-written`: the times are causes, not beliefs.
- `moments` takes only the six kinds. Anything else belongs in `observations.*`.

## Verify

```
python3 validate.py synth/songs/*.map.json    # 0 errors
python3 synth/loop.py                          # the new level appears and scores
```
