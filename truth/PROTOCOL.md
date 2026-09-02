# How a truth file is made

By a **human**, with the audio playing. Not by a model, not by an agent, not by inference from a
tracklist. This is the only file in the project that cannot be generated, and everything the
bench says depends on it being honest.

## The one rule

**Never fill a field you did not verify.** `null` is a legitimate answer and it is worth far
more than a guess, because a guess is indistinguishable from truth once it is written down. One
invented timestamp makes every bench number afterwards a lie, and it does it invisibly — the
number still prints, it is just measuring nothing.

If you are unsure, write `null` and put why in `note`.

## What to tap, and what not to

**Beats — do not tap the whole song.** Tapping 1,359 beats by hand is how truth files stop
getting made. Pick a thirty-second window, tap only that, and record it:

```json
"beats_window": [96.0, 126.0]
```

The bench grades beats **only inside the window**. Thirty seconds of honest beats is worth more
than ten minutes of tired ones. Choose a window that contains something hard — a fill, a
half-time section, a place where the kick drops out — because that is where trackers fail and an
easy window measures nothing.

**Downbeats.** Tap the "one", the beat you nod hardest on. Same window.

**Chapters.** Scrub, listen for where the character changes, and round each boundary to the
nearest downbeat. A boundary between downbeats is almost always a mis-hear. Names are plain:
`intro`, `verse`, `build`, `drop`, `break`, `outro`.

**Moments.** Six kinds and no others: `build`, `drop`, `stop`, `quiet`, `spotlight`, `return`.
The drop is easy and worth getting to the frame. For a `stop`, measure how long the gap actually
lasts and put it in `holds` — this is the number people get wrong most often, and a stop that is
200 ms too long reads as a mistake in the room.

**Spans.** Play the stretch twice. First decide where it starts and ends. Then decide the shape
by listening to the middle: did it climb evenly (`steady`), sit still and then rush (`late`),
jump early and then flatten (`early`), or arrive in discrete steps (`stepped`)? The shape matters
as much as the position — the bench scores them separately, because a span in the right place
with the wrong shape produces a room that lifts at the wrong time.

**Energy.** Do not try to be precise. One value every eight bars is plenty; readers interpolate
between them. Use a dial of 0 to 10 in your head and divide by ten. What matters is direction
and relative height, not the third decimal.

## Two people, independently, for the first song

Both fill a truth file without seeing the other's. Then compare. If you disagree by more than
the bench tolerance, one of three things is true, and it is worth knowing which:

- the tolerance is wrong,
- the song is genuinely ambiguous at that point — record it in `note`, and treat the model getting
  it "wrong" there as a non-event,
- one of you was careless.

Disagreement is information. Resolve it before you write a second truth file, not after twenty.

## Who owns this

Renjith owns truth and taste. Not by seniority — because a person who both builds the model and
decides what counts as correct will grade generously, and not through dishonesty. Through hope.
