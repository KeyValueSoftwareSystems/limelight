# Limelight — rig checklist

Two kinds of done, and only one of them can be checked from a laptop.

The code half is checked by behaviour, not by reading the source, because a
variable can exist and do nothing. Run `node tools/status.js` and it probes each
improvement by actually rendering or planning and looking at the answer.

The rig half can only be ticked by a person who watched real lamps. Tick a box,
put your name and the date, and attach the evidence named on the line. An
untickable line is the honest state; leaving it blank is not a failure, it is
the point of the list.

## Watched on the rig

- [ ] **Lights land on the beat.** Evidence: `synccheck` output on a baked show
      with matching audio, showing offset under 40 ms and drift under 120 ms.
      Who / when:
- [ ] **A build visibly grows.** Watch Levels bars 25–33. The rig should be doing
      more at bar 32 than at bar 26. Who / when:
- [ ] **A returning section looks like it did before.** Watch the three drops in
      Levels (bars 9, 33, 101). Who / when:
- [ ] **Quiet sections glide rather than blink.** Watch Levels bars 25–32.
      Who / when:
- [ ] **A rhythm change is followed.** Levels bar 32 is marked double time.
      Who / when:
- [ ] **The rig goes dark safely if the software is killed.** Kill the panel
      mid-song and confirm blackout. Who / when:
- [ ] **No fixture is driven past its limits.** Motors, strobe rate, and the
      laser height floor. Who / when:

## Notes

Anything a person tried and rejected belongs here, so it is not retried.
