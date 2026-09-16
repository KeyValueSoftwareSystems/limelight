/**
 * Lining the lights up with what the listener actually hears.
 *
 * THE PROBLEM. `audio.currentTime` reports where the DECODER has got to, not
 * what has reached the speakers. Every output path buffers: around 20ms wired,
 * comfortably over 150ms on Bluetooth. Nothing in this app compensated for it,
 * so the preview drew the frame for the decode position and the lights ran that
 * far AHEAD of the music — a constant lead, never growing, which is exactly what
 * "slightly out of sync" feels like and why it never looked like drift.
 *
 * Measured, for the record: the baked frames themselves are beat-aligned to a
 * median of +15ms against the score's own beat times, with no drift across the
 * song. The bake was never the problem.
 *
 * THE FIX. Show the frame for `t - offset`, where offset is what the device says
 * it is plus whatever the person nudges. Pure and tested, because the failure is
 * silent: a wrong offset still renders a perfectly good-looking show.
 */

/** The most the manual nudge may move things, either way. */
export const SYNC_NUDGE_LIMIT = 0.3;

/** Beyond this, a reported latency is a broken driver rather than a device. */
const PLAUSIBLE_LATENCY = 1.0;

const finite = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Which baked frame to draw at audio position `t`.
 *
 * `offset` is seconds of output latency: positive means the sound lags the
 * clock, so the lights must wait for it.
 */
export function frameFor(t: number, fps: number, frameCount: number, offset: number): number {
  const n = Math.max(0, Math.floor(finite(frameCount)));
  if (n <= 0) return 0;
  const rate = finite(fps);
  if (rate <= 0) return 0;

  /* round, not floor: flooring biases every frame half a step late, which is a
     free 12.5ms of error at 40fps */
  const i = Math.round((finite(t) - finite(offset)) * rate);
  return Math.max(0, Math.min(n - 1, i));
}

/** What the browser says this output path costs, in seconds. 0 when it will not say. */
export function outputLatencyOf(
  ctx: { outputLatency?: number; baseLatency?: number } | null | undefined,
): number {
  if (!ctx) return 0;
  /* outputLatency is the whole path and is what we want; Safari reports only
     baseLatency, which is the graph's own buffer and better than nothing */
  const total = finite(ctx.outputLatency) + finite(ctx.baseLatency);
  if (total <= 0 || total > PLAUSIBLE_LATENCY) return 0;
  return total;
}
