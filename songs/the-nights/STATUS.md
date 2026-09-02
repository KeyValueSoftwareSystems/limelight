# The Nights — what is actually verified

| field | state | to promote it |
|---|---|---|
| **drop 1** | **verified** — 63.621 s, by ear, 2026-09-02 | done |
| bar phase | **inferred from the above** — only phase 1 puts that instant on beat 0 of a bar | done |
| beats, downbeats | **awaiting ear.** Grid refit after Renjith rejected the first one (75 ms early) | 3 min with `the-nights-CLICK-v2.mp3` |
| drop 2 | model says 139.816 | 1 min — same click track, listen at 2:20 |
| the 153.6 s "stop" | model found a 1.25 s sub-bass dip, **no silence anywhere in the song** | 1 min — is it a stop or not? |
| chapters | model boundaries from kick presence | 5 min in `loop.html` |
| spans | model: 38.86→63.62 `late`, 115.05→141.72 `steady` | 3 min — does the first one hold back then rush? |
| energy | model composite, r = 0.59 against loudness | **do not curve it — see below** |

Total remaining: **roughly fifteen minutes**, not the hour the plan assumes, because tonight
already fixed the grid and confirmed the drop.

## Do not ask a human for an energy curve

Ask for comparisons. "Is it more intense at 0:45 or at 2:10" is a question people answer
reliably and quickly; "rate the intensity here from 0 to 1" is one they answer badly and
inconsistently, and it is the harder question by far.

Twenty pairwise clicks give a ranking. Monotone weights fit to a ranking perfectly well, and the
same instrument serves the taste gate in the measurement lane — one tool, two lanes, and the
expensive human minute spent on the question humans are actually good at.

## The rule this file exists to enforce

Model output for this song lives in `the-nights.map.json`. It is labelled `"how": "model"`. It
must never be copied into this file. One invented timestamp makes every bench number afterwards
a lie that still prints.
