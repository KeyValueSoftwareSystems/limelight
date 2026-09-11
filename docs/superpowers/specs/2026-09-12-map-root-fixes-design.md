# Fixing the map at the root

2026-09-12. Agreed with Amal after a night of patching leaves.

## Why

The video reader has never reached the creative quality expected, and asked
where the quality was lost, the answer was: all four of nothing decides what
the film is about, the footage is a ceiling, execution is crude, and the music
understanding is too shallow.

The last of those is the root, and it was being routed around rather than
fixed. Three specific times in one night:

- **The grid is wrong and it was declared parked.** Holocene reads 148 bpm for
  a ~74 bpm record; Afterglow reads 87 for ~174. The grid is what beats, bars,
  moments and every cut are measured against, so a wrong octave corrupts all
  three readers at once. The workaround was hand-writing `pace: slow` into a
  brief.
- **Energy is sampled once per downbeat** -- 1.9 s -- and cannot represent the
  0.65 s hole a listener kept picking out by ear. The workaround was
  `listen/prehush.py`, a separate 20 ms pass bolted into `observations`.
- **The map cannot say that a stop and the drop after it are one gesture.** The
  workaround was a window chooser that reconstructs the relationship by
  scanning for "a stop followed within six seconds by a drop".

Every one of those workarounds is a leaf. The instruction was to fix the root.

## What does NOT change

The map must never contain a reader's word. Not because schemas are sacred:
the moment it holds `cut` or `fixture` it is a video format with a neutral
name and the drone reader stops making sense. That rule is the thesis.

"No reader-specific words" and "the map is finished" are different rules, and
conflating them is what produced the three workarounds above. Resolution, the
grid's correctness, and the vocabulary of relationships are all facts about the
song, and if they are wrong or too coarse every reader inherits it.

## 1. The grid: decide the octave by comparing grid points to each other

`listen/AGENTS.md` already names this: "compare grid salience explicitly across
period, half and double instead of trusting one normalised score. The division
in `comb()` is where the tempo octave error lives."

Three octave tests were written in one night and all three were biased, which
is the useful part:

| test | what it did | why it failed |
|---|---|---|
| autocorrelation peak | took the strongest lag | locked onto the BAR, not the beat |
| mean onset energy under the grid | scored energy at grid points | rewards SPARSITY -- fewer points, higher mean; picks "half" for everything |
| precision/recall against onset peaks | matched grid to peaks | rewarded DENSITY, because the peak set was too dense to discriminate |

Each compared the grid against the whole signal, and any such measure has a
built-in preference for more points or fewer.

**The unbiased test compares grid points to each other.** The two failure modes
leave opposite fingerprints:

- **Too fast (double).** Alternate grid points land on nothing. If odd-indexed
  points are systematically weaker than even ones, halve it.
- **Too slow (half).** The midpoints between grid points are as strong as the
  grid points. If energy at midpoints is comparable to energy on them, double
  it.

Both are ratios internal to the candidate grid. Neither can be won by placing
more or fewer points. Self-normalising, so no constant fitted to this corpus --
which matters, because three songs on this disk are held out.

Lands in `ear.py`'s `comb()` as a post-fit octave decision, with the evidence
written into `grid.how` so a wrong grid can be seen rather than inferred.
`bench/grid-vs-kick.py` is fixed too: it globs a hardcoded `maps/model/` and
measures phase rather than octave, so it could not have caught this.

**Verified** against the ten songs in `synth/`, whose maps are `how: synthetic`
-- the times are causes, so an octave error there is unambiguous -- and against
a human ear on click tracks for the six real recordings. A click track is the
decisive artifact: an octave error is audible in two seconds and no measurement
gets a vote.

## 2. Energy: one curve, 20 Hz, owing the grid nothing

One sample per downbeat cannot represent a 0.65 s hole.

The replacement is a single curve at a fixed 50 ms, measured in seconds.
Tempo-INDEPENDENT, and that is the load-bearing part: energy sampled against
the grid would inherit the grid's octave error, so Holocene would get a curve
at double rate to match its double-tempo fault and the two would compound
invisibly. Energy is a fact about the recording and owes the grid nothing.

50 ms resolves a 0.65 s hole across thirteen samples and the near-total cut at
4:17.2 across two. Finer than a video frame at 24 fps. ~6,000 points for a
five-minute song, ~50 KB of JSON; the maps already carry heavier per-beat
vectors in sidecar files if that proves too much.

Two things then stop existing, which is the test that this is a root and not
another layer:

- The **per-downbeat curve** becomes a derivation. Rule 8, one writer per fact:
  "how loud is it" is one fact. Readers wanting per-bar energy average the fine
  one, in `derive.js`, where `salience` already lives for the same reason.
- **`observations.prehush` is deleted.** It is the minimum of the fine curve in
  the 1.5 s before a moment -- three lines in `derive.js` once the information
  is in the map at all.

**Risk, and it is rule 7:** any reader indexing `energy` positionally rather
than by time breaks. `en()` in the lighting reader already crashed once on a
map with no energy curve, so this edge is known. Every reader is checked to
read by time; `apptest.js` and `smooth.js` are the gate.

## 3. Moments: the gap is a relationship, not a kind

A seventh moment kind was considered and rejected on inspection.

The moment in question is a `stop` at 256.24 and a `drop` at 257.67. Both
already exist, both correctly labelled, both at the right times. Nothing is
mislabelled. What the map cannot say is that they are ONE GESTURE -- that the
silence exists to set up the slam 1.4 s later.

A seventh kind would encode that as an adjective on the stop, without saying
what it is attached to. Strictly weaker, and it costs the one-way door.

The evidence that the relationship is the missing thing: the window chooser had
to reconstruct it by scanning. Any time a reader rebuilds a musical fact by
searching, that fact belongs in the map -- rule 4, pointing at `spans` rather
than `moments`.

**One new span kind, `lift`:** a fall that exists to set up what follows, from
the moment the floor goes to the moment it returns. `spans` already says "this
stretch has a shape" and already carries `build`.

Measured, not inferred: a `stop` or `quiet` whose end sits within about a bar
of a `drop` or `return`, AND where the level recovers across it -- a fall that
stays down is an ending, not a lift.

Every reader wants it, which is the test that it belongs in the map: lighting
holds the room dark across a lift and slams on the payoff, the drones gather
and break, the cut holds still and then flurries. None of that is a video word.

`moments` keeps its six kinds. Not timidity -- the door would have been widened
if the gap were there -- but because the six describe this song correctly and
the missing information is between them.

**Verified:** on Where Are U Now it must find 143.86->145.28 and
256.24->257.67, which are the two moments the prehush measurement ranked
deepest and the two a listener picked unprompted, arrived at from a completely
different direction. If it finds those and not the shallow ones at 114.33 and
170.05, the definition is right.

## Order

1, then 2, then 3. That is the order of causation: the grid corrupts energy,
energy corrupts moments. Doing them in any other order measures the previous
fault.

## How this gets seen

Every map produces `renders/click/<slug>.mp3` -- the song with a click on each
beat and a different click on each downbeat. A tempo error is audible
instantly. The human verdict goes in `truth/` and is what the octave test is
graded against, rather than the arithmetic grading itself. Four measurements
were written in one night and none was checked against a person; that is the
failure mode this exists to stop.

## Out of scope, deliberately

The video lane's own reframe -- an authored intent, a critique loop, a model
that looks at what it made -- is a separate spec written after this one. It is
blocked on this: an edit authored against a wrong grid is an edit authored
against noise.

The constraint that spec will carry, agreed now: **an authored intent may refer
to the map only by index** -- `moments[17]`, `downbeats[128]` -- never a raw
second. If a cut cannot name the musical thing it serves, it is not a cut this
system makes. That keeps the map load-bearing and keeps
`frame = f(map, layout, recipe, t)` true.
