# Show quality: what is measured, what is left

Referee: `tools/shape.js`, ten checks, calibrated so the teammate's hand-built show
in `~/Downloads/limelight-show-method` answers all ten. Run it on any baked lights
file. `tools/watch.sh` shows what the composer decided and anything the validator
dropped; `tools/monitor.sh` samples every 10s into `/tmp/monitor.log`.

## The ten checks

| check                    | what fails it                                                             | reference |
| ------------------------ | ------------------------------------------------------------------------- | --------- |
| on the grid              | rises not within 60ms of a measured beat, 2 sd over a circular-shift null | +2.6 sd   |
| goes dark                | under 4% or over 30% of frames below 12 DMX                               | 14.4%     |
| held back                | over 55% of frames mid-level                                              | 37.2%     |
| not a wall               | under 45% of frames with lamps differing by 20 DMX                        | 68.8%     |
| never parks              | any unchanging stretch over 6s                                            | 4.7s      |
| peak on peak             | brightest 5s where the song is under 85% of its loudness range            | 90%+      |
| loudest where it matters | that stretch under 75% of the show's own maximum                          | 77%       |
| the strong moments land  | under 60% of moments at 0.70+ get a visible change                        | 10 of 11  |
| lamps act apart          | median lamp-pair correlation over 0.75                                    | 0.50      |
| colour carries the form  | one colour over 72% of lit time                                           | 64%       |

## Bugs found and fixed, 2026-09-16

Every one degraded every show, and none were visible in the finished output.

- **`follow` rendered in a hard-coded cream** `[0.9, 0.8, 0.55]`, saturation exactly
  0.39 — the median measured across the whole show — and `colour` was not a declared
  dial, so no plan could set it. Every show ever baked used that one colour.
- **`accent` flashed white** by the same route, on about a third of frames.
- **Only `split` was a continuous place binding.** chase, ripple, alternate and the
  rest were one-shot gestures, so a section's continuous layer could only ever be
  follow or accent, both of which drive every lamp with the same number. No plan
  could have made the lamps move independently.
- **The crossfade interpolated the colour wheel.** A move from slot 4 to 52 dragged
  the gel carrier through every gel between; the show sat on 16 values where the
  wheel has 8 slots. Channels that pick a position are now stepped, by profile role
  name, so a future fixture inherits it without touching the baker.
- **`smooth` was declared and never implemented.** The composer set it on every
  follow binding since the beginning and it did nothing.
- **`S.beatAt` does not exist** — Session exposes positionAt, secondsAt, sectionsAt,
  energyAt. Every bake using a travelling binding crashed on it.
- **My own `streams` regression deleted a third of all bindings.** Seeding the set
  with three grid names switched on a check that had been inert, so every real
  instrument lane was rejected. `_lanes_of` returns a tuple, and reading it as a list
  would have done the same thing a second time.

## Referees that were wrong

- **peak-on-peak took a single-frame argmax of a plateau.** `levels` is brick-walled:
  its two candidate peaks differ by 1.5% RMS and the audio itself flips between them
  depending on a 5s or 15s window. I nearly "fixed" a detector that was correct. It
  now asks how loud the song is where the show is brightest.
- **"not a wall" passed at 62.6% while all four lamps moved as one body**, because
  `spread` offsets their levels by a constant. It measured whether lamps differ,
  never whether they do different things. Hence `lamps act apart`.
- **The hue cap was making the show blander.** The composer said so itself: "Per my
  notes on the hue cap I avoided spectrum, shift, trade, ramp, swell, fade, ripple
  and breathe." A rule against thirteen shades of one orange was suppressing colour
  variety — the exact fault being reported. Removed; colour is unrestricted and only
  `colour carries the form` remains, which is a floor, not a cap.

## Measured facts worth keeping

- Baking 5,252 frames takes **0.26s**, scoring **0.06s**. All show-creation time is
  the model deciding, not the machinery.
- Each travelling binding alone over a 0.25 wash: chase 98.8% on-grid (+3.5 sd),
  correlation 0.10; ripple 100% (+3.2 sd), 0.14; alternate 100% (+3.0 sd), -0.72.
  All three beat the reference's 69.6%.
- `accent` rides onsets, which land on a beat **36%** of the time; a grid stream puts
  **63.7%** on a beat. accent is not a substitute for one.
- `stems_fine` at 0.05s exists for raga-of-revenge (2625 windows against 262). It does
  NOT improve how well the light tracks the music — correlation with mix loudness
  0.501 coarse against 0.472 fine — but it triples the jumps. Useful with `smooth`,
  not a free win. A GPU run for the rest was started on the L40S at ~16-34s a song.
- The composer now bakes and scores its own plan mid-compose. First draft it caught
  itself: 5 of 10.

## Next experiment: composer-defined effects

Agreed with Amal after measuring whether the catalogue constrains it. It does
not, yet: the show uses 25 of 34 effects, sets 94% of available dials (175 of
186), and mentions a limitation once across 40 cues. It is choreographing
within the vocabulary - "two travelling place bindings at deliberately
different periods, with the lower one's level under the higher one's crest so
neither erases the other".

So this is the next thing to try rather than a fix for something broken. A
plan carries its own effect definitions, parameterised, registered like the
built-ins. Unlimited vocabulary while the editor still shows named effects a
person could have dragged in, and the same plan still renders on club16.

Raw DMX was considered and rejected: 5,252 frames x 41 channels is 215,000
numbers, so the model would have to emit code rather than frames, and that
loses the editor (the teammate's README: "a show written as raw primitives
cannot be drawn in the editor"), loses rig portability, and hands it the
keep-out zone and fixture profiles to get wrong silently.

## Left

- [ ] raga to 10 of 10, verified by looking at the rendered strip, not only the score
- [ ] the other 27 songs
- [ ] `portal/effects.js` is still schema-1; placed edits bake with `type: undefined`
- [ ] `portal/server.py:save_custom` raises KeyError on schema-2
- [ ] `playersOf()` in app.js is unrecoverable — `git log -S` finds it on no branch
- [ ] nothing pushed; `limelight-portal` is local-only
