# The map file — v0.2

What the music does. **Never** what a light should do — a video editor and a rhythm game read
this same file. The moment it says "strobe" it becomes a lighting file and the idea collapses.

## Fields

| field | plain words |
|---|---|
| `map` | format version |
| `song` | title, artist, `length` in seconds |
| `made_by` | who or what wrote this, and when. `truth`, `model` or `sketch` |
| `beats` | time of every beat, seconds from the start |
| `downbeats` | the "one" of each bar |
| `chapters` | `{at, name}` — where the song changes character |
| `moments` | `{at, kind, …}` — an **instant** something happens |
| `spans` | `{kind, from, to, rise}` — a **stretch** during which something is happening |
| `energy` | `[[t, 0..1], …]` — one point per downbeat. **Readers interpolate linearly between points** |
| `confidence` | 0–1. How much the writer trusts this |
| `vectors` | `null`, or a pointer to a side file. See below |

## The six kinds. No others.

`build` · `drop` · `stop` · `quiet` · `spotlight` · `return`

The same six words are used for both moments and spans, because they are the same six ideas
seen at two time scales. Extras: `holds` (how long a stop lasts), `size` (how hard a drop hits,
0–1), `of` (what a spotlight is on), `rise` (the shape of a span: `steady`, `late`, `early`,
`stepped`), `note` (free text for humans).

## Why spans and energy exist

A drop is an instant, so a point in time describes it perfectly. **An elevation is not.** "It
lifts from 1:05 to 1:20" is a stretch with a direction, and there is no honest way to write it
as a point. Songs like *Opus* are one four-minute elevation and almost nothing else — a
point-only map cannot express such a song at all.

So a span says *where* the lift happens and *what shape* it has, and the energy curve says
*how much* at any instant. Together they let a reader make the room climb for four minutes
without knowing the first thing about music.

## The rule I had wrong

The old rule said: **never store a derivable fact** — no loudness curve, it is in the audio.
That rule quietly deleted the energy curve, and it was wrong, because it left out half the
question:

> **A fact is only redundant if the person who needs it can derive it.**

Energy is derivable from the audio, so it is redundant *for the analysis lane*, which holds the
audio. It is unobtainable for every downstream reader, which holds only the map. The rule
deleted information at exactly the boundary where it was needed. The corrected rule:

1. **Time is always seconds**, decimal, from the start of the song.
2. **A reader ignores fields it does not recognise.** That is what lets us add things later.
3. **A field goes in when a reader breaks without it** — and a reader breaks when it cannot
   derive the fact from what it holds.
4. **One writer per fact.** Two lanes computing the same number will eventually disagree.

## `vectors` — the learned tier

Named fields cannot carry everything a model notices. There is no word for "this feels like the
second half of a Coldplay song", and there never will be. So the map has two tiers:

- the **named tier** — beats, chapters, moments, spans, energy. Small, readable, arguable, and
  **correctable by hand**. This is the interface every reader compiles against.
- the **learned tier** — `vectors`, one row per beat. Everything the model noticed, including
  what we have no words for.

The vector is the evidence. The field is the verdict. We ship both, and readers choose their
tier. The important asymmetry: **only a verdict can be argued with.** You cannot hand a human a
768-number row and ask "is this wrong?" — so if corrections are the moat, the named tier is the
moat, not a scaffold to throw away later.

Vectors live **out of line**, because a six-thousand-beat song at 768 dimensions is nine
megabytes and JSON is the wrong container for that:

```json
"vectors": {
  "model": "mert-v1-95m",
  "rate": "per_beat",
  "rows": 1143,
  "dim": 768,
  "dtype": "float16",
  "layout": "row_major",
  "file": "opus.vec.f16"
}
```

`null` today. The slot is specified now so that nothing has to change when it fills.

## Deliberately absent

Lighting words. Hardware. Channels. Fixtures. Colours. Tempo (it is in the beats).
