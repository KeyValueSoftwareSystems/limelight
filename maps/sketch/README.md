# Sketch maps — not truth

Every file here carries `"how": "sketch"` and `"confidence": 0.3`. The timings are plausible and
internally consistent. **They were not measured against audio.**

They exist so the reader lane, the room lane and the hardware lane can all start before a single
song has been listened to properly. That is their entire job.

Never copy a number out of here into `songs/<slug>/truth.json`. One invented timestamp makes
every bench number afterwards a lie, and it does it invisibly.

| file | why this song |
|---|---|
| `the-nights.map.json` | two builds, two drops, a stop before each. The easy shape |
| `strobe.map.json` | a three-minute elevation that plateaus before it climbs — `rise: "late"` |
| `opus.map.json` | one monotonic 4.7-minute riser. A point-only map cannot express it at all |
