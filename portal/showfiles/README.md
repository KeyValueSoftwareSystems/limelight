# The show file

Three lists, because they are three different things:

| list | what it is | hung on |
|---|---|---|
| `states` | what the rig is DOING through a section — the resting condition | a section |
| `bindings` | a section where the rig follows an audio stream instead of a state | a section |
| `gestures` | punctuation | a moment |

That split is the valuable part. The plan this replaces kept the base look in
`plan.looks`, which nothing ever drew — so the timeline showed punctuation
floating over a look nobody could see or edit. Here the resting condition is a
first-class row.

## What had to be added, and why

Every cue positions itself by INDEX — `section: 3`, `moment: 14` — into the
song's own lists. That reads well, but an index only means something against the
exact score it was authored from.

The raga-of-revenge file references moments up to **30**. That score carries
**8**. So:

- 18 of 29 cues cannot be placed at all
- and the three gestures that *do* resolve land in the **wrong place**, because
  index 1 in the authoring score is a different moment from index 1 in this one.
  `stab` says "9.8s the first drums enter" and lands at 31.4s.

A wrong placement that looks fine is worse than one that fails loudly. So:

### `at` — required on every cue

```jsonc
"at": { "bar": 22, "beat": 1, "beats": 2 }   // 1-based, like everywhere here
```

`at` is what the timeline draws. Keep `section` / `moment` as provenance — they
record WHY the cue is there — but they stop being load-bearing.

`start_s` / `end_s` may be carried too; they are only ever a cross-check, because
the grid is the authority and this song changes tempo at 17.87s.

### `id` — required on every cue

```jsonc
"id": "g14"
```

Stable across edits, so selection, undo and "this cue replaced that one" have
something to hold.

### Top level

```jsonc
{
  "schema": "limelight.show/1",
  "song": "raga-of-revenge",          // which score the indices refer to
  "grid":  { "bpm": 119.982, "beats_per_bar": 4, "first_beat_s": 1.7481, "bars": 65,
             "tempo": [ { "from_beat": 0, "at_s": 1.7481, "bpm": 89.341 },
                        { "from_beat": 24, "at_s": 17.8662, "bpm": 119.982 } ] },
  "duration_s": 131.286,
  "plan": "...", "states": [], "bindings": [], "gestures": []
}
```

`grid` and `duration_s` make the file self-contained: it can be drawn without
asking the hub for the score, and it cannot drift when the score is re-analysed.
Both are optional — the loader falls back to the baked show's own grid.

Everything else on a cue is a DIAL and is passed through untouched, so
`floor`, `peak`, `colours`, `travel`, `rest`, `smooth`, `stream`, `intensity`
all survive even where this build has no renderer for them yet.

`lead_beats` is honoured: it pulls a gesture earlier than its anchor, for a cue
that has to land before the hit.

## What reaches the rig today

Naming an effect is not the same as rendering it. The catalogue carries 17 tiles;
the renderer answers to 8 words.

- **render now**: `drone` `wash` `impact` `blackout` `hush` `ramp` `stab` `lift`
  `strip` `cut` `swell` `accent`
- **no renderer yet**: `trade` `isolate` (place), `gear` (rate),
  `follow` `split` (audio bindings)
- **not in this build at all**: `pulse` `drive` `anticipation` — used by the
  raga file, in no catalogue

`lib/showfile.ts` reports all three cases rather than drawing a clip that does
nothing in the room.
