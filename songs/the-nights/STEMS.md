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

---

# First section reviewed by ear — 2026-09-03

Renjith, listening to the first thirty seconds:

> *around second 2, you hear 3 drum sounds which have to be accounted for*
> *the start of bar 10 marks the start of kicks that then stop at the end of bar 16*

Both check out on the isolated drums stem, and one of them lands exactly on a boundary I had
already detected — which is the strongest validation the grid has had.

## The kick region

Kick energy at beat positions, per bar, measured on the lag-corrected drums stem:

```
bars 2-9    0.345 - 0.457      toms, not the kick
bar 10      0.949   <- steps up 2.5x
bars 11-16  0.906 - 0.956      holds
bar 17      0.143   <- drops 6.7x
bars 19+    0.000
```

Bar 10 starts at **17.904 s** and bar 17 at **31.238 s**. That second number is *exactly* the
chapter boundary the analysis had already found at 31.238 — the same instant, from two unrelated
methods, one of them a human ear. The grid, the period, the phase and the bar phase are all
implicated in that agreement, so all four are now much better attested than before.

Bar 9 versus bar 10 also turned out to be two different events rather than one: **the bass enters
at bar 10** (0.000 → 0.191) together with the kick, while my detected boundary at 16.00 s is
bar 9. So something changes a bar before the band arrives — which is ordinary in pop and means the
boundary at 16.00 is probably right *and* incomplete.

**Why my first pass got this wrong:** I measured "kick presence" on the low band of the *full
mix*, where a bass note and a kick are indistinguishable. That reported the kick as present from
0.69 s. On the isolated drums stem the distinction is unambiguous — bars 2–9 are toms at 0.39, and
the four-on-the-floor is 0.95. Separation earns its keep here.

**Not stored as a new field.** `stems.drums` already carries this and no reader breaks without a
declaration, so it is recorded under `verified_by_human` as confirmation of the measured curve.
The rule holds: a field goes in when a reader breaks without it, not when a fact is interesting.

## The three drum sounds — a real format gap

This one *does* break a reader. The loudest drum onsets between 1.5 and 3.0 s:

| at | what | strength | position |
|---|---|---|---|
| 1.715 | hat | 0.729 | beat 3 + 0.00 — **on** the grid |
| 2.100 | hat | 0.714 | beat 3 + 0.81 — **off** the grid |
| 2.425 | snare | 0.635 | beat 4 + 0.50 — **off** the grid |
| 2.663 | snare | 0.707 | beat 4 + 1.00 — the downbeat of bar 2 |

Two of the three sit *between* beats. So a reader asked to stab three times at second 2 cannot get
those times from `beats`, and `stems` is sampled per downbeat so it cannot either. They are not
`moments` — the six kinds are structural and closed. **The map had no way to express them.**

Hence `accents`: individual percussive events with a time, a strength and which drum. Across the
song there are **983 of them, and 71% do not sit on the beat grid** — so a reader working from
`beats` alone was missing most of the percussion in the record.

## The map records everything; the recipe chooses

Making the show react to all 983 put the flicker straight back in — frames changing by more than
0.15 went from 10 to 208, and p99 from 0.137 to 0.180. It was also wrong musically: nobody stabs
every hi-hat.

So the recipe keeps accents above 0.42 strength and thins them so two stabs are never inside
300 ms — **173 stabs out of 983 recorded**. That is the separation of concerns working exactly as
intended: the *map* says what the music does, the *recipe* decides what to react to. p99 is back
to 0.153, and the hits that remain are the fills, which is what was asked for.

The first six stabs: 1.715 hat, 2.100 hat, 2.425 snare, 2.829 snare, 3.152 kick, 4.103 kick.
