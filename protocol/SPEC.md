# The protocol — beats

The smallest version that can fail. Beats only, with play, pause, seek and
tempo change. Everything else waits until this is right, because everything
else sits on top of it.

## The score

A rule for deriving beats, and never a list of beat times.

```json
{ "grid": { "bpm": 128.0, "first_beat_s": 0.2233, "beats_per_bar": 4,
            "tempo": [ { "from_beat": 0, "at_s": 0.2233, "bpm": 128.0 } ] } }
```

A list of beat times in seconds is what everyone builds first, and it is wrong
the instant anything is edited — every entry has to be recomputed and re-sent.
A rule derives every beat in the recording and none of it changes when somebody
plays the record faster.

`bpm` and `first_beat_s` alone were that rule until they met a song that
changes tempo. Raga of Revenge opens at about 90 and settles at 120 after
twenty seconds; fitting one tempo to it put the opening sections a bar and a
half out, and nine of twenty-one songs had some span the single figure could
not describe. So the rule is `tempo`: a list of constant-tempo segments, each
saying that from beat `from_beat` onward — which lands at second `at_s` — the
tempo is `bpm`. Beat 0 is bar 1 beat 1; a pickup before it counts backwards
into bar 0 at the first segment's tempo.

```
secondsAt(bar, beat):
    n   = (bar - 1) * beats_per_bar + (beat - 1)
    seg = the last entry whose from_beat <= n
    return seg.at_s + (n - seg.from_beat) * 60 / seg.bpm
```

A song whose tempo never moves is a map of length one, and that reproduces the
old two-number arithmetic exactly — so there is one code path, not two.

`bpm` and `first_beat_s` remain, and remain correct, as the song's dominant
tempo and its first downbeat. A reader that only understands those two keeps
working and is exactly as right as it was before. A reader that walks `tempo`
is right on the songs that change. `tempo` is always present.

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

## The request

A consumer asks for the fields it wants, and optionally a window.

```json
{ "score": "levels", "version": 2,
  "fields": ["grid", "downbeats", "sections", "energy"],
  "window": { "from_bar": 33, "bars": 8 },
  "asked_by": "lights" }
```

Four rules the responder keeps, checked by `node protocol/respond.test.js`.

**`grid` always comes back**, asked for or not, because every position in every
other field is meaningless without it.

**A field nobody asked for is not sent.** Wanting 127 downbeats should not mean
receiving 506 beats to get at them. That request above is 175 bytes in and 726
bytes back, against 19 KB for the whole song.

**The response says which version it gave.** A consumer that asked for `levels`
and got v2 yesterday and v3 today has no way to know last night's show is not
the one it would render now. A score is immutable once published; a correction
is a new version.

**A window clips, it does not renumber.** Bar 33 is still called bar 33. And a
section that starts before the window still comes back, because a consumer
asking for eight bars needs to know it is sitting inside a sixteen-bar drop.

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

## Profile

A score can carry how one user's application treats it. The hub stores a
profile per user beside the score's versions, and `limelight pull <score>
--profile=<user>` embeds it:

```json
"profile": { "user": "muzammil", "colours": [{ "name": "red", "hex": "#ff0000" }, { "name": "blue", "hex": "#0000ff" }] }
```

For now a profile is one or more colours from a fixed palette, in the user's
order; more keys come later.
The responder returns `profile` in every response when the score has one,
asked for or not, for the same reason it always returns `grid`. Without the
flag, no `profile` key exists anywhere. The author's metadata (`x-` keys) and
the profile are independent layers.

## Known and deliberate

The pickup before bar 1 is bar 0 beat 4. That is correct and it reads as
broken, so `before_first_beat` is set and the container shows the pre-roll
rather than a bar number.

## Two kinds of number, and why it matters

Some fields are absolute and can be compared between songs. Some are divided by
something inside their own song and mean nothing outside it. Reading a
song-relative number as an absolute one is how every song ends up looking the
same, because every song's loudest bar is 1.0 by construction — the quiet
record and the loud one both reach it.

The score says which is which, per lane, in `scales`:

```json
{ "width":     { "kind": "absolute", "runs": [0.0, 2.0] },
  "intensity": { "kind": "per_song", "against": "the song's loudest bar" } }
```

Absolute: `width`, `pump`, `brightness`, `chord_sure`. Per-song: `intensity`,
`air` (against the 98th percentile), `pace` (against the median bar), and each
of `drums`, `bass`, `vocals`, `other` against **that stem's own** loudest bar.
So drums at 0.8 does not mean the drums are loud, and it does not mean they are
louder than the bass, which is on a different scale again.

`loudness` is the field that lets a reader scale to the record rather than to
an absolute level, and it is the reason the quiet song can light up at all.

## Stems carry two numbers because there are two questions

`level` is the mean of the same per-bar lane a reader already has, so the two
can never disagree. `sits` is where the section falls between the song's 10th
and 90th percentile for that stem, and `is` — `none`, `some`, `full` — is the
bucket `sits` falls into. Use `level` to follow a curve and `is` to make a
decision. They used to both be called `level` and disagreed by as much as a
section reading 0.000 against a lane reading 0.170.

## Presence is the same fact as a shape

`presence` gives each stem as spans — the voice is `in` from bar 17 to 33, then
`out` — for readers that want to ask "is the voice in now" and "when does it
come back" rather than scan an array. It is the per-bar lanes with hysteresis,
so it is coarser on purpose.

## Melody

`melody` is one entry per sustained note with `bar`, `beat`, `pitch` in MIDI,
`held_beats`, and `from`, which is `voice` or `lead`. The voice comes from a
vocal separation and a monophonic pitch tracker; the lead comes from the other
stem and harmonic salience, because a monophonic tracker on a polyphonic stem
chases whichever partial is loudest and returns noise.

`voice` and `lead` each summarise their line and carry `sure`, driven by how
many notes needed octave correction. A low `sure` means the pitch track is not
to be trusted — one song in this set reads 0.0 — and a reader leaning on melody
should check it rather than assume.

## Chord changes

`chord_changes` lists only the bars where the chord moves, with the new chord
and a confidence. Expect less compression than it sounds: on a busy record it
is still most of the bars.

## Honesty fields

`beats[].off_ms` is how far each beat sits from where the grid says it should
be. On a programmed record it is near zero everywhere, which is itself worth
knowing; on a played one it is where the performance disagreed with the model.

`grid.sure` is how far two independent beat trackers agree about this song.
The pipeline runs madmom's DBN and Beat This!, which share no code and no
training data, and scores how many beats land within 70ms of each other and
whether both chose the same metrical level. It is the one confidence in the
file that nobody had to label by ear, and it is worth reading before acting
boldly: Entharo Mahanu scores 0.21 because the two models disagree by exactly
a factor of two about what the beat is, and the honest report of that is a low
number rather than a confident pick. Songs written to a click score 0.87 to
1.00.

`parts[].sure` is the silhouette of the clustering that decides `repeats_as` --
how cleanly a section sits inside the group it was assigned to, rather than how
likely its label is to be correct.

Neither is a probability. Both are measurements of agreement, which is a
different and more honest thing than a guess dressed as one.

`grid.tempo` says where the tempo was measured to change. It is not a
confidence: a segment boundary means the beats really did move, not that the
fitter was unsure. Uncertainty is what `holds_from_s` is for.

`grid.holds_from_s` and `holds_to_s` are always present now, and
`holds_measured` says whether that span was measured or is simply the whole
song because nothing measured it. Outside a measured span the bar lines are
extrapolated — calculated, not heard.

`made_by` names the separator behind the vocal and the instrumental lines,
because quality varies between songs and nothing else in the file records it.

## What the score cannot do

There is no stem audio. The separated stems are deleted once their loudness
curves and pitch tracks have been taken, so nothing can offer to play just the
drums or mute the vocal without re-running separation from scratch. Any reader
that assumes otherwise is wrong about this file.
