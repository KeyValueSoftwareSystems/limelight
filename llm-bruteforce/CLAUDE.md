# llm-bruteforce

The other lane. Everything in this folder was written by pointing a model at a
real rig and iterating against what the lamps did, rather than by deriving a
protocol first. It is kept because it works and because the rig facts in it were
paid for in evenings of watching a moving head do the wrong thing.

It is an archive with a pulse: the code still runs, and the `:8765` panel in
`music_sync/` is still the thing that drives shows today. It is not the
direction the repository is going. The protocol lane — `protocol/`, `readers/`,
`presets/` — is.

Imported from `experimentation/` on 2026-09-13. The originals stay where they
are; see **Read-only origin** below.

## Hard rules

**One sender per universe.** The Art-Net node at `2.0.0.100` keys merge sources
by IP, so two senders from this machine on one universe do not merge — they
overwrite each other and the lamps flicker. Confirmed 2026-09-10. Before you
stream anything, check what else is already on the wire:

```bash
curl -s http://127.0.0.1:8765/api/status   # this folder's panel
curl -s http://127.0.0.1:8766/api/status   # the protocol lane's panel
```

`net: true` on either means it holds the wire. Hand it over by asking, not by
starting a second sender.

**Never send an all-zero frame to the head.** Zero pan and zero tilt is a real
position, and the head will whip to it at full speed. The safe dark frame is
`concert.park_frame()`. Channels for macro, unused and reset are forced to zero
always; the macro channel left non-zero makes the head wander the room on its
own program.

**Black out on exit.** Every streaming script here traps SIGINT and SIGTERM and
sends zeros to the PARs plus a parked head. Keep that when you edit them. A
script killed mid-show that leaves lamps lit is the failure mode that ends with
someone pulling power.

**Read-only origin.** `experimentation/` belongs to another session and is not a
git repository. Do not edit or delete anything there. This folder is a copy;
changes go here.

## The duplication you must not make worse

Four files here have descendants under `readers/lights/panel/`. They were copied
there and then developed further. The panel's copies are ahead:

| file | here | `readers/lights/panel/` |
|---|---|---|
| `music_sync/rig.py` | 110 lines | byte-identical |
| `music_sync/artnet.py` | 54 lines | byte-identical |
| `music_sync/server.py` | 387 lines | 729 lines, ahead |
| `music_sync/transport.py` | 204 lines | 236 lines, ahead |
| `music_sync/audio_out.py` | 108 lines | 132 lines, ahead |
| `music_sync/ui.html` | 525 lines | 902 lines, ahead |

`rig.py` and `artnet.py` are channel truth: PAR addresses, the head's channel
order, the colour wheel, the pan and tilt calibration, and how a DMX packet is
framed. Two identical copies of the truth is already one too many. **If you
change either of them, change both, in the same commit, and say so in the
message.** A silent divergence there means a show renders one thing and the
panel sends another.

For the other four, new panel work belongs in `readers/lights/panel/`, not here.
Touch the copies in this folder only to keep this lane runnable.

## Setup

Python 3.12, and a venv of its own. The analysis stack is the heavy part:

```bash
cd llm-bruteforce
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

The rig needs a wired interface on the Art-Net subnet, because the sender binds
`2.0.0.1` before it talks to `2.0.0.100`:

```bash
nmcli con add type ethernet ifname <iface> con-name artnet ipv4.method manual ipv4.addresses 2.0.0.1/8
nmcli con up artnet
ip route get 2.0.0.100      # must name the wired interface, not wifi
```

Without that, every script here dies on `OSError: [Errno 99] Cannot assign
requested address` at the bind. That error means the network, never the code.

Audio playback is PipeWire's `pw-play`, with `aplay` as the fallback. The `poc/`
folder wants its own venv with `pygdtf`, `sacn` and `pymvr`.

## Running it

```bash
cd llm-bruteforce/music_sync
../.venv/bin/python -m pytest                       # no network, no audio, safe anywhere
../.venv/bin/python analyze.py ../../synth/out/x.wav --style concert
../.venv/bin/python server.py --no-net              # panel on http://127.0.0.1:8765/
../.venv/bin/python play.py ../levels.lights.json   # headless; Ctrl-C blacks out
```

Start with `--no-net` every time until you know the wire is yours. The tests are
the only thing here that is safe to run without thinking about the rig.

Rendering a show from a hub score, which is the good path:

```bash
../.venv/bin/python score_show.py ../levels.score.json --wav ../levels.cache.wav \
    --seed 1 --save-plan ../levels.plan.json --dry     # choose effects, write the plan
../.venv/bin/python score_show.py ../levels.score.json --wav ../levels.cache.wav \
    --plan ../levels.plan.json                         # render the pinned plan
```

The probe scripts at the root of this folder are for a rig in front of you and
are useless otherwise. They stream continuously on purpose: a head that stops
receiving DMX falls back to its own program.

## What is here

| path | what it is |
|---|---|
| `music_sync/analyze.py` | audio in, `.lights.json` frame stream out; beats, downbeats, sections, phases |
| `music_sync/phases.py` | per-bar labelling: intro, verse, build, drop, anthem, breakdown, gap, outro |
| `music_sync/score.py` | a hub score's bar and beat positions resolved into seconds |
| `music_sync/arrange.py` | sections to cues; roles, drop numbering, intensity, break bars |
| `music_sync/effects.py` | the effect library, about thirty, tagged by role and by what the score must contain |
| `music_sync/concert.py` | timeline to 41-channel frames; `park_frame()` lives here |
| `music_sync/score_show.py` | the score to show renderer, seeded and plan-pinnable |
| `music_sync/mapping.py` | the older single-PAR look: pulse and bands |
| `music_sync/server.py`, `ui.html`, `transport.py`, `audio_out.py` | the `:8765` control panel |
| `music_sync/rig.py`, `artnet.py` | channel truth and the wire |
| `music_sync/test_*.py` | twelve suites, synthetic audio, no network |
| `*.py` at root | rig probes and calibration: `u0probe`, `par_sweep`, `colour_map`, `wall_calib`, `dmx_discover`, `probe`, `par_cycle`, `flower_show`, `head_show` |
| `*.plan.json` | the pinned shows for Levels and Don't Look Down |
| `poc/` | the first MVR and GDTF to sACN spine, superseded by `readers/lights/mvr/` |

Four root scripts (`par_sweep`, `colour_map`, `u0probe`, `wall_calib`) import
`artnet` and `rig` out of `music_sync/` through a `sys.path` insert. On import
those pointed at an absolute path inside `experimentation/`; they were rewritten
to resolve relative to the file, which is the only edit made to any copied
source. Keep it file-relative if you move things.

## What was left behind, and how to get it back

No audio, no caches, no rendered shows. That is rule one of this repository and
it also keeps this folder at under half a megabyte instead of 240.

| missing | how to regenerate |
|---|---|
| `*.cache.wav` | `analyze.py <track>` writes it next to the track |
| `*.lights.json` | `analyze.py`, or `score_show.py` for the score path |
| `*.score.json` | from the hub: `score_show.py --hub http://192.168.1.38:8770 --score <name>` |
| `*.mp3` | licensed music, never in git; it is on the machine that had it |
| `music_sync/clicks*.wav` | `make_clicks.py 120 45 clicks.wav` |
| `poc/` stage file | `simulation/MVR-Stash/Circle Stage/Circle Stage.zip`, 19 MB, outside this repo; `--zip` overrides the hardcoded default |

## Conventions

This tree is shared with other live Claude sessions. Never `git stash`,
`git reset` or `git checkout --` here. Make one edit per file per turn and
re-read a file if an edit reports it changed underneath you. Commit only the
paths you touched. A failing suite you did not touch is somebody else's
in-progress work; report it, do not fix it.

When you learn something about the rig from watching it, write it down in the
file that encodes it, next to the number it corrects, with the date. That habit
is the only reason this lane is worth keeping.
