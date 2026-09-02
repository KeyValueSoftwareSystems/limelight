# The frame — the lighting reader's output

**This format belongs to the lighting reader only.** It is not universal. A video-edit reader
outputs cut points; a rhythm game outputs a note chart. The universal artifact is the *map*,
which knows nothing about output devices.

What every light is doing at one instant, forty times a second. Normalised — nothing here knows
about DMX channels or fixture models.

```json
{ "t": 420.5,
  "look": "drop",
  "fixtures": [
    { "id": "par_1",    "r": 255, "g": 255, "b": 255, "level": 0.892 },
    { "id": "par_2",    "r": 255, "g": 40,  "b": 160, "level": 0.892 },
    { "id": "strobe_1", "level": 1.0, "strobe": 4.0 },
    { "id": "strip_1",  "pixels": [[255,255,255],[212,212,212]] },
    { "id": "fog_1",    "level": 0.0 } ] }
```

| field | range | meaning |
|---|---|---|
| `t` | seconds | which instant this frame is for |
| `look` | string | **diagnostic only.** Which recipe branch was chosen. Not part of the contract, but compared first |
| `r` `g` `b` | 0–255 | colour. When `level` is 0 these are 0 too — off means *actually* zero |
| `level` | 0–1 | brightness, linear. Display gamma is the room's business, not the frame's |
| `pan` `tilt` | 0–1 | where a moving light points, as a fraction of its range |
| `strobe` | Hz | 0 means steady. Capped by `layout.limits.max_strobe_hz` |
| `pixels` | list of rgb | strips only. Brightness is baked into the rgb; strips have no `level` |

Fixture order matches `layout.fixtures`, with `optional` fixtures skipped.

## The one rule

**The frame is a function of `t` alone.** Ask for `t = 8.0` twice and get identical bytes. Ask
for `t = 47.0` without having played the first 47 seconds and get the right answer.

That is what lets us scrub during rehearsal, join a show late, run it on a hundred phones, and
test it at all. It costs something real: **effects cannot be written as state machines.** Not
"on the beat, start a fade" but "brightness = f(where we are in the beat)". The map is your
history — *when was the last beat* is a lookup, not a memory.
