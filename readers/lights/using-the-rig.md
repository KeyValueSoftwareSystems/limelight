# Using the whole rig

The rig is four PARs and a moving head. That sounds like five things you can
turn on, and it is really about fifteen things you can do, because the PARs are
not interchangeable — they sit in a row, and a row has an order, a direction, a
middle and two ends. Almost everything that gives a show a personality comes
from using that fact instead of treating the four lamps as one lamp that
happens to be wired four times.

This is a note about what the rig can already do, what it is doing today, and
the gap between them. There is measured evidence for each claim, taken from
`frame.js` as it stands.

## What you actually have

From `arc4-head.layout.json`: four par7 fixtures on a 150 cm arc at −32.5°,
−17°, +17° and +32.5°, and one 13-channel head in the centre. The `arc` group is
sorted by physical x position, so `arc[0]` really is the leftmost lamp and
`arc[3]` really is the rightmost. That ordering is correct and everything below
depends on it.

So the rig gives you five independent dimensions, and today the shows use about
two of them.

There is **level**, which is used well. There is **colour**, which is used but
almost always the same colour on all four lamps at once. There is **position** —
which lamp, out of an ordered row — which is used only by one gesture. There is
**count** — how many lamps are lit at all — which is not used as a dimension at
all; a look is either one lamp or all four. And there is **time between lamps**,
the stagger, which is fixed at exactly one beat and cannot be changed.

## What the chase does today

The arc chase is the one gesture that uses position. Here is what it produces,
sampled every eighth of a beat, which at 128 bpm is about 59 ms:

```
  beat     par_1  par_8 par_15 par_22   lamps lit
  1.000     1.00   0.05   0.05   0.05      1
  1.125     0.86   0.05   0.05   0.05      1
  1.250     0.46   0.05   0.05   0.05      1
  1.375     0.07   0.05   0.05   0.05      0
  1.500     0.05   0.05   0.05   0.05      0
  1.750     0.05   0.05   0.05   0.05      0
  2.000     0.05   1.00   0.05   0.05      1
```

Three things are visible in that table. Exactly one lamp is ever lit, so there is
never a handoff between two lamps. Each lamp has fallen back to the floor by
about a third of the way through its beat, so for roughly two thirds of every
beat the whole rig sits dark. And the next lamp starts from nothing, with no
overlap with the one before.

The eye reads that as four separate blinks in a row. It does not read it as one
thing moving, because nothing is ever in two places at once, which is what
motion looks like. A sweep needs a tail.

## The five moves that would change the most

**Give the chase a tail.** In `renderPar`, the arc branch sets a lamp to the
peak if it is the current step and to the floor otherwise. If instead each lamp
carried a level that decays with how many steps ago it was lit — the current one
at full, the one before at roughly half, the one before that at a fifth — the
same gesture becomes a sweep with a comet trail. This is the single biggest
visual change available for the smallest edit, and it costs nothing at play
time.

**Make stagger an amount rather than a flag.** Today `stagger > 0` only decides
whether to chase at all, and the speed is always exactly one lamp per beat. If
stagger were read as beats-per-lamp, the same code gives you a whip that crosses
the rig in a quarter of a beat, and a slow drift that takes two bars to cross.
Those are two completely different feelings, and the difference between them is
one number.

**Use count as a dimension.** Right now a look is either one lamp or all four.
How many lamps are lit is a dial with four positions and nothing is turning it.
Drive it from the section's fullness or from the energy curve: one lamp in an
intro, two in a verse, three in a build, four in a drop. That alone gives a show
a sense of growth that brightness cannot, because brightness saturates and count
does not.

**Put colour across the arc, not on it.** Four lamps that can each take their own
colour are currently given one colour between them. A hue that shifts along the
row — warm at one end, cool at the other — reads as depth rather than as a wash,
and it costs the same number of DMX frames.

**Let the head and the PARs be one gesture.** The head is currently doing its own
continuous pan sweep regardless of what the PARs are doing. If its pan followed
the chase position, the sweep would cross the whole rig as a single movement
rather than as two unrelated things happening at once. That is the difference
between a rig and an instrument.

## Where the personality comes from

A show has a personality when it has habits — when the same musical situation
reliably gets the same treatment, so an audience learns the rules without being
told. The protocol now gives you enough to build those habits on something real.
These are the mappings worth making deliberate rather than incidental.

How many lamps are lit should follow **fullness** on the section and the
**energy** curve inside it. How spread the light is — inner pair only, versus
both ends — should follow the **width** curve, because that is literally how wide
the record is. Colour temperature should follow **brightness**, so the rig warms
and cools with the track instead of on a timer. Chase speed should follow
**pace**, so a double-time section moves faster without anyone choosing that.
Whether the rig is chasing at all, or holding still, should follow the
subsection's **doing** — a section that is sustaining wants stillness, and one
that is intensifying wants motion.

Direction is worth thinking about on its own, because it is the dimension a
four-lamp row has and a single lamp does not. A section with a positive **rise**
is going somewhere, and a sweep that travels outward from the centre says that.
A section with a negative rise is falling away, and a sweep that collapses
inward says that. Use the sign of `rise` to choose the direction and the show
starts agreeing with the music without anybody scripting it.

Then there is restraint, which is most of it. The protocol now tells you how
much each moment matters, so you can pick the top few in a song and give them
the whole rig — all four lamps, the head, full level — and leave everything else
to one or two lamps. A drop only lands if the eight bars before it were smaller.
The `silence` layer and the low-energy bars are not gaps to fill; they are the
thing that makes the rest legible.

Finally, repetition. The protocol says when a section is the same material as an
earlier one. If the second chorus looks like the first, the audience recognises
it, and recognition is most of what separates a show that feels composed from
one that feels generated. A fresh random look every eight bars is not variety,
it is noise — it destroys the pattern the audience was starting to learn.

## The order I would do them in

The tail on the chase first, because it is a few lines and it changes how every
existing chase looks. Then count as a dimension, driven from fullness, because
it gives the show a shape across the whole song. Then stagger as an amount, so
speed becomes something the music can set. Then colour across the arc. Then the
head following the sweep, which is the most work and the most striking.

None of this needs a new protocol field. Everything above is already in the
response.
