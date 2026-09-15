# How a show gets made

The lighting model, and the composer that writes shows in it. Worked against the
current protocol response for `raga-of-revenge` — 24 fields, 32 moments, 39 named
instrument lanes at half-second resolution.

---

## Light has four dimensions and no more

A rig is a set of emitters. At any instant each has an amount of light, a colour,
a direction if it can move, and a beam quality if it has optics. Every lighting
gesture anyone has ever made is a change to one of those over time.

- **amount** — how much light is in the room
- **colour** — what colour it is
- **place** — which emitters carry it, and therefore where the light is
- **rate** — how fast any of the other three is changing

A strobe is rate applied to amount. A chase is place moving over time. A blackout
is amount to zero. We previously had a library of 98 looks and 17 effects, of
which one song used 13 and 13, and 13 of the 98 had never been chosen by any song
at all. Names multiply without limit; dimensions do not.

## A show is three kinds of thing

**State** — what the rig rests at across a span. It changes at section
boundaries, and everything else is a departure from it. Shows without a defined
resting condition feel flat, because nothing has anything to contrast against.

**Binding** — a continuous link from a measured stream to a dimension. Amount
follows the kick. Place follows two vocal lanes. A binding holds until replaced.

**Gesture** — a bounded departure at a position. Seven properties describe one
completely: the dimension, the magnitude, the duration, the shape (step, ramp,
swell, settle), the extent, whether it travels and how fast, and **whether it
returns or becomes the new state**.

That last property is the one worth arguing about. A blast returns. A register
shift does not — the music went up and stayed up, and so should the light.

## What a creator sees

All of the above is the renderer's business. A creator opens a palette of named
effects and drags one onto a lane, exactly as before. A named effect is a
**preset**: a saved set of values over the four dimensions. Open one and you see
its dials; change a dial and you have, without being told, authored a new effect.
Saving it under your own name is the whole of the custom-effect feature.

In a video editor you drag *Cross Dissolve*. The renderer knows opacity over
time. Nobody types opacity curves, and nobody wants a renderer that knows a
hundred named transitions instead of knowing opacity.

## What this asks of a venue

A venue does not implement a named library that grows whenever somebody has an
idea. It declares which of the four dimensions its fixtures can move, and over
what range. Every gesture and binding is then either expressible on that rig or
honestly refused. Small, fixed, testable, and it does not change when we invent
something.

---

# The composer

A model composes each show **once, offline**. It is never between the music and
the lamps, so a slow or missing model delays making a show and can never
interrupt one that is playing.

```
score file → hub formatter → protocol response
                                    ↓
                     overview  +  retrieval tools
                     profile   +  palette
                                    ↓
                              the model
                                    ↓
                    validator  (ours, not optional)
                                    ↓
                               show file
                                    ↓
              renderer + layout → frames → rig
```

Everything either side of the model is deterministic. The validator is not
optional and is not the model's job.

## What it is given

Structure now, detail on request. The overview is the caption, every section, all
32 moments, all 24 emotion spans, and an index of every stream that exists.
Everything heavier is a tool call away:

```
lane("harp", 110, 125)
onsets(48, 56, 0.5)
compare(["lead-vocal", "back-vocal"], 48, 82)
chords(from_s, to_s) · melody(from_s, to_s) · moment(i) · section(i)
```

Long windows come back summarised, so a question about a minute of melody returns
its range and contour rather than 400 notes. Give it a call budget — twenty is
generous for one song — because a model with tools will spend forty and produce
nothing.

A fixed digest would have been us guessing in advance which detail makes a cue
good. Whether the harp deserves its own lamp depends on the harp's lane. Whether
two vocals genuinely alternate depends on comparing them.

## What it returns

**The model's reply is not the show file.** It is the instruction to build one —
the same relationship a submitted form has to the record it creates.

Every moment in the response already carries its own bar, beat and time, so the
model never calculates a position. It copies one.

```jsonc
// what moment 16 looks like in the response
{ "i": 16, "at": { "bar": 24, "beat": 3 }, "time_s": 52.26,
  "type": "peak", "intensity": 1.000,
  "description": "the loudest the song gets" }
```

```jsonc
// what the model replies
{ "plan": "Devotional call and response. Moments 16 and 27 carry the whole show.",

  "states": [
    { "section": 0, "effect": "drone", "amount": 0.12, "colour": "amber",
      "why": "one voice and nothing else; leave somewhere to go" } ],

  "bindings": [
    { "section": 2, "effect": "split", "streams": ["lead-vocal", "back-vocal"],
      "why": "they alternate every 2.7s and overlap under 15% of the time" } ],

  "gestures": [
    { "moment": 16, "lead_beats": 1, "effect": "blackout", "for_beats": 1,
      "why": "the biggest moment in the song earns the only silence before it" },
    { "moment": 16, "effect": "impact", "colour": "white",
      "why": "intensity 1.00; the one whole-rig moment in the song" },
    { "moment": 27, "effect": "lift", "magnitude": 0.35,
      "why": "a register shift is a rise, not a hit" } ] }
```

Short, and every line is a judgement rather than a number. The only arithmetic is
`lead_beats`, and **the hub does that subtraction** — which matters, because
moment 16 sits on beat 3, and a model asked to find the beat before a downbeat
will eventually cross a bar line and get it wrong.

## What gets stored

```jsonc
{ "id": "g7",
  "effect": "impact",
  "bar": 24, "beat": 3, "at_s": 52.26, "for_beats": 1, "to_s": 52.76,

  "dimension": "amount", "magnitude": 1.0, "shape": "step",
  "extent": "all", "travel": 0, "returns": true, "colour": "white",

  "from_moment": 16, "author": "model",
  "why": "intensity 1.00; the one whole-rig moment in the song" }
```

Nothing here needs interpreting. The editor draws that row, the player consumes
it, a person reads it. `from_moment` says why the cue exists and lets the hub
re-resolve it if the song is analysed again. `author` separates what the model
decided from what a person changed afterwards.

Expanding `impact` into its dimension and shape is a dictionary lookup, not an
interpretation — the same as a browser turning `bold` into 700. The name is kept
because the editor labels the clip with it, and because **a venue with a better
Impact of its own substitutes on the name**.

## The system prompt

```text
You compose lighting shows for Limelight. You run once per song, offline. You are
never between the music and the lamps.

LIGHT HAS FOUR DIMENSIONS
  amount   how much light is in the room
  colour   what colour it is
  place    which emitters carry it, so where the light is
  rate     how fast any of the other three is changing

A SHOW IS THREE KINDS OF THING
  state     what the rig rests at across a span. Everything departs from it.
  binding   a continuous link from a measured stream to a dimension.
  gesture   a bounded departure, which either RETURNS or becomes the new state.

You place all three by NAMING AN EFFECT and POINTING AT something the response
already numbered — a moment, a section, an emotion span. Never write a bar
number: every moment already carries its own bar, beat and time, so you are
copying a position, not calculating one.

  { "moment": 16, "effect": "impact" }
  { "moment": 16, "lead_beats": 1, "effect": "blackout" }   // the beat before it
  { "section": 2, "effect": "split", "streams": [...] }
  { "from_moment": 11, "to_moment": 16, "effect": "ramp" }  // a span

RULES
1. Anchor everything. Never compute a position; you will get it wrong.
2. Measurement places, prose characterises. Moments and intensities decide WHERE.
   The caption and the emotion text decide only how it should FEEL. A caption
   calling a song restrained must never remove a gesture a high intensity earned.
3. Intensity is relative to this song. 1.00 is the biggest thing HERE, not in
   music. The largest gesture the profile allows belongs to those moments and no
   others.
4. Most moments get nothing. A show that answers everything has said nothing.
5. Darkness is a gesture, and it is the strongest one you have.
6. The state does more work than the gestures.
7. Bind only to streams named in the overview. Never invent an instrument.

ASK FOR WHAT YOU NEED
You start with structure only. Call lane, onsets, chords, melody, moment, section
or compare to look at anything else in the response. Long windows come back
summarised. You have twenty calls.

HOW TO WORK
Write the plan first: one sentence on what this show is about, then the two or
three moments that carry it, by index. Commit before placing anything.
Then states, then bindings, then gestures — fewest first, largest first.
Every entry carries a short `why`. Somebody will read it and disagree with one
line rather than regenerate everything.

Return only JSON.
```

## What the hub does with the answer

Validate before rendering anything. Every dimension must be one of the four.
Every stream a binding names must exist, so the model cannot bind to an
instrument it imagined. Every reference must resolve.

Then **enforce the profile's budget after the fact** rather than asking for it —
if it spent three whole-rig gestures where the profile allows two, cut the one
with the lowest intensity. You cannot ask a model to respect a quota; you can
check one.

Where two things want the same dimension at once: a gesture beats a binding, a
binding beats the state, the larger magnitude wins a tie, and **the loser is
reported rather than silently dropped**. The editor shows that as layer order,
which is the same rule made visible — and therefore arguable by dragging.

A show that fails validation is rejected with a reason and shown to whoever asked
for it. It is never quietly half-played, because a half-played show looks like a
fault in the rig rather than a fault in the composer, and the venue gets blamed
for our mistake.

## Two things not to build

**A compose-then-revise agent loop.** Anything mechanically checkable — the
budget, the references, the streams — is cheaper and more reliable as validation.
A model grading its own show is weak evidence, and every extra pass is another
chance to undo a good decision at three times the cost. The one exception worth
building is **repair on failure**: hand validation errors back, allow one retry,
then fall back to the deterministic composer so a misbehaving model never means
no show.

**Composing straight to frames.** The show file must stay free of light. No
channels, no fixtures, no colour resolved to a lamp. That one property is why a
single file plays in any room, and why a bigger room gives a bigger show rather
than a broken one.

## Where an agent does earn its keep

Not composing — the **conversation box in the creator**. *"Make the chorus
calmer."* *"Lose the strobe at 63 seconds."* It reads the current show, the
response and the request, and returns **edits, not a new show** — so the change
is reviewable, lands in the undo stack like a drag, and costs one keystroke to
reject. It needs the selection context (playhead, selected clip) or *"make this
calmer"* has no referent. It goes through the same validator. And a human closes
the loop, which is exactly what a self-revising composer lacks.
