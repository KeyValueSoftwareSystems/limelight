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
