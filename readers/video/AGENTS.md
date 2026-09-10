# The video reader — agent instructions

Read `../../AGENTS.md` first, then this. Then read `IR.md`, which is the contract.

## What this lane is

The third reader. Lighting turns the map into fixture states; drones turn it into
positions; this turns it into cut points. **The map is not changed to suit it.**
If you find yourself wanting to add a field for the video reader, re-read rule 4:
a field enters the interface tier when a reader *breaks* without it, not when it
would be convenient. `salience` is the worked example — it looked like a map
field for a week and turned out to be derivable, so it lives in `derive.js`.

## The chain, and who is allowed to decide what

```
map + brief + assets/INDEX.json
        |
   policy_*.js          decides WHERE to cut and where to hold
        |
   *.ir.json            IR.md is the contract
        |
   compile.py           decides HOW to execute it. No creative choices.
        |
   an mp4
```

The split is not tidiness. It is what makes the A/B mean anything: every policy
gets identical inputs and shares `assets.js` for choosing footage, so a
difference between two edits is a difference in judgement about the music and
nothing else.

## Four policies, and why the boring ones matter

| policy | what it knows |
|---|---|
| `naive` | the beat grid, and nothing else. The thing to beat |
| `random` | the brief's pacing, and no music at all. **The null** |
| `rules` | a budget spent over ranked musical events, with holds |
| `llm` | a committed `intent.json`; the model chose indices, never times |

`random` is the one people want to delete. Do not. `rules` beating `naive` proves
almost nothing — `naive` is bad in an obvious way. `rules` beating a null with
the same shot-length distribution is the claim worth making, and as of this
writing **it does not clear it convincingly**.

## Things that are already known to be wrong, and are not to be redone

- **Grading cuts against the map's own moments.** The policy placed those cuts by
  reading those events. It scores near 1.00 on any edit and measures nothing.
  `bench/cutscore.py` reads only the rendered file for exactly this reason.
- **Correlating the whole visual-change curve against onset strength.** Motion
  inside shots swamps the cuts; every edit came out at |r| < 0.04 and the
  ranking was noise. Score the cuts, not the curve.
- **Distance from a cut to the nearest onset peak.** With peaks every 0.24 s
  every possible instant is a near miss, and a musical edit, a random edit and a
  beat-cut edit all read 80 ms. Use a hit rate at a fixed tolerance.
- **`-t <seconds>` per segment.** It rounds up, 38 times, and the last cut of a
  237-second edit landed 717 ms late. Frame counts, never durations.
- **`-t` at the mux.** Same bug at the other end: it re-truncated a frame-exact
  video to a non-integer length.
- **A brief hard-coded into a policy.** The brief is data. `briefs/README.md`
  says how to check that a policy is actually reading it.

## Before you claim an edit is better

`bench/cutscore.py` is a ruler. The authority is `bench/verdict.py`, which is a
person watching unlabelled files. Until somebody has run it, "the intelligent
edit is better" is an unsupported claim, and the honest form of the sentence is
"no verdict has been recorded".
