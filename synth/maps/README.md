# Candidate maps

One folder per person: `synth/maps/<who>/<song>.map.json`.

Your map appears on the board and in both dropdowns automatically — discovered from disk, nothing
to register. Commit it: they are small, they diff, and the history is how your reading of a song
improved.

## What you are given, and what you are not

You get the **shape** of a map, never the answer.

`../songs/07-voice.map.json` is a complete, filled-in example for a song we composed ourselves.
Every field a map can hold is in it, correctly. Read it to learn the format — the field names, the
units, what a section looks like, what a moment looks like. `../../MAP.md` states what each field
promises.

You do **not** get the reference map for the song being judged. It lives outside git on one machine.
Upload yours and you get numbers back; you never see what you were scored against. That is
deliberate: a model tuned until it reproduces a file has learned the file, not the music, and every
number after that would be meaningless.

## Submitting

Either drop the file on the board with **import a map file**, or:

```
curl -X POST "http://<host>:8770/api/score?song=levels&who=yourname" \
     --data-binary @your.map.json
```

You get back beat accuracy, downbeat accuracy, grid error in milliseconds, whether you locked to the
wrong tempo octave, section-boundary accuracy, how many moments you found, and how well your energy
curve tracks the real one. Nothing else comes back, and nothing else is meant to.

Set `made_by.how` honestly: `model` if a program produced it, `hand-written` if a person typed the
times, `truth` only if a human verified it with the audio playing.
