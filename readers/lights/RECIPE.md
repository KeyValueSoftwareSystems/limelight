# The club recipe — v0.2

Six moments in, six looks out. **This version is written as formulas, not adjectives**, because
someone has to reproduce it exactly. Taste changes; when it does, this file changes and the
golden frames are regenerated.

Everything below is a function of `t` and the map. No state. No memory of the last frame.

## Helpers

All read straight from the map.

| helper | meaning |
|---|---|
| `bi(t)` | index of the last beat at or before `t`. `-1` before the first beat |
| `beat_len(t)` | `beats[bi+1] - beats[bi]`. At the last beat, reuse the previous interval |
| `phase(t)` | `(t - beats[bi]) / beat_len(t)`, clamped 0–1. `0.0` when `bi < 0` |
| `bar_phase(t)` | same, between `downbeats`. Span at the last downbeat is `4 * beat_len(t)` |
| `energy(t)` | **linear interpolation** between the two nearest `energy` points. Flat outside the ends |
| `chapter(t)` | name of the last chapter at or before `t` |
| `span(t)` | the first span with `from <= t < to`, else `None`. Spans never overlap |
| `stop(t)` | the stop moment with `at <= t < at + holds`, else `None` |
| `since(kind, t, w)` | the latest moment of that kind with `at <= t < at + w`; returns it and `t - at` |
| `decay(ph, e)` | `(1 - ph) ** (1.5 + 4.0 * e)` — the pulse shape. Sharper as energy rises |
| `clamp(x)` | to 0–1 |
| `scale(rgb, g)` | `round(c * g)` per channel, clamped 0–255 |

`cap = layout.limits.max_strobe_hz` — **4.0 Hz** in this room.

## Look selection — first match wins

```
1  stop(t)                          -> stop
2  since("drop", t, 8.0), s < 0.25  -> flash
3  since("drop", t, 8.0)            -> drop
4  since("spotlight", t, 4.0)       -> spotlight
5  since("quiet", t, 8.0)           -> quiet
6  span(t).kind == "build"          -> build
7  span(t).kind == "quiet"  or  chapter(t) in (break, quiet) -> quiet
8  chapter(t) == "drop"             -> drop
9  chapter(t) == "verse"            -> verse
10 otherwise                        -> idle
```

Golden frames carry the chosen look in a `look` field. It is a diagnostic, not part of the
frame contract — but get it right first, because every number downstream depends on it.

## Palette

```
WHITE   255,255,255      AMBER  255,140,20      COOL   40,80,200
MAGENTA 255,40,160       DEEP   20,60,180       WARM   255,180,90      VERSE  200,120,60
```

## The nine fixtures

`ord` is the fixture's index in `layout.fixtures`, optional fixtures excluded: `par_1`=0 … `fog_1`=8.

### PARs

| look | colour | level |
|---|---|---|
| `stop` | `0,0,0` | `0.0` |
| `flash` | WHITE | `1.0` |
| `drop` | WHITE if `(bi + ord) % 2 == 0` else MAGENTA | `0.55 + 0.45 * decay(phase, 0.95)` |
| `spotlight` | WARM on `par_2`, `0,0,0` on the rest | `0.75` on `par_2`, `0.0` on the rest |
| `build` | AMBER | `floor + (peak - floor) * decay(phase, e)` where `floor = 0.10 + 0.35e`, `peak = 0.45 + 0.55e` |
| `quiet` | DEEP | `(0.10 + 0.35e) * (0.8 + 0.2 * sin(2πt / 8))` |
| `verse` | VERSE | `0.20 + 0.30 * decay(bar_phase, e)` — pulses on downbeats only |
| `idle` | COOL | `0.12` |

**The build row is the important one.** `floor` and `peak` both climb with energy and the decay
sharpens, so a build that rises for three minutes gets brighter, snappier and denser the whole
way — without a single extra field in the map.

### Strobes

Off in every look except two.

| look | level | strobe (Hz) |
|---|---|---|
| `flash` | `1.0` | `0.0` — a flash is not a strobe |
| `drop`, while `s < 2.0` | `1.0` | `min(cap, 2.0 + 2.0 * drop.size)` |
| `build`, while `span.to - t <= 2.0` | `0.30 + 0.70 * (1 - (span.to - t) / 2.0)` | `min(cap, 2.0 + 2.0e)` |
| everything else | `0.0` | `0.0` |

### Strips — 24 pixels, `n = 24`

| look | pixels |
|---|---|
| `stop`, `spotlight` | all `0,0,0` |
| `flash` | all WHITE |
| `drop` | `(a, b) = (WHITE, MAGENTA)` if `bi % 2 == 0` else swapped. Pixel `i` = `scale(a if i < n/2 else b, decay(phase, 0.95))` |
| `build` | comet. `head = bar_phase * n`, `w = 6.0 - 4.0e`, `d = min(|i - head|, n - |i - head|)`, pixel = `scale(AMBER, max(0, 1 - d/w))` |
| `quiet` | `scale(DEEP, clamp(0.15 + 0.15 * sin(2π·i/n + t/3)))` |
| `verse` | two pixels only: `i0 = floor(bar_phase · n) % n` and `(i0 + n/2) % n`, both `scale(VERSE, 0.5)` |
| `idle` | one pixel: `floor((t/4 mod 1) · n) % n` at `scale(COOL, 0.4)` |

### Fog

`level = 1.0` when any drop `d` satisfies `d.at - 9.0 <= t < d.at - 7.0`. Otherwise `0.0`.

**Fog ignores the stop rule.** Its `lag_ms` is 9000, so the burst is commanded nine seconds
early and there is nothing to gain by cutting it during a silence — the haze is already in the
air. This is the one place where a physical delay leaks into the recipe, and it is worth
understanding rather than hiding.

## `return` — applied last, on top of whichever look was chosen

If `since("return", t, 2 · beat_len(t))` matches, let `k = s / (2 · beat_len(t))` and multiply
every `level` and every pixel by `k`. Fog is exempt. This is what makes a return rebuild over
two beats instead of snapping.

## Two things a recipe may never do

- **Exceed `layout.limits.max_strobe_hz`.** The room sets the cap, not the recipe.
- **Turn a small strobe into a whole-room strobe** when fewer fixtures are present than expected.

## Who decides whether this is good

Renjith. Not a vote and not an average. Two versions of the same fifteen seconds, and the
question is which is better — a question humans answer reliably. "Rate this out of ten" is not.
