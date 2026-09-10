# Assets — agent instructions

Read `../AGENTS.md` first.

## Rule 1 applies to footage

No mp4s in git, for the same reason there are no wavs. `stock/CATALOGUE.json` and
`generated/TRUTH.json` are committed and are enough to reproduce both sets; the
media is ignored. The Mixkit licence independently forbids redistributing clips
as stock, so this is also the only lawful arrangement.

Every fetched clip carries its source URL, its licence as the source states it,
and a sha256. A clip that cannot be attributed is not downloaded.

## The generated clips are the only ground truth here

Nobody knows where the true shot boundary in a stock clip is, to the frame. So
`make-clips.py` renders clips FROM an answer sheet, the way `synth/compose.py`
renders songs from a map, and `index.py --check` grades the detector against it.

**Four bugs were found there, and every one was in the test rather than the
detector.** Each time, the clip could not answer the question being asked of it:

1. a flat background — the only structure in frame was the subject
2. vertical stripes — no corners, so `goodFeaturesToTrack` selected none
3. a flat-coloured subject — no interior corners, only an untrackable rim
4. a sign error that made a "stationary" subject cross at twice the pan speed

If a measurement disagrees with `TRUTH.json`, suspect `TRUTH.json` first. It is
authored, and authored things are wrong in ways that measurements are not.

## What the check can and cannot say

It is a floor. No compression noise, no grain, no handheld drift, no rolling
shutter, no depth of field. A detector that passes here and fails on stock
footage is not contradicting itself, and no accuracy is claimed for stock — there
is nothing to claim it against.

## Nulls are answers

`faces: null` means nothing looked; `faces: 0` means the detector looked and
found nobody. `camera_motion_px_s: null` means fewer than `MIN_TRACKED` points
survived the forward-backward check. Writing 0 for any of these would be a guess
wearing a measurement's clothes, and `assets.js` skips null fields when scoring
fit rather than treating them as zeros.
