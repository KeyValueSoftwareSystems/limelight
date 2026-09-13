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

### Which bar a beat is in

A beat says which bar and beat it is, and that answer comes from its time read
through the tempo map, rounded to the nearest grid beat -- the same arithmetic
`listen/pulse.py` uses to decide what `off_ms` is measured from. `v1.js`,
`hub/score_api.py` and `respond.js` all do this, and a test holds them to it
across every song.

Two other rules were tried and are written down here because both looked right.
Counting the position in the list, `index / beats_per_bar`, assumes a song opens
on a downbeat; thirteen of twenty-eight open with a pickup, and on Levels the
first downbeat is index 2, so every bar in the protocol began two beats before
the bar. Walking the tracker's `downbeat` flags fixes the pickup and then
drifts, because the flags are not reliably one in four: on Cipher the walk
counted 274 bars where the grid says 337, and the beats and the sections stopped
agreeing about what bar 200 was.

Rounding lets two beats land in one grid slot, and then a bar has two beat ones.
That happens forty-six times in about twelve thousand beats across the library,
always on songs whose grid the score already doubts, and it is the recording
rather than the rule: the tracker heard a beat the grid has no room for, and
`off_ms` says how far out it was. Forcing the numbers to keep increasing was
tried to remove those collisions and was much worse -- one collision early in
Where Are U Now pushed the count ahead of the grid and the next 394 beats
inherited it.

A pickup bar is numbered from its own first beat, so that every bar in the list,
that one included, has a beat one.

### One field, two shapes

`beats` travels in two different shapes depending on which door a reader comes
through, and this is not yet settled.

`protocol/respond.js`, the reference responder, sends
`{ derived_from, as, count, list }` where the list is `[bar, beat]` pairs. That
is what `response.example.json` shows and what `respond.test.js` and
`session.test.js` assert.

`server/format/v1.js` and `hub/score_api.py` send an array of one object per
beat: `{ bar, beat, weight, sure, off_ms, downbeat }`. That carries strictly
more -- `off_ms` is an honesty field described below and the pair form throws it
away -- and `count` is the array's length.

Both handle either shape on input; neither converts to the other on output. A
reader written against one and pointed at the other will not crash, it will
quietly read nothing, which is the worst of the three possible outcomes. Pick
one before anyone writes a third reader.

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

## What a reader can act on that is newer than the rest

`ticks` is the only lane fast enough to drive a light on the beat. Everything
else here is per bar or per section, and a bar at 128bpm is 1.875 seconds --
four times slower than the kick. It carries one reading per sixteenth for each
of the four stems, cut on the bar edges so it stays with the music through a
tempo change, each stem scaled to its own loudest moment. `per_bar` says how
many readings a bar holds, but read the length of the array and trust that
instead: a score written before the rate was corrected declares sixteen and
carries four.

`sections[].repeats_as` is a letter. Two sections sharing one are the same
section coming back, so a look used for the first can be used again for the
second. `sections[].sure` is how cleanly that section sits inside its group,
which is a measurement of the clustering and not a probability.

`sections[].trades` appears on a section that alternates inside itself --
`{"every_bars": 8, "sure": 0.497, "heard_in": ["pace", "drums", "vocals"]}`.
A call and response never steps anywhere, so nothing else in this file
reports it, and a rig that holds one look across it is holding through four
turnovers of the music.

`melody_phrases` is the tune broken into lines, each with the notes it spans,
whether it was sung or played, and `same_as` naming an earlier line it repeats
the shape of.

`groove` is what the rhythm *is*, which nothing else here says. Per stem, the
strength of the hits at each sixteenth across a bar, plus `same_bar_to_bar` for
how much the pattern holds from one bar to the next. `pace` counts events and
throws the arrangement of them away: fourteen bars of Levels sit within 0.05 of
"one event a beat" and they do not sound alike. Levels' kick reads
`x...x...x...x...` and its bass `..x.......x...x.`; Nebulakal's kick is
`X.........X.xx..`, which is not four-on-the-floor at all. A reader that wants
to punch on the pattern rather than on the beat needs this.

`weight` and `floor` are the bottom of the spectrum -- the share below 120 Hz
and below 60. `air` and `brightness` are both the top, and nothing measured the
bottom, which is most of what a drop feels like. `weight` tracks loudness
closely enough to look redundant, and the places it does not are the point:
bar 50 of Levels is 0.04 loud and 0.30 heavy, a bar that measures as nearly
silent and still has a third of its energy under 120 Hz.

`sections[].also_heard` is a second opinion on the boundary from MuQ, a model
trained on a hundred and sixty thousand hours that shares no code, no features
and no assumptions with the detectors in shape.py. It is not merged into
`sure`: two numbers that disagree are worth more than one average that hides
it. On Nebulakal the model is nearly certain about boundaries we rated
middling -- bars 73 and 94 come back 0.99 and 0.95 against our 0.49 and 0.44 --
and it declines to back bars 110 and 146, which are also our two weakest. A
boundary both methods like is worth committing a look to. A boundary only one
of them likes is worth a gentler one.

null means only we heard it. That is not the same as wrong.

`lyrics` is what the singer is singing and when. `lyrics.words` is every word
with the second it starts and ends and the bar it falls in; `lyrics.lines`
groups those words into the song's own phrases, breaking at the quietest moment
within a beat of each phrase boundary rather than at a fixed word count, because
sung lines start on a pickup before the bar line and the median gap between two
sung words is zero -- singers do not leave silence between lines.

`lines[].sure` is the part of the line that two passes agreed on. The song is
transcribed twice with differently placed chunk boundaries, and a word counts as
confirmed when both passes produce the same word within 1.2 seconds. This is the
same rule as `grid.sure` and `also_heard`: one method's opinion is not evidence.
It matters here more than anywhere else, because a transcriber is fluent and
confident when it is wrong -- on The Nights it returns "when the thunderclap
starts pinging down" for "when thunderclouds start pouring down", in exactly the
register it uses for the lines it gets right. A line under 0.6 is usually one
where the voice is buried under the production.

`lyrics.checked_twice` is false when only one pass was run, and then no `sure`
is present anywhere. Absent `sure` means unmeasured, never confirmed.

`lyrics` is absent for songs the transcriber cannot read, and that set is larger
than it looks. Qwen3-ASR covers thirty languages; Malayalam, Tamil and Telugu
are not among them, and it does not decline. It picks the nearest language it
knows and answers with confidence. Nebulakal comes back as Chinese reading
"红灯，红灯，红灯，红灯"; Mizhiyoram as Chinese; Ponni Nadhi as Tamil forced
into Devanagari; Entharo Mahanu as nothing at all. Arz Kiya Hai is Hindi, which
is supported, and comes back as real Hindi lyrics.

Asking the model twice at different points in the song does not sort this out.
Mizhiyoram answers Chinese every time and Nebulakal answers Hindi every time --
steadily, and wrongly. A language that holds still is not the same as a language
that is right, which is why the gate is the two-pass word agreement in `sure`
rather than anything the model says about itself.

Indian-language lyrics need a model trained for them -- IndicWhisper or Sarvam
Saarika-2.5. Until one is wired in, those songs carry no `lyrics` field, which
is the honest answer rather than a field full of the wrong alphabet.

`noisy` is how much of a bar is noise rather than pitch -- distortion, cymbals,
breath -- measured as spectral flatness. `held` is how much of the bar the sound
keeps ringing instead of hitting and stopping: the share of the bar spent above
half the bar's own peak. A bar of staccato stabs and a bar of one held chord can
carry the same energy and the same brightness and read completely differently,
and nothing in the score could tell them apart.

Both were checked against every curve already in the score before they were
added, on eight songs. `held` never exceeds 0.71 correlation with an existing
curve and `noisy` reaches 0.88 only on Levels, against air, sitting between 0.21
and 0.60 elsewhere. A third candidate, the depth of the valleys between hits,
was dropped: it tracked `held` at 0.93 on Strobe and 0.88 on Experience, which
is one measurement wearing two names.

`tells` sits beside the per-bar lanes and says how much each is worth following
on this song. The lanes themselves travel as bare arrays because that is how
every reader already reads them, so the number rides alongside rather than
inside: `energy` is an array of values and `tells.energy` is what it is worth.
`curves.<name>.tells` carries the same figure for anyone reading the wrapped
form, and `energy.tells` for anyone reading that.

A reader that keys a look off a lane should look the lane up in `tells` first.
On Levels, brightness scores 0.99 -- below the point where it means anything --
and until this was added a reader holding the bare `brightness` array had no way
to know.

One name still means two things and one thing still has two names, and both are
worth knowing about before they bite. The per-bar energy curve is `intensity` in
the score file and `energy` in the protocol. `phrases[].energy` is not that
curve at all -- it is a single figure for one phrase. Renaming any of them
breaks a reader that exists, so they are written down here rather than changed.

`curves[].tells` is how much a curve is worth following on this particular song:
how much more the sections differ from one another than a section differs from
its own two halves. It is the same measurement that gates mood, applied to every
per-bar curve. Above about 1.3 the curve is tracking the music. At 1.0 a section
differs from itself as much as it differs from any other section, and a reader
keying a look off that curve on that song is lighting noise.

No curve is reliable everywhere, and the differences are large. Across the
twenty-eight songs, drums, bass and energy are never weak. pump says little on
ten of them, noisy on nine, width on eight, brightness on six -- on Levels
brightness scores 0.92, which is below the point where it means anything.

This was measured, not assumed, and it changed what we know about fields that
had already shipped. floor and weight are the closest pair in the whole file:
every per-bar lane was crossed with every other and they lead at mean |r| 0.86,
reaching 0.9 or more on fourteen of twenty-eight songs and 0.99 at worst. That
is past the 0.93 that retired an earlier candidate for being one measurement
wearing two names. Taking the part of floor that weight cannot predict and
testing that on its own, it still carries section structure on sixteen of
twenty-eight songs -- 4.15 on The Feeling, 3.53 on The War Cry, 2.24 on Don't
Look Down -- so floor stays. On the other twelve it is weight plus noise, and
`tells` is how a reader finds out which song it is holding.

That count was eighteen when it was first measured and is sixteen now; Levels at
1.26 and Killers From The Northside at 1.23 slipped just under the 1.3 line when
the per-bar lanes moved onto tempo-aware bar edges. The conclusion did not
change but the number did, which is the reason to re-run a claim rather than
quote it.

The second-closest pair is drums against intensity at 0.66 mean, which is not
redundancy: it is a loud song having loud drums. Nothing else in the file comes
near.

`sections[].mood` is where a section sits on a handful of opposed axes -- calm
against aggressive, happy against sad, warm against cold -- read by MuQ-MuLan,
which was trained to place music and text in one space. The number is not a
score against the word. It is the section's position within this song: zero is
the song's own average, and the range runs to roughly plus or minus a half. So
-0.4 on `calm_vs_aggressive` means one of the more aggressive stretches of this
particular song, not an aggressive piece of music. The raw similarity carries
an arbitrary offset -- every section of The Nights reads "bright" against
"dark" -- and only the differences between sections survive it.

`mood_axes` says which axes were worth keeping and by how much. Every axis is
measured before it ships: each section is split in half and read twice, which
gives a noise floor, and that floor is compared against how much whole sections
differ from one another. The number in `mood_axes` is that ratio. Below 1.0 a
section differs from itself more than it differs from other sections, and the
axis is measuring nothing. Anything under 1.3 is dropped from the score rather
than shipped as decoration.

The bar is applied per song, because the reliability is per song and not per
axis. bright/dark scores 0.86 on The Nights and 1.64 on Levels. calm/aggressive
scores 2.49 on The Nights and 0.95 on Levels. Raga of Revenge reads warm/cold
at 5.49. Holocene, which holds one mood for four minutes, clears the bar on
almost nothing and so carries almost no mood -- which is the correct answer for
that song, and the reason the gate exists.

Unlike `also_heard`, where two independent methods vote on the same boundary,
this is one model's opinion with no second method to check it against. The
split-half ratio says the opinion is stable. It does not say it is right.

`moments[].agreed` is how strongly several different detectors concur that
something happens in that bar, and it is how the bar earned its place.

A moment used to be kept only if one signal was loud enough on its own. That
threw away the thing this project treats as evidence everywhere else. Bar 7 of
Raga of Revenge is where the drums come in, the harmony turns, the riff arrives,
a sweep lands, the tension lets go, and the song changes tempo from 89 to 120 --
six detectors, five different kinds, at one instant. The loudest of them scored
0.399 against a bar that needed 0.70 alone, so every one was dropped and the
page said nothing was notable there. Amal heard it and asked why.

A bar now earns a moment either the old way, one strong signal, or by two or more
distinct kinds concurring, combined as independent evidence. `agreed` carries
that combined figure: bar 7 comes out at 0.899.

This was checked against landmarks none of the detectors can see -- where the
tempo changes, where a section begins, where a release lands. Agreed bars fall
on one of those 67% of the time against 28% for a bar picked at random, a lift
of 2.41 across 344 of them. Requiring three kinds instead of two was tried and
was worse on every count: fewer bars, lower lift, and two songs left with no
moments at all.

## How much a boundary is worth

`sections[].edge` is how far apart this section and the one before it are,
against how much each of them varies inside itself -- the same ratio `tells`
uses for a lane, applied to a cut. It is null on the first section, which has
nothing before it.

A boundary at 5.31 is the drop landing in Levels. A boundary at 0.29 was
Cipher's breakdown being cut into two breakdowns on nothing. The threshold the
rest of this project uses is 1.3, and below that a reader should treat the cut
as a suggestion rather than an event.

Two sections with the same name on either side of a boundary worth less than
1.3 are now merged, because the same section split in half on noise is a
mistake with no upside. Thirteen of those existed across the library and one
remains, Experience at bar 74 where the ratio is 1.16. Boundaries below 1.3
that separate *different* names are left alone and shipped with their number:
sixty of them exist, and they may be real changes that the level and the stems
happen not to show.

`edge` says how different the two sections are. `sections[].sudden` says how
much of that difference happens *at* the boundary: the jump across the two bars
either side, over the total distance between the sections. At 1.0 the whole
change lands on the bar. At 0.3 the sections really do differ and the change is
a ramp spread over eight bars, so the exact bar is arbitrary and no listener
will feel an event there.

They are different questions and the numbers know it: across 279 boundaries they
correlate at -0.16, and they disagree on 62 of them -- 30 boundaries pass the
1.3 difference check while being ramps, and 32 fail it while being clean steps.
(`wash` was dropped for correlating 0.93 with `held`; this is nothing like that.)

Don't Look Down is the worked example. Its boundary at bar 20 scores 1.66 for
difference and 0.39 for suddenness: the bass climbs 0.09, 0.23, 0.34, 0.46,
0.67, 0.98 from bar 16 to bar 23 while the energy stays flat. The two sections
are genuinely different and there is no moment between them. Amal played it and
said he could not feel any change at that boundary. He was right, and `edge`
alone could not have told him why. Its drop at bar 38 scores 1.14 and bar 103
scores 1.77.

A reader should cue a step and fade through a ramp. Below about 0.5 there is no
instant to hit.

This is also the honest answer to why breakdowns were worse than drops. A drop
is a large step in a loud passage and the evidence towers over the noise: drop
boundaries fail the 1.3 check on 2 of 26. A breakdown boundary sits inside a
quiet passage where the wiggles are the same size as the evidence, and fails on
11 of 45. Chorus boundaries are worst at 11 of 32. The detector was applying one
threshold to both.

## What the music is doing, which is not how loud it is

`motion` answers the question a lighting desk actually asks: is this lifting,
holding, falling away, or winding up. It carries `moving`, one of `rising`,
`steady` or `falling` per bar, read off the loudness curve with two bars of
hysteresis so it reports a settled state rather than every wobble; `spans`, the
same thing as runs for a reader that wants "when does the lift start" instead
of an array; and `winding`, which is the one that is not loudness at all.

`winding` is the build. It measures the thing a riser actually does, which is
get **thinner**, not louder: the sub is filtered out and noise climbs, and then
the drop returns the bottom. It is `0.7 * (1 - floor) + 0.3 * noisy`, scaled
across the song.

The reason it exists is that energy is the wrong lane to watch and watching it
is worse than watching nothing. Taking every sustained loudness jump across the
library as drops -- found from the loudness curve itself, so our section labels
are not the judge -- and asking where each lane sits in the eight bars before
one, against every other eight-bar window in the same song, chance being 50:

    winding          66.6      inverted floor    66.4
    inverted energy  65.6      noisy alone       52.1

**`winding` does not beat reading the energy curve upside down, and this spec
should not pretend otherwise.** An earlier draft reported energy at the 32nd
percentile and winding at the 68th as though they were two findings. They are
one finding seen twice: the 32nd percentile for a lane is the 68th for its
negation. The information was already in `intensity`.

What is real is the observation, not the lane. Energy is not merely
uninformative before a drop, it is reliably *low* -- four bars before Don't Look
Down's drop the energy curve reads 0.24, 0.24, 0.20, while air climbs to 1.02
and floor collapses from 0.31 to 0.06. A reader keying a build off `energy`
without inverting it will fade down into the drop.

`winding` is kept for two small reasons, neither of them new information. It
rises into a drop, so a reader maps it to intensity without having to invert
anything; and it is slightly more decisive, reaching the top quartile of its
song on 52% of drops against 41% for inverted energy. A reader who already
inverts `energy` gains almost nothing by switching.

It is not redundant in the way `wash` was with `held`: against energy it
correlates -0.33 on average, |r| >= 0.80 on only two of twenty-eight songs
(Don't Look Down -0.84, Killers From The Northside -0.83) and below 0.60 on
twenty-one. On Raga of Revenge it is +0.06, because there the `noisy` term
dominates. So it is not the same curve -- it simply does not do better at the
one job it was built for.

Combining more lanes did not pay. Adding the slope of noisy and air to the blend
moved it from 62.2 to 61.9, so the slope terms were dropped and the lane is two
terms. `gone only` -- floor inverted with nothing else -- scores 62.5, within
noise of the blend that shipped.

`motion.tells` is per song and is not the split-half number the other lanes
carry. It is the percentile `winding` reaches in the eight bars before this
song's structural drops, so 50 is chance and higher is better. It is above 65 on
eighteen of twenty-eight songs and below 50 on seven: it is an EDM-shaped
measure and it says so rather than pretending otherwise. A drop here is a jump
at least half the size of the song's biggest, which is what `slams[].big` marks.

`slams` and `ebbs` are where the loudness steps up and steps down, with `by` for
how far and `big` for whether it is structural. `ebbs` is the one nothing else
reported: a song loses energy as deliberately as it gains it, and the moment the
drums walk out is a cue in its own right.

## Times, because a label is not a time

Every event that has a moment now carries the second it happens at, and this is
the correction of a real fault rather than an addition. Alnas built a show off
this file and reported a constant two-beat offset. He was right, and the offset
was not in the tracker.

`beats[]` never carried `t`. A reader could only rebuild a beat's time from its
bar and beat, and `off_ms` -- the field whose whole job is to say how far a beat
sits from the grid -- was being recomputed by the formatter against a uniform
grid indexed by the beat's position in the list. Levels' first beat measures
-13.5 ms in the score and reached him as -951 ms, which at 128 bpm is 2.03
beats. Beats now carry `t` and the `off_ms` the score measured.

`releases[]` had the same shape of fault. The formatter recomputed the position
from `at_s` on a uniform grid and then threw `at_s` away, so a release the score
placed at bar 8 beat 3 arrived as bar 8 beat 1: the pickup's two beats, again.
Releases now carry `at`, `at_s` and `lead_beats` as measured. He called an
aligned release the most valuable single cue in the file.

`melody[]` carried `bar` and `beat` and nothing finer, so ninety slots in Levels
held more than one note and five notes were exact duplicates of the one before.
Notes now carry `at_s` and `in_beat`, where `in_beat` is how far through the
beat the note starts, 0.0 on the beat and 0.5 exactly between two. A chase can
follow an arpeggio note by note instead of guessing a rate from `pace`.

The rule this leaves behind: if the score knows when something happened, the
protocol sends the second, not only the label. A label is a claim about a grid
and a grid can be wrong; a second is what a speaker did.

## A dropout is a bar, not a flag

`phrases[].has_break` said a phrase contains "a bar out, then back" and nothing
else -- not which bar, not how long, not what kept playing. Alnas had to recover
them from energy dips with a threshold of his own, which is work the file should
have done. The detector already knew: it finds the quietest bar in the phrase,
checks it against 40% of the phrase median, and then threw the index away.

`phrases[].break` now carries `from_bar`, `to_bar`, `bars`, `still` -- the stems
that keep going -- plus `deepest` and `depth` for the stem that falls furthest
and how far. `has_break` stays, so nothing that reads it breaks.

The dip is one bar on the median phrase and runs to four at the longest, and
just over a quarter of them are longer than a single bar, which is exactly the
detail the flag could not express.

Whether these are real was checked against the stems, which are different data
from the loudness curve that finds them. In every one of 112 candidates at least
one stem falls inside the dip relative to the same phrase outside it, on 73% of
them by 80% or more, and the median deepest stem falls by 0.99 -- something goes
essentially silent. There were no candidates where nothing dropped.

That check was run twice. The first version divided each stem's level in the dip
by its phrase median and reported stems sitting at 285 times their own median,
which is a near-zero denominator rather than a finding, and it led to a false
conclusion that a fifth of the flags were artefacts. Comparing the dip against
the rest of the same phrase, with a floor under the denominator, is what the
numbers above use.

## Which file this score belongs to

`recording` is a fingerprint of the audio: `fingerprint` as hex, `bits`, and
`heard_seconds`. It is eight mel bands over thirty-two slices of the first two
minutes, reduced to the sign of the change from one slice to the next, so it
survives re-encoding. Alnas had no way to tell whether a score belonged to the
file he was about to play it against and fell back on matching durations.

A plain hash of the samples was tried first and is useless here. The same
recording as wav, 192 kbps mp3 and 128 kbps mp3 gives three different digests,
and since the pipeline reads wav while the hub stores mp3, it would have
mismatched every single time. The coarse fingerprint gives **zero** bits of
difference across those same three encodings.

Across the library it separates cleanly: 378 pairs of different songs, the
closest two -- The War Cry and Where Are U Now -- 84 bits apart out of 248, a
median of 120, and nothing under 15%. Same recording is 0 and the nearest
different song is 84, so any threshold between 1 and 83 decides it. Compare with
a Hamming distance and treat anything over about 20 bits as a different
recording.

## Finding a thing that is not in any one lane

Amal asked whether the protocol exposes the sustained high element behind
Levels' last breakdown, between 3:04 and 3:11. It does, and the answer is worth
recording because the obvious lane is the wrong one.

That passage is bars 95 to 99. The element is in `stems.other` -- everything
that is not drums, bass or voice -- which peaks at 1.00 at bar 97 while `held`
reads 0.85, so it is sustained rather than struck. `energy` reads 0.165 there
and sees nothing at all, the same blindness it has before a drop.

`brightness` is the lane a reader would reach for and it is useless here: it
sits pinned between 0.96 and 1.00 for the whole passage, and its `tells` on this
song is 1.02, below the 1.3 floor. The score already says not to use it. `air`
is falling through the window, from 1.08 at bar 93 to 0.60 at bar 99.

So the recipe is `stems.other` high, `held` high, `energy` low, and the two
lanes that name a register do not carry it. There is no single field for "a
sustained thing high in the background", and until one is measured rather than
assumed, this combination is the honest answer.

## Six stems, because `other` was hiding a good lane

Amal asked about a sustained high element behind Levels' last breakdown and the
answer was that it lives in `other`. His response was the right one: `other` is
not a thing, it is everything we could not name, and a bucket that holds the
lead synth, the pads and the noise floor at once cannot be followed.

`guitar` and `piano` are now their own lanes, taken from a second pass with
`htdemucs_6s`. The four stems still come from `htdemucs` exactly as before, so
`presence`, `groove`, `sections[].stems` and every structural signal built on
them are untouched.

Running only the six-stem model was tried first and is wrong. Its `other` is not
the old `other` with two things removed -- the two models decompose differently
throughout, and the six-stem `other` correlates with the four-stem one at 0.23.
Rebuilding it as other plus guitar plus piano reaches only 0.69, with a mean
error of 37% of the signal. Levels' pause moved from bar 51 to bar 26 and the
lighting reader's own test caught it. So both models run: about 36 seconds a
song on top of 12, all of it once and then cached.

The gain was measured on seven songs before the pipeline was touched, as
between-section spread over within-section spread, the same ratio `tells` uses:

    song              guitar  piano   other (6)  other (4)
    dont-look-down     5.86    2.12     3.14      1.78
    levels             1.84    3.53     0.82      1.83
    the-nights         2.00    0.79     4.05      2.45
    holocene           2.10    1.28     2.39      2.77
    nebulakal          1.62    1.30     1.85      1.82
    raga-of-revenge    0.72    2.15     1.17      1.60
    wetwork            0.87    0.85     1.47      2.71

Guitar or piano clears the 1.3 floor on six of the seven. Don't Look Down's
guitar at 5.86 is the strongest single lane measured anywhere in this project,
against an `other` of 1.78 that was carrying it before. Raga Of Revenge, which
had only six of fourteen lanes above the floor, gains a 2.15. On The Nights and
Wetwork neither new lane clears it and `other` stays the better one, which is
what `tells` is for.

Separation costs about 36 seconds a song against 12, all of it the first time.

BS-RoFormer was tried and is not here. It is the better model -- 12.9 dB SDR on
vocals against htdemucs's 9.6 -- but it needs about thirty-four minutes a song
on this machine's 3.6 GB GPU, which is sixteen hours for the library against
seventeen minutes. It is the right thing to move to when there is a bigger card,
not something to pretend is free.

## A section start and a slam can be a bar apart, and neither is wrong

Amal heard the drop in Nebulakal at 1:50. The section boundary says 1:50 and
`motion.slams` says 1:52, and by the raw lanes the slam is right: at bar 58
`floor` goes 0.17 to 0.95, the voice cuts to 0.00, the pad falls 0.95 to 0.21
and `winding` collapses 0.70 to 0.28. One bar apart.

That was checked across the library on every big slam with a section boundary
within four bars. Of 72, forty-three land on exactly the same bar, twenty-two
lead by one and seven lag by one. The bias is real -- three times more lead than
lag, mean -0.18 bars, about a third of a second -- and three explanations for it
were tested and all three failed.

It is not phrase snapping: in the one-bar cases the section bar sits on the
phrase grid 27% of the time, which is exactly how often the slam bar does.

It is not the onset walk-back in `switches`, which moves entries backwards and
would be the obvious culprit given the asymmetry. Turning it off moves the mean
to -0.05 and makes the answer worse: exact hits fall from 43 to 39 and the lag
side doubles from 10 to 20. It buys symmetry with scatter.

And it cannot be sharpened with the bassline. A one-bar jump in `floor` is the
crispest evidence a drop leaves, but only 45% of big slams have an unambiguous
one nearby, and where there is one it disagrees with the slam bar on 52% of them
and with the nearest section boundary on 65%. Three instruments, three answers.

So the bar of disagreement is the resolution of the measurement, not an offset
waiting to be removed. A slam's bar comes from a four-bar windowed mean on
either side and cannot be sharper than that. A reader who needs the instant
should cue from `motion.slams` and `beats[].t`, and treat `sections[].from` as
where the structure changes rather than where the hit is. Where they differ by
a bar, they are both telling the truth about different questions.

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
