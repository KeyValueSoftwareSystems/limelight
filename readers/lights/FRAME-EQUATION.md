# How a frame is computed

For Dheeraj, and for anyone writing a second reader. This is what
`readers/src/recipe4.js` actually does, not a description of what it ought to do.

## The shape

```
frame(t) = f(map, layout, recipe, t)          bytes = wire(frame, wiring)
```

`t` is the only input that changes. There is no state anywhere: ask for `t = 47` twice and get
identical bytes, ask for it without playing the first 47 seconds and get the right answer. That is
what makes scrubbing, late join and golden-frame testing possible, and it costs one thing — **an
effect cannot be a state machine.** Never "on the beat, start a fade"; always "brightness = g(where
we are in the beat)". The map is the history, and "when was the last beat" is a lookup.

## Step 1 — which look

Looks are segmented from `chapters` and `moments` once, then **crossfaded**. The blend weight is
itself a function of `t`, so purity survives. This is the fix for the pops: a look no longer
switches, it fades, and everything downstream is therefore continuous.

```
L        = the look at t          (drop, build, verse, break, quiet, flash, spotlight, idle, outro)
```

## Step 2 — the terms every fixture shares

| term | from | what it is |
|---|---|---|
| `e = en(t)` | `energy`, smoothstepped between downbeats | 0–1, how loud this part of the song is |
| `A = accentHit(t)` | `accents`, strong hits thinned to 300 ms | a short envelope on a drum hit |
| `EX.arc` | `sections.arc` and `repeat` | the show grows across the song, and a repeated section is denser |
| `bp4` | `grid` | position within a four-bar phrase |
| `G.xn` | `layout` | this fixture's position across the room, **0–1 in metres, not an index** |
| `stem(k,t)` | `stems` | how present drums / bass / vocals / other are right now |

## Step 3 — one fixture, in full

A par, which is the clearest case:

```
base   = {drop:0.38, build:0.15, verse:0.20, quiet:0.028, idle:0.036, outro:0.042}[L]
wave   = 0.70 + 0.30·cos(2π·(xn − bp4))                    a slow gradient across the room
wash   = (base + 0.40·e·k) · wave · EX.arc  +  (0.04 + 0.10·e)·A·0.35·grow
                                                            k = 1 in a drop, 0.62 otherwise

c      = chaseAt(t, e, n)                                   which drum hit we are on
pulse  = chaseGain(xn, c) · (0.55 + 0.45·strength)          this lamp's share of that hit
full   = (base + 0.55·e) · EX.arc
mix    = chaseMix[L] · (0.45 + 0.55·e)                      how much chase versus wash

level  = lerp(wash, full·(0.04 + 0.96·pulse), mix)
       · (build ? ramp : 1) · (quiet ? breathe : 1) · (outer ? 1.10 : 0.92)
```

Colour comes from `fixColour(t, L, kind, xn, e)`, which walks a hue path per look and shifts it
along `xn`, so the room has a gradient rather than one colour.

## The chase, since it is the newest part

It steps from lamp to lamp **on the drum hits**, not on a subdivision.

```
chaseAt(t)  →  the most recent hit in `accents` at or before t, its age, and the gap to the next
chaseGain() →  1 lamp on that hit, the previous one decaying, the rest at zero
               the decay is scaled by the gap to the NEXT hit, so a fill reads as a fill
```

Two versions were built and measured. A pulse that **slides** between lamps put only 57% of its
brightness changes within 30 ms of a sixteenth. One that **steps** put 80.8% there. Then stepping on
a fixed sixteenth turned out to be monotonous — correctly, because a metronome is the same four bars
forever and the drumming is not. Stepping on the hits gives gaps whose median is 0.232 s inside a
drop but which vary by 372 ms, and that variation is the record's own rhythm.

The chase rests: on for six bars of every eight, and off entirely when the drums stop for more than
1.2 s. A chase that runs continuously stops being an effect.

## Heads, briefly

Pan and tilt come from an **integrated** phase, never `2π·t·speed` — multiplying time by a varying
speed makes the phase jump whenever the speed changes, and the error grows with `t`. That bug slewed
the heads at 2.88 units/s against a 0.45 limit.

Amplitude is **derived** from `layout.limits.max_pan_per_s` rather than checked against it, so a
recipe cannot ask a motor for more than it has, and lowering the number in a layout makes the show
gentler instead of making a test fail.

## What the frame may never contain

No DMX, no addresses, no channel order, no physical lag. All of that is `wiring.json` and is read
only by `wire()`. That separation is why the browser room and the real room load the same layout
file and differ in exactly one place.

## Verifying a change

```
node readers/src/apptest.js     # every reader still draws, three rigs
node readers/src/smooth.js      # per-frame deltas, head slew against the layout's own limits
node readers/lights/pack/make.js && python3 readers/lights/pack/check.py …
```

`smooth.js` reads the limits the layout declares rather than a constant, so a wrong layout produces
a green test. Check the layout too.

---

# The drive knob (added later)

One setting at the end of the chain decides how hard the room is pushed. The map does not change
and neither does the layout: the same song on the same rig gives a restrained show or an aggressive
one because a person turned a knob, which is what an operator actually does.

**It stays pure.** `ENERGY` is a recipe parameter, not state. `frame(t)` at drive `high` is still
the same answer every time it is asked.

```
ENERGY ∈ {low, medium, high}                                  medium is the default

K = {                base  span  chase  accent  motion  strobe  haze
      low:           0.72  0.80   0.45    0.55    0.55    0.35   0.75
      medium:        1.00  1.00   1.00    1.00    1.00    1.00   1.00
      high:          1.18  1.30   1.45    1.55    1.45    1.60   1.20 }
```

Where each one enters:

```
base   = clamp(0.20 + (base[L] − 0.20)·K.span) · K.base       span opens the gap around the middle
accent term                              · K.accent           how hard the room answers a hit
chase mix = clamp(chaseMix[L]·K.chase, 0, 0.85)               capped: see below
chase floor = 0.06 / max(0.5, K.chase)                        deeper gaps between pulses
SLEW_CAP = clamp(0.60·(LIMP/0.85)·K.motion, 0.30, 1.0) · 0.68
fog      = (base + 0.55·burst) · K.haze
```

**It is deliberately not a brightness control.** Turning a whole show up makes it flat and bright.
What changes is how much of each behaviour is allowed. Measured inside drop looks on the small rig:

| drive | brightest par | spatial spread | head travel | chase steps/min |
|---|---|---|---|---|
| low | 0.517 | 1.6× | 0.48 | 43 |
| medium | 0.431 | 2.4× | 0.79 | 79 |
| high | 0.463 | 2.9× | 0.79 | 80 |

Total light output is roughly flat across the three, and that is correct: a wash lights five lamps
at once and a chase lights one, so "more energy" shows up as more contrast and more movement rather
than as more lumens. Head travel saturates between medium and high on this rig because it is already
at its ceiling; on the club rig, which declares half the pan budget, it rises 0.32 → 0.56 → 0.80.

## Two clamps that exist for a reason

**The chase mix is capped at 0.85.** Letting it reach 1.0 left four lamps of five sitting on the
chase floor, so the room got *darker* as the knob went up — measured, p95 output fell from 3.35 to
2.26 while the setting said "more".

**`SLEW_HEADROOM = 0.68` is empirical and is labelled as such in the code.** The analytic bound —
amplitude times 2π over the shortest move period — says 1.0 is safe. Measurement says otherwise: the
achieved peak came out 2.2× that, so something in the pan chain contributes beyond the amplitude
term and I have not found it. A recipe must never ask a motor for more than its layout declares, so
the cap carries a measured factor until the analysis is finished. Verified across every combination
of two maps, two rigs and three drive settings — twelve runs, all within the declared pan and tilt
budgets.

Check it yourself after any change to head motion:

```
node readers/src/smooth.js      # peak slew against the layout's own declared limits
```
