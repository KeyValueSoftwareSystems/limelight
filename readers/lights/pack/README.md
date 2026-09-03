# The reader lane — golden frames

**Owner: Dheeraj.** Your job is one function: given a map, a layout and a time, return what every
light is doing at that instant. `../FRAME.md` is the contract.

```
node readers/lights/pack/make.js      # regenerate the golden frames
python3 check.py expected/first-light.frames.jsonl.gz mine/first-light.frames.jsonl.gz
```

## Two cases, and they are different jobs

`first-light` is the one to work against. It is 60 seconds of music we composed ourselves — we
wrote the arrangement, rendered the audio from it, then measured the map from the individual
instrument tracks. Every field in it is exact, so it is a fair test.

`the-nights` is a real record and its map is **not** trustworthy: six methods dispute its section
boundaries, its chord labels agree with its own detected notes 69% of the time, and one moment in
it has been verified by a human ear. It is here because a reader should survive real data, not
because the answers are right.

## Why these are generated and never hand-kept

The pack that shipped on 2 September was pinned to recipe v0.2 while the recipe moved several
versions past it, so any failure it reported was ours and not yours. Golden frames are now produced
by `make.js` from committed inputs at the current recipe, and regenerating is one command. If your
output differs from these, the difference is real.

The two cases from that old pack, `opus` and `strobe`, are gone. They were sketch maps with no grid
field, so no reader could run on them and the frames that shipped for them cannot be reproduced from
anything in this repository.

`CASES.json` records what was generated, from which map, at what frame rate.
