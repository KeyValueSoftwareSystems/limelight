# Reader: drones

The second reader, and the reason it exists is not the drones. It is that **the thesis was
asserted and never demonstrated.** "The map is universal, lighting is one reader" is a claim
anyone can make about a format. Nobody believes it until two unrelated art forms run off the same
file at the same timestamp and you can switch between them in one keypress.

## It shares nothing with the lighting reader

| | lighting | drones |
|---|---|---|
| frame | `{id, r,g,b, level, pan, tilt, strobe, pixels}` | `{id, x,y,z, r,g,b, level}` |
| constraint | motor slew, strobe cap | top speed, minimum separation, altitude floor and ceiling |
| driven by | energy, stems, accents, sections | the same map, different fields |

`FRAME.md` always said the lighting frame belonged to the lighting reader and was not universal.
This is that sentence being cashed.

## What it reads that lighting cannot use

- **`sections`** choose the formation, and **`repeat`** and **`arc`** shape it — grid, wave, rings,
  helix, rising column, sphere, expanding shell, descent.
- **`notes`** — all 3,863 of them — are mapped one pitch per drone, so **the swarm plays the
  melody**: a drone brightens on the note it owns. There is no equivalent in a lighting rig.
- **`energy`** lifts the whole swarm; **`accent`** breathes it on the beat.
- **`stereo.pan`** drifts it sideways, the same listener the rig uses for its wash.

## The physics is not solved, and here are the numbers

Measured over the whole song at 20 Hz, 120 drones:

```
altitude used      11.3 .. 83.2 m     floor 8, ceiling 88      OK
peak speed         20.03 m/s          limit 7.5                EXCEEDS
closest approach   0.07 m             minimum 2.6              TOO CLOSE
```

Three attempts, and worth recording why each failed, because the lesson generalises:

1. **A fixed two-bar morph** asked drones to cross forty metres in 3.8 s — **59.6 m/s**.
2. **Morph time derived from displacement** was correct in isolation and worse in practice —
   **883 m/s** — because when a section is shorter than its own morph time the next boundary
   arrives mid-morph and the position *snaps*. Blending previous-to-current cannot be continuous.
3. **A weighted blend over every section**, each with a smooth weight bump, is continuous by
   construction no matter how the sections are arranged. That got it to 20 m/s. The residue is the
   normalisation: dividing by the weight total amplifies the rate at which weights change.

**Separation is the genuinely unsolved one.** Two formations can each be well spaced and still
route drones through each other in between. Real drone shows solve this with path planning and
collision avoidance, which is a different kind of problem from anything else in this repo and is
not a tonight job. It is measured, stated, and left open rather than hidden.

The same discipline caught the head-slew bug on the lighting side. A reader that measures its own
physical violations is worth more than one that looks fine.
