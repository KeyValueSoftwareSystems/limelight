# Limelight — analysis lane

Agent context. Read this fully before your first tool call. Human brief: `START-HERE.html`.

## What this project is

We are building a file format that describes what a piece of music **does** — where the beats
are, where it changes character, where it lifts, where it stops — plus the software to produce
that file from audio and to read it back into anything.

Lighting is the first reader and the demo, **not** the product. A video editor, a rhythm game,
a fitness app and a drone show all read the same file. If a proposed field would only make sense
to a lighting rig, it does not belong in the map.

Team hackathon: KeyCode, Friday 18 September 2026. Today is 2 September 2026.

## The five words. The set is closed.

| word | answers | who owns it |
|---|---|---|
| **map** | what is the *music* doing? | **this lane** |
| **layout** | what is *in the room*? | Nikitha |
| **wiring** | how is it *connected*? | Alnas |
| **recipe** | what should a *moment look like*? | Renjith |
| **frame** | so *what is lit right now*? | Dheeraj |

```
frame = f(map, layout, recipe, t)     then     bytes = wire(frame, wiring)
```

If you need a sixth word, say so out loud. It usually means something is designed wrong.

## This lane's job

**audio in, `map.json` out.** Nothing else. You never produce a frame, never touch a fixture,
never read `layout.json` except to understand who consumes your output.

Six things the map must carry, in `contracts/MAP.md`:

| field | shape | difficulty |
|---|---|---|
| `beats` | `[t, ...]` seconds | largely solved by existing trackers |
| `downbeats` | `[t, ...]`, a subset of `beats` | **a separate problem.** Do not derive by `beats[::4]` |
| `chapters` | `[{at, name}]` | self-similarity over beat-synchronous features |
| `moments` | `[{at, kind, ...}]` six kinds only | drops are easy, stops need `holds` measured |
| `spans` | `[{kind, from, to, rise}]` | **unsolved. The interesting one** |
| `energy` | `[[t, 0..1], ...]` one per downbeat | not loudness. See trap 3 |

## Rules — these override your defaults

1. **Never invent a timestamp.** Not to fill a template, not to make an example, not to unblock
   yourself. A guessed number is indistinguishable from a measured one once written, and it makes
   every bench result afterwards a lie that still prints. Write `null` and say why in `note`.
2. **Truth files are made by a human with audio playing.** You may never write, edit or extend a
   file under `truth/` that is labelled `"how": "truth"`. Read `truth/PROTOCOL.md`.
3. **Sketch and truth never mix.** Sketch maps live in `maps/sketch/` and carry
   `"how": "sketch"` with `confidence <= 0.5`. Do not copy a number from one into the other.
4. **No audio in the repo, ever.** Scores, never songs. Everyone brings their own local copies.
   Audio patterns are already gitignored; do not add exceptions.
5. **No model weights in the repo.** Set `HF_HOME` and `TORCH_HOME` outside the repo, on a disk
   with room. Check free space before your first download.
6. **Time is always seconds**, decimal, from the start. Never ms, bars, samples or frames.
7. **A field goes in when a reader breaks without it** — and a reader breaks when it cannot
   derive the fact from what it holds. Propose new fields to Renjith; do not add them.
8. **Do not change a bench tolerance.** Moving a tolerance to make a number look better is the
   one form of cheating the bench cannot detect. If a tolerance is wrong, argue it in the open,
   before the experiment, not after seeing the result.
9. **Do not grade your own model against truth you wrote.** Separation of powers is the point.
10. **Validate before you show anyone anything**: `python3 validate.py <map>`.

## Commands

```bash
python3 validate.py maps/sketch/*.json              # is it a legal map?
python3 bench/bench.py <truth> <candidate>          # three numbers
python3 bench/bench.py <truth> <candidate> --json   # machine-readable
python3 bench/selftest.py                           # does the bench measure what it claims?
```

Start with `selftest.py`. It breaks one map in eleven specific ways and prints what the bench
notices, so you learn what each metric is blind to before you trust it on a real model.

## What is in here

```
CLAUDE.md                             this file
START-HERE.html                       the human brief, with diagrams
contracts/MAP.md                      what you must produce. The contract
contracts/WORDS.md                    the five words
contracts/FRAME.md                    what Dheeraj produces from your map -- read once, to see who consumes you
contracts/RECIPE.md  layout.json      how a moment becomes light -- context only
maps/sketch/*.map.json                three well-formed maps. Your output shape reference
truth/PROTOCOL.md                     how a truth file is made
truth/truth.template.json             the blanks to fill, by hand, with audio
truth/the-nights.truth.synthetic.json a stand-in so the bench runs today. NOT a listening record
example/the-nights.candidate.json     a realistic mediocre first attempt
example/expected-report.txt           what the bench says about it. Read this closely
bench/bench.py                        the scorer. Sebastian owns this file from tomorrow
bench/selftest.py                     eleven deliberate breakages
validate.py                           schema and sanity checks
GPU.md                                2x L40S: what they buy, and why week one does not need them
LEVELS.md                             the curriculum. One new hard property per level
```

## Traps that have already cost someone a day

1. **Tempo octave errors.** A tracker locked to 63 BPM instead of 126 hits every beat it claims
   and looks perfect to the eye. `bench.py` prints an explicit octave warning; do not ignore it.
2. **Downbeats by indexing.** `beats[::4]` gives 98% beat accuracy and 10% downbeat accuracy the
   moment one beat is missed, because the bar phase drifts and never recovers. This exact failure
   is in `example/expected-report.txt`. Downbeat detection is its own model.
3. **Energy is not loudness.** A build can get quieter and still lift — layers arriving, a filter
   opening, pitch rising, density increasing. RMS alone calls the drop the peak and the build
   flat, which is the opposite of what a room needs.
4. **Correlation flatters energy.** A curve with strong structure scores r > 0.95 even with heavy
   noise added. Look at the shape, not the coefficient.
5. **Confidence must be honest.** The correction interface ranks by confidence, so a model that
   is confidently wrong is worse than one that abstains.
6. **`holds` is measured, not estimated.** A stop 300 ms short reads as a mistake in the room.
   The bench flags it as audible; nothing else will.

## Definition of done, per problem

Stated with pass bars in `START-HERE.html` §6. Short version: a legal map that Dheeraj's renderer
accepts, beats above 0.85 F on one song, chapters within 3 s and then 0.5 s, and spans that exist
at all — because nothing else in the pipeline can invent them.
