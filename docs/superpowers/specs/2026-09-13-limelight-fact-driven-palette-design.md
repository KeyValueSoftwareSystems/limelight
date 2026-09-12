# Limelight — a fact-driven palette and matrix (enumeration rev 3)

- **Date:** 2026-09-13
- **Branch:** `ground-zero`
- **Status:** design, awaiting user review
- **Parent specs:** `2026-09-12-limelight-effect-enumeration-design.md` (the taste gate),
  `2026-09-12-limelight-reader-design.md` (the reader)
- **Builds on:** the reader work of 2026-09-12/13 — `musical.js` (shape-agnostic readers
  of subsections, moments, lanes, harmony), the arranger's carved variations and
  modulation, the head's aim anchors and room-scale motion, `wire.js`.

## Why this exists

The user's words: *"can we create better sequence patterns and better matrix, given
all the new types of information we can capture from the protocol?"*

Today the score's finer structure reaches the show only as **modulation** on top of
looks chosen from eight coarse form contexts. Subsections step a context calmer or
bolder; presence, texture and harmony scale levels and tint colours; moments are four
fixed effects written into the arranger and frame. Neither the palette nor the matrix
has a word for "the voice comes in", "the riff hook", "tension winding up to a
release" or "the chord is A". This spec gives them those words.

Two more of the user's words shape it. On speed: *"it's not doing any quick stuff,
like the light moving back and forth between pars in a really quick interval, the max
speed possible even at the DMX rate."* On generation: *"include in the system prompt
all the info needed, so that any model, not just the best, can create this thing for
any given layout."*

Five gaps, each one a design limit rather than a data limit:

1. The matrix has one axis, form. Everything else the score says is invisible to it.
2. A sequence carries fixed RGB, fixed keyframes and one suitability row. It cannot say
   "the chord's colour", "one lap per phrase", "follow the bass", or "last 4 beats".
3. Moments are hard-coded: a hit is always a white flash, a pause always a hush.
4. The level shape comes from the context, so a breath drawn as a variation renders as
   hits.
5. Nothing moves faster than twice a beat. Pattern clocks are beat-locked with a pace
   subdivision of at most 2, so a trade between pars never exceeds about 4 Hz; the
   rig can do eight times that.

## Inherited constraints (unchanged)

- Positions are bars and beats; the plan never sees seconds or tempo.
- `plan()` is pure and deterministic in `(score, seed)`; no LLM at play time.
- Sequences are chosen through the matrix; nothing is hard-coded by id.
- Concurrent sequence assignments never share an `occupies` token; typed modifiers ride
  on top and are resolved by priority.
- The score says what the music does, never what a lamp should do. Every word added
  here to the palette side is a lighting word; every word on the matrix side is a
  musical fact the protocol already emits.
- Scores without the richer fields bake as they do today.

## The target rig (changed 2026-09-13)

The four PARs now stand in a **straight line, 50 cm apart, all facing the same way**,
with the moving head in the middle. Seen from behind the rig the right-most lamp is
@1, then @8, the head @29, @15, @22. The layout file states its frame of reference so
no reader has to guess: positions are metres in the **audience frame**, +x to the
audience's right, so @1 is at x = -1.0, @8 at -0.5, the head at 0, @15 at +0.5, @22 at
+1.0. Beams are parallel, so a lamp's position IS its position on the wall and spatial
patterns read one-to-one (a chase walks 50 cm per step).

Consequences:

- `arc4-head.layout.json` carries `geometry: "line"` and `frame: "audience"`; the
  `arc` group keeps its name as "the lamps in order" and is derived from x as before.
  Inner is the pair beside the head (@8, @15), outer the ends (@1, @22).
- `rig.py` (the hardware authority in `experimentation/music_sync`, mirrored in the
  panel) still describes the arc: `PAR_ANGLE_DEG`, `ARC_RADIUS`, `par_wall_x`. Its
  owner updates it; `gen_layout.py` then regenerates the layout from it. Until then
  the layout is hand-edited from the user's description and says so in its note.
- The rig id stays `arc4-head` (file names, the panel, the bake); it is an
  identifier, not a description.
- Everything geometric the palette needs (positions, spacing, facing, the head's aim
  anchors and travel) is emitted into the generation prompt from the layout and the
  driver profiles, never assumed by the prompt text.

## What the score says, per bar

All read by `musical.js` from either score shape (raw or format_v1), all already
verified byte-identical across the two shapes.

| Fact family | Values (the vocabulary the matrix will use) | Source |
|---|---|---|
| **form** | intro, verse, break, build, drop, outro, silence, final_drop | sections + energy + arc (`contextsFor`, as today) |
| **doing** | establishing, intensifying, peaking, easing, suspending, resolving, closing, holding | `layers.subsection[].doing` / `phrases[].doing`; `holding` when null |
| **presence** | drums:in / drums:out, bass:in / bass:out, vocals:in / vocals:out (the stem lanes' own names) | per-bar stem lanes against a threshold (0.3 of the stem's own peak) |
| **moment** | entrance, release, hook, pause, fill, rise, exit, accent, change; with a weight band light (< 0.5), firm (0.5–0.75), heavy (≥ 0.75) | `moments[]` |
| **texture** | narrow / wide, sparse / busy, dull / bright | width, pace, brightness lanes, per-song normalised: below 0.33 / above 0.67; the middle third is neither |
| **harmony** | minor / major; changing (the chord changed on this bar) | per-bar chords + key |

The arranger already computes everything in this table; the change is that it hands
it to the matrix instead of only to the renderer.

## The context vector

A **context** is no longer a column name. It is a small vector of facts for one bar
(or one moment instant):

```
{ form: "drop", doing: "peaking", presence: ["drums:in", "bass:in", "vocals:out"],
  moment: null, texture: ["narrow", "busy", "bright"], harmony: ["minor"] }
```

Rules:

- `form` is always present. Every other family may be absent (the score did not say)
  or a list of facts.
- A **bare string** is still accepted everywhere a vector is (`candidates("drop")`), and
  means `{ form: "drop" }`. This is the backward-compatible path and the path scores
  without richer fields take.
- Vectors are built by the arranger, deterministically, once per bar, and recorded in
  the plan as `plan.facts` (an anchored per-bar array) so the panel timeline and the
  CLI can show *why* a look was chosen.
- For a **section's base look**, the vector is the section's form plus the facts that
  hold for the majority of its bars. For a **subsection variation**, it is that
  subsection's own vector. For a **moment**, it is the moment fact plus the bar's
  facts.

## What a sequence declares

The `suitability` row becomes one family of a richer `affinity`. Existing palettes
convert mechanically at enumeration time: `suitability` → `affinity.form`.

```
affinity: {
  form:     { intro: 0, verse: 0.4, ..., final_drop: 0.9 },   // required (today's row)
  doing:    { peaking: 0.9, intensifying: 0.8, easing: 0.2 }, // optional
  presence: { "drums:in": 0.9, "drums:out": 0.1 },            // optional
  moment:   { entrance: 1.0, release: 0.9 },                   // one-shots only
  texture:  { busy: 0.8, narrow: 0.7 },                        // optional
  harmony:  { minor: 0.6 }                                     // optional
}
```

Semantics, fixed by this spec:

- A family the sequence does **not mention** is neutral: it does not enter the score.
- Within a mentioned family, a fact the vector carries that the sequence scores **0**
  is a **veto**: the cell is 0. A fact the vector carries that the sequence does not
  list scores the family's `_default` if given, else 0.5.
- Values are 0..1, validated like suitability today.

New gesture fields, all optional, all rendered by `frame.js`:

| Field | Values | Meaning |
|---|---|---|
| `mode` | hold, breathe, hit, chase, follow | the level shape; wins over the context's mode when declared, so a breath stays a breath |
| `colour` (in a key) | `[r,g,b]` as today, or `{ role }` with role root, third, fifth, contrast, white | roles are filled from the bar's chord: root = the chord's hue on the circle of fifths, fifth = +7 semitones, third = major or minor third by the chord, contrast = the opposite hue; without harmony, roles fall back to the key's hue, else to the seeded hue |
| `follows` | bass, drums, vocals, other, tension, energy | the PAR level (or head dimmer) tracks that lane between floor and peak, per-song normalised |
| `on` | beat, downbeat, chord_change, phrase | when discrete steps (trades, chase steps, colour changes) may happen; default beat |
| `duration_beats` | integer > 0 | one-shots only: how long the sequence lasts from its trigger; a moment's `for_beats` overrides it |
| `program` (head) | keyframes (default), figure8, circle, wall_scan, audience_sweep, spiral, corner_snap | parametric head paths, room-scale by construction, scaled by motion and capped by the wire like keyframes today |
| `strobe` (in keys) | 0..1 at `at` beats | interpolated over the sequence's span (a riser ramps), not merely held |
| `steps_per_beat` | 1, 2, 4, 8, or `max` | how many pattern steps (trades, chase steps, flicker flips) fit in a beat; the pace subdivision (0.5, 1, 2) multiplies it; `max` is the fastest clean rate at the render rate (see Speed) |

A new `kind`, **`oneshot`**, sits beside individual, compound and combination: a
sequence triggered by a moment, lasting `duration_beats`, with `affinity.moment`
required and `occupies` declared like any other sequence.

## Speed: the quick stuff

The plan stays in beats (the two-clock rule), so "as fast as the DMX rate" is a
question the renderer answers, not the plan. Rules:

- A pattern's step clock is `steps_per_beat x pace subdivision`, evaluated on the
  musical position as today, so a trade at 8 steps per beat flips on every eighth
  of the beat and re-aligns on every downbeat.
- `max` resolves in `frame.js` from the render rate the bake declares (`ctx.fps`,
  40 today) and the score's tempo (`plan.grid.bpm`): the largest power of two that
  leaves at least two frames per step. At 128 bpm and 40 fps that is 8 steps per beat,
  about 17 flips a second. Knowing the render rate is a renderer fact, like the
  display gamma; the transport's rate changes do not move it, because baked frames
  are simply played faster or slower.
- Faster than every second frame is aliasing, not speed. Per-frame flicker (20 Hz at
  40 fps) is what the fixture's own **strobe channel** is for; the par7 profile
  declares `strobe.max_hz: 25`, and `flicker` sequences drive it with `strobe` in
  their keys rather than flipping levels.
- The head is excluded: its pose is slew-limited on the wire and its quick moves are
  kicks and snaps, never a step clock.

A new **fast** family uses this: `ping_pong` (a single lit lamp bouncing along the
line at `max`), `flicker_pair` (inner and outer trading at 8), `rapid_chase`
(one lap per beat), `shutter_alt` (all lamps flashing alternately with the head
dimmer). Their affinities: drops, peaks, fills and busy bars high; intro, silence and
sparse bars vetoed. Texture's `busy` fact is what lets the matrix reach for them.

## Scoring

```
cell(seq, vector) = fit(seq, layout) x geomean( affinity[family][fact] for every
                    family the sequence mentions and the vector carries )
                    -- 0 if any mentioned fact is a veto; FIT_FLOOR gating as today
```

`view(result).candidates(vector)` returns the sequences with cell > 0, sorted, exactly
as today's `candidates(ctx)`. `pickWeighted` draws by cell, so the seed still chooses
among tasteful options and never outside them.

The cached `<layout>.matrix.json` cannot be a flat sequence-by-column table any more,
because vectors are combinatorial. It becomes:

```
{ sequences, fit: { seq: 0..1 },
  affinity: { family: { seq: { fact: 0..1 } } },
  matrix: { seq: { form: 0..1 } },      // the form table, kept for the report and compat
  report }
```

`candidates(vector)` computes cells on the fly (about a hundred sequences, a handful
of facts: negligible). `preflight.js`'s CLI report gains a "strongest by fact" section
per family so taste stays inspectable.

## The arranger with vectors

- **Base look per section:** `pickFor(sectionVector, "par")` and `"head"`, as today
  but with the vector. Budgets per form context remain.
- **Subsection variations:** chosen with the subsection's vector. This replaces the
  CALMER / BOLDER context stepping; the carving of the base and the
  first-subsection-keeps-the-base rule stay.
- **Moments:** each moment builds its vector (moment kind and weight band plus the
  bar's facts) and draws a **oneshot** from `candidates(vector)` filtered to
  `kind === "oneshot"`. It is placed at the exact bar and beat for `for_beats` or the
  sequence's `duration_beats`, as `layer: "fx"` with the sequence's `occupies`. One-shots
  pre-empt by priority as today's fx do; the arranger checks that no two one-shots
  overlap on a token and drops the lighter one if they do.
- **Fallback:** when no oneshot candidate exists for a moment (an old palette, or an
  unknown kind), the current fixed effects (blast, breath blackout, hush, hook lift)
  are used unchanged. Scores with no moments keep the drop-boundary blackout and blast.
- **Modulation and lanes stay.** Texture, presence density and harmony tint keep
  riding on top; a sequence that declares `follows` or colour roles simply uses the
  same lanes more precisely.
- `plan.facts` is recorded per bar; `bake.js` exports it in the timeline next to
  `looks` and `moments`.

## Rendering additions (`frame.js`)

- `mode` from the sequence overrides `params.mode`; `chase` is the arc chase's own
  clock; `follow` maps the named lane onto floor..peak.
- Colour roles resolved per bar from `plan.harmony`; the existing tint then applies
  only to fixed RGB colours, never to a resolved role (a role is already the harmony).
- `on` gates the discrete steps: chase steps and trades at `downbeat` or `phrase`
  advance only there; `chord_change` advances when `plan.harmony` changes.
- Head `program` paths are generated parametrically about the gesture's pose (or the
  wall), scaled by the same extent-by-motion and capped by the same wire rule as
  keyframes. `wall_scan` rows across the wall band (tilt near 0.5); `audience_sweep`
  crosses tilt 0.7–1.0; `corner_snap` is a one-shot pose change on the beat.
- Strobe ramps: a gesture whose keys carry `strobe` values interpolates them across
  its span (the riser `strobe_accelerating` describes).

## New sequence families (base anchors, then LLM breadth)

Hand-tuned base vocabulary in `preflight.js` first, so the matrix has taste before the
LLM fills it out; then `generate.py` asks for breadth in each family.

| Family | Sequences | Facts they answer |
|---|---|---|
| one-shots | impact (blast + head to centre + prism), breath (dark hold before a hit), riser (whiten + strobe ramp over N beats), hush (levels sink, head parks low), fill_flicker, release_bloom (a slow colour bloom after a release) | moment kinds and weight bands |
| presence-reactive | voice_follow (head dim and warmth follow the vocal lane, prism off, motion low), bass_pulse (inner pair follows bass), drums_out_hold (pars hold a static colour while drums are out), band_in_wash (all pars open when the band is in) | presence |
| structural | phrase_chase (one lap per phrase, `on: phrase`), tension_ramp (`follows: tension`, whitening toward a release), chord_wash (`on: chord_change`, colour roles root/fifth), width_arc (arc spread follows width) | doing, harmony, texture |
| head programs | figure8, circle, wall_scan, audience_sweep, spiral, corner_snap | form and doing (room-scale in drops and peaks; wall-scale in intros and easing) |
| fast | ping_pong (`max`), flicker_pair (8), rapid_chase (4), shutter_alt (`max`, strobe channel) | drop, final_drop, peaking, fill, busy |

## Validation (`preflight.validateSequence`)

Extended, not replaced: `affinity.form` required (or legacy `suitability`); other
families optional with facts from the fixed vocabulary above; every value 0..1;
`mode`, `on`, `program`, colour `role` from their enums; `follows` from the lane
names; `steps_per_beat` one of 1, 2, 4, 8, `max`; `duration_beats` a positive integer,
required for `oneshot`; a `oneshot` must declare `affinity.moment`. Everything the current validator checks still applies
(caps, groups, dangerous types, combination self-conflict).

## Generation (`generate.py`): a prompt any model can follow, for any layout

The prompt must carry **everything** a model needs, so that a mid-size model produces
a valid, tasteful palette for a rig it has never seen. Nothing about this rig may be
baked into the prompt text; every rig fact is emitted from the layout and the driver
profiles at run time. The prompt has these sections, in this order:

1. **The job, in one paragraph.** Propose N lighting sequences for the rig below,
   as JSON matching the schema; they are validated mechanically and the survivors
   are chosen by a seeded arranger against musical facts, so honesty in the scores
   matters more than breadth.
2. **The rig, emitted from the layout.** Each fixture: id, type, position in metres
   in the stated frame, address. Derived: the ordered group and its spacing, inner and
   outer, the head's position. From the driver profiles: each type's capabilities,
   the PAR strobe range, the head's colour wheel slot names, gobo and prism names,
   pan and tilt travel in degrees with the aim anchors explained (0.5 is the wall
   spot, 0 and 1 the ends of travel, tilt 1 past vertical toward the back).
3. **What a sequence is.** The schema field by field, with each field's exact
   semantics and range, quoted from this spec: kind, boldness, requires, occupies
   (the token list and what a clash means), gesture (group, keys, `at` in beats,
   repeat), and every new field: mode, colour roles, follows, on, duration_beats,
   program, strobe ramps, steps_per_beat.
4. **How it is rendered.** What the renderer does with the fields, so the model can
   predict the look: hits spike on the step clock and sag to the floor; trades hold a
   pair bright and the other dark; chases move one lamp per step; breathe is one
   cycle per bar; the head eases through keyframes, is stretched to the room by
   energy, is capped at half its travel per beat; discrete attributes change on beats;
   `max` steps per beat is about 8; colour roles come from the current chord.
5. **The musical facts, with meaning.** Every fact family and value from the table
   above, each with one sentence of what it sounds like ("easing: the section is
   letting go, often a bar out then back"; "vocals:in: a voice is present; the head
   tends to it").
6. **Taste rules.** Boldness budgets per form; contrast needs a dark floor; the
   wheel is mechanical, so colour changes sit on beats and prefer adjacent slots;
   never strobe the head; intro, outro and silence are ambient; the final drop is the
   boldest place in the song; a sequence should be usable in more than one place but
   honest about where it is weak.
7. **Quotas.** How many of each kind and each new family, and at least one head
   program of each named type.
8. **Worked examples.** Three complete, valid sequences: an individual with colour
   roles and `on`, a `oneshot` with `duration_beats`, and a head `program`; and one
   deliberately invalid sequence with the validator's message for it.
9. **Output contract.** JSON only, matching the schema (enforced with structured
   output where the API offers it); ids unique and descriptive; every affinity value
   0..1; no prose.

Robustness for any model: `generate.py` validates the reply with the same
`validateSequence` the runtime uses, and on failure re-prompts with the exact
rejections ("`bass_pulse`: unknown fact `voice:on`; allowed: ...") up to three times,
keeping the survivors. Generation stays offline and cached per layout; the runtime
never calls a model. The prompt text itself is checked in as a template with the rig
sections rendered from data, and a test renders it for the current layout and
asserts every fixture id, every fact value and every field name appears in it.

## Backward compatibility

- An existing palette enumerates unchanged: `suitability` becomes `affinity.form`, no
  new fields means today's rendering.
- A score without subsections, moments, lanes or chords yields vectors that carry
  only `form`; picks are then made from the form family alone. The draw order is
  preserved, so an existing seed keeps its sequence picks on such a score.
- The Python parity test (`format_v1 == raw`) must stay green: every fact is read
  through `musical.js`, which already reads both shapes identically.

## Testing

- **musical / arranger:** vectors per bar are deterministic and shape-agnostic;
  `plan.facts` matches the score's subsections, presence thresholds and moments; a
  subsection variation is drawn with its own vector; one-shots land at the exact bar
  and beat for the right length; the fallback effects appear only when no one-shot
  candidate exists; zero token clashes on levels.
- **preflight:** `candidates(vector)` equals `candidates(form)` for a form-only vector;
  a veto zeros a cell; unmentioned families are neutral; the geometric mean is
  order-independent; `suitability` converts to `affinity.form`; the validator accepts
  every new field and rejects an unknown fact or role; the cache round-trips.
- **frame:** `mode` overrides the context's mode; colour roles resolve from the bar's
  chord (root, fifth, third, contrast) and fall back without harmony; `follows` tracks
  a lane between floor and peak; `on: downbeat` and `on: chord_change` gate steps;
  every head program stays inside 0..1, respects the wire cap, and covers the room at
  full motion; strobe ramps interpolate.
- **speed:** `steps_per_beat` 8 flips a trade eight times a beat and re-aligns on the
  downbeat; `max` resolves to 8 at 128 bpm and 40 fps and to 4 at 200 bpm; a fast
  sequence is vetoed in an intro by the matrix.
- **generation:** the rendered prompt for the current layout names every fixture,
  every fact value and every field; an invalid reply is re-prompted with the
  validator's message.
- **bake / parity:** timeline carries `facts`; raw and format_v1 bake identically.
- **rig:** each new base sequence previewed through `preview.js --lights` with the
  other session, as for the head work.

## Phases

| Phase | Deliverable | Acceptance |
|---|---|---|
| **A** | context vector, per-family affinity and scoring in `preflight.js`; the arranger builds vectors and draws base looks and variations with them; existing palette converted; `plan.facts` | every pick on levels is explained by its vector in the CLI; parity and all suites green; no clashes |
| **B** | `oneshot` kind, base one-shot sequences, moment drawing in the arranger, fallback preserved | on levels the bar-9 entrance, the hooks and the bar-51 pause each resolve to a one-shot chosen by weight band; a score with an old palette still shows today's effects |
| **C** | `mode`, colour roles, `follows`, `on`, `steps_per_beat` and `max`, head programs, strobe ramps in `frame.js`; base fast, presence-reactive and structural sequences; validator extended | each field pinned by a frame test; base sequences reviewed on the rig, the fast ones first |
| **D** | `generate.py` rewritten around the full prompt; palette regenerated with a mid-size model as the proof; `preflight.js` re-enumerated; rig pass | the report shows every family populated; a mid-size model's palette passes validation within three rounds; the show on three songs judged by eye against today's |

Each phase leaves the suite green and the show bakeable; phases can ship separately.

## Open decisions

1. **Neutral weight for a listed-but-unscored fact.** This spec says 0.5 unless the
   family gives `_default`. The alternative, neutral (excluded from the mean), makes
   sparse affinities safer but lets a sequence ignore a fact family it half-filled.
2. **Texture as a matrix family versus modulation only.** This spec makes it a family
   so a chase can prefer busy bars; if it double-counts with the lane modulation in
   practice, drop the family and keep the modulation.
3. **Head program set.** Six are named; the rig pass decides which earn a place.
4. **Model for regeneration.** `generate.py` defaults to claude-sonnet-5; a stronger
   model may score affinities more honestly. Decide at phase D.
