# Limelight — handover

You are picking up the lighting-show pipeline. Read this before touching anything;
the most important part is *Why the old engine was thrown away*, because everything
else follows from it.

Amal is the person you are working for. His standard is that the show should look
like a real lighting designer made it, and he judges it by watching, not by reading
numbers. When he says something feels wrong, he has been right every single time —
measure what he describes before you decide he is not.

---

## 1. Working rules (from Amal, non-negotiable)

- **Zero comments in code. There is no exception clause.** Reasoning goes in the
  commit message instead. Commit messages here are long and explain *why*; match that.
- **Run every command in the background** so problems surface early.
- **Never open a browser.** Tell him the URL and let him open it. Headless
  screenshots are fine.
- **No audio in git, ever.** `hub/files/` is gitignored; keep it that way.
- **Do not push without his say-so.** As of this handover there are ~10 local
  commits on `limelight-portal` that he has asked to review first. Check with him.
- Teammates push to the same branch. Pull and rebase often; the generated file
  `portal/showfiles/raga-of-revenge.show.json` conflicts routinely — take either
  side and regenerate.
- Don't touch `/home/actions-runner` (a live CI runner on this machine).

---

## 2. Why the old engine was thrown away

The old pipeline had a Claude "composer" write a `plan.json` of states, bindings and
gestures, which `portal/baker.js` rendered. Every effect was a **function of beat
phase evaluated per frame**, so a "cue" was an oscillator, not a look.

The measurement that settled it — how often the *rendered output* changes by a
clearly visible amount:

```
  old engine, best version   920 changes in 131s  = a new look every 0.14s
  a teammate's reference     759 changes in 131s  = every 0.17s
```

The plan declared 39 cues; the render had 920 visual states. That gap is the whole
reason the show felt random, had no flow, no coordination and rough transitions —
five complaints, one cause. It also explains why months of parameter tuning
(release times, stagger, `every_beats`, crossfades) improved numbers without
improving the show.

**The old engine still exists and still works** (`portal/baker.js` + `portal/venues/`).
Nothing was deleted. The portal routes a plan containing `cues` to the new engine and
anything else to the old one, so both run side by side.

---

## 3. The new engine — three rules

`portal/cue/` is a cue-list renderer. A show is an ordered list of **looks that
hold**. There is nowhere to put a per-frame function, which is the point.

1. A cue is live from its trigger until the next cue's trigger. **Between triggers
   the output is constant.** Stillness is structural, not a parameter.
2. A trigger crossfades from the previous rendered output over the cue's `fade`
   seconds. `fade: 0` snaps.
3. A **chase** modulates only the fixtures it names, only while its cue is live, and
   **steps** on a declared musical rate. Stepped, never continuous — so a chase
   cannot become an oscillator.

### The cue file

```json
{ "schema": "limelight.cuelist/1", "song": "...", "rig": "arc4-head",
  "palette": { "crimson": "#c8102e", "...": "..." },
  "accents": [ { "t": 42.5, "l": 0.96, "decay": 0.2, "on": "lamps", "c": "bone" } ],
  "cues": [
    { "id": 12, "at": { "bar": 23, "beat": 1 }, "fade": 0.8,
      "why": "why this cue exists, in the music",
      "look": { "outer": {"c":"crimson","l":0.7}, "inner": {"c":"teal","l":0.5},
                "heads": {"c":"crimson","l":0.5,"pan":0.5,"tilt":0.3} },
      "swell": { "from": 0.82, "to": 1.0, "curve": 1.3 },
      "chases": [
        { "on":"lamps", "figure":"handover", "every":{"hits":1}, "low":0.42,
          "fill_beats":2, "move_head":true },
        { "on":"inner", "figure":"hocket",  "every":{"hits":3}, "low":0.55, "c":"teal" }
      ] } ] }
```

- `at` takes `{bar, beat}` or `{second}`.
- A look names **groups** or fixture ids. Groups come from rig geometry:
  `all lamps left right inner outer ends centre heads`. A fixture absent from a
  look is dark; an empty look `{}` is a blackout.
- `centre` is one lamp on an odd row, the **middle pair** on an even row. This
  matters: a single lamp alone on a symmetric row reads as three broken lamps.
- `every` takes `{bars:n}`, `{beats:n}` or `{hits:n}`. `hits` steps on the score's
  measured percussive onsets; `fill_beats` fills in with beats where the percussion
  drops out, or the chase goes dead in quiet passages.
- `chases` is a list — layers. `chase` (singular) still works.
- `figure` is one of 16: `alternate hocket sweep bounce wave comet handover
  converge diverge build unbuild cascade pulse pairs split rotate pitch`. A figure
  may return **weights** rather than on/off, which is what makes a comet tail or a
  handover *overlap* possible. `pitch` turns the row into a pitch ladder — the lit
  position tracks the melodic line, verified at r=+0.76 against a shuffled null.
- `every` also takes `{notes:n}`, stepping on the melody's top voice.
- `reverse` runs a figure right-to-left, used so a descending run sweeps downward.
- A chase step eases over 60ms by default. Sweeping that fade showed 0 to 0.07
  costs no sync (92-93% of rises on a hit) and cuts the p99 per-frame jump from
  49.6 to 33.5; at 0.11 sync falls to 86%. Accents, cue snaps and blackouts still
  snap deliberately.
- `move_head` pans the head to whichever lamp the figure is lighting.
- `swell` ramps the cue's own level across its span.
- `accents` are punches on the strongest measured hits, composited with `max` so
  they read as hits on top of the show rather than replacing it.

---

## 4. Files

| file | what it does |
| --- | --- |
| `portal/cue/engine.js` | rig loading from profiles, groups, grid, colour parsing, the 15 figures, chase step times |
| `portal/cue/render.js` | the three rules: hold, crossfade, stepped chases. Plus swells, accents, head slew |
| `portal/cue/bake.js` | CLI: cue file + score -> the frames envelope the UI reads |
| `portal/cue/author.py` | **writes the cue list from the score.** This is where the design lives |
| `portal/cue/faults.py` | **scans a baked show for named defects with timestamps. Run it after every change; all seven songs are at zero.** |
| `portal/cue/bars.py` | prints what is playing bar by bar, what entered, what left. Run this first on any new song |
| `portal/cue/render.test.js` | 19 checks, including "a single cue never moves after it lands" |
| `portal/cue/shows/<song>.cues.json` | the generated cue list |
| `portal/look.js` | bakes the current plan and prints the room: cue rate, blackouts, the arc, on-beat share |
| `tools/contact.py` | one frame per second as an image strip. This is how you *see* a show |

Rig geometry, channel roles and slew limits all come from
`readers/lights/drivers/profiles/*.profile.json` and the layout files, so nothing
is hardcoded to four lamps.

---

## 5. Running it

```bash
./start.sh                      # hub :8770, portal :8800, ui :3000  (needs PORTAL_NET set)
PORTAL_NET="" ./start.sh        # what actually works, set -u bites otherwise

work/allin1/bin/python portal/cue/bars.py <song>          # read the song first
work/allin1/bin/python portal/cue/author.py <song>        # write the cue list
cp portal/cue/shows/<song>.cues.json portal/work/<song>.plan.json
node portal/cue/bake.js <song> --out /tmp/x.json          # render
work/allin1/bin/python portal/publish.py <song>           # into the UI
node portal/look.js <song>                                # look at it
python3 tools/contact.py /tmp/x.json "$(node -e "console.log(require('./protocol/fixture.js').pick('<song>'))")" /tmp/x.png arc4-head
node portal/cue/render.test.js                            # 19 checks
```

The portal bakes from `portal/work/<song>.plan.json`. A plan carrying `cues` goes to
the new engine; anything else to the old one.

---

## 6. What "good" means here, with current numbers

These are the measurements that actually track Amal's judgement. Re-measure after
any change; several of them contradict intuition.

| measure | now (raga-of-revenge) | why it matters |
| --- | --- | --- |
| **total room output swing within a second** | **21.7%** | **this is what Amal calls "voltage fluctuation" — see below** |
| rises landing on a measured percussive hit | 92% | the show hits with the music |
| colour changes | 27, one every 4.9s, median hold 4.5s | colour churn reads as random |
| longest idle stretch | 3.9s | he calls idle "lazy" |
| changes per second inside a build | 3.0 | a build must accumulate, not accelerate |
| one-frame flashes | 0 | a 25ms flash reads as a broken lamp |
| blackout | 5.6s, all on measured audio holes | rarity is what makes one mean something |
| peak | reaches 255, once, at the loudest instant | full is spent once |

Verified across six songs and both rigs:

```
  song                      rises  on hit  colour  hold   idle   black  flash
  raga-of-revenge              52     92%      27  4.5s   3.9s   5.6s      0
  afterglow                   101     98%      28  5.5s   4.7s   4.7s      0
  levels                       87     93%      33  5.6s   6.8s   6.5s      0
  the-nights                   27     89%      34  4.8s   5.0s   4.5s      0
  nebulakal                    87     98%      52  4.8s   8.7s  21.9s      0
  leva-between-worlds-60s      49     98%      10  4.0s   1.9s   1.2s      0
```

`the-nights` has few rises because it has 0.49 strong hits/second — that is the
song. `nebulakal` blacks out for 21.9s because it genuinely opens with 16s of
near-silence. Both are correct, not bugs.

Rig-generic: the same cue list bakes on `club16-2head` (16 lamps + 2 heads)
unchanged.

---

## 7. How the author decides things

Read `portal/cue/author.py` alongside this.

- **A cue appears** where the music does something: a moment, a decisive change of
  leading instrument family, or 7+ stems entering/leaving in a bar. **Section edges
  deliberately do not force a cue** — Amal's instruction: a section is one place a
  change might belong, not a place one must happen.
- **Level** = measured bar energy × an arc that climbs to the song's peak moment and
  releases after it. Mapping level straight onto energy gives a flat show on songs
  whose energy is constant; a designer shapes the arc.
- **Colour** comes from the leading instrument family's cool→warm ramp, indexed by
  the **harmonic mode** of the emotion span under the cue, nudged by its brightness.
  Minor pulls toward indigo and violet, major toward amber and saffron.
- **Colour discipline**: a family must beat the incumbent by 30% to take the lead
  (it was flipping on 1.8% margins); harmonic colour cues need 6s between them; and
  a final pass holds any colour for 4s unless a peak, climax, drop, breakdown,
  register shift or blackout asks otherwise.
- **The moment type picks the treatment**: pause/exit → blackout, peak → full white
  with a pulse on the hits, climax/drop → full blast, build → accumulate, breakdown
  → empty to the middle, entrance → snap and hand over, spotlight → the head points
  and the row stays level.
- **Blackouts come from the audio**, not the score: `holes_in()` finds every stretch
  below 30% of median RMS lasting 140ms+. A half-second hole inside a loud bar is
  invisible at bar resolution — this is how 0:48 in raga was found.
- **Builds are detected** (3+ bars of rising energy ending 25% up) and treated as a
  unit: figures step every 2 beats rather than on every hit, and the swell spans the
  whole run rather than resetting each bar.

---

## 7a. Phrases — the show is composed per phrase, not per bar

Amal's deepest criticism was that the show "feels reactive, not musically
intelligent": brightness tracked loudness bar by bar, so it was a response
function rather than a composition. A listener hears **phrases**, not bars.

`author.py` now segments each section into 4-bar phrases, reads each phrase's
direction as a unit (rises / falls / holds by comparing its first and last bar),
and gives the whole phrase ONE idea:

  rises  -> `build`,   level climbs 0.80 to 1.00 across the phrase, "opens out"
  falls  -> `unbuild`, level falls 1.00 to 0.82,                    "closes down"
  holds  -> `wave` when dense, `comet` when sparse, level near flat "travels across"

The level of any bar comes from **its phrase's trajectory**, not from that bar's
own energy, and a cue only fires at a phrase start or on a real moment. Inside a
phrase the lights execute a plan instead of re-deciding.

**Be honest about what this did and did not do.** It is structurally right and
it is what he asked for, but the measurement did not move much: brightness
correlated with bar loudness at r=+0.41 before and r=+0.37 after, and with the
phrase plan at r=+0.43 both times. The chases and accents dominate the measured
brightness, not the cue levels. If he says "reactive" again, the lever is
probably the chase behaviour inside a phrase, not the phrase levels.

## 7c. The step-rate floor — the actual cause of "voltage fluctuation"

Amal said "watch from 0:04 and you'll understand". Dumping those frames was
worth more than every aggregate metric in this document put together.

From 4.3s to 5.4s the lamps swapped which one was brightest every 50-150ms with
no pattern. The TOTAL held steady at ~191 (conservation works), so the wobble
metric said 19% and looked acceptable — but the **distribution** was churning at
5-10 Hz. That is what he has been calling voltage fluctuation all along.

The cause: chases stepping on `{notes: 1}`, and **the median gap between melody
notes in this song is 0.104s**. A note-stepped chase steps ten times a second.

`gateSteps()` in engine.js now refuses any chase step closer than
`min_step_beats` (default **1.0**) to the previous one, for every chase,
whatever it steps on. Measured:

```
  floor        lead changes   median hold   wobble   rises   on hit
  none              260          0.18s      19.3%     38      89%
  half a beat       154          0.38s      16.3%     33      88%
  one beat          110          0.60s      16.2%     32      88%
```

A full beat costs nothing and triples how long a position holds.

**The metric that finally saw it** is "how often does the brightest lamp
change" — not per-frame jump, not total wobble. Add that to any future
investigation: the eye tracks *which lamp leads*, and if that changes faster
than about twice a second it reads as electrical noise no matter how steady the
total is.

## 7b. The activity / fluctuation trade-off — read this before adding anything

Amal's most persistent complaint is that the show "feels like voltage
fluctuation". Per-frame smoothness does **not** measure it — p99 per-frame jump
sat at 33 while he still saw flicker. What tracks his perception is how much the
**total light in the room** swings within a second. Measured by removing one
feature at a time:

```
  everything on      34.2%      no swells         35.9%   (no effect)
  no accents         12.3%      no build/pulse    34.8%   (no effect)
  no chases at all   17.7%      the version he liked 2.7%
```

Accents dominate. They are room-wide brightness spikes, and a spike every few
seconds reads as electrical rather than musical. But the version with a 2.7%
swing has only **3 rises in the whole show** — it is nearly static, and he
rejected that as "lazy" too. The two complaints are the same dial seen from
opposite ends:

```
  accents   wobble   rises
     40      30.7%      54
     30      21.7%      44
     19      19.3%      38     <- where it sits now (3.6s spacing in author.py)
     13      16.5%      30
      0      12.3%      18
```

Things already tried that did NOT help, so do not retry them:
  - raising the chase floor to 0.75          (30.7% -> 29.7%, nothing)
  - making chases conserve total output      (40% -> 34%; correct in principle,
    kept, but not dominant)
  - moving chases from hits back onto beats  (identical numbers — because a
    conserving chase barely moves the rig mean, so neither the wobble nor the
    regularity metric can observe it at all)
  - softening the phrase trajectory depth    (31.5% -> 30.2%)

That third one matters: **the aggregate metrics cannot see the chases.** If the
complaint is about how the chase itself feels, these numbers will not show it
and you need to look at frames or ask him.

If he says fluctuation again, move **down** this curve (fewer accents, longer
spacing in `author.py`'s accent loop). If he says lazy, move up. Do not reach
for per-frame smoothing; it is not the variable.

## 7g. Cues need room, and each section needs its own movement

Amal: from 0:06 to 0:10 every effect must hold and be consistent, not randomly
fluctuate. Measured, the median gap between cues was **0.77s and half of all
gaps were under 0.8s** — 6.39 to 7.16 alone carried three different figures
(comet, pitch, build) inside 0.77 seconds. No look existed long enough to read.

Cues now need 0.95s of room. When two collide the more important one wins, on a
fixed priority: blackouts and their returns and the big moments outrank phrase
cues, which outrank entrances and builds, which outrank harmonic colour turns,
which outrank ordinary bar cues. A swish also needs 1.6s of clear air or it is
skipped. 84 cues became 47, median gap 0.77s became 2.06s.

Then variety, because holding a look made the sameness obvious: only 8 of the
16 figures were being used and build/comet/handover were most of them. Each
SECTION LABEL now owns a movement family, the way it already owns a colour:

  travel  sweep comet wave      trade  alternate pairs hocket
  grow    build cascade unbuild meet   converge diverge split
  pass    handover bounce rotate

Families are handed out so no two labels share one, biased by hit density. The
phrase direction then picks a variant INSIDE the family — rises takes the first,
falls takes the second reversed, holds takes the third — so a chorus always
moves like that chorus while still answering what the music is doing.

Fourteen cues carry no movement at all and that is correct: seven blackouts,
five anticipation dips (the breath before an arrival is meant to be still), the
spotlight, and the breakdown.

## 7f. A figure must be allowed to finish

Amal liked the build sweep at 0:10-0:12 and called 0:05-0:10 random. Measuring
the two windows the same way says exactly why:

```
  5-10s   step spread 0.60   order [1,4,1,2,1,2,1,2]   ping-pong
  10-12s  step spread 0.27   order [2,3,4]             travel
```

A pattern reads as a pattern when its timing is regular AND it keeps a
direction. The cause of the ping-pong was that **every derived cue restarted its
chase at step 0**. A harmonic colour cue, a swish return, an anticipation dip --
each inherits the running chase, and each snapped the figure back to its first
lamp. A build would reach lamp 2 and start again. Figures never finished.

A chase carried into the next cue now continues its step count, keyed on
figure + targets + rate + direction. Reversals in 5-10s went 6 to 3 and the
window now ends on a clean 1-2-3-4 sweep. Lamp lead evened out to 42/24/19/15
and lit share to 74/81/81/74.

Two other things tried here that did NOT help, so do not retry: smoothing the
pitch targets with a median of neighbours (spread went back up), and mapping
pitch by rank or by percentile (lamp 1 to 80%, then lamp 3 to 0%).

## 7e. Two things the scanner cannot see

It reports zero on all seven songs, and Amal still found two faults by watching
0:02-0:11. Both are about *distribution over time*, which no per-event check
catches. Add these to any investigation:

  - **lit share per lamp** — how long each lamp spends above 40/255. All four
    should be within ~10 points of each other (now 77/78/74/68).
  - **dead stretches** — spans where NO lamp changes by more than 2/255. There
    are 9 above 1.2s, the longest 2.92s, and that one is the `spotlight` cue
    deliberately holding the row level while the head works.

And a warning about the lead metric: `argmax` returns the FIRST index on ties,
and symmetric looks put lamps 1 and 4 at identical levels, so lamp 1 wins every
tie. 16% of lit frames are ties. Read "lamp 1 leads 49%" with that in mind —
check lit share as well before concluding a lamp is unused.

## 7d. The fault scanner

`portal/cue/faults.py <song> <lights.json>` walks every second and reports named
defects: `lead-churn`, `blip`, `ping-pong`, `colour-flipflop`, `flicker-out`,
`lamp-idle`, `head-jitter`, `dark-on-loud`, `bright-on-silence`, `pinned`.

**All seven songs currently scan at zero.** Keep it that way: bake, scan, and
only then look at anything else.

Three scanner bugs were found while building it, and each one nearly sent me to
fix the show instead of the tool. Watch for the same shape:

- Hue was bucketed as `channel * 12 // (max + 1)`, which changes with
  BRIGHTNESS, so a lamp fading through one colour registered as several. It
  reported 155 colour-flipflops that did not exist. Hue is an angle now.
- The scanner flagged every deliberate accent as churn, because an accent on a
  subset necessarily changes the leading lamp twice. It now excludes windows the
  plan asked for (`planned()`), widened to 2.5x an accent's decay.
- `argmax` over near-equal lamps flips on rounding: it reported "lead changes
  after 25ms" where the top two lamps differed by 0.62 of 255. A lead change now
  needs an 8/255 margin and must hold 100ms.

Real faults it did find, all now fixed: an accent driving the other lamps to
zero; `the-nights` and others opening dark over music that had already started;
a moment at 4.4s placing a cue at 235.47s in `levels` (moment-to-bar mapping,
now guarded to 2.5 bars); and two layered chases interleaving so that each was a
beat apart but together they stepped every 175ms.

## 8. Traps — mistakes already made here, do not repeat

- **The wrong referee.** This is the recurring failure. Examples that cost real
  time: measuring the odd lamp on the **dimmer** channel when a par7 profile carries
  brightness in the **colour** channels with master pinned at 255; calling the beat
  grid unaligned because librosa's onset strength peaks *after* the transient and I
  sampled one 23ms frame; reading sync as *worse* after adding accents because the
  raw change count counts an accent's **decay** as a second change (measure rises).
- **Chord boundaries are not on the beat** — median 143ms off, only 30% within 80ms.
  That is the recogniser's frame grid. Quantise chord edges to beats before using them.
- **`pkill -f "claude_composer.py ..."` matches your own shell** and kills it. Use PIDs.
- **`setsid nohup cmd &` makes `$!` the setsid PID**, not the child's. Killing `$!`
  leaves the real process alive, and orphans then overwrite files mid-run.
- **Emulator judder is arithmetic, not slowness.** A 40fps show on a 60Hz display
  holds each frame 1 refresh then 2. Both renderers now blend the two frames either
  side of the playhead (`blendedFrame` in `limelight-ui/lib/sync.ts`). Do not
  "optimise" that away.
- **Post-passes in `author.py` are order-sensitive.** Holes must run *last*; when
  they ran first, a hole's "and back" cue restored the pre-hole colour and reverted
  a later harmonic colour change. Also don't strip `_t` before the final pass — that
  bug made every cue read as t=0 and inherit the last cue of the song.
- **Anything chosen by `len(cues) % n` is a bug.** Two of these shipped and both
  read to Amal as randomness. A choice needs a reason in the music.

---

## 9. Open items

- **The composer is not wired to the new engine.** `portal/claude_composer.py` still
  writes old-model plans against a 37KB brief describing the dead model. Cue lists
  are currently written by `author.py`, which is deterministic — it has no judgement
  about which of several valid treatments suits a song. Teaching the composer to
  author cue lists is the biggest remaining piece.
- **29 other songs are untouched.** `author.py` runs on them (verified on five), but
  nobody has watched those shows.
- The head still only pans and dims. It has tilt, strobe, gobo, prism and a colour
  wheel doing nothing.
- Accents are only `bone` and `saffron`; they could take palette colours.
- `nebulakal` has an 8.7s idle stretch worth a look.
- The old composer path, `portal/venues/*` effects and `portal/baker.js` are all
  still live. Decide with Amal whether to retire them.

---

## 10. Where the reasoning is

Every change in this work is committed with a message explaining the measurement
that motivated it and the numbers before and after. `git log` on `limelight-portal`
is the real design document — read the last ~10 commits before changing the engine.
