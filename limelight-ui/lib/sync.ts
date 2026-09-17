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

/**
 * The two frames either side of `t` and how far between them it sits.
 *
 * A 40fps show on a 60Hz display cannot divide evenly, so picking one frame
 * holds it for one refresh then two, which reads as judder on fades and on the
 * moving head. Blending the pair instead makes the output continuous at
 * whatever rate the display happens to run.
 */
export function framePairFor(
  t: number, fps: number, frameCount: number, offset: number,
): { i0: number; i1: number; f: number } {
  const n = Math.max(0, Math.floor(finite(frameCount)));
  if (n <= 0) return { i0: 0, i1: 0, f: 0 };
  const rate = finite(fps);
  if (rate <= 0) return { i0: 0, i1: 0, f: 0 };
  const x = (finite(t) - finite(offset)) * rate;
  const lo = Math.floor(x);
  const i0 = Math.max(0, Math.min(n - 1, lo));
  const i1 = Math.max(0, Math.min(n - 1, lo + 1));
  const f = i1 === i0 ? 0 : Math.max(0, Math.min(1, x - lo));
  return { i0, i1, f };
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

/**
 * The channel slice to draw for `t`, blended between the two frames either
 * side of it. `scratch` is reused across calls so a 60Hz loop allocates
 * nothing. Returns the array to read from and the frame index within it.
 */
export function blendedFrame(
  frames: Uint8Array,
  channels: number,
  t: number,
  fps: number,
  frameCount: number,
  offset: number,
  scratch: { current: Uint8Array | null },
): { src: Uint8Array; at: number } {
  const { i0, i1, f } = framePairFor(t, fps, frameCount, offset);
  if (!(f > 0) || i1 === i0 || !(channels > 0)) return { src: frames, at: i0 };
  const a = i0 * channels;
  const b = i1 * channels;
  if (a < 0 || b < 0 || a + channels > frames.length || b + channels > frames.length) {
    return { src: frames, at: i0 };
  }
  let buf = scratch.current;
  if (!buf || buf.length !== channels) {
    buf = new Uint8Array(channels);
    scratch.current = buf;
  }
  for (let c = 0; c < channels; c++) {
    buf[c] = (frames[a + c] + (frames[b + c] - frames[a + c]) * f + 0.5) | 0;
  }
  return { src: buf, at: 0 };
}
