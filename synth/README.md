# synth — ground truth we caused

Every accuracy number in this project used to be self-consistency. A beat grid was once
"verified" against the tracker that produced it, using the same features, and 9.1 ms of agreement
was reported as though it meant something. It measured nothing. The real error was 75 ms and a
human ear found it.

So the pipeline runs backwards here. **Author the map first, render audio from it, then ask a
listener to recover the map.** The authored map is ground truth because it is the *cause* of the
audio rather than an observation of it, which makes every disagreement attributable with no
argument available.

```
python3 synth/loop.py                                 # score the baseline on dev cases
python3 synth/loop.py --all                            # include held-out cases
python3 synth/loop.py --listener "python3 mine.py"     # score your own
```

## The listener contract

A command line, not a Python import, so a listener can be written in anything. It receives a WAV
path as its last argument and writes a map to stdout. That is the whole interface.

```
python3 listen/baseline.py synth/out/02-kick-hat.wav > cand.json
```

## The cases are our bugs, not a wishlist

| case | what it is | what it catches |
|---|---|---|
| `01-metronome` | identical clicks, 120 bpm, phase 0.500 | phase recovery. The tempo octave is **undetermined by design** — 60 bpm is a perfect subset of 120 and no accent exists to break the tie, so this asks whether a listener reports the ambiguity or guesses. No bar cue either: downbeats reported here are invented |
| `02-kick-hat` | kick on 1 and 3, hat on 2 and 4, 126.4 bpm, phase 0.317 | a hop size that can only represent round tempi. This is the 123.05-for-126 bug |
| `03-offbeat-hats` | kick on downbeats, hats on every eighth-note offbeat, 124 bpm | the 75 ms bug. Full-band onset energy is dominated by the hats, so a naive fit locks half a subdivision early |
| `04-octave-trap` | kick every other beat, hats a sixth as loud between, 126 bpm | the half-tempo lock. **Held out** — excluded unless you pass `--all` |

Held-out cases are excluded by default because tuning against every case produces a listener that
passes this suite and fails on music. One number stays un-optimised on purpose, and it is the one
worth believing.

## The renderer proves itself

If `render.py` placed a kick 5 ms from where the map declares it, the ground truth would be
corrupt and every number measured against it afterwards would be a confident lie that still
prints. So it locates every authored event in its own output, per event against a local floor,
by a method that shares nothing with the listener under test — a transient in near-silence has an
unambiguous onset. Placement holds to **1.0 ms worst case against a 2 ms tolerance**, and
re-rendering is byte-identical because the hat uses a seeded generator rather than randomness.

`loop.py` refuses to score any case whose render does not verify.

## What the baseline scores, and why it is wrong

`listen/baseline.py` is committed as a floor to beat, not as a good answer. It measures full-band
energy flux and takes the highest-scoring comb — the two choices that produced this project's real
bugs. On its first honest run:

```
  case                beats F  grid err      bpm  downbeat F  octave
  01-metronome          0.667     4.0ms    60.00       0.000    half
  02-kick-hat           0.658     1.0ms    63.20       0.700    half
  03-offbeat-hats       0.000   238.0ms    62.00       0.000      ok
  04-octave-trap        0.658     4.0ms    63.00       0.632    half   [held out]
```

Three distinct failures, all real. It halves the tempo on three cases out of four, because scoring
a grid by *mean* flux per beat rewards a sparse grid that hits only the loud events — the division
in `comb()` is where the tempo octave error lives. It lands 238 ms out on case 03, which is half a
beat, because the hats carry more full-band energy than the kick. And it reports downbeats on case
01 where the audio contains no bar cue at all.

Phase, notably, it gets right to within 4 ms everywhere except case 03. The period is the hard part.

The fixes are known and belong to whoever replaces this file: fit on the low band where the kick
lives, and compare grid salience explicitly across period, half and double rather than trusting
one normalised score.

## Numbers are logged, not remembered

`loop.py` appends every run to `RESULTS.tsv` with the commit it came from, so a regression shows up
as a diff. Wall clock per case is logged alongside accuracy, because a listener that is right and
takes four minutes a song is not usable.

## The limit

Synthetic truth can only test what we can already name. It cannot validate the learned tier, whose
whole premise is that some of what matters has no field yet, and a listener tuned only on rendered
audio will learn the renderer. Human ears stay the authority: see `truth/PROTOCOL.md`.
