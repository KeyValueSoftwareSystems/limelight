# Limelight — measurement lane

Agent context. Read this fully before your first tool call. Human brief: `START-HERE.html`.

## What this project is

We are building a file format that describes what a piece of music **does** — where the beats
are, where it changes character, where it lifts, where it stops — plus the software to produce
that file from audio and to read it back into anything.

Lighting is the first reader and the demo, **not** the product. A video editor, a rhythm game, a
fitness app and a drone show read the same file. If a proposed field would only make sense to a
lighting rig, it does not belong in the map.

KeyCode is Friday 18 September 2026. Today is 2 September 2026.

## The five words. The set is closed.

| word | answers | who owns it |
|---|---|---|
| **map** | what is the *music* doing? | Amal |
| **layout** | what is *in the room*? | Nikitha |
| **wiring** | how is it *connected*? | Alnas |
| **recipe** | what should a *moment look like*? | Renjith |
| **frame** | so *what is lit right now*? | Dheeraj |

```
frame = f(map, layout, recipe, t)     then     bytes = wire(frame, wiring)
```

## This lane's job

**Nobody else in this project can tell whether it is working.** That is the job.

Amal produces maps. Renjith decides what is true and what is beautiful. You build the instruments
that turn both of those into evidence, and you keep them honest. Concretely:

| instrument | what it answers | state |
|---|---|---|
| `bench/bench.py` | is this map correct? | v0 exists. **Yours now** |
| a population runner | is the *system* getting better, across songs and levels? | not built |
| a run record | better than *what*, exactly? | not built |
| a regression alarm | did improving level 1 break level 3? | not built |
| a taste gate | is this *better*, when correctness is not the question? | not built |
| a calibration check | does `confidence` predict anything? | not built |
| a tapping tool | can truth be made in fifteen minutes instead of an hour? | not built. **Highest leverage** |

You do not build models and you do not write truth files. You build the things that make both
falsifiable.

## Rules — these override your defaults

1. **Do not change a tolerance to make a number look better.** This is the one form of cheating
   the bench cannot detect, and you are the person best placed to do it. Every tolerance in
   `bench/README.md` has a stated reason; argue it in the open, before an experiment, never after
   seeing a result.
2. **A refusal and a zero are different facts.** A malformed map must be reported as unscored, not
   as a low score. Validate before you score, always.
3. **Never write or edit a file under `truth/` labelled `"how": "truth"`.** Truth is made by a
   human with audio playing. You build the tool; Renjith uses it.
4. **A number without a run record is not a result.** Store what code, what map version, what
   tolerances, what date. "It got better" is unfalsifiable without this.
5. **Never invent a timestamp.** Not to fill a template, not to make a fixture. `null` is a
   legitimate answer worth more than a guess.
6. **The synthetic cohort and stand-in truth files are for testing tooling only.** No number
   derived from them may be quoted to anyone as a result.
7. **No audio in the repo, ever.** No model weights either — `HF_HOME` and `TORCH_HOME` outside
   the repo, on a disk with room.
8. **Time is always seconds**, decimal, from the start of the song.
9. **Clocks come from the audio device, never from `time.time()`.** In a tapping tool this is not
   a nicety: wall-clock timestamps drift against the audio and skew every truth file you help
   produce, systematically and invisibly. Use the audio callback time or `<audio>.currentTime`.
10. **Propose new map fields to Renjith; do not add them.** The vocabulary is closed at five words
    and the map at nine fields for a reason.

## Commands

```bash
python3 bench/selftest.py                    eleven deliberate breakages. Start here
python3 bench/bench.py <truth> <candidate>   score one pair
python3 bench/bench.py <truth> <candidate> --json
python3 validate.py <map>                    legal? (not: correct?)
```

## What is in here

```
CLAUDE.md                     this file
START-HERE.html               the human brief: the six instruments, with pass bars
bench/bench.py                v0 scorer. You own it from now on
bench/selftest.py             breaks one map eleven ways, checks the bench notices
validate.py                   schema and sanity
cohort/                       12 synthetic candidates at 4 graded tiers, 3 stand-in truths
cohort/EXPECTED.md            the five facts your aggregation must recover. Read it last
contracts/MAP.md              what a map is. What you are measuring
contracts/WORDS.md            the five words
contracts/FRAME.md            RECIPE.md   layout.json   the reader side, for context
maps/sketch/*.map.json        three well-formed maps
truth/PROTOCOL.md             how truth is made -- the process your tapping tool must serve
example/                      a mediocre candidate and its report. Four planted lessons
LEVELS.md                     the curriculum. Track the bench per level, not just in total
GPU.md                        2x L40S
```

## The one thing that is easy to get wrong

Measurement work drifts toward what is easy to measure. Beat F-measure is easy, so it gets
polished; span shape and `holds` accuracy are awkward, so they get skipped — and those are the
two that a room makes obvious. Keep the awkward metrics in the report even when they are ugly,
and resist adding a single headline number that hides them.

Numbers also cannot grade beauty. That is why the taste gate is on your list and not optional:
two versions of the same fifteen seconds, which is better, logged. "Rate this out of ten" is a
question humans answer badly; "which of these two" is one they answer reliably.
