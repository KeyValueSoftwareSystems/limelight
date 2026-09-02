# The map file

What the music does. **Never** what a light should do — a video editor and a rhythm game read
this same file. The moment it says "strobe" it becomes a lighting file and the idea collapses.

A complete example lives at [`maps/example.map.json`](maps/example.map.json): a made-up
16-second song at 120 bpm, with every beat listed. Nothing elided.

## Fields

| field | plain words |
|---|---|
| `map` | format version. Bump when the shape changes |
| `song` | title, artist, `length` in seconds. A reader checks length against the audio it has |
| `made_by` | who or what wrote this, and when. Tonight: `hand-written` |
| `beats` | time of every beat, seconds from the start |
| `downbeats` | the "one" of each bar — the beat you nod hardest on |
| `chapters` | `{at, name}`. Where the song changes character. Plain names: intro, verse, build, drop, break, outro |
| `moments` | `{at, kind, …}`. What a show reacts to. Six kinds only — see below |
| `confidence` | 0–1. How much the writer trusts this. Hand-written is 1.0 |
| `vectors` | `null` for now. Week two it holds numbers from a model, one set per beat |

## The six moments. No others.

`build` · `drop` · `stop` · `quiet` · `spotlight` · `return`

Extras: `holds` (how long a stop lasts), `size` (how hard a drop hits, 0–1),
`of` (what a spotlight is on, e.g. `"voice"`), `note` (free text for humans).

## Four rules

1. **Time is always seconds**, decimal, from the start of the song. Never ms, bars or frames.
2. **A reader ignores fields it does not recognise.** That is what lets us add things later.
3. **A field goes in when something breaks without it** — not when it might be useful.
4. **Never store a derivable fact.** No tempo (it is in the beats). No loudness curve (it is in
   the audio). Two copies of one fact eventually disagree.

## Deliberately absent

Lighting words. Hardware. Channels. Fixtures. Colours. Tempo. Those live elsewhere or nowhere.
