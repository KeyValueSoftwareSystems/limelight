# Candidate maps

One file per person per song, named `<song-slug>.<who>.map.json`:

```
07-voice.renjith.map.json      hand-corrected, the one to beat
07-voice.amal.map.json         produced by an algorithm
07-voice.dheeraj.map.json
```

They appear automatically in the two-rooms view, so any two can be played against each other on the
same audio at the same instant. **That is the judge** — not a number, and not an argument.

Commit them. They are small, they diff, and the history is the record of who improved what.

Set `made_by.how` honestly: `model` if a program produced it, `hand-written` if a person typed the
times, `truth` only if a human verified them with the audio playing. A guess must never look like a
measurement.
