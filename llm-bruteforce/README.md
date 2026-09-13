# llm-bruteforce

A working light-show pipeline for the universe-0 rig, built by iterating against
real lamps rather than by deriving a protocol first. Imported from
`experimentation/` on 2026-09-13.

Audio in, or a hub score in, and 41 channels of DMX out at 40 fps: four PARs on
a 150 cm arc and a moving head. There is an effect library of about thirty
looks, an arranger that draws from it by section role with a seeded random, and
a web panel that is the master clock for both the audio and the frames.

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cd music_sync && ../.venv/bin/python -m pytest          # 130 tests, no rig needed
../.venv/bin/python server.py --no-net                  # panel on http://127.0.0.1:8765/
```

**Read `CLAUDE.md` before touching the rig.** One sender per universe, never an
all-zero frame to the head, and four files here are duplicated under
`readers/lights/panel/` in a way that has to be kept honest.

`music_sync/README.md` is the original operator's guide: calibration, the stream
format, what each effect does, and the written-up shows for Levels and Don't
Look Down. `poc/README.md` covers the first MVR and GDTF to sACN spine, now
superseded by `readers/lights/mvr/`.
