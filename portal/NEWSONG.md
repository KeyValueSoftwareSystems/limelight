# A new song, end to end

Every step is a command in this repo. Nothing here depends on a session that
has already happened.

## 1. Score the audio

Drop the mp3 in `hub/files/audio/<slug>.mp3` and a wav in `work/wav/<slug>.wav`,
then run the listen pipeline. That produces the score under
`hub/files/score/.versions/<slug>.score/`, carrying beats, sections, moments,
emotion spans, chords, melody and the 39 instrument lanes at 0.5s.

Check what the show path actually needs before going further:

    node -e "console.log(require('./protocol/fixture.js').pick('<slug>'))"

## 2. Add the fine instrument envelope (needs the GPU box)

The 0.5s lanes in the score are about one number per beat — good for _which_
instrument is playing, useless for _when_ it hits. The separated stems exist at
full sample rate inside the separation model and were being thrown away at
0.5s. `stems_fine` keeps them at 0.05s.

The VM is at `192.168.1.241`, key `~/Downloads/keycode-vm.pem`, user
`developer`. From home it needs the KV tunnel up (`sudo bash ~/vpn/connect.sh`,
then wait for `Initialization Sequence Completed` in `~/vpn/kv.log` — the first
remote is dead and failover takes ~10s, while connect.sh gives up at 30s and
reports failure while the tunnel is still coming up).

    scp -i ~/Downloads/keycode-vm.pem listen/gpu/stems_fine.py \
        developer@192.168.1.241:~/proj/
    scp -i ~/Downloads/keycode-vm.pem work/wav/<slug>.wav \
        developer@192.168.1.241:~/proj/wav/
    ssh -i ~/Downloads/keycode-vm.pem developer@192.168.1.241 \
        "cd ~/proj && WINDOW_S=0.05 ONLY=<slug> venv/bin/python stems_fine.py"
    scp -i ~/Downloads/keycode-vm.pem \
        developer@192.168.1.241:~/proj/stems-fine/<slug>.json work/stems-fine/

About 17-34 seconds a song on the L40S. Then merge it into the score:

    work/allin1/bin/python listen/gpu/merge_fine.py \
        "$(node -e "console.log(require('./protocol/fixture.js').pick('<slug>'))")" \
        work/stems-fine/<slug>.json

This is optional. Without it the show still works off the 0.5s lanes and the
grid streams; the fine envelope is what lets `follow` carry a note's attack,
and it only pays off with `smooth` set, because raw it puts the lamp on every
attack and reads as jitter.

## 3. Compose, bake, score, repeat

    ROUNDS=4 OUT=/tmp/chase9 bash tools/chase9.sh <slug>

Each round runs the composer, bakes the plan to DMX, scores it against the ten
checks, and hands the failures back with guidance. The best round's plan is
published to `portal/work/<slug>.plan.json` at the end — nothing intermediate
reaches the live show file.

The composer also bakes and scores its own plan mid-compose, so most correction
happens inside one round rather than across several.

For every song at once:

    JOBS=3 bash tools/showrun.sh

## 4. Look at it

The score is a floor, not proof. Every real fault found so far was invisible to
the checks and turned up only on looking:

    work/allin1/bin/python tools/strip.py \
        /tmp/chase9/lights/<slug>.json /tmp/<slug>.png "<slug>"

That draws every lamp's colour across the whole show. Mud, lamps moving as one
body, a colour wheel dragging between gels and a head that never moves all
showed up there first.

To watch the show properly, the portal runs on `127.0.0.1:8800` — it re-bakes
per request, so code changes are live, but a browser tab loaded earlier still
has the old `app.js` and needs a hard reload.

## 5. Watch the machinery while it runs

    bash tools/watch.sh          what the composer decided, and anything dropped
    tail -f /tmp/monitor.log     one line every 10s

`tools/watch.sh` prints any binding the validator threw away. That is the class
of fault worth watching for: a silently dropped binding leaves a show that
looks thin with nothing in the score to explain it.

## What can go wrong quietly

- **A dial that is declared and never read.** `smooth` was set on every binding
  for weeks and did nothing; `colour` was not a dial on `follow` at all, so
  every show rendered in one hard-coded cream. If a dial seems to have no
  effect, grep for it in the venue file before believing the plan.
- **A validator that drops what it does not recognise.** Bindings naming a real
  instrument were deleted for a while because a name set was seeded wrongly.
  `tools/watch.sh` exists for this.
- **Interpolating a channel that selects a position.** Wheels, gobos and prisms
  are stepped in `portal/baker.js` by profile role name. A new fixture whose
  profile uses a different word for a wheel-like channel will smear through it;
  add the word to `STEP_ROLE`.
