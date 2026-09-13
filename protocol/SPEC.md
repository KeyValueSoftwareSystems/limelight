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
  "intensity": { "kind": "per_song", "against": "the song's loudest bar" },
  "brightness": { "kind": "per_song", "against": "the song's loudest frame" } }
```

Two lanes are named for something they do not measure, and the names are kept
only because readers are built on them. `held` is documented as how much of the
bar is ringing rather than struck; if that were so it would fall as onsets get
denser, and it rises instead (r = +0.16, negative on only 8 of 28 songs). It is
a duty cycle. `noisy` is documented as the unpitched share and fails both
referents for that -- HPSS percussive r = +0.34, chroma entropy r = +0.16 -- and
restates `air` at r = +0.67. Use them as textures with those names as labels,
not as claims.

Absolute: `width`, `pump`, `held`, `noisy`, `chord_sure`. Per-song: `intensity`,
`weight`, `floor`, `brightness`, `air` (against the 98th percentile), `pace`
(against the median bar), and each of `drums`, `bass`, `vocals`, `other`,
`guitar`, `piano` against **that stem's own** loudest bar. So drums at 0.8 does
not mean the drums are loud, and it does not mean they are louder than the bass,
which is on a different scale again.

`scales` now names every lane the file ships. It used to be missing `guitar`,
`piano`, `held` and `noisy` — four lanes a reader could normalise only by
guessing. And `brightness` was declared absolute and is not: it counts mel bins
above -38 dB against `ref=np.max`, which is the song's own loudest frame.

A lane where 95% of the bars carry the same number is not a measurement, and it
now ships as nulls rather than as a wall of one value. Holocene's `pace` read
0.000 on 209 of its 210 bars, because the onset detector finds almost nothing in
soft piano attacks; a reader taking that at face value would see a song where
nothing ever happens. 95% is a floor, not a tuned threshold: the next-flattest
lane in the library is Experience's `pace` at 74% one value, and that one still
has a tell of 1.70 and real information in the remaining quarter.

`loudness` is the field that lets a reader scale to the record rather than to
an absolute level, and it is the reason the quiet song can light up at all.

## Stems carry two numbers because there are two questions

`level` is the mean of the same per-bar lane a reader already has, so the two
can never disagree. `sits` is where the section falls between the song's 10th
and 90th percentile for that stem, and `is` — `none`, `some`, `full` — is the
bucket `sits` falls into. Use `level` to follow a curve and `is` to make a
decision. They used to both be called `level` and disagreed by as much as a
section reading 0.000 against a lane reading 0.170.

**`none` does not mean silent.** It means `sits` is under 0.10 — the section is
in the bottom tenth of *this song's own range* for that stem. On a record where
the voice never stops, the quietest sections still come back `none`. That is why
59 of the 230 sections carrying `sung` notes also say `vocals: none`, and 33 of
315 carrying `played` say `other: none`: the pitch tracker found a line where
the level bucket says "as quiet as this song gets". Neither field is wrong; they
answer different questions. Read `is` as a rank within the song and `presence`
or the raw lane for whether anything is there at all.

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

`voice` and `lead` each summarise their line with `notes`, `low`, `high` and
`octave_fixes`. They used to carry a `sure` derived from `octave_fixes`, and it
is gone because its sign was backwards. The formula read repairs as damage, so
it returned 0.0 both for a track the fixer had repaired perfectly and for pure
noise — I ran both through it to check. Four of the seven tracks it scored 0.0
were among the best in the library by every independent measure, and the field's
strongest correlate on the lead was the share of consecutive notes at the *same*
pitch (+0.50): it rewarded a drone and punished a melody. `octave_fixes` stays,
because it is a true count of an operation performed, and a reader can decide
what to make of it.

Two things about `melody` worth knowing before leaning on it. The `high` figure
was contaminated: `librosa.yin` returns its `fmax` when it cannot decide, and
that rail is perfectly stable so it passed the held-note gate. 19 of 29 songs
had a pre-correction maximum of exactly that rail, and `high` is a max statistic
so a handful of frames set it. Frames at the tracker's ceiling are now dropped.
And the `lead` half is not a melody. It is dominated by repeats and leaps (42.7%
of its intervals are unisons against the voice's 30.9%, and it sits on the bar's
chord root 22.9% of the time), which is what tracking the strongest harmonic of
an accompaniment looks like. It carries real harmonic content — it beats a
key-rotation control at p = 1e-7 — but read it as what the accompaniment is
doing, not as a tune somebody sang.

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

`sections[].like` is a letter. Two sections sharing one are the same
section coming back, so a look used for the first can be used again for the
second. `sections[].sure` is how cleanly that section sits inside its group,
which is a measurement of the grouping and not a probability.

`sections[].role` -- intro, verse, chorus, drop, breakdown and the rest -- is
the least trustworthy thing in this file, and it is also the most readable, so
it needs saying plainly. **The boundaries are measured. The names on them are
not.**

The name comes from loudness, position and which stems are playing
(`listen/call.py`). It looks consistent if you check it against `bars.intensity`
-- chorus and drop outrank verse on 15 songs out of 15 -- but that is circular,
because intensity is what chose the label. Check it against `fullness`, the
energy figure this file actually publishes per section, and it is 8 of 15, which
is a coin flip. Against published human transcriptions it does worse: Ultimate
Guitar has The Nights as verse / pre-chorus / chorus and this file gives it no
verse and no pre-chorus at all, and five breakdowns; Holocene is verse/chorus
three times over and this file puts its one chorus at bar 191 of 209. A
hook-lyric test -- does the line the sheet music calls the chorus land in a
section named chorus, drop or post-chorus -- gets 6 of 30. `breakdown` is 21% of
all sections, the largest class, and it is the fallback branch.

So: drive a look off `like`, `edge`, `fullness` and the stem lanes, which are
measured. Use `role` to put a word on screen for a human. Do not use it to
decide what the lights do.

`sections[].trades` appears on a section that alternates inside itself --
`{"every_bars": 8, "sure": 0.497, "heard_in": ["pace", "drums", "vocals"]}`.
A call and response never steps anywhere, so nothing else in this file
reports it, and a rig that holds one look across it is holding through four
turnovers of the music.

`melody_phrases` is the tune broken into lines: where each starts and stops,
how many notes it holds, its lowest and highest, whether it was sung or played,
and `from_note`/`to_note` indexing straight into `melody[]` so a reader can pull
the actual notes back out. A phrase's bar.beat span could not do that on its own
— several notes share a beat, and resolving a span against `melody[]` returned a
different note set than the phrase reported on 8% of phrases.

It used to carry `same_as`, naming an earlier line it repeated the shape of,
with a `sure` beside it. That is gone. Two things were wrong with it. The index
was written per-stream and then the voice and lead phrases were merged and
re-sorted without remapping it, so 79% of the populated pointers named the wrong
phrase and 43% named one in the other stream, which the rule never even compared
against. And once that was fixed the field still did not survive a control: hold
a phrase up against phrases drawn from *other songs* and the shipped threshold
tags 12.9% of them, against 14.6% within the song — a lift of 1.13. It was
matching the generic statistics of a pitch track, not this song's repetition.
Tightening it does find real repeats — shift-aligned, six steps or more, exact,
with a guard requiring two intervals of a tone or wider, reaches 4.75x over the
same control — but at 1.0% recall, on a segmentation that already returns the
same figure as five notes one time and four the next. Section-level repetition
is in `sections[].like`, and it is measured; melodic-phrase
repetition is not something this file can claim yet.

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
that shares no code, no features and no assumptions with the detectors in
shape.py. (The checkpoint loaded here is `MuQ-large-msd-iter`, trained on the
Million Song Dataset -- not the hundred-and-sixty-thousand-hour corpus of the
paper, whose authors say the released weights do not reach the published
numbers.) It is not merged into `sure`: two numbers that disagree are worth
more than one average that hides it.

It is agreement **within two bars**, not on the bar. That distinction is the
whole field. Matched against random bars of the same count and span, our
boundaries land on a MuQ novelty peak 33.2% of the time against 23.7% by
chance -- a lift of 1.41, p = 3e-05, above chance on 23 of 28 songs. Tighten the
window to the exact bar and the lift is 1.11 with p = 0.87, which is no
agreement at all. The two methods are hearing the same event; they are not
placing it on the same bar.

Read the presence, not the number. The value is a novelty peak height with a
floor under it, so it cannot come back below 0.56 and among the boundaries that
have one it does not track our own `sure` (rho = -0.12). What it does carry is
real: our `edge` averages 2.15 where MuQ agrees against 1.79 where it is silent.

On Nebulakal the model is nearly certain about bars 74 and 93, coming back 0.99
and 0.95, and declines to back bars 128 and 146. Do not read our `sure` against
it as a second opinion on the same question: `also_heard` is about the boundary,
`sure` is about how cleanly the section sits in its `like` group, and they are
not two estimates of one thing. `edge` is the field to read beside it, and it
does line up -- 2.15 where MuQ agrees against 1.79 where it is silent. A
boundary both methods like is worth committing a look to. A boundary only one of
them likes is worth a gentler one.

null means only we heard it. That is not the same as wrong. It is null on 197 of
305 boundaries.

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
register it uses for the lines it gets right.

What `sure` is not: a measure of how buried the voice is. That was claimed here
and it is wrong. Correlating `lines[].sure` against how far the vocal stem sits
above its bar's own intensity, over 354 lines in 19 songs, gives r = +0.063,
p = 0.24. It measures whether two passes produced the same word, and nothing
else. A high `sure` means reproducible, which is not the same as right: Holocene
scores 0.60 on a line that reads "Someone's part of me apart" where the record
says "Someway, baby, it's part of me, apart from me".

`lyrics.checked_twice` is false when only one pass was run, and then no `sure`
is present anywhere. Absent `sure` means unmeasured, never confirmed.

`lyrics` is absent for songs the transcriber cannot read, and that set is larger
than it looks. Qwen3-ASR covers thirty languages; Malayalam, Tamil and Telugu
are not among them, and it does not decline. It picks the nearest language it
knows and answers with confidence. Nebulakal comes back labelled Hindi in
Devanagari; Mizhiyoram and World of Lokah as Chinese in Han; Entharo Mahanu, a
Tyagaraja kriti, as the Amitabha mantra in Han; Ponni Nadhi as Tamil forced into
Devanagari. Arz Kiya Hai is Hindi, which is supported, and comes back as real
Hindi lyrics.

The gate that drops them is the two-pass agreement in `sure` together with the
script: below 0.25 and more than half non-Latin letters, the block does not
ship. On this library that is exactly the five songs above -- World of Lokah
0.026, Mizhiyoram 0.053, Entharo Mahanu 0.098, Ponni Nadhi 0.118, Nebulakal
0.179 -- and it leaves the genuinely-Hindi Arz Kiya Hai at 0.443 and Raga of
Revenge at 0.395 alone. The threshold is fitted to twenty-three songs, not
derived; what makes it hold is that the unsupported languages cluster far below
everything else, because a model decoding a language it has never seen cannot
produce the same word twice. `made_by.words_from` names the transcriber so a
reader can check its language list rather than trust this paragraph.

The script test alone would not do it: Arz Kiya Hai is 93% Devanagari and
correct. The `sure` test alone would not either: Shootout is English, scores
0.000, and ships -- it reads "Zero zero zero zero zero", a decoder loop, and
that failure is visible in the number where a reader can see it. Both tests
together is what separates a wrong alphabet from a bad transcription.

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
its own two halves. Read it as a band, not a line. Below 1.0 a section differs
from itself as much as it differs from any other section and a reader keying a
look off that curve is lighting noise; above 1.6 the curve is tracking the
music; between them it is uncertain. The band is wide because the number moves:
shifting every internal boundary by one bar changes each tell by 29% on average
and flips the trust verdict on about one lane in seven, and section starts and
slams are already known to sit a bar apart on 29 of 72 cases. Wrong boundaries
do cost it -- random segmentations drop the mean tell 47% -- so it is not simply
reading itself back, but one bar is expensive.

No curve is reliable everywhere, and the differences are large. Across the
twenty-nine songs only bass and drums are never weak. piano says little on
fifteen of them, pump and noisy on eleven each, held, vocals, width and other on
five, guitar and weight on four, floor and brightness on three.

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

`sections[].mood` and `mood_axes` are gone. They put every section on a handful
of opposed axes -- calm against aggressive, happy against sad, warm against cold
-- read by MuQ-MuLan, and `mood_axes` carried a ratio that was supposed to say
the axis had cleared its own noise. Three measurements took the field out.

The ratio was not measuring noise. MuQ-MuLan is bit-exact deterministic: the
same clip read twice returns the identical vector, so the "read it twice" floor
the gate divided by was not measurement noise at all, it was how much a section
changes between its first half and its second. Music does that on purpose.

The gate did not beat a control. Recomputing it over random contiguous segments
of the same sizes, ignoring where the sections actually are, passed 43.4% of
axes against the real segmentation's 44.9%.

And the certificate did not predict the thing it certified. Across 88 (song,
axis) cells with at least one repeated section, the correlation between an
axis's gate score and how much its literal repeats actually agreed was -0.070.
The highest-scoring axes were among the worst: mizhiyoram's warm/cold gated at
1.90 and its repeats disagree more than unrelated sections do. On shootout, two
sections the file itself marks as the same music read opposite signs on all
seven axes.

Two of the seven were also degenerate before any music was played. In the text
tower, warm and cold sit at cosine 0.824 and spacious and claustrophobic at
0.754, against 0.247 for bright and dark -- and since the projection is exactly
the dot product with the difference of the two anchors, a short axis is a
compressed dynamic range with the same audio-side noise on it. Of the rest,
calm_vs_aggressive correlates with no per-bar lane above 0.11, and
spacious_vs_claustrophobic correlates with `brightness` at -0.51, which is a
brightness meter under a spatial name.

The model is still in the file. `sections[].also_heard` is MuQ reading the same
audio for boundaries, and that one does beat its control: 1.41x over matched
random bars, p = 3e-05. Boundaries are a thing this model can be checked on.
Affect is not, and there is no second method here to check it against.

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

## `tension` was not tension, and a rig driving brightness off it inverts

The field is now **`lift`**. The protocol sends `tension` beside it, the same
object, for one release, because readers were built against that name.

What it computes is `0.45 * clip(brightness - bass) + 0.55 * (brightness rising
over eight beats)` -- high-band presence that the low end is not backing, and
climbing. That is a real and specific texture. It is not tension. Reproduced
from `bars.brightness` and the bass envelope it comes back at r = 1.000 across
28 songs, and its correlation with `intensity` is +0.014.

By section, mean z: pre-chorus +0.14, post-chorus +0.12, build +0.11, solo
+0.11, verse +0.07, chorus -0.00, drop -0.08, intro -0.37, outro -0.94. Read
charitably that is the right shape for tension -- highest in the run-up,
released at the drop. Tested directly it does not earn the word: over 70
drop and chorus entries the four bars before are higher than the four bars after
on 40 of them (57%), and against random bars in the same song the run-up sits
+0.15 z with p = 0.17. It leans the right way and cannot be shown to do more.

The practical point is the one Alnas hit. `tension` invites a rig to map it to
brightness, and a rig that does goes bright in the verse and dark at the drop.
`lift` says what it is: a texture that thins out, not a wind-up you can trust.

## What the music is doing, which is not how loud it is

`motion` answers the question a lighting desk actually asks: is this lifting,
holding, or falling away. It carries `moving`, one of `rising`, `steady` or
`falling` per bar, read off the loudness curve with two bars of hysteresis so it
reports a settled state rather than every wobble, plus `tells`, `slams` and
`ebbs`.

The labels are true. Against BS.1770 loudness measured independently from the
stereo file, bars marked `rising` run at +0.46 LU/bar and `falling` at -1.00,
rank-biserial +0.62. But the *changes* carry nothing: 20.1% of them land within
two bars of a MuQ boundary against 22.4% for a matched circular-shift control.
Read a `motion` state; do not treat a state change as an event.

The hysteresis had a defect worth naming because it is easy to write again. The
run counter incremented on any disagreement with the current state rather than
on a run of the same candidate, so `rising` followed by `falling` -- two samples
that contradict each other -- flipped a settled state. 215 of 779 flips in the
library were fired that way. It now counts agreement with the candidate.

Two fields are gone from `motion`. `spans` was a bit-exact run-length encoding
of `moving` in 29 songs out of 29, and a reader that wants runs can make them.
`winding` was `0.7 * (1 - floor) + 0.3 * noisy`, recomputable from the two lanes
it names to within 0.002 on 29 of 29. This spec already said the honest thing
about it -- that it does not beat reading the energy curve upside down -- and
kept it for ergonomics. Re-measured, plain inverted energy is about three
percentile points *ahead*, because the published comparison had smoothed the
baseline and not the contender. A field that loses to a lane already in the file
and is computable from two other lanes in the file is not carrying its weight.

What is real is the observation, not the lane. Energy is not merely
uninformative before a drop, it is reliably *low* -- four bars before Don't Look
Down's drop the energy curve reads 0.24, 0.24, 0.20, while air climbs to 1.02
and floor collapses from 0.31 to 0.06. A reader keying a build off `energy`
without inverting it will fade down into the drop. That is the finding; it is
`floor` and `air` that carry it, and both ship.

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

## Three fields that were one field twice

`phrase_grid.boundaries_on_grid` claimed the song's sections land on the phrase
grid. It equalled `every_bars != 4` on 29 songs out of 29 -- true on all ten
songs with an 8- or 16-bar grid, false on all nineteen with a 4-bar one -- which
is no information beyond a field sitting next to it in the same object. As an
honesty flag it also pointed the wrong way: MuQ novelty peaks land on the
declared grid 26.4% of the time when it says True and 31.4% when it says False.
Gone from the score and from both formatters. `every_bars` and `from_bar` stay,
and those do earn their place -- novelty peaks hit the declared origin 29.7%
against 18.4% for the other origins of the same step, and slams 36.4% against
17.9%.

`phrases[].sure` graded the word in `doing`. Five of the ten words emitted
exactly one value ever -- `resolving` always 0.800, `establishing` always 0.850,
`expanding`, `thinning` and `closing` always 0.950 -- so for half the worded
phrases the number was fixed by the word and said nothing about this phrase.
Another 174 phrases carry `doing: null` and shipped a `sure` anyway: a
confidence in a word that was suppressed. On the two words where it does vary it
does not separate right from wrong -- phrases the audio agrees with score 86.7%
at `sure` 1.0 and 82.5% below it, p = 0.58. Gone.

`phrases[].has_break` is covered below.

## A dropout is a bar, not a flag

`phrases[].has_break` said a phrase contained "a bar out, then back" and nothing
else -- not which bar, not how long, not what kept playing. Alnas had to recover
them from energy dips with a threshold of his own, which is work the file should
have done. The detector already knew: it finds the quietest bar in the phrase,
checks it against 40% of the phrase median, and then threw the index away.

`phrases[].break` now carries `from_bar`, `to_bar`, `bars`, `still` -- the stems
that keep going -- plus `deepest` and `depth` for the stem that falls furthest
and how far. The score no longer carries `has_break`: across 608 phrases it was
exactly `break != null`, the same fact spelled twice, and two spellings of one
fact are two things that can drift apart. The protocol still sends it, derived
from `break` at format time, so nothing that reads it breaks.

`depth` is the weak part of this. It reads 0.976 at the median and sits above
0.80 on two thirds of breaks, and against the mix RMS drop it is supposed to
describe it correlates at r = 0.38. Read `break` as "a stem went quiet here, and
`deepest` names it"; do not read `depth` as how quiet. `still` holds for drums
-- breaks naming drums as still lose 3.40 dB of percussive energy against 11.49
dB otherwise, p = 1.2e-05 -- and does not hold for vocals, where words carried
through the dip are the same either way (p = 0.77).

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

## Which languages the words can be trusted in

Twenty-three of twenty-eight songs carry `lyrics`. They are not equally good and
`lyrics.sure` -- how much two independent transcription passes agreed -- is what
separates them. Read it before showing a word to anybody.

English works: Don't Look Down 0.85, Language 0.75, Where Are U Now 0.72,
Starlight and The Nights 0.61. Hindi works: Arz Kiya Hai reaches 0.44 with its
vowel signs intact.

Malayalam, Tamil and Telugu do not. Nebulakal reads 0.18, Mizhiyoram 0.05,
Ponni Nadhi 0.12, Entharo Mahanu 0.10. The failure is not transcription quality
but script: Qwen3-ASR has no Malayalam, Tamil or Telugu, so it forces the sound
into Devanagari and calls it Hindi, or into Latin and calls it Chinese. Ponni
Nadhi is Tamil written in Devanagari. Two passes over the same audio then
disagree almost entirely, which is why `sure` collapses -- the number is doing
its job.

Below about 0.3 the words are not words. IndicWhisper or Sarvam is the fix and
neither is wired in.

One bug worth naming because it hid all of this. The forced aligner returns
per-word text with every combining mark stripped, so Devanagari arrived as bare
consonants -- "कनम वमनम करल यदध" where the transcript said "देखो नौकुंपों मानो राजमा".
English has no combining marks and was never affected, which is why the pipeline
looked fine. The words now take their spelling from the transcript and their
timing from the aligner.

## Where bar N actually starts

This cost most of a night, so it is written down. A score's bar N starts at
`bar_edges(g)[N]`, and for the twenty-three songs that open on a pickup that is
`at_beat(g, (N - 1) * beats_per_bar)`, **not** `at_beat(g, N * beats_per_bar)`.
The pickup is bar 0 and it is shorter than a bar, so every later bar is one
multiple of the beat count behind what the naive formula gives.

Afterglow's bar 16 begins at 20.92 s. The naive formula says 22.30 s, exactly
one bar late. The page has always drawn it correctly; a diagnostic written
against the naive formula reported every section a bar later than the file
actually places it, which made a real one-bar error look like an argument about
numbering conventions for several hours.

If you are checking a boundary against your ears, take the time from
`bar_edges`, or from `sections[].from` through a formatter, and never rebuild it
from the bar number with a multiplication.

## The bass names the bar

When several stems switch within a bar or two of each other, something has to
choose which bar the section starts on. That choice was "the lowest number",
which is not a reason.

Amal listened to ten boundaries where the stems disagree and said which bar the
change is on. With three he had already confirmed on Afterglow that is thirteen
boundaries of ground truth, and it settles what no internal referee could: on
those thirteen, asking each stem how often it names the confirmed bar when it
votes at all gives

    bass    9 of 11   82%        other   1 of 4   25%
    vocals  3 of 4    75%        guitar  1 of 5   20%
                                 drums   1 of 8   12%

against about 33% for a lane guessing among the candidates. Bass at 82% and
drums at 12% is not a tie-break dressed up: drummers fill *into* a change and
land after it, bass lands on the downbeat of the new section. A bin now takes
the bar the bass names whenever the bass names one, and falls back to the bar
most of the group named.

Both measures agree, which is the reason to believe it. Boundaries landing on
the confirmed bar went 7 of 13 to 11 of 13, and the independent movement referee
-- the bar with the largest change across all lanes -- went from 48% exact to
51%, mean offset +0.09 to +0.00, mean absolute 0.75 to 0.70.

The two it still misses are honest. Levels bar 69 has no bass vote at all, and
The Nights bar 41 is one of the two where the bass is itself wrong.

Four earlier attempts at this failed and are recorded so nobody repeats them:
removing the backward walk in switches(), sharpening the bar with the bassline
returning, feeding six stems to the detector (which fixed one song and was
neutral across the library), and taking the most-voted lane bar (which
overshot Afterglow's breakdown to 58). Picking the bar with the largest lane
movement was never tried, because that is the rule the referee scores with and
it would have proved nothing.

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

`grid.sure` used to compare the two beat trackers' **input** to each other. It
does not any more: it scores the grid that actually ships against the second
tracker, which is what the field always claimed. The difference matters. Nine
of twenty-nine grids fail an independent onset referee that their own tracker
passes -- the tracker is right and the least-squares fit taken from it is not --
and the old number could not see any of them. The Feeling read **0.816** while
1.6% of its tracked beats landed on its own grid; it now reads 0.004. Across the
library the gap between grids that pass the referee and grids that fail it went
from 0.19 to 0.58. Under about 0.35, do not trust a bar number on that song.

Three of those nine were repaired rather than flagged. `ladder()` built the
tempo map by accumulating beats from the previous segment's period and threw
away each segment's own measured anchor, so one spurious segment moved the phase
of everything after it. Each segment now re-anchors on its own measurement with
the beat count kept continuous, and Experience, Nod Krai and Raga of Revenge
come back. Six still fail: The Feeling, which was fitted from 44% of the song
and extrapolated across the rest, and Apex, Cipher, Entharo Mahanu and the two
Where Are U Nows, which look like a metrical-level pick. Those are not fixed.
They are now declared.

`parts[].sure` is the silhouette of the `like` grouping -- how cleanly a section
sits inside the group it was assigned to, rather than how likely its label is to
be correct, and not a confidence in the boundary either. It used to grade a
second grouping, `repeats_as`, which no longer ships.

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
