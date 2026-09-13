# music_sync — music-synced light shows for the universe-0 rig

Analyses a track once, renders a 40 fps RGB frame stream, then plays the
audio and streams the frames over Art-Net straight to the gateway
(2.0.0.100, universe 1, DMX channels 1–3). QLC+ is not in the path; make
sure nothing else (QLC+ output, another script) is writing universe 1 or
the PAR flickers.

## Run

```bash
cd experimentation/music_sync
.venv/bin/python analyze.py "../The Nights.mp3"          # -> ../The Nights.lights.json + .cache.wav
.venv/bin/python server.py                               # web control panel on http://127.0.0.1:8765/
.venv/bin/python play.py "../The Nights.lights.json"     # headless alternative; Ctrl-C blacks out
```

### Web control panel (`server.py`)

Open http://127.0.0.1:8765/ . The page is a remote control; the server is
the master clock for both the audio (PipeWire via `pw-play`) and the frames
sent to the PAR, so pause/seek keep them locked.

- **Play / Pause / Stop / Blackout**, click the timeline to seek, `K` toggles,
  `J`/`L` seek ∓5 s. Timeline shows sections (bands), beats (ticks) and
  downbeats (tall ticks), plus your calibration taps.
- **Delay**: offset in ms, applied live. Positive = lights later. `←`/`→`
  nudge ±10 ms (`Shift` ±40). Remembered in the browser.
- **Tap calibration**: with the track playing, press `Space` on each beat
  you *hear* (8+ taps), then switch to *light* and tap on each flash you
  *see*. Reaction time cancels; the panel suggests the offset. Apply it.
- **Output**: send-to-PAR toggle, gain, server/stream info, re-analyze with
  a different style (pulse/bands) without leaving the page.

Flags: `--port`, `--host` (default 127.0.0.1), `--no-net` (start with output
off), `--gateway`, `--universe`, and directories to scan for `*.lights.json`.

Useful flags for `play.py`:

| flag | meaning |
|---|---|
| `--offset MS` | lights later (+) or earlier (−) if they visibly lag/lead the beat |
| `--start SEC` | begin partway into the track (audio and lights together) |
| `--gain 0..1` | cap brightness |
| `--no-net` | terminal preview only |
| `--no-audio` | lights only |

`analyze.py --style bands` renders the alternative bass/mid/treble → R/G/B look.

## Offset calibration

```bash
.venv/bin/python make_clicks.py 120 45 clicks.wav && .venv/bin/python analyze.py clicks.wav
.venv/bin/python play.py clicks.lights.json --offset 0
```

Every click should flash. If flashes come after the click, use a negative
offset; before, a positive one. Steps of 30–50 ms are visible.

## The stream file

`<track>.lights.json`: `fps`, `frames` (one `[r,g,b]` per frame, gamma-
encoded 0–255), `beats`, `downbeats`, `sections` (seconds), `tempo`,
`duration`, and `wav` (the decoded audio `play.py` plays). Hand-editable.

## Look ("pulse")

- Brightness = loudness floor (0 in silence, up to 0.6 at full loudness)
  plus a flash to full on every beat that decays over half a beat. Strong
  off-beat hits flash to 70 %.
- Hue holds for a bar and steps to the next palette colour on each
  downbeat. Each section (verse/chorus boundary) gets a new 4-colour
  palette: warm palettes for bass-heavy sections, cool for bright ones.
- Flashes desaturate slightly toward white; output is gamma 2.2.

## Files

- `analyze.py` — decode, beat/downbeat/onset/loudness/band/section analysis, render, write JSON + WAV cache
- `mapping.py` — pure feature→RGB functions (`render_pulse`, `render_bands`, palettes, envelopes)
- `play.py` — clock-driven Art-Net streaming loop + audio launcher (pw-play, falls back to aplay)
- `artnet.py` — ArtDmx packet builder/sender, Length padded to even, blackout
- `make_clicks.py` — click-track generator for calibration
- `test_*.py` — `.venv/bin/python -m pytest` (synthetic audio, no network)


## 2026-09-12 rig: 4 PARs + moving head on universe 0 (`rig.py`)

PARs 7-ch @1 @8 @15 @22 (dimmer, R, G, B, strobe, program, speed), head 13-ch @29
(pan, pan-fine, tilt, tilt-fine, speed, dimmer, strobe, colour, gobo, prism, macro, unused,
reset). Geometry, colour-wheel map and pan/tilt calibration live in `rig.py`; the head's
macro/unused/reset channels are always forced to 0 and all-zero frames are never sent
(the head whips to pan/tilt 0) — `concert.park_frame()` is the safe dark frame.

### Faded with audio (the real thing)

```bash
.venv/bin/python analyze.py ../faded.mp3 --style concert   # -> ../faded.lights.json + faded.cache.wav
.venv/bin/python server.py --gain 1.0                        # control panel on http://127.0.0.1:8765/
```

`--style concert` detects beats/downbeats (halving double-time tempos), labels every bar
(`phases.py`: intro / verse / build / drop / anthem / breakdown / gap / outro from per-bar
bass and loudness), renders the 41-channel show with `concert.py` on the real beat grid and
writes the phases into the JSON. In the page pick "faded", press Play: the server plays the
cached wav through PipeWire locked to the lights, so there is nothing to sync by hand. The
ms offset still trims light-vs-sound latency; tap calibration works as before. Phases are
drawn on the timeline — click into a build or drop to review it.

### Faded without audio (fallback)

`faded_show.py` alone plays the show live from the terminal (`--start 50` jumps to just
before drop 1). `concert.py` is the renderer (phases intro / verse / build / drop /
breakdown / outro / gap, spatial pulses along the arc, head slew-limited, colour-wheel
travel hidden behind the dimmer). `wall_calib.py`, `colour_map.py`, `u0probe.py`,
`par_sweep.py` in the parent folder are the calibration/probe tools.

## Shows from a hub score (`score_show.py`, `effects.py`, `arrange.py`, `score.py`)

When the music-understanding hub has a score for a song (sections, phrases, moments,
per-bar energy/width/pump/pace/brightness lanes, stem lanes, chords) the show is rendered
from that instead of from our own analysis:

```bash
curl -s -X POST http://192.168.1.38:8770/hub/score -H "Content-Type: application/json" \
     -d '{"score": "levels"}' > ../levels.score.json            # or: score_show.py --hub http://192.168.1.38:8770 --score levels
.venv/bin/python score_show.py ../levels.score.json --wav ../levels.cache.wav --seed 1 --save-plan ../levels.plan.json --dry
#   ...edit the plan (which effect on which cue)...
.venv/bin/python score_show.py ../levels.score.json --wav ../levels.cache.wav --plan ../levels.plan.json
#   -> ../levels.lights.json (+ levels.cache.wav next to it); pick "levels" in the panel and press Play
```

- `score.py` turns `{bar, beat}` into seconds through the grid/tempo map and looks lanes
  up by time. Scores can arrive a whole bar off against the audio (Levels does: its beat
  list carries a constant −2 beat `off_ms` and the sections were snapped forward from
  those labels); `align_bar_shift()` measures the shift from drum entrances in the wav,
  or pass `--bar-shift -1|0|1` to force it.
- `effects.py` is the **effect library**: ~30 effects in three layers, each tagged with
  the roles it suits (intro / verse / build / drop / final_drop / breakdown / bridge /
  outro), what it needs from the score (vocals present, a brightness dip, a `pause`
  moment, dropout bars…) and a docstring. PAR looks: comet_chase, ripple_hits,
  pair_alternate, full_rig_hits, glide_gradient, riff_build, vocal_swell,
  brightness_follow, bass_pump, half_kit_taps, fade_collapse. Head looks: roam_slow,
  spotlight, spiral_rise, room_patterns, figure8, corner_snaps, sweep_locked,
  spot_per_bar, head_bloom, park_fade. Events (rule-fired): pre_drop_blackout, drop_hit,
  break_blackout, strobe_pops, strobe_accelerate, wheel_spin_tail, white_finale,
  pause_hold. `python -c "import effects; print('\n'.join(effects.catalogue()))"` lists them.
- `arrange.py` builds cues from the sections (a rising section before a drop becomes a
  `build`, the last drop is the `final_drop`, drops escalate in intensity, "a bar out,
  then back" bars become `breaks`), then draws one PAR look and one head look per cue
  with a seeded random weighted by suitability. Material the score marks as the same
  (`like`) gets the same looks again; events are attached by rule. `--seed N` gives a
  different show for the same song; a saved plan pins it. Colour follows the chord lane
  in drops (C#m → blue, A → pink, E → light blue, …) so repeated harmony reads as repeated
  colour.
- The output `.lights.json` carries `phases` (cue roles, drawn on the panel timeline),
  the `plan` that produced it (cues with their effects, plus `activity`: the spans in
  which each rule-fired event actually changed a frame) and `score_bar_shift`.
- **Effect library card (panel).** Below the settings cards the page lists the whole
  library from `GET /api/effects`, grouped PAR looks / head looks / events, each with its
  description and the roles it suits. For a score-rendered show the tiles follow the
  playhead: the current cue's looks light up for the whole cue, events flash solid when
  they fire (a strobe pop, the blackout beat) and sit dashed while assigned but waiting;
  the cue's role, span, effects and plan note are shown above the tiles. **Only in use
  now** hides everything the current cue is not using (remembered in the browser). Shows
  rendered by `analyze.py` have no plan, so the card just lists the library.

**Levels** (`../levels.plan.json`, 128 BPM, 3:57): riff chase in gold with the head
following it along the wall → drop 1 rippling across the arc (blue/pink by chord) with
the head in a figure-8 → the riff build accelerating into a strobe → drop 2, same look,
bigger (pops on 1 and 3, room-wide head patterns) → half-kit taps → the pause: one lamp
breathing → vocal swell in warm colours under a warm spot → glides → the bridge pumping
with a hat chase and the head locked to it → the filter passage blooming from dark
saturated colour to white → the riff build again → the final drop with all four lamps on
every beat, wheel spin and a white-strobe finale → collapse inward to dark.

### Per-song briefs and the score's finer fields (dont-look-down)

A score can arrive with a written brief (`dont-look-down.zip`: the score, the song, and a
README naming what each moment wants). Two lessons from it are now built into the library
rather than special-cased:

- **Builds read `pace` and `tension`, not loudness.** `pace_build` sets its chase RATE from
  the per-bar `pace` lane (on the bar when pace is low, on the beat, then twice a beat as it
  climbs, so a double-time bar makes the rate *jump*) and its floor/second-comet from the
  per-beat `tension` lane, ramping across the `rise` span the score declares (`sc.ramp`).
  So a build whose energy sits flat still visibly accelerates and fills — the failure the
  brief was written against ("a rig driven by loudness alone sits still then jumps").
- **The score's punctuation drives events.** A `pause` with `still: ["voice"]` holds the
  voice's colour on one pair for exactly its `for_beats` (`pause_hold`); a `release` blooms
  white ON its beat (`release_accent`); a `highlight` flares (`highlight_flare`).

New score fields `score.py` now reads: per-beat `tension` (`sc.tension(t)`), the full
`signals` list (a superset of `moments`), richer moment fields (`into_bar`, `back_at`,
`still`, `after_beats`), and rise spans (`sc.rises()` / `sc.ramp(t)`). The arranger detects
a build from a `rise` signal or a `pace` climb even when the section's energy and rise are
flat, and lights the second chorus like the first only bigger by sharing looks across
`drop`/`final_drop` by material (`like`). Unknown section names (post-chorus, pre-chorus…)
alias to the nearest lit role. Every whole-bar `bar_shift` is still measured from the audio:
Levels needs −1, dont-look-down needs 0.

**Don't Look Down** (`../dont-look-down.plan.json`, 128 BPM, 3:40): comet intro → pace-built
run into drop 1 → drop 1 rippling by chord with the head snapping between corners → verse
glide with a vocal-run flare → the run into drop 2 (pace accelerates through the bar-96
double-time, the bar-95 "everything but voice" hole holds the voice colour on one pair, the
bar-96 release blooms white, then blackout) → drop 2, the same ripple only bigger, white
finale → a full-tilt post-chorus → collapse to dark.
