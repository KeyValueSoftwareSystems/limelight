# Driving your emulator from the map

Everything here is already in the repo. Nothing needs installing.

## The three files you need

| file | what it is |
| --- | --- |
| `synth/truth/levels.map.json` | the map: what the song does |
| `readers/lights/beat/layout.json` | the rig: five lamps in a row, and where they are |
| `readers/src/recipe_steps.js` | the reader: turns the two above into frames |

## Getting frames

```js
const RM = /* synth/room.js, evaluated with recipe_steps.js as RECIPE */;
const frame = RM.mkReader(map, layout, "medium", "garrix", 14);
frame(63.9);
// { t: 63.9, look: "step14", fixtures: [
//     { id: "par_1", level: 1, r: 255, g: 250, b: 242 }, ... ] }
```

`level` is 0..1, `r,g,b` are 0..255. Heads also carry `pan` and `tilt`, both 0..1
across the fixture's own range. It is a pure function of time: call it at any
instant, in any order, as often as you like. Nothing accumulates, so you can
scrub, join late, or render one frame for a screenshot.

The five arguments after the map are the rig, the energy (`low` / `medium` /
`high`), the colour set (`garrix`, `garrix-red`, `sunset`, `ice`, `neon`,
`amber`, `white`), and how far up the ladder to go (1-14).

## The ladder

The show is built in fourteen steps and each one adds exactly one thing, so you
can bring your emulator up gradually instead of debugging fourteen behaviours at
once. Pass the number as the fifth argument:

1 beats · 2 the bar · 3 position · 4 breathing · 5 loud and quiet · 6 the build ·
7 the drop · 8 colour · 9 drum hits · 10 instruments · 11 melody · 12 chords ·
13 restraint · 14 moving lamps

Start at 1. All five lamps flash on every beat and nothing else moves. If that is
not locked to the music on your rig, nothing above it will be.

**Rung 14 is the only one that uses the moving heads.** Use
`readers/lights/small/layout.json` for it; `beat/layout.json` has five lamps and
nothing else.

## Checking it without looking

```bash
node synth/ladder.js levels          # every rung, one song
node synth/ladder.js --solo levels   # each rung on its own, not stacked
node synth/ladder.js --parts levels  # and each part of the song separately
```

It exits non-zero if anything fails, so it can sit in front of a commit. Every
check is measured against the **recording**, not against the map, which is the
only reason a pass means anything.

Two things worth knowing about the numbers:

- `--solo` gives different answers to the stacked run and both are true. Melody
  reads 0.52 in the stack and 0.78 alone.
- "nothing to measure" is not a failure. A song with no chords written down
  cannot be judged on the chords rung and says so.

## Proving a check still works

`synth/maps/_broken-half-beat/` is Levels with the grid deliberately half a beat
late. Select it and rung 1 must go red. If it passes, the check has gone
circular — it is measuring the map against itself instead of against the audio,
which is the single most common way a check in this project has been wrong.

## Scoring a map in the browser

Open `/score`, drop your `.map.json` on the page, put your name in, press the
button. You get a bar per field, the sentence explaining each number, and where
you sit against everyone else.

Nothing is held back. Every check measures your map against the recording, so
there is no answer key to leak and no reason to keep the logic private -- a check
that could be gamed by reading it would be a check worth fixing rather than
hiding. Read `listen/evals/` if you want to know exactly what each one does.

There is one way to score well without doing the work: claim less. Put beats only
where the drum is unmistakable and every beat you claim will be right. That is
what the coverage number is for, and it is why the total uses both.

## Scoring a map from the command line

```bash
python3 listen/mapeval.py levels                     the answer map
python3 listen/mapeval.py levels --all               every map for that song, ranked
python3 listen/mapeval.py levels --map path/to.json  your own output
python3 listen/mapeval.py --every                    every song, every map
```

This scores the MAP, not the show, and no lights appear in it. Every field is
measured against the recording -- is the kick loud where you say the beats are, do
the notes of your chord carry energy at that bar, is your claimed pitch the
loudest one there, does the sound change where you say a part begins. Nothing is
compared against anybody else's map.

Three numbers come out. **Accuracy** is how right the fields you claimed are.
**Coverage** is how much of a map you filled in, because a file that claims
nothing was outscoring one that claims everything, and silence should not be a way
to win. And the **grid is a gate** rather than one field among eight: every other
timestamp is expressed in the grid's frame, so a map that cannot find the beat has
not described the song however well the rest reads. The deliberately-broken map
scores 0.08 for exactly that reason.

Results append to `synth/learning/mapeval.jsonl`, one line per run, so you can see
whether today's change actually helped rather than trusting that it did.

## Hearing what the map claims

```bash
python3 synth/audition.py levels chords --from 60 --for 30
```

Writes a file outside the repo: the song, quieted, with the map's own reading
sounded over it. If the map says a bar is C# minor you hear a C# minor triad
across it. Where two analysers disagree this is the only judge that settles it.
