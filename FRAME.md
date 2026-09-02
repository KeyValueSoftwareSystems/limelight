# The frame

What every light is doing at one instant. `play/` produces it; `room/` draws it and hardware
sends it. Normalised, so nothing here knows about DMX channels or fixture models.

```json
{
  "t": 8.0,
  "fixtures": [
    { "id": "flood_1", "r": 255, "g": 255, "b": 255, "level": 1.0 },
    { "id": "flood_2", "r": 255, "g": 92,  "b": 168, "level": 1.0 },
    { "id": "head_1",  "r": 255, "g": 255, "b": 255, "level": 1.0,
      "pan": 0.5, "tilt": 0.3, "strobe": 6.0 },
    { "id": "strip_1", "pixels": [[255,0,0],[0,0,0],[255,0,0]] }
  ]
}
```

| field | range | meaning |
|---|---|---|
| `t` | seconds | which instant this frame is for |
| `r` `g` `b` | 0–255 | colour |
| `level` | 0–1 | brightness. `0` means off, and off means **actually zero** |
| `pan` `tilt` | 0–1 | where a moving light points, as a fraction of its range |
| `strobe` | Hz | 0 means steady. Capped downstream for safety |
| `pixels` | list of rgb | for strips only |

## The one rule

**The frame is a function of `t` alone.** Ask for `t = 8.0` twice and get identical bytes. Ask
for `t = 47.0` without having played the first 47 seconds and get the right answer.

That is what lets us scrub during rehearsal, join the show late, put it on a hundred phones, and
test it. It costs something real: **effects cannot be written as state machines.** Not
"on beat, start a fade" but "brightness = f(where we are in the beat)". The map is your history
— *when was the last beat* is a lookup, not a memory.
