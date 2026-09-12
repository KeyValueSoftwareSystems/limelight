# What else the protocol could hand out

The pipeline measures far more than the protocol lets an app ask for. Today a
consumer can request seven things — `grid`, `beats`, `downbeats`, `sections`,
`energy`, `moments`, `layers` — while the score file carries about forty
measured facts. This is the list of what is worth adding, why a consumer wants
it, and where the work actually is.

## The rules any new field has to keep

These are not style preferences. Each one exists because breaking it has
already cost us a day.

A position is `{bar, beat}`, never a number of seconds. Seconds stop being true
the moment the tempo moves, and they cannot be compared between two songs.
Anything in the score stored as `_s` has to be converted on the way out.

Every per-bar array states the bar it starts from. Bar numbering starts at 0 on
some songs and 1 on others, and a reader that assumes either is a bar wrong on
half the catalogue.

A gap stays a gap. Where the pipeline measured nothing it writes null, and null
must survive to the consumer. A zero is a measurement; a null is an admission.

A field nobody asked for is not sent, `grid` is sent whether asked or not, the
response says which version answered, and a window clips without renumbering.
Those four already hold and should keep holding.

No word in any of this may belong to one kind of reader. The score says a
section is `silence`; it does not say `blackout`.

---

## Group A — facts about the whole song

Cheap, constant for the track, fetched once. These are the fields that stop
every song looking the same, because they let a reader normalise itself against
the record rather than against an absolute.

**`key`** — `{root, scale, confidence, tuned_to_hz}`
The key and whether we believe it. A reader can map a palette to it, a game can
pick note sounds that are in tune with the track, and `tuned_to_hz` catches
records that are not at A440 and would otherwise sound sour against anything we
generate.

**`chord_summary`** — `{root, scale, confidence, changes_per_beat}`
Harmonic rhythm. `changes_per_beat` is the useful one: it separates a track that
sits on one chord for eight bars from one that moves every beat, which is the
difference between a slow wash and something that has to keep up.

**`loudness`** — `{integrated_lufs, range_lu, dynamic_complexity}`
How loud the record is overall and how much room it has. This is the field that
fixes "the quiet song never lights up and the loud song is pinned at maximum",
because it lets a reader scale its response to the record rather than to an
absolute level.

**`feel`** — `{danceability, onsets_per_second}`
Two numbers that describe how busy and how danceable the track is. Useful for
picking an overall treatment before a single bar has played.

**`song`** — `{length_s, bars}`
Length and bar count. Already implied by the grid, but a consumer that wants to
size a progress bar or preallocate a buffer should not have to derive it.

---

## Group B — honesty about the grid

**`grid.holds_from` / `grid.holds_to`** — positions, or null
The score already records the span over which the grid was actually fitted, in
seconds, as `holds_from_s` and `holds_to_s`. Outside that span the bar lines are
extrapolated rather than measured. This matters more than it sounds: one song in
the library has a grid that only holds from 37 seconds in, and its first
eighteen bars are a guess. A consumer has no way to know that today.

Convert both to positions and send them inside `grid`. A reader can then decide
to be careful early rather than confident and wrong.

---

## Group C — the per-bar curves

One number per bar, the same shape as `energy` already has. The score carries
nine of these and the protocol exposes one.

Ask for them by name so nobody receives nine arrays to use two:

```json
{ "fields": ["curves"], "curves": ["brightness", "air"] }
```

and get back `{ curves: { brightness: { per: "bar", from_bar: 0, values: [...] } } }`.

| name | what it measures | why a reader wants it |
|---|---|---|
| `energy` | loudness per bar | already exposed as `energy`; fold it in here too |
| `brightness` | how bright the bar sounds | maps to colour temperature, or to how sharp a visual reads |
| `width` | how wide the stereo image is | a narrow mono verse and a wide chorus are a real, visible difference |
| `air` | high-frequency openness | the difference between a filtered build and an open drop, which energy alone misses |
| `pump` | how much the track ducks against the kick | this is the four-to-the-floor breathing that makes dance music feel like dance music |
| `pace` | how many events per bar | busy-ness, independent of loudness: a quiet fast passage is not a quiet slow one |

The four stem lanes — `drums`, `bass`, `vocals`, `other` — are also per-bar
numbers, but they are a large enough subject on their own that they have a
section below.

Note for the implementation: these arrays contain nulls where a bar could not be
measured, and the nulls must survive.

---

## Group C2 — the stems, which are worth a section of their own

Every song is separated into drums, bass, vocals and other before anything else
is measured. Four of the most useful facts in the score come out of that, and
one of the nastiest traps does too.

### What is already in the file

`bars.drums`, `bars.bass`, `bars.vocals`, `bars.other` are one level per bar per
stem. `parts[].playing` is the list of stems that are in for a section, and
`parts[].stems` gives each one a state — `none`, `some` or `full` — and a level.

### The trap, which has to be stated in the response

**These levels are not absolute and cannot be compared across stems or across
songs.** Each lane is divided by its own loudest bar in that song, so
`bars.drums` at 0.8 means "eighty per cent of this song's loudest drum bar". It
does not mean the drums are at eighty per cent, and it does not tell you whether
the drums are louder than the bass.

Worse, `parts[].stems[].level` is normalised a second, different way — as a
share of the tenth-to-ninetieth percentile range of the same lane. So two fields
that look like the same measurement on the same stem are on two different
scales.

Whatever we do here, the response must say which scale a number is on. My
preference is to send it as a stated field rather than a convention somebody has
to remember:

```json
{ "stems": { "normalised": "per-stem-peak-within-song",
             "from_bar": 0,
             "lanes": { "drums": [...], "bass": [...] } } }
```

A reader that wants to ask "are the drums louder than the bass" cannot answer it
from what we have, and should be told that rather than left to infer a wrong
answer from numbers that look comparable.

### New fields worth adding

**`stems`** — the four per-bar lanes, requested by name like the curves, with
the normalisation stated. This is the field most readers actually want.

**`layers.presence`** — the `none` / `some` / `full` states turned into spans,
so a consumer can ask "is the voice in right now" and "when does it come back"
rather than scanning an array. This is the single most requested thing that
currently cannot be expressed, and it is already measured per section.

**`melody`** — this one is genuinely new. The pipeline already runs a pitch
tracker over the separated vocal, at a hundred readings a second between 65 and
1200 Hz, and caches the result. It is used only to notice held notes, and then
thrown away. That is the vocal line: the tune. Published as a contour against
musical position it would let a reader follow the melody rather than the volume,
which is a different and much better-looking thing. It should carry its own
confidence, and null wherever there is no voice.

**`made_by.voice_from`** — provenance, and not a nicety. The vocal lane is
produced by a better separator when it is available on the machine, and by the
general one when it is not, so vocal quality varies from song to song in a way
nothing records in the file. A reader leaning hard on the vocal lane deserves to
know which one it got.

### What we cannot offer, and should not pretend to

The separated stem audio is deleted as soon as the level envelope has been taken
from it. Only the envelope survives. So the protocol cannot offer stem playback,
muting or remixing without re-running the separation, and we should not design
anything that assumes it can.

There is also a resolution question worth putting to Amal. The envelopes are
measured at a hundred readings a second and the score keeps one number per bar,
which throws away almost all of it. A per-beat version would cost little and
would matter to anything reacting inside a bar — which is most things.

## Group D — harmony over time

**`harmony`** — per-bar `{from_bar, chords: [...], confidence: [...]}`
The chord for each bar and how sure we are. Already measured, never exposed.

**`chord_changes`** — a list of `{at: {bar, beat}, to, confidence}`
Where the chord actually changes. This is the one to build first. A hundred and
twenty-three bars of chord names is a lot of payload to discover fourteen
changes in, and a change is what a reader wants to respond to.

---

## Group E — the pulse, finer than a beat list

**`beats` should carry position and deviation.**
Today `beats` goes out as `{t, downbeat, weight, sure}` where `t` is seconds —
which breaks the first rule. Each beat should carry `{bar, beat, weight, sure,
off_ms}`.

`off_ms` is new and is the interesting one: how far the beat we actually heard
sits from where the grid says it should be. The grid is a model of a performance,
and on anything not made to a click the two differ. A reader that wants to lock
to the performance rather than to the model needs that number, and today nobody
can see it.

`weight` — how hard the beat was hit — and `sure` — how confident we are it is
a beat at all — are already measured and already sent. Keep them.

**`tension`** — `{per: "beat", from_bar, from_beat, values: [...]}`
A per-beat curve of how much the music is winding up. This is the single most
useful thing on the list for anything that wants to build toward a moment
instead of reacting after one, and it is measured today and thrown away.

**`releases`** — `[{at: {bar, beat}, size}]`
Where the tension lets go, and how big the letting-go is. These exist in the
score as `at_s` in seconds and currently get folded into `moments` as a generic
drop. They deserve to be first class, in positions, with their size intact.

---

## Group F — moments, with the fields that make them usable

`moments` is already exposed, but only as `{at, kind, size}`. The pipeline now
produces much more per moment and all of it is being dropped.

| field | what it is |
|---|---|
| `is` | the kind: entrance, exit, rise, change, hook, fill, transition, accent, highlight, pause, release |
| `what` | what it happened to: drums, bass, voice, chords, the band, the riff, a sweep |
| `sure` | how confident the measurement is |
| `weight` | how much this moment matters, 0 to 1 |
| `for_beats` | how long it lasts, where that applies |

**`weight` is the most valuable field in this entire document.** A song produces
hundreds of moments and a reader cannot spend a big gesture on all of them. With
a weight it can ask for the top twenty and spend properly; without one it either
reacts to everything or picks arbitrarily. It should also be a request filter:

```json
{ "fields": ["moments"], "moments": { "min_weight": 0.6 } }
```

`is` and `what` matter for the same reason: a reader that wants to respond only
when the voice enters can currently not express that.

---

## Group G — the layers that are measured but not emitted

**`layers.subsection`** — sparse spans inside a section
The pipeline now finds the stretches inside a section and says what each is
doing: establishing, developing, intensifying, peaking, sustaining, expanding,
thinning, easing, resolving, suspending, transitioning, closing. Each carries
`{from, to, in, in_nth, doing, also, says, energy, rise, playing, has_break}`,
where `says` is a plain sentence like "drums and bass in, voice out".

This is a genuinely new layer and probably the highest-value addition after
moment weight. A section tells you where you are; a subsection tells you what is
happening there. An eight-bar verse that is establishing and an eight-bar verse
that is intensifying should not get the same treatment, and today they do.

**`layers.presence`** — who is playing
From `parts[].stems` and the four per-bar stem lanes. Each part already records,
per stem, whether it is in and at what level. Emitted as a sparse layer this
answers "is the voice in right now", which is the question that everything
vocal-reactive needs and nothing can currently ask.

**`layers.phrase`** — the resolved rule
`{every_bars, from_bar, boundaries_on_grid}`, already computed per song. Amal
has offered to emit the resolved values rather than leaving them to be inferred,
which is the right call — inferring `from_bar` is exactly the bug that shifted
six songs by a bar. `boundaries_on_grid` is the honesty flag: it says whether
this song's sections actually land on the phrase grid, or whether the grid is a
model the song does not obey.

---

## Group H — sections, with what is already there

`sections` currently sends `{from, to, name, nth, like, returns, feels,
fullness}`. Three measured fields are still being dropped:

`rise` — whether the section builds across itself, which distinguishes a verse
that climbs from one that sits flat.

`playing` — which stems are in.

`stems` — per stem, whether it is in and at what level.

---

## Where each field comes from

Several of these are renamed on the way out, because the pipeline's names
describe how it measured something and the protocol's should describe what a
consumer is asking for. This is the mapping, so nobody has to guess.

| protocol field | score key | conversion needed |
|---|---|---|
| `song` | `song` | none |
| `key` | `key` | none |
| `chord_summary` | `chords` | rename only |
| `loudness` | `loudness` | none |
| `feel` | `feel` | none |
| `grid.holds_from` / `holds_to` | `grid.holds_from_s` / `holds_to_s` | seconds to position |
| `curves.*` | `bars.intensity`, `.brightness`, `.width`, `.air`, `.pump`, `.pace` | wrap each with `from_bar`; keep nulls |
| `harmony` | `bars.chord`, `bars.chord_sure` | pair them, state `from_bar` |
| `chord_changes` | derived from `bars.chord` | find the changes; index to position |
| `beats` | `beats` | add `bar`/`beat`; add `off_ms` against the grid; drop `t` |
| `tension` | `tension` | state `from_bar`/`from_beat` |
| `releases` | `releases` | `at_s` to position; keep `size` |
| `moments` | `moments` | `is`, `what`, `sure`, `weight`, `for_beats` all pass through |
| `layers.subsection` | `phrases` | `from_bar`/`to_bar` to `from`/`to` positions |
| `stems` | `bars.drums/bass/vocals/other` | wrap with `from_bar`; state the normalisation |
| `layers.presence` | `parts[].stems` (`is`: none/some/full) | states to spans |
| `melody` | not in the score; cached as `<slug>.pitch.npy` | publish as a contour with confidence |
| `made_by.voice_from` | pipeline report, not currently written out | pass through |
| `layers.phrase` | `phrase_grid` | none; emit resolved |
| `sections` | `parts` | add `rise`, `playing`, `stems` to what is already sent |

`score` and `version` are not fields — they already live in the response
envelope, and the envelope is where they belong.

## What I would build first

If this is more than fits in one version, the order I would take it in:

1. **`weight` on moments**, plus `is` and `what`. Cheapest change, largest
   effect, and it unblocks every reader from having to treat all moments alike.
2. **`layers.subsection`** and **`layers.presence`**. The biggest genuinely
   new things in the score, and presence answers the question readers ask most
   often and cannot currently phrase.
3. **`tension` and `releases` as positions.** Both measured, both discarded,
   both needed by anything that wants to anticipate rather than react.
4. **`grid.holds_from` / `holds_to`.** Small, and it is the difference between
   a reader knowing it is on guessed ground and not.
5. **`curves`**, with per-name selection.
6. **Group A**, the whole-song facts. Easy, and they are what stop every track
   being treated identically.
7. **`beats` with `off_ms`**, and the rest.

## Where the bugs will be

Three places, all the same bug in different clothes.

Anything stored in seconds — `releases[].at_s`, `grid.holds_from_s`, and
`beats[].t` — has to be converted to a position on the way out, and that
conversion has to read `grid.first_bar` rather than assume a base. Getting this
wrong is a whole-song one-bar error that nothing downstream will report.

Anywhere a default is applied, default on absence and never on falsiness. Bar 0
and beat 0 are real values, and `x || 1` reads both as missing. This has already
been found in four places.

Nulls in the per-bar arrays must not become zeros. A bar we could not measure
and a bar measured as silent are different facts, and a reader will treat them
differently if we let it.
