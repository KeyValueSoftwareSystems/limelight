# Limelight — agent instructions

Read this before touching anything. Then read the `AGENTS.md` in the directory you are working in.

## What this is

**A file that says what a song does.** One file per recording, holding where the beats fall, where
the bars begin, where the voice leaves and the drums take the room. A *reader* turns that file into
an art form — lighting is one, a drone show is another. The file is the product. The light show is
evidence it works.

The consequence that governs every decision: **the map must never contain a lighting word.** No
fixtures, no colours, no cues, no "strobe". The moment it does, it becomes a lighting file and the
drone reader stops making sense.

## Rules that do not bend

| # | Rule |
|---|---|
| 1 | **No audio in git, ever.** `*.wav`, `*.mp3`, `synth/out/`, `synth/incoming/` are ignored. We ship the generator, not the recording — `synth/compose.py` is 14 KB and writes every song identically on every machine. |
| 2 | **Never fill a field you did not measure.** `null` or empty is a legitimate answer and is worth more than a guess, because once a guess is written down nobody can tell it from a measurement. `synth/songs/01-pulse.map.json` has empty `downbeats` for exactly this reason. |
| 3 | **`moments` has exactly six kinds** — build, drop, stop, quiet, spotlight, return. It is the interface tier and a one-way door. Anything else goes in `observations.*`, which is append-only and which readers ignore when they do not recognise it. `validate.py` enforces this. |
| 4 | **A field enters the interface tier only when a reader breaks without it.** Not when a fact is interesting. `stems` and `accents` both earned their place by a reader failing. |
| 5 | **Safety lives in the layout, never in the recipe.** Strobes cap at `layout.limits.max_strobe_hz`. Lasers stay above 3.0 m — a hard floor, not a preference. No audience scanning. A blackout must survive the engine crashing. |
| 6 | **Time is always seconds**, decimal, from the start. Never ms, bars, samples or frames. |
| 7 | **A reader ignores fields it does not recognise, and survives fields that are absent.** `en()` once crashed on a map with no energy curve; that was a bug in the reader, not in the map. |
| 8 | **One writer per fact.** Two lanes computing the same number will eventually disagree, and then both are suspect. |

## Provenance — the `how` field is the safety mechanism

`made_by.how` is a closed set and it is the only thing standing between a measurement and a guess
wearing its clothes.

| `how` | meaning | usable as truth? |
|---|---|---|
| `truth` | a human, with the audio playing (`truth/PROTOCOL.md`) | yes, the authority |
| `synthetic` | the times are **causes** — audio was rendered from this map | yes, within its limits |
| `model` | a listener measured it from a recording | no, this is what gets graded |
| `hand-written` | a human typed times they believe | no |
| `sketch` | a guess, quarantined in `maps/sketch/`, confidence ≤ 0.5 | never |

Synthetic truth can only test what we can already name. It cannot validate the learned tier.

## The one rule that makes readers testable

```
frame = f(map, layout, recipe, t)        then        bytes = wire(frame, wiring)
```

Ask for `t = 47` twice, get identical bytes. Ask for `t = 47` without playing the first 47 seconds,
still get the right answer. That is what allows scrubbing, late join, golden-frame tests, and
rendering the same map twice to price a mistake. It costs something real: **an effect cannot be a
state machine.** Not "on the beat, start a fade" but "brightness = f(position in the beat)". The map
is the history; "when was the last beat" is a lookup, never a memory.

## Layout

| path | what |
|---|---|
| `synth/` | the playground: composes songs, scores listeners, serves the portal |
| `synth/compose.py` | the ten songs. Map authored first, audio rendered from it, map measured back out |
| `synth/import.py` | bring in a song a human wrote, without losing the answer sheet |
| `synth/serve.py` | the portal on 127.0.0.1:8770 |
| `listen/` | audio → map. **Parked** for the hackathon; the ladder remains as the way to prove it later |
| `readers/src/` | the sources `limelight.html` is built from. Edit these, not the built file |
| `readers/lights/` | the lighting reader: `FRAME.md` is the contract, `wire.js` is frame → DMX, `calibrate.js` commissions a rig |
| `readers/lights/pack/` | golden frames, **generated** by `make.js`, never hand-kept |
| `readers/drones/` | the second reader. Its existence is the proof the map is not a lighting format |
| `maps/model/` | measured maps. `maps/sketch/` holds guesses and is never mixed in |
| `truth/` | human listening records. **Never write a file here labelled `how: truth`** |
| `bench/bench.py` | the scorer. Tolerances are fixed and moving one to make a number look better is the one form of cheating it cannot detect |

## Verify a change

Run what your change can affect. All stdlib or node, no install.

```
python3 validate.py synth/songs/*.map.json     # every map is well-formed
python3 synth/compose.py                        # regenerate the ten songs (~90s)
python3 synth/loop.py                           # score the listener against all ten
node readers/lights/pack/make.js                # regenerate golden frames
node readers/src/apptest.js                     # all three readers draw, headless
node readers/src/smooth.js                      # per-frame deltas and head slew vs declared limits
```

`readers/src/smooth.js` is the physics check: it reads the layout's own declared limits rather than
a hardcoded tolerance, so a wrong layout produces a green test. Check the layout too.

## Mistakes already made — do not repeat them

- **Circular verification.** A beat grid was checked against the tracker that produced it, using the
  same features, and 9 ms of agreement was reported as accuracy. It measured nothing. The real error
  was 75 ms and a human ear found it. Never grade a thing against its own output.
- **Grading against a reference nobody can vouch for.** The Nights' structure is disputed by six
  methods and one moment in it has been verified. It is the final exam, not something to build
  against.
- **A whole-song average hides everything local.** Removing `sections`, `stems` and `accents` costs
  almost nothing on a mean and changes the show completely at specific moments. Score per moment.
- **Silent failures cost more than ugly ones.** Two pages rendered blank instead of showing an error;
  both times it cost an hour. Surface the error.
- **Schema drift between writer and reader.** `loop.py` gained a column, `serve.py` still indexed the
  old one by name, and the portal went blank. Read by name and tolerate a moved schema.
- **A regex with `.*?` runs past the end of the thing you are editing.** Editing song 04 matched song
  05's tempo and corrupted it. Slice first, then match.
- **Hard-coding a name in two places.** Renaming a song broke the rooms page. Discover from disk.
- **Widening a one-way door.** A seventh moment kind was added and `validate.py` correctly refused it.

## Who owns what

| lane | owner |
|---|---|
| frame generation — map + layout + t → what every light does | Dheeraj, with Amal and Sebastian |
| hardware — frame → bytes → fixtures | Alnas |
| the emulator and how all of it looks | Nikitha |
| the songs and their answer sheets | Renjith |
| audio → map | parked |
