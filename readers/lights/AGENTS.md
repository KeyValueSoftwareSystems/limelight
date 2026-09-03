# The lighting reader — agent instructions

Read `../../AGENTS.md` first.

**Owner: Dheeraj, with Amal and Sebastian.** One function: a map, a layout and a time give what
every light is doing at that instant, forty times a second.

## The contract

`FRAME.md`. Read it before changing anything here — it is the agreement between this lane and every
other. The frame is normalised: levels 0–1, colours 0–255, pan and tilt as a fraction of each
fixture's own range. **Nothing in a frame knows about DMX.** That knowledge lives in `wiring.json`
and nowhere else, which is why the browser room and the real room load the same layout file.

## Files

| file | what |
|---|---|
| `FRAME.md` | the contract. Change it only with the whole team |
| `../src/recipe4.js` | the recipe. `frame(t)` and nothing else — no state, no history |
| `wire.js` | frame → 512 bytes. A naive reference, committed to be beaten; it lists its own four failures |
| `calibrate.js` | the commissioning sweep. Ten steps that exercise every capability a rig has |
| `club/layout.json` | what is in the room and what it can do. `limits` is load-bearing |
| `club/wiring.json` | universes, addresses, channel order, physical lag. The hardware layer only |
| `pack/make.js` | regenerates the golden frames. They are generated, never hand-kept |
| `pack/check.py` | compare your frame stream against the golden one |

## Two traps specific to this lane

**The recipe derives its amplitude from the layout's declared budget** rather than being checked
against it — that is why lowering `max_pan_per_s` makes the show gentler instead of failing a test.
It also means a layout that overstates a rig silently over-drives real motors. `calibrate.js`'s pan
step is built to just reach the declared budget so that lie becomes visible.

**Golden frames go stale the moment the recipe changes.** That already cost a week once. `make.js`
regenerates them in one command; the portal shows a red STALE badge by comparing file times.

## Verify

```
node ../../readers/lights/pack/make.js        # regenerate goldens
python3 pack/check.py pack/expected/01-pulse.frames.jsonl.gz mine.jsonl.gz
node ../../readers/src/apptest.js             # every reader still draws
node ../../readers/src/smooth.js              # per-frame deltas, head slew vs declared limits
```

Known open: the moving heads still pop. p50 is 0.001 and p90 is 0.015, but the worst single step is
a full 1.000 across all eight heads. Four rounds of fixes have not settled it and the current cap is
blunt and labelled as such.
