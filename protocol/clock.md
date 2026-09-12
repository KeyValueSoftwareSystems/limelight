# Syncing a clock to the music

Every app on this protocol asks the same question — where are we in the song —
and the protocol answers it in musical terms: bar 33, beat 2, eight bars until
the drop. But something has to tell it where the song is in plain seconds, and
that something is a clock. Everything you build is only as good as that clock
is honest, so this page is about how to get it right and how to prove you did.

## The rule

Your clock must **measure** where the audio is. It must never **calculate**
where the audio ought to be.

That is the whole rule. The rest of this page is why it matters and how to
satisfy it.

## The three ways people build this

The first way is to start a timer when the player presses play, and report the
time elapsed since. In a game this often means adding up frame deltas, which is
the same mistake wearing a costume. This is wrong in three ways at once. The
timer starts before the sound does, so it runs ahead of the music by however
long the audio took to begin. That head start is a different number every run,
because it depends on buffers and decoding and what else the machine was doing,
so no calibration setting can remove it — tune it perfectly tonight and it is
wrong tomorrow. And the sound card's own clock does not run at exactly the speed
the CPU thinks it does, so the two slide apart over the length of a song.

The second way is to read the audio's position directly every frame. This is
accurate, and it is what most people try next. The problem is that an audio
element only updates its position a few times a second, not every frame. So the
value you read is a staircase. In our test, eighty-one frames out of a hundred
and twenty returned the same number as the frame before. Anything you draw from
it judders — in a rhythm game the notes visibly step toward the player instead
of sliding, and it looks broken even though the timing is right.

The third way is the one to use. Read the audio's position, and between its
updates carry the number forward with an ordinary timer — but re-anchor to the
audio every single time it reports something new. You get accuracy from the
audio and smoothness from the timer, and the timer's error can never build up,
because it is only ever trusted for the few milliseconds since the last real
measurement.

## Using it

`protocol/clock.js` has all three, and the one you want is `AnchoredClock`.

```js
const clock = LimelightClock.AnchoredClock(audioElement);
const s = LimelightSession.Session(score, { songTime: () => clock.position() });

clock.play(0);            // drive the audio through the clock, not around it
clock.pause();
clock.seek(61.9);
```

Pass `songTime` and the protocol stops keeping a clock of its own and reads
yours instead. Two clocks in one program drift, and then somebody spends an
evening finding out why everything is forty milliseconds late.

Python is the same shape in `protocol/clock.py`, where the class is
`MeasuredClock` and it takes a device that reports how much sound has actually
reached the speaker.

## Proving it

Do not trust this by ear. `conformance()` drives a clock through a fake audio
element that starts late, runs slightly fast, and updates coarsely, then tells
you where your clock lies.

```
node protocol/clock.test.js        # the three clocks, and the contract
python3 protocol/clock.test.py     # the same contract on the Python side
```

Point it at your own clock and it will tell you the truth about it:

```js
const { conformance } = require("./protocol/clock.js");
for (const [passed, name, detail] of conformance((audio, opts) => MyClock(audio, opts)))
  console.log(passed ? "pass" : "FAIL", name, detail);
```

The failing clocks are kept in the file deliberately. A test that nothing can
fail is not a test, and this project has been caught by that three times now.
If you ever see all three clocks pass, the harness is broken, not fixed.

## If you are building a rhythm game

A few things follow from the protocol that are worth knowing before you design
around something else.

**A note's travel time is the lead time.** If a note takes 1200 ms to fly from
the spawn point to the strike line, then `s.next(1200)` returns exactly the
notes you should spawn this frame. You do not need to precompute a chart or
keep an index into one. Ask every frame, spawn what you have not already
spawned, and the window does the bookkeeping.

**The first call is different.** `next()` answers "what is inside the window",
not "what just entered it". So the first call after play or after a seek hands
back a backlog — notes already part-way to the strike line, some almost on it.
Each one tells you its real distance in `in_ms`. Spawn them at that true
distance or drop them, but do not give them a full approach, or they will
arrive late and the player will be punished for your bookkeeping.

**Judge hits against musical position, not against the object.** When the
player swings, ask the protocol where the song is and compare that to the beat
the note belongs to. If you compare against where the object happens to have
been drawn, you are judging your own render loop.

**A tempo change costs you nothing.** `next()` answers in your milliseconds and
applies the rate at the boundary, so a faster song simply puts more notes inside
the same approach window and they arrive sooner. The beats themselves do not
move — they are the same bars and beats, because the score clock never hears
about rate. You do not need to rebuild anything.

**Calibration means one thing only.** There is a real, fixed delay between a
frame being drawn and a player seeing it, and between them swinging and you
receiving it. That is worth a calibration setting, and players expect one. What
is *not* worth a setting is audio startup delay — a measuring clock never
introduces it, so if you find yourself adding a number to fix the sync, the
clock is wrong and the number will betray you on the next run.

**Pause, seek and restart go through the clock.** If you move the audio behind
the clock's back, it will be reading a song that is no longer where it thinks.

## What this is really for

The reason the contract is written down rather than left to each app is that
lighting, visuals and a game all have to agree about where the song is. If the
game's clock guesses and the lights measure, they are describing different
songs, and nothing anywhere reports a fault. That is the failure this project
keeps finding, and it never announces itself — you only notice when the room
looks wrong.
