# The Nights — what one real song taught us

First end-to-end pass, 2 September 2026. Measured from Renjith's own file with ffmpeg, numpy and
scipy. No ML in the loop except Demucs for stems.

## The four findings worth carrying forward

**1. My first grid was wrong, and every internal metric said it was right.** I fitted the beat
grid on full-mix spectral flux across 128 mel bands and reported "grid-locked, median deviation
9.1 ms". That number was circular: it compared a fitted grid against my own beat tracker, both
derived from the same onset envelope. Two estimates from one feature agreeing is not
verification. Renjith played the click track and heard immediately that it did not line up. The
phase was **75 ms early**, because on this master the spectral flux is dominated by hi-hats,
synths and vocals rather than the kick. Refitting on 35–130 Hz, in windows where the kick
actually plays, fixed it: on-beat versus off-beat energy in that band reaches **17:1**.

> **A click track over the song is the cheapest and highest-yield check in the analysis lane.**
> Put it in the pipeline as a standard step, not a debugging tool.

**2. One human answer resolved two unknowns.** Bar phase was undecidable from features —
harmonic change said phase 1 with a 43.7% margin, the snare backbeat rule said phase 2. Renjith
confirmed the drop by ear. Only phase 1 puts that instant on beat 0 of a bar; phase 2 would put
it on beat 3, which no dance record does. **The bar phase fell out of a single confirmed
timestamp.** This is the correction corpus in miniature and it is the best available argument for
why the loop matters.

**3. Loudness is useless on this record.** Spread from the 2nd to the 98th percentile is
**9.9 dB across the whole song** (the master reads LUFS −7.06, loudness range 2.6 LU, true peak
+1.77 dB — clipping). A composite energy curve correlates only **r = 0.59** with loudness, so the
other cues carry real information. **Kick presence**, not level, gave the entire form in one pass:

```
0.00 intro   16.00 verse   31.24 break   38.86 build   63.62 DROP
107.43 break  115.05 build  139.82 DROP  168.39 outro
builds:  38.86 → 63.62  rise=late      115.05 → 141.72  rise=steady
```

**4. Demucs stems are shifted.** The drums stem sits **+50 ms** later than the source and is
70 ms longer, from the mp3 round trip on the output. Stems are reliable for deciding *what* is
playing and unusable for deciding *when*. Write wavs, or measure the offset and correct it.

## What the format could not hold

- **Bars and phrases.** Phrase boundaries fell out for free and land on exact bar lines. There is
  no field for them, and every musician thinks in eight-bar phrases.
- **Kick presence.** The single most informative signal in the song. It is neither a moment nor a
  span nor an energy value.
- **Per-field confidence.** 9 ms confident on the period, a coin toss on the bar phase, and one
  global `confidence` number cannot say that. The correction interface needs it to know what to
  ask a human first.

## The open question that matters for the demo

**There is no silence anywhere in this song.** The only candidate for a `stop` is a 1.25 s
sub-bass drop-out at 153.6 s. If that does not read as a stop, the recipe's most dramatic look
never fires on The Nights — which is a real problem to know about now rather than on the 17th.
