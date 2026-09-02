# score — the instruments and the game

**Owner: Sebastian.** You build the measuring tools. You do not define what is true or what is
good — Renjith does. You hand him a better microscope.

## Tonight (2 hours)
**The tapping tool**, as one web page: load a local audio file, play it, spacebar marks a beat,
three buttons mark drop / stop / quiet, download JSON. No install.

**Done:** Renjith can use it tomorrow. He is blocked until it exists, so it is first.

## Then
The scoreboard. One command, three numbers per song:

- **beats** — share of our beats within ~70 ms of a tapped beat (the tolerance researchers use,
  so the number means something outside this room)
- **chapters** — boundaries found within 0.5 s, and within 3 s
- **moments** — hit or miss each, plus the error in seconds

```
SONG                 BEATS   CHAPTERS   MOMENTS
the nights            94%      80%      2 of 3   ***
raga of revenge       31%      20%      1 of 3   *
-----------------------------------------------
TEAM SCORE  54 / 100          yesterday: 41
```

## Then the useful part
**The failure page.** For each song, where our map disagrees with truth, with timestamps. That
page tells Amal what to fix, and it is worth more than any percentage.

## Two things worth knowing
A number a machine can read is a number a machine can climb — your script is what lets an agent
improve things overnight. And by the end of week one you will know these songs better than
anyone here, because you will have listened to them fifty times with a stopwatch.
