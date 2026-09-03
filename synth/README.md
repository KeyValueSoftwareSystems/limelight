# The playground

Ten levels of made-up music. Each one has a **perfect** map, because we wrote the arrangement
first, rendered the audio from it, then measured the map back out of the individual instrument
tracks. Nothing is estimated, so when your listener disagrees with it, your listener is wrong —
there is nothing to argue about.

## Set up (about two minutes, once)

Everything after the clone can be done from the page — generating songs, scoring a listener,
rebuilding the golden frames. The commands below are what those buttons run, and they still work if
you prefer a terminal.


```
git clone git@github.com:KeyValueSoftwareSystems/limelight.git
cd limelight
python3 synth/compose.py        # makes all ten songs — audio and answers together
python3 synth/loop.py           # scores the example listener. This is the number to beat.
python3 synth/serve.py          # optional: open http://127.0.0.1:8770 to see it
```

Python 3 only. No pip, no node, no network, nothing to download. If `python3 --version` works, you
are ready.

**The audio is not in the repo and never will be.** `compose.py` is 14 KB and it writes every song
identically on every machine. That is the whole answer to "how do we share music" — we share the
code that makes it.

## The ten levels

Each level adds exactly **one** new thing. So when your score drops, you know what caused it.

| level | adds | teaches |
|---|---|---|
| 01 pulse | a kick, nothing else | find the beat |
| 02 backbeat | a clap on 2 and 4 | find the bar. Level 01 has no bar at all — its `downbeats` is empty on purpose |
| 03 offbeat | busy hats between the kicks | do not get dragged onto the offbeat |
| 04 odd tempo | 126.4 bpm, untidy phase | a grid that only fits round numbers will fail here |
| 05 sections | an arc, quiet to loud to quiet | find structure |
| 06 repeat | the same section twice | notice that two sections are the *same* section |
| 07 voice | a lead that leaves at the drop | per-instrument presence matters |
| 08 syncopation | ghost notes off the grid | most hits are not on a beat |
| 09 half-time | drums halve, tempo does not | do not follow the drums down an octave |
| 10 everything | swing, human timing, and one buried sound that happens once | all of it at once |

Level 10 hides a single rising sound at a fifth of the level around it, once, and nowhere else in
the ladder. It is recorded in `observations.singular` — described by what it *did* (rose, smeared,
spread wide) rather than by what made it, because a reader does not need its name.

The Nights is **not** on this ladder. It is the final exam, in `readers/lights/pack/`, and its map
is not trustworthy — six methods disagree about its structure and one moment in it has been checked
by a human ear. Do not build against it.

## Writing a listener

Your listener is a command, not a Python import, so write it in whatever you like. It receives a
WAV path as its last argument and prints a map to stdout.

```
python3 synth/loop.py --listener "python3 listen/mine.py"
python3 synth/loop.py --level 03 --listener "python3 listen/mine.py"     # one level
```

`listen/baseline.py` is a deliberately naive example, committed as a floor to beat. It measures
energy across the whole frequency range and takes the best-scoring grid, which are exactly the two
choices behind this project's real bugs — it halves the tempo on nine levels out of ten.

A level passes at beats F ≥ 0.90, grid error ≤ 25 ms, and no octave error. The loop prints the
first level you fail and stops being polite about it.

Every run appends to `RESULTS.tsv` with the commit it came from, so a regression shows up as a diff
rather than as a memory.

## The rule that matters most

**Never fill a field you did not measure.** An empty value is worth more than a guess, because once
a guess is written down nobody can tell it from a measurement. Level 01 declares no downbeats for
exactly this reason, and a listener that reports them there is marked wrong.

## Bringing your own songs

Generated songs sound like a machine. Real ones will not. If you write a song — in a DAW, or with
a generator — it can join the ladder, but **the answer sheet has to come from you authoring it, not
from us listening to it.** You know the tempo and where each section starts because you set them.
The moment we have to detect those, we are back to marking an exam with no answers.

```
python3 synth/import.py                       # writes a template to fill in
python3 synth/import.py synth/incoming/night-drive.song.json
```

Put the wav next to the spec in `synth/incoming/`, which is gitignored. You tell us four things:

| you tell us | why you and not us |
|---|---|
| `bpm` | you set it in the DAW |
| `first_downbeat` | seconds to the start of bar 1 |
| `sections` | name and length in bars, in order |
| `plays` | which instruments are in each section |

Everything else is measured from your audio, not guessed — energy per bar, length, and the beat
grid derived from your tempo. If you export stems named `drums.wav`, `bass.wav`, `other.wav`,
`vocals.wav`, `guitar.wav`, `piano.wav` into a folder and point `stems_dir` at it, instrument
presence is measured exactly instead of taken from the on/off list.

Audio never enters git. 16-bit wav only — the importer refuses anything else rather than reading it
wrong.

Verified by round-trip: a generated song re-imported from its own arrangement reproduces its map
exactly, including the repeated section and energy to four decimal places.
