# audio → map — agent instructions

Read `../AGENTS.md` first.

**PARKED for the hackathon.** We author the songs instead, so nothing is blocked on solving this.
The ladder stays because it is how we would prove a listener later, and because the songs it
generates are the demo material.

If you do pick it up: your listener is a **command**, not a Python import. It receives a WAV path as
its last argument and prints a map to stdout, so it can be written in anything.

```
python3 ../synth/loop.py --listener "python3 listen/mine.py"
python3 ../synth/loop.py --level 03 --listener "python3 listen/mine.py"
```

`baseline.py` is deliberately naive and committed as a floor. It measures onset energy across the
whole frequency range and takes the highest-scoring comb — the two choices behind this project's
real bugs. It halves the tempo on most levels.

The two fixes it is waiting for are known: fit on the low band where the kick lives rather than the
full mix, and compare grid salience explicitly across period, half and double instead of trusting
one normalised score. The division in `comb()` is where the tempo octave error lives.

A level passes at beats F ≥ 0.90, grid error ≤ 25 ms, and no octave error. Do not move those.
