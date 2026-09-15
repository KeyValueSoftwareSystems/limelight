# Effects to build

Every effect below is a change to **one dimension of light**, so the renderer needs
no special case for any of them. Read `docs/architecture.md` first if the words
*state*, *binding* and *gesture* are not already familiar.

Derived from the current protocol response for `raga-of-revenge` — 24 fields,
32 moments, 39 named instrument lanes at half-second resolution.

---

## Tier one — eight, and a song plays end to end

| | kind | what it does | dials | fires on |
|---|---|---|---|---|
| **drone** | state | amount 0.08–0.2, a few lamps, still | `amount` `colour` `extent` | the resting condition of a quiet section |
| **wash** | state | amount 0.4–0.7, all lamps, one colour | `amount` `colour` `extent` | the resting condition of a full section |
| **impact** | gesture | amount to full, step, all, returns | `colour` `extent` `for_beats` | `peak` |
| **blackout** | gesture | amount to zero, step, all, returns | `for_beats` | the beat before a peak; a deep `exit` |
| **hush** | gesture | amount × depth, returns | `depth` `for_beats` `keep` | `exit` |
| **ramp** | gesture | amount rising across a span, arriving at the far end | `from_moment` `to_moment` `to` `curve` | `build` |
| **stab** | gesture | amount up on part of the rig, step, returns | `colour` `extent` `for_beats` | a middling `entrance` |
| **lift** | gesture | amount up, shape settle, **holds** | `by` `over_beats` `tilt` | `register_shift` |

Two notes on that table.

`ramp` must be started backwards from the build's own `lead_s`, so that it
**arrives** at the thing it precedes rather than announcing itself when the build
is first reported.

`lift` is the only tier-one effect that does not return. Raga has exactly one, at
120.3s, where the response says *the music moves up an octave*. Lighting that as
another blast is the single biggest mistake available in this song — the music
went up, not bang.

---

## Tier two — nine more, and it feels composed

| | kind | what it does | dials | fires on |
|---|---|---|---|---|
| **trade** | gesture | place, one half hands to the other, returns | `colours[2]` `for_beats` `travel` | an `entrance` and an `exit` sharing a timestamp |
| **isolate** | gesture | place to one lamp, holds for its span | `which` `colour` `rest` | a named instrument entering alone |
| **strip** | gesture | amount down to the state's floor, settle, holds | `to` `over_beats` | `breakdown` |
| **cut** | gesture | amount to zero, very short, returns | `for_beats` | `rhythm_change` where the beat drops away |
| **swell** | gesture | amount up then down | `colour` `for_beats` `rise` | a soft `entrance` |
| **gear** | gesture | rate × n, holds | `from` `to` | `tempo_change` |
| **follow** | binding | amount ← a named stream | `stream` `depth` `extent` `smooth` | a section where one instrument leads |
| **split** | binding | place ← two streams, one per half | `streams[2]` `colours[2]` | call and response |
| **accent** | binding | amount ← drum onsets above a threshold | `threshold` `extent` `for_beats` | dense drumming |

The three bindings are what the new analysis unlocks and they are worth building
properly. On this song, `split` bound to `lead-vocal` and `back-vocal` makes the
room answer the singer **because it is the singer** — no pattern imposed, the
structure coming out of the measurement. `accent` puts flashes on the 499 measured
drum onsets, each with its own intensity, rather than on the beat grid.

---

## Deliberately dropped from the old vocabulary

- `flash`, `cross` — `stab` and a travelling `stab` under different names.
- `hook_lift`, `riser`, `fill_flicker`, `exit_dip`, `breath` — all tier-one
  entries with different dials.
- `chord turn` — the data is there (63 chord spans) but the shortest is 0.09s,
  and nobody has worked out the minimum-span rule. It will flicker without one.
- `melody beam` — we have two moving heads that currently receive **identical**
  instructions, so it would read as one head duplicated rather than a beam
  tracking a voice. Worth building after the heads are independent.

---

## Two things to watch while building

**Declare what a rig cannot do; never silently drop it.** A rig with no movers
should do the amount half of `lift` and say it could not do the tilt half.

**`isolate` needs at least three lamps** to read as isolation. On a four-lamp rig
it is marginal; on two it is meaningless. It should refuse rather than look broken.
