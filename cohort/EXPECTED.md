# What your tooling must recover

Twelve candidate maps, three stand-in truth files, four quality tiers per song. Filenames leak
nothing on purpose. Your aggregation is correct when it recovers all five facts below without
being told them.

**1. The tier ordering, per song.** A is best, D is worst. Any sensible aggregate score must order
them A > B > C > D for every one of the three songs. If your aggregate cannot separate B from C,
it is not sensitive enough to detect a real regression, which is the entire job.

**2. The octave warning fires on exactly three candidates** — the tier D one for each song, which
are the only half-tempo trackers in the set. If it fires anywhere else, the check is too loose; if
it misses one, too tight.

**3. The per-level split.** `the-nights` is level 1, `strobe` and `opus` are level 2. A per-level
aggregate must show level 2 harder than level 1 at matched tier, because spans move further in
absolute seconds when the song is ten minutes long.

**4. One candidate is invalid, and your harness must refuse to score it.** `cand_07.json` has
overlapping spans -- it arrived that way honestly, from the tier D shift colliding two builds, and
it is kept rather than fixed. A harness that silently scores a malformed map produces a number
that means nothing, and it will do that quietly for as long as nobody checks. Validate first,
refuse loudly, report it as unscored rather than as a low score. A zero and a refusal are
different facts.

**5. Nothing here is a real result.** Both the truth files and the candidates are synthetic. This
cohort tests measurement tooling, not a model, and no number from it may be quoted to anyone.

## The answers

| file | song | level | tier |
|---|---|---|---|
| `cand_01.json` | the-nights | 1 | **A** |
| `cand_02.json` | the-nights | 1 | **B** |
| `cand_03.json` | the-nights | 1 | **C** |
| `cand_04.json` | the-nights | 1 | **D** |
| `cand_05.json` | strobe | 2 | **A** |
| `cand_06.json` | strobe | 2 | **B** |
| `cand_07.json` | strobe | 2 | **C** |
| `cand_08.json` | strobe | 2 | **D** |
| `cand_09.json` | opus | 2 | **A** |
| `cand_10.json` | opus | 2 | **B** |
| `cand_11.json` | opus | 2 | **C** |
| `cand_12.json` | opus | 2 | **D** |

`truth_<song>.json` is the stand-in truth to score against.
