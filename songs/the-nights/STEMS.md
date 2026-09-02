# What the stems said

Six-stem separation with Demucs `htdemucs_6s`, run locally. Free, MIT, no account, no upload,
about two minutes on CPU. Independent 2026 comparisons put the gap between the best paid engine
and a well-configured free one under a decibel, so there is nothing here worth buying.

## The trap, first

**Demucs output runs a uniform +25.08 ms late against the source.** Identical on all six stems, so
it is internal framing rather than per-stem drift, and one shift corrects it — residual lag after
correcting is 0.00 ms and the six stems then reconstruct the mix to a 26% residual.

Earlier, mp3-encoded stems were **+50 ms** out, from the encoder delay on top of this. So: write
WAV, measure the offset once by cross-correlating the stem sum against the source, and subtract it.
Twenty-five milliseconds is inside the ±70 ms beat tolerance, which is exactly what makes it
dangerous — every number derived from uncorrected stems is wrong by less than the bench can see.

## The voice vacates both drops

| | voice before | voice at the drop | drums at the drop |
|---|---|---|---|
| drop 1, 63.621 s | 0.50 | **0.02** | 0.99 |
| drop 2, 139.816 s | 0.61 | **0.12** | 1.00 |

Vocal out, drums at maximum. That is a *measurable* signature of a drop in this song, and it is
not available from the mix — the full-band spectral flux sees a busy moment either way.

## The spotlight, measured rather than guessed

The most exposed vocal in the song is at **137.911 s** — voice at 1.00 against drums 0.20 and
other 0.11 — which is **1.9 seconds before drop 2**. Voice alone, then the room detonates. That is
the strongest single demo moment in the track and no one had to listen for it.

Runners-up: 44.572, 46.477, 90.289, 120.767.

## Vocal entries and exits, to the downbeat

```
IN  0:02   OUT 0:48   IN 0:52   OUT 1:01   IN 1:18   OUT 2:04
IN  2:08   OUT 2:19   IN 2:21   OUT 2:35   IN 2:36   OUT 2:38   IN 2:40   OUT 2:50
```

Two of these settle open questions. The vocal leaves at **1:01**, two and a half seconds before
drop 1 — so the pre-drop gap is a *vocal* gap, not a silence, which is consistent with finding no
silence anywhere in this record. And the vocal returns at **78.860 s**, which independently
confirms the chapter boundary I suspected near 78 from the energy dip at 84–88. Two different
measurements agreeing on a boundary I had flagged as missing is worth more than either alone.

## The hook is not separable — an honest negative

The lead hook stays inside `other`. `guitar` peaks at 0:12 and `piano` at 1:11, which are the verse
pluck and a chord stab. So **six-stem separation will not hand us "the hook plays here"** — if the
map wants that fact, it needs a field for it and a model trained to find it. Worth knowing before
someone spends a week assuming separation solves it.

## The new field

`stems` now sits in the map: per-instrument presence, one value per downbeat, normalised on each
stem's 2nd–98th percentile.

This is the gap flagged in `FINDINGS.md` after the first pass — *kick presence was the single most
informative signal in the song and it is neither a moment nor a span nor an energy value* — and
the same hole meant a lighting reader wanting to spotlight the voice had no way to know where the
voice was. It goes in under the rule: a field goes in when a reader breaks without it.
