---
name: limelight-verify
description: Use before claiming a change to Limelight works, or before committing. Runs every check the repo has — map validation, the ten-song ladder, golden frames, all three readers headless, and the physics check against declared layout limits — and reports what actually passed.
---

# Verify a Limelight change

Run only what the change can affect, but never claim it works without running something. All checks
are stdlib or node — no install, no network.

```
python3 validate.py synth/songs/*.map.json      # every map well-formed; 0 errors expected
python3 synth/loop.py                            # ladder score; baseline passes 4 of 10
node readers/src/apptest.js                      # all three readers draw headless
node readers/src/smooth.js                       # per-frame deltas + head slew vs the layout
node readers/lights/pack/make.js                 # regenerate golden frames after a recipe change
python3 synth/compose.py                         # regenerate songs after touching compose.py (~90s)
```

## What the numbers mean

- **apptest** must print `ok` for club, venue and the-grind, plus the sky and 18 score lanes.
- **smooth** reports p50/p90/p99 of per-frame change and head slew against the layout's *declared*
  limits. It reads those limits from the layout file rather than a constant, so a wrong layout gives
  a green test — check the layout as well as the number.
- **loop** prints the first failing level and what is wrong with it.

## Two things that are not verification

Do not compare a thing against its own output. A beat grid checked against the tracker that made it
once reported 9 ms of agreement and measured nothing.

Do not grade against `maps/model/the-nights.map.json`. Its structure is disputed by six methods and
one moment in it has been verified by a human. It is the final exam, not a reference.

## Before committing

State what you ran and what it printed. If a check was skipped, say so and why.
