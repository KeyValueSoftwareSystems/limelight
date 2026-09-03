# The playground — agent instructions

Read `../AGENTS.md` first.

Ten made-up songs whose maps are **exact**, because the arrangement is authored before any sound
exists, the audio is rendered from it, and the map is measured back out of the individual instrument
tracks. That is the only reason a score here means anything.

## Files

| file | what |
|---|---|
| `compose.py` | the ten songs. `SONGS` is the arrangement, `IDENTITY` is each song's key, chords, tune, bass feel and tempo |
| `import.py` | bring in a song a human wrote. They supply tempo, bar one, sections and instruments; everything else is measured |
| `loop.py` | score a listener against the ladder. The listener is a **command**, not an import |
| `serve.py` | the portal, localhost only. Jobs are looked up by name — never run a string from the browser |
| `render.py` | renders the four old click-track diagnostics and verifies its own output to 2 ms |
| `songs/*.map.json` | committed. The audio next to them is not |

## Rules for this directory

- **Each level adds exactly one new thing.** A level that changes three things at once tells you
  nothing when a score drops.
- **Levels 01–03 have flat energy on purpose.** They exist to test beat-finding, so the room barely
  moves on them and they are marked flat in the UI. That is a property, not a fault.
- **Never let a level claim something its audio cannot carry.** 01 has identical kicks, so the bar is
  unknowable and `downbeats` is empty with a note saying so.
- **Held-out levels exist so one number stays un-optimised.** Anyone tuning against every level will
  pass the suite and fail on music.
- Audio regenerates in ~90 seconds and is never committed.

## Verify

```
python3 compose.py                     # all ten, or `compose.py 03` for one
python3 ../validate.py songs/*.map.json
python3 loop.py                        # score the baseline; it currently passes 4 of 10
python3 serve.py                       # portal on 127.0.0.1:8770
```
