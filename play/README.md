# play — map + time → frame

**Owner: Dheeraj.** Given a map and an instant, say what every light is doing.

## Tonight (2 hours)
Read `../maps/example.map.json`, print what four lights should do at a given time. Text only.

```
$ python play.py ../maps/example.map.json 8.0
flood_1  white  100%
flood_2  white  100%
head_1   white  100%  strobe 6Hz
strip_1  pulse
```

**Done:** that command prints something sensible at 8.0 (the drop) and at 7.6 (the stop — all
zeros).

## The rule that shapes everything you write
`frame_at(t)` depends on `t`, the map, and the recipe. **Nothing else.** No memory of the
previous frame. Ask for t=47 without playing the first 47 seconds and it must be right.

That forbids the natural way to write effects. Instead of "on beat, start a fade", write
"brightness = f(position within the beat)". The map is your history: *when was the last beat* is
a lookup, not a memory. See `../FRAME.md` and `../RECIPE.md`.

## Then
The clock. Take time from the **audio device**, never `time.time()`. Two crystals drift apart
by milliseconds a minute, which is fine for one song and fatal for a set.
