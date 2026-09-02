# The bench

One command, three numbers.

```bash
python3 bench/selftest.py                    # does the bench measure what it claims?
python3 bench/bench.py <truth> <candidate>   # score a map against a truth file
python3 bench/bench.py <truth> <candidate> --json
```

Run `selftest.py` before you trust a single number. It takes one map, breaks it in eleven specific
ways, and prints what the bench notices — which is the fastest way to learn what each metric is
**blind** to.

## Tolerances, and why they are not negotiable mid-experiment

| metric | tolerance | why that number |
|---|---|---|
| beats, downbeats | ±70 ms | the standard in the beat-tracking literature, so our numbers are comparable to published ones |
| chapter boundaries | 0.5 s and 3.0 s | two tolerances, two verdicts. "Roughly the right section" and "the right moment" are different achievements |
| moments | ±1.0 s to match, then the error is reported | matching and accuracy are separate questions |
| `holds` on a stop | flagged audible above 100 ms | a stop 300 ms short reads as a mistake in the room, and onset accuracy alone is blind to it |
| span IoU | 0.70 to pass | position only. `rise` shape is scored separately, because getting one right proves nothing about the other |

Moving a tolerance to make a number look better is the one form of cheating this file cannot
detect. Argue a tolerance in the open, before the experiment.

## What the bench cannot do

It cannot tell you whether a show is beautiful. Numbers grade correctness; beauty is graded by
putting two versions of the same fifteen seconds side by side and asking which is better — a
question humans answer reliably, unlike "rate this out of ten". Both gates matter and neither
substitutes for the other.

Sebastian owns this file. `bench.py` is v0 so that nobody is blocked waiting for it.
