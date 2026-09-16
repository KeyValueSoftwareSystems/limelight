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

## The central finding: layering is why nothing goes dark

Bindings composite brighter-per-lamp, so a lamp is lit whenever ANY binding
over it is lit. With three or four continuous bindings on a section the chance
all of them are quiet at once is almost nil, and the rig can never breathe.
Same plan, same gestures, changing only the number of bindings per section:

| | lamp off | lamp-pair correlation |
| --- | --- | --- |
| reference (hand-built) | 27.1% | 0.50 |
| 3-4 bindings per section | 8.4% | 0.70 |
| **1 binding per section** | **26.7%** | **0.31** |

One binding matches the reference on darkness and beats it on independence.
Nothing else came close: floors to zero moved 3.0% to 8.1%, making follow's
response linear moved 8.1% to 8.4%, marking fade reductive moved 3.0% to 3.4%.

This was self-inflicted. Every complaint got answered by adding a layer -
travelling bindings when the lamps moved as one body, accent when it looked
static - and each addition raised the floor and removed darkness. The show kept
feeling flat whatever else was fixed.

Continuous response was the right idea; making it the whole show was the error.
The reference's 117 assignments are discrete looks that change often, not 117
continuous streams. A binding is for the one continuous thing a section is
about. Anything else in that section should be a gesture, which ends and gives
the lamp back.

Also worth keeping: the emulator applies gamma 1.6, so DMX 12 draws at 14%
brightness, not black. Per-lamp measurements matter more than rig averages -
`goes dark` passed at 4.7% on the rig average while no single lamp was ever
out.

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

## Downbeat phase, 2026-09-16

Downbeat flags were fabricated: every score had `beats[0]` flagged and the rest
every Nth beat from it. All 28 songs had first downbeat at index 0, which no real
tracker produces. `listen/downbeat_phase.py` re-phases; `listen/downbeat_audit.py`
audits. 9 applied, 2 vetoed by the onset gate, 17 already right.

Which referee to trust, in order:

1. A listener. Decisive, and the only thing that settled raga-of-revenge.
2. Drum onset density (`rhythm.hits` within 60ms). Independent of the chord
   detector, and caught 2 of 11 chord-driven calls wrong.
3. Chord changes (`btc_chords_raw`). Finds the phase, but cannot verify its own
   answer, and BTC is trained on Western pop so it is least reliable on exactly
   the non-Western songs. entharo-mahanu is Carnatic and it got that one wrong.
4. Low-end energy. Uninformative wherever every beat carries a kick.

raga-of-revenge is at phase 1 by ear. Its four referees gave three different
answers on margins of a few percent (onsets tie 1 and 2, onset strength prefers 0,
low-end and chords prefer 2). Provenance records "decided_by: listener" rather
than implying a measurement chose it.

Open: the metre period is still assumed, not measured. It comes from the median
gap between the fabricated flags, which were every 4 by construction, so a song in
7 or 8 would never be spotted. A joint period/phase search scores higher at longer
periods purely because they test fewer beats.

## raga-of-revenge reaches 11 of 11, 2026-09-16

First show to pass every check on an independent bake.

                 before   now    reference (hand-built)
  goes dark        6.2%  14.7%      14.4%
  held back       60.0%  44.5%      37.2%
  not a wall      52.9%  63.6%      68.8%
  peak at          106s   94.4s     92.3s
  loudest@peak      65%    90%        77%
  lamp imbalance    4.9    1.6        0.9
  commonest hue     52%    29%        64%

Traceable causes, both brief additions rather than code:

- The peak table (where each signal says the song is loudest, and that they
  disagree) moved the climax to within 2s of the recording's own peak.
- The ink table (each effect's share of lamps lit, and how often lamps differ)
  halved the lamp imbalance, and the gesture-level measurement got gestures to
  reach the rail at all.

Still short: lamps reach full 5.8% of the show against the reference's 20.3%,
four times better than the 1.4% before the gesture note but not there. Lamp
correlation 0.72 against 0.50. Both are the same underlying thing -- our rig
still dims where the reference switches.

Open, reported by the composer and NOT yet verified by me:
- `bump` at for_beats 0.5 appears to latch: one gesture reportedly produced
  five seconds of all four pars at 255, leaking across later gaps in the outro.
  Found by bisecting one gesture at a time. Needs reproducing.
- An orphaned composer process from a killed run rewrote the workings file
  roughly once a minute mid-session. Kill the process group, not the parent.
