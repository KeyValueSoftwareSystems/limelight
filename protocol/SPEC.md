# The protocol — beats

The smallest version that can fail. Beats only, with play, pause, seek and
tempo change. Everything else waits until this is right, because everything
else sits on top of it.

## The score

Three numbers, and never a list of beat times.

```json
{ "grid": { "bpm": 128.0, "first_beat_s": 0.2233, "beats_per_bar": 4 } }
```

A list of beat times in seconds is what everyone builds first, and it is wrong
the instant the tempo moves — every entry has to be recomputed and re-sent.
Three numbers derive every beat in the recording and none of them change when
somebody plays the record faster.

## Beats and downbeats are written out too

They are derived from the grid, and they are also listed, because a score
travelling through a registry as a file should be readable without implementing
the derivation first.

```json
"beats":     { "derived_from": "grid", "as": "[bar, beat]", "count": 506,
               "list": [[1,1],[1,2],[1,3],[1,4],[2,1], …] },
"downbeats": { "derived_from": "grid", "as": "[bar, beat]", "count": 127,
               "list": [[1,1],[2,1],[3,1], …] }
```

`[bar, beat]` and never seconds. Listing them costs bytes; listing them in
seconds would cost correctness, because a list of seconds is wrong the moment
somebody moves the tempo. As musical positions the list survives a tempo change
exactly as the grid does, which is checked by a test.

**The grid stays authoritative.** If the list and the grid ever disagree, the
list is what is wrong, and a test compares all 506 entries on every run.

## The two clocks

Keeping these apart is the whole design.

| clock | maps | does rate touch it? |
|---|---|---|
| the score | song seconds → musical position | **no**, ever |
| the transport | wall time → song seconds | yes, and only here |

Bar 12 beat 3 sits at the same song-second whatever speed you play the record.
That is why nothing has to be refetched.

## The two questions

`now()` answers in musical position. `next(lead_ms)` answers in the caller's
own milliseconds, because that is what a container schedules against — and it
is the only place the two clocks meet.

```js
const s = Session(score, { songTime: () => audio.currentTime });
s.now()       // { position: {bar, beat}, phase, to_next_beat_ms, playing, rate }
s.next(2000)  // [ { bar, beat, accent, in_ms } ]
```

If the container already has a clock, hand it over with `songTime`. Two clocks
in one program drift, and then somebody spends an evening finding out why the
lights are 40 ms late.

## Play, pause and seek are not ours

They are facts about the container's clock, not about the song. Nothing on our
side holds a session, so there is nothing to get out of step and nothing to
restore after a reload.

## The test that has to keep passing

`node protocol/session.test.js` — 19 checks. The one that matters most is the
last: note the next beat, pause, seek backwards, change the tempo, and the beat
is still the same bar and beat while the milliseconds have moved. If any
musical position moves, the design is wrong.

## Sections, in layers

A song is several structures at once, and flattening them into one list loses
the part that matters. So sections come in named layers, and layers overlap.

| layer | kind | what it holds |
|---|---|---|
| `form` | partition | intro, verse, break, drop. Exactly one covers any bar. `id` and `repeat` say which are the same thing coming back. |
| `energy` | sparse | builds. Crosses form boundaries on purpose. |
| `presence` | sparse | which instrument is in. Overlapping by nature. |
| `silence` | sparse | where the voice is absent. |
| `phrase` | rule | hypermeter, derived from `every_bars`, never stored. |

The test that shows why this is not over-engineering: on Levels the build runs
bars 78 to 86, and the verse starts at 79. One flat list cannot hold both.

`sectionsAt(position)` returns every layer at once — a single span for a
partition, an array for anything sparse, because overlap is the point.

`until(layer)` is the one an application actually wants: how many bars and how
many of *your* milliseconds until the thing you are inside ends. That is what
lets a reader build toward a change instead of reacting to one.

Boundaries also arrive through `next()`, so anything with lead time is told a
section ends in 900 ms rather than discovering it once it already has.

### One writer per fact

`instruments.parts.vocals` and `vocal_silence` both answer "is the voice
there", by different methods, and they disagree — at bar 78 the first says
present and the second says silent. The silence measurement keeps the fact and
vocals is dropped from the presence layer. Two lanes computing the same number
will eventually disagree, and then both are suspect.

### Not a lighting word

There is no `blackout` in the score, and there will not be one. The musical
fact is `silence`. A lighting reader may black out there; a game may do nothing
at all; and the score must not assume either.

## Known and deliberate

The pickup before bar 1 is bar 0 beat 4. That is correct and it reads as
broken, so `before_first_beat` is set and the container shows the pre-roll
rather than a bar number.
