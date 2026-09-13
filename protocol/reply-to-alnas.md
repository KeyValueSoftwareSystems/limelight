# Re: what else to put in the score

This list was the most useful thing anyone has sent about the format. Four of
your items were real faults, three were already in the file and you had an old
score, and one I tested and could not reproduce. Taking them in your order.

Pull `ground-zero` and rescore, or take `work/handover/levels.response.json`.

## 1. Alignment — half of this was ours, and worse than you reported

**You could not get a beat's time at all.** `beats[]` went out as
`{bar, beat, weight, sure, off_ms, downbeat}`. No `t`. The only way to place a
beat in the recording was to rebuild it from its label, which is exactly where
an offset bites. The handover doc I wrote you claimed `beats[i].t` existed. It
did not. That is on me.

**Your two-beat offset was `off_ms`, and the number was ours.** The field whose
job is to say how far a beat sits from the grid was being _recomputed_ by the
formatter against `first_beat_s + idx * beat_sec` — a uniform grid indexed by
the beat's position in the list rather than its beat number, ignoring the tempo
map twice over. Levels' first beat measures **−13.5 ms** in the score and
reached you as **−951 ms**. At 128 bpm that is 2.03 beats. That is your constant
two-beat offset, and it was a formatter arithmetic bug, not the tracker.

Both formatters now forward what `pulse.py` measured. Every beat carries `t`.
0 of 498 beats disagree with the score. (The two languages then differed by one
millisecond, because `Math.round(-13.5)` is −13 and Python's `round(-13.5)` is
−14. Python now rounds the way JavaScript does.)

**The "one bar late" half does not reproduce.** On Levels the drums lane and the
first section calling `drums: full` both land on bar 9 — offset zero.

I did write the self-check you proposed. It failed on six songs and **the score
was right on all six**, so I deleted it rather than loosen it until it passed.
The reason is worth knowing because it affects how you read the file:
`presence` marks any stretch where a stem is _audible_; `drums: full` marks a
section where it _dominates_. Ponni Nadhi has an intro fill at bar 1, six silent
bars, then the real entrance at 17 — presence says 1, the section says 17, and
both are correct. The Nights holds a steady 0.32 from bar 9 under a single 1.12
spike at 17. A raw threshold cannot tell a fill from an entrance. **If you want
"where do the drums really start", use `presence` and take the first long `in`
span, not the first section.**

What replaced that check is a fidelity test: the `off_ms` you receive must equal
the one the score measured. That is the invariant that was actually broken.
135 checks to 191.

**You also asked for a `sure` on each boundary. There are now two.** One number
could not answer what Amal asked when he played Don't Look Down at 0:41 — "at
the section boundary you put, I don't feel any change in the song."

- `sections[].edge` — how different the two sections are, measured as the gap
  between them over how much each varies inside itself. Same ratio `tells` uses.
  Below **1.3** treat the cut as a suggestion.
- `sections[].sudden` — how much of that difference happens _at_ the boundary.
  1.0 means the whole change lands on the bar. Below **0.5** it is a ramp and
  there is no instant to hit.

Don't Look Down bar 20 scores `edge 1.66, sudden 0.39`: the bass climbs 0.09,
0.23, 0.34, 0.46, 0.67, 0.98 from bar 16 to 23 while energy stays flat. Real
difference, no moment. Its drop at bar 38 scores 1.14; bar 103 scores 1.77.
**Cue the steps, fade through the ramps.** They are not the same measurement —
across 279 boundaries they correlate at −0.16 and disagree on 62.

I also merged 13 boundaries across the library that split a section in half and
gave both halves the same name on evidence worth as little as 0.29. One remains.

## 2. Dropouts as moments — not done

Still a phrase flag. You are right that `pause` already has the shape. Not in
this pass; it is the top of the next one.

## 3. Rhythm inside the bar — partly already there, partly impossible today

**Already in the file, and you should check whether they do what you need:**

- `ticks` — sixteen readings a bar, per stem. `ticks.per_bar = 16`, then
  `ticks.drums`, `.bass`, `.vocals`, `.other`.
- `groove` — per stem, the bar-shaped pattern: `on: [0,4,8,12]` and a
  `strength` per sixteenth, plus `same_bar_to_bar` for how much it holds.
  Levels' kick reads `x...x...x...x...`, its bass `..x.......x...x.`

If everything you got was per bar, you were on an older score.

**Fixed now:** you were right about melody. It carried `bar` and `beat` and
nothing finer, so ninety slots in Levels held more than one note and five were
byte-for-byte duplicates of the note before — your "duplicate entries at bar 0".
Notes now carry `at_s` and `in_beat` (how far through the beat it starts, 0.0 on
the beat, 0.5 exactly between two). **Zero of 420 notes now share a time**, and
`in_beat` uses the full range. Note-by-note chases are possible.

**Not possible today:** kick, snare and hat separately. The separator gives us
`drums` as one stem. That is a real limit, not an oversight.

## 4. Builds and risers — shipped, with a caveat you should have

`motion` is in every score now: `moving` (rising/steady/falling per bar),
`winding` (the build), `spans`, `slams` and `ebbs` with `big` marking the
structural ones, and `motion.tells`.

The caveat, because you would find it yourself and be annoyed: **`winding` does
not beat reading the energy curve upside down.** On drops found independently of
our labels it scores 66.6 where plain inverted energy scores 65.6 — one point on
n=88. An earlier draft of the spec reported "energy 32nd percentile, winding
68th" as two findings; they are one finding seen twice, since the 32nd
percentile for a lane is the 68th for its negation. The spec now says so.

What is true and useful: **energy _falls_ into a drop.** Four bars before Don't
Look Down's, energy reads 0.24, 0.24, 0.20 while air climbs to 1.02 and floor
collapses 0.31 → 0.06. Ramp on `winding` (it rises into the drop, so it maps
straight to intensity) or on inverted `energy`. Do not ramp on raw `energy`;
you will fade down into the hit.

`motion.tells` is per song and is **not** the split-half number the lanes carry.
It is the percentile `winding` reaches in the eight bars before that song's
drops, so 50 is chance. Above 65 on 18 of 28 songs, below 50 on 7. It is an
EDM-shaped measure and says so.

## 5. Releases that land — fixed, same bug as item 1

You were right and it was the same two beats. Both formatters recomputed the
position from `at_s` on a uniform grid, ignored the tempo map, then threw `at_s`
away. Levels' first release is **bar 8 beat 3** in the score and reached you as
**bar 8 beat 1**.

Releases now carry `at: {bar, beat}`, `at_s`, `lead_beats` and `size` exactly as
measured. This should be the cue you wanted.

## 6. Vocal phrases at beat resolution — not done

Honest status: lyrics exist on only 4 of 28 songs, and the Indian-language ones
are broken — the forced aligner strips every Devanagari vowel sign, so the words
are consonant skeletons. I found the cause tonight (the transcript keeps them;
the aligner's per-word text does not) and have a fix written but not yet run
across the library.

## 7. Repetition below section level — not done, and I removed what looked like it

`melody_phrases[].same_as` used to exist and I was going to point you at it. It
is gone. Two things were wrong. The index was written per-stream, then the voice
and lead phrases were merged and re-sorted without remapping it, so 79% of the
populated pointers named the wrong phrase. After fixing that, I held each phrase
up against phrases from *other songs*: the shipped threshold tagged 12.9% of
those against 14.6% within the song. It was matching the generic statistics of a
pitch track, not this song's repeats.

Tightening it does find real repetition — shift-aligned, six steps or more,
exact, with a guard requiring two intervals of a tone or wider, gets 4.75x over
that same control — but at 1.0% recall, and on a phrase segmentation that
already returns the same figure as five notes one time and four the next. Not
worth your trust yet.

What `melody_phrases` does now carry that it did not: `from_note` and `to_note`,
indexing straight into `melody[]`. The bar.beat span could not be resolved back
to its own notes — several notes share a beat — and it returned the wrong note
set on 8% of phrases. Section-level repetition in `sections[].repeats_as` and
`like` is measured and stands.

## 8. Character tags per section — I had this, and I took it out

I owe you a correction here. I was going to tell you `sections[].mood` was a
safer palette driver than key. It is gone, and key is the one that got fixed.

`mood` put each section on opposed axes (calm/aggressive, happy/sad, warm/cold)
read by MuQ-MuLan, and `mood_axes` carried a ratio that was supposed to certify
the axis had cleared its own noise. Three measurements took it out:

- The ratio was not measuring noise. The model is bit-exact deterministic — the
  same clip read twice returns the identical vector — so the "read it twice"
  floor it divided by was how much a section changes between its halves. Music
  does that on purpose.
- It did not beat a control. Recompute it over random contiguous segments of the
  same sizes, ignoring where the sections are, and 43.4% of axes pass against
  the real segmentation's 44.9%.
- The certificate did not predict the thing it certified. Over 88 (song, axis)
  cells with a repeated section, the correlation between an axis's gate score
  and how much its literal repeats agreed was **−0.070**. The worst offenders
  were high scorers. On shootout, two sections the file itself marks as the same
  music read opposite signs on all seven axes.

If I had shipped you that as a palette driver you would have had a rig changing
colour between two identical choruses, with a number in the file telling you it
was reliable.

**Key is now the field to use, and I was wrong to tell you to distrust it.** You
were right that F major against C# minor was a disagreement that should stop
you. The cause was ours: we were reading `tonal.key_edma` out of Essentia's
MusicExtractor, whose tonal chain builds its key estimator with `usePolyphony`
and `useThreeChords` on. That re-reads the tonic as the dominant — **11 of 28
songs came back as exactly the subdominant**. Calling `es.KeyExtractor` directly
with the same profile on the same files, scored against eleven published human
transcriptions: **3/11 exact before, 7/11 after**. Levels went from F major,
which shares 1 note in 120 with the record, to E major — still not the C# minor
a human would write, but E major is C# minor's relative, so the pitch collection
is now right and only the tonic is not.

The second field in that disagreement is also gone. `chords.root`/`scale` and
`key.chords_say` were never a key estimate — Essentia builds them by taking the
most frequent chord and reading its letter. Shipping them beside `key` gave you
two fields that looked like the same claim. `chord_summary` keeps
`changes_per_beat`, which is the part that meant something.

One caveat on key: when it is wrong it now usually names the relative or the
fifth. A palette keyed to the **pitch collection** is safe. One keyed to
major-versus-minor mood is not.

## 9. Smaller items

- **Per-stem entry and exit** — already there: `presence`, per stem, as
  in/part/out spans with hysteresis. Use it for "the kick left a bar before the
  chords did".
- **Pump shape** — not done, still a per-bar value.
- **Impact moment** — not done, though `motion.slams` with `big: true` gets you
  most of the way.
- **Audio hash** — not done, and you are right that it matters. Nothing today
  stops a score being played against the wrong file.

## What I would use first

`beats[].t` and `releases[].at_s`, because those were wrong in a way that would
have made everything downstream feel slightly late. Then `edge` and `sudden` to
decide which boundaries deserve a cue at all. Then `ticks` and `groove`, which
were already there and may unblock the riff chase today.
