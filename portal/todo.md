# Show quality: what is measured, what is left

Referee for every claim below: `raga-of-revenge`, rig `arc4-head`, compared against the
teammate's known-good show in `~/Downloads/limelight-show-method`, same song, same rig,
same 41-channel 40fps frame format.

|                                            | teammate (good)           | ours, 2026-09-16 |
| ------------------------------------------ | ------------------------- | ---------------- |
| light rises within 60ms of a measured beat | 69.6% (+2.6 sd over null) | 30.6% (+0.8 sd)  |
| single-frame jumps > 30 DMX                | 838                       | 305              |
| dark frames                                | 14.4%                     | 3.0%             |
| frames in the middling band                | 37.2%                     | 76.5%            |
| frames where lamps differ from each other  | 68.8%                     | 39.9%            |

The headline: **their show jumps ~3x more than ours and still reads as designed.**
Jump count is not the defect. Jumps that miss the beat are. Reducing jump count was the
wrong target and cost the show energy without fixing what was visible.

---

## Validated 2026-09-16

`tools/shape.js` is the referee, nine checks, calibrated so the teammate's hand-built
show answers 9 of 9 and ours answered 3 of 9. Two checks were wrong when first written
and both showed as a failure on a show known to be good: peak-on-peak took a
single-frame argmax of a plateau, and the colour count bucketed brightness as hue.
Both now measure over a 5s stretch with brightness divided out.

Binding `follow` to the new `beat` stream, nothing else changed, moves on-grid from
33.9% (+1.3 sd) to **63.7% (+3.4 sd)** against the teammate's 69.6%. The mechanism
works. It also dropped lamps-differ 40.3% to 31.3%, because four pars pulsing in
unison is a wall — which is why bed-plus-pattern layering has to come with it.

## A. Sync — the show is not on the grid

- [ ] **A1. Snap look/state changes to bar lines.** Teammate measured 66 of 66 looks
      starting on a bar line. Ours crossfade on section seconds.
- [ ] **A2. Snap gestures to the nearer beat, not the floor.** A cue written at 49.79
      currently fires on the beat before it.
- [ ] **A3. Expose the beat grid as bindable streams** (`beat`, `downbeat`, `bar`) so the
      designer chooses when the rig moves with the pulse. Must stay a designer decision,
      not baker behaviour — a baker-imposed metronome was already tried and rejected.
- [ ] **A4. Re-measure rises-on-beat against the circular-shift null after A1–A3.**
      Target: clear +2 sd. Anything under that is not synced, whatever it looks like.

Confirmed NOT the cause: there is no audio/frame offset. Cross-correlating light change
against the 499 measured hits gives a best lag of exactly 0 frames.

## B. Dynamics — the show lives in the middle

- [ ] **B1. Compress the energy curve, do not copy it.** States floor at 0.34, cap at 0.92.
      Only a gesture reaches 255. Fixes middling 76.5% and dark 3.0%.
- [ ] **B2. Ink tracks energy.** A chase lights ~6% of the rig; never put one on the climax.
      Above three quarters, layer a full-ink bed under a half-ink pattern.
- [ ] **B3. Repeats rhyme.** Look follows section identity, not a rotating list, so the three
      choruses are recognisably the same thing.
- [ ] **B4. Fix lamps-differ 39.9%.** Follows from B2.

## C. Upstream — the score cannot express rhythm per instrument

- [ ] **C1. `stems_temporal.window_s = 0.5`** (`listen/gpu/pipeline.py:584`), a
      non-overlapping block RMS. At this song's median beat of 0.500s that is exactly one
      number per beat, linearly ramped — the continuous bindings physically cannot land on
      a beat. The separated audio is full-rate in `accum` and is discarded at 0.5s.
      Needs a pipeline re-run (BS-Roformer, GPU). No cached stem audio exists
      (`work/gpu-stems` empty, `work/stems` holds no files). Local GPU is a Quadro T1000
      with 3.7GB free; the VM key is not on this machine.
- [ ] **C2. Verify `moments[].peak`.** Teammate reports it disagrees with the energy curve,
      the emotion segments and the recording on their score version (52.26s vs ~105.8s).
      Our score is a different version and this session changed `loudest()`. Re-measure on
      ours before accepting or dismissing.
- [ ] **C3. `acoustic.loudness` exists at 0.5s** with `centroid_hz` and `percussive` and is
      not currently offered to the composer. Check it is not noise, then expose it.

## D. Referee

- [ ] **D1. Write `tools/shape.js`.** The nine-question scorer the teammate's README scores
      against does not exist on any branch here. Without it every quality claim is ad hoc.
      Note their own warning: two of the nine were wrong when written (peak-on-peak read the
      wrong signal; strong-moments-land only rewarded more light, when an exit should darken).
      It is a floor, not a target.

## E. Known bugs, carried

- [ ] **E1. `portal/effects.js` is still schema-1** — placed edits bake with `type: undefined`.
- [ ] **E2. `portal/server.py:save_custom` raises KeyError on schema-2.**
- [ ] **E3. `portal/app.js` label work is gone and NOT recoverable.** `git log -S playersOf`
      returns nothing on any branch, so it was never committed — it lived only in a working
      state that a later rewrite overwrote. Rebuild from scratch if wanted; do not go
      looking for it in history.
- [ ] **E4. Nothing pushed since the merge.** `limelight-portal` is local-only.
- [ ] **E5. Recompose all 29 songs** once A and B land. 16 existing plans were built on the
      old 24-effect catalogue and the old brief.

## F. Reverted or rejected, with the reason

- Baker-imposed beat pulse on states — rejected: pulsed regardless of the music. Note it ran
  on the drifting tempo map, a bug since fixed; a designer-chosen beat binding is not the
  same thing.
- Auto-binding every section to its loudest lane — correlation fell 0.555 to 0.403.
- Softening `accent` to cut jumps 597 to 305 — wrong target, see the headline above.
  Re-evaluate after A lands.
