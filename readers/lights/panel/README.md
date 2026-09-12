# Control panel

A copy of the other agent's control page (`experimentation/music_sync/ui.html`,
`server.py`, `transport.py`, `audio_out.py`) adapted to drive **our** show, plus
**import from the hub** built into the page. Originals in `experimentation/` are left
untouched — this is a copy.

## Run

The transport needs `numpy` + `soundfile`, which live in the other agent's venv:

```
# preview + audio only (safe while another sender holds universe 0):
experimentation/music_sync/.venv/bin/python readers/lights/panel/server.py \
    --no-net --port 8766 "$PWD/synth/out"
# then open http://127.0.0.1:8766/
```

Drop `--no-net` (and coordinate single-sender on universe 0 first) to drive the real
rig. `--gain`, `--offset-ms`, `--gateway`, `--universe` are as in the original.

## How it plays our show

- **bake.js `--lights`** renders a score into the other agent's `.lights.json` frame
  format (41-ch DMX @ 40fps) via our drivers (same channel truth as `rig.py`), with
  gamma 1.6 and pan/tilt slew-limiting, plus the beat/section/phase timeline.
- **Import** (`⤓` in the header): pick a hub score → the server fetches it
  (`/hub/<name>.score`), formats it (`server/handler.js` via `format_score.mjs`),
  bakes it (`bake.js --lights`), symlinks local audio if we have it, and loads it —
  all from the page.

Scan dirs are scanned for `*.lights.json`; imported shows land in the first one.
