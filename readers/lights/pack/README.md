# The reader pack

What Dheeraj takes home. Zipped and handed over on 2 September 2026.

- `START-HERE.html` — the brief: diagrams, the three songs, four problems
- `expected/*.keyframes.json` — 36 annotated instants across the three songs
- `expected/*.frames.jsonl.gz` — every frame at 40 fps. 54,280 in total
- `check.py` — compares a candidate stream to the golden one, first divergence wins

Inputs are the repo's own files: `../../../MAP.md`, `../RECIPE.md`, `../FRAME.md`,
`../club/layout.json`, `../../../maps/sketch/*.map.json`.

**The reference implementation is deliberately not in this repo.** The pack is a problem, not a
tutorial: same three inputs, reproduce the same output. When the recipe changes, the golden files
are regenerated and the checker re-run.

Tolerances: `level` ±0.01, `strobe` ±0.05 Hz, colour channels ±2. `look` is compared first
because every number downstream depends on it.
