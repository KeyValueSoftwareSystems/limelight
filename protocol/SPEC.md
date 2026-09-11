# The protocol — beats

The smallest version that can fail. Beats only, with play, pause, seek and
tempo change. Everything else waits until this is right, because everything
else sits on top of it.

## The score

Three numbers, and never a list of beat times.

```json
{ "grid": { "bpm": 128.0, "first_beat_s": 0.2233, "beats_per_bar": 4 } }
```

A list of beat times in seconds is what everyone builds first, and it is wrong
the instant the tempo moves — every entry has to be recomputed and re-sent.
Three numbers derive every beat in the recording and none of them change when
somebody plays the record faster.

## The two clocks

Keeping these apart is the whole design.

| clock | maps | does rate touch it? |
|---|---|---|
| the score | song seconds → musical position | **no**, ever |
| the transport | wall time → song seconds | yes, and only here |

Bar 12 beat 3 sits at the same song-second whatever speed you play the record.
That is why nothing has to be refetched.

## The two questions

`now()` answers in musical position. `next(lead_ms)` answers in the caller's
own milliseconds, because that is what a container schedules against — and it
is the only place the two clocks meet.

```js
const s = Session(score, { songTime: () => audio.currentTime });
s.now()       // { position: {bar, beat}, phase, to_next_beat_ms, playing, rate }
s.next(2000)  // [ { bar, beat, accent, in_ms } ]
```

If the container already has a clock, hand it over with `songTime`. Two clocks
in one program drift, and then somebody spends an evening finding out why the
lights are 40 ms late.

## Play, pause and seek are not ours

They are facts about the container's clock, not about the song. Nothing on our
side holds a session, so there is nothing to get out of step and nothing to
restore after a reload.

## The test that has to keep passing

`node protocol/session.test.js` — 19 checks. The one that matters most is the
last: note the next beat, pause, seek backwards, change the tempo, and the beat
is still the same bar and beat while the milliseconds have moved. If any
musical position moves, the design is wrong.

## Known and deliberate

The pickup before bar 1 is bar 0 beat 4. That is correct and it reads as
broken, so `before_first_beat` is set and the container shows the pre-roll
rather than a bar number.
