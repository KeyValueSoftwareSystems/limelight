# POC — MVR/GDTF → beat-synced DMX → sACN

**Status: throwaway proof-of-concept.** It proves the *pipeline spine* only.
There is **no music analysis yet** — a synthetic 128 BPM grid stands in for the
future encoder. The point is to answer one question: *can we generate a valid,
beat-synced DMX stream that drives a real rig?* Answer so far: **yes** (verified
in `check` and `selftest`; visual confirmation is the Blender step below).

## What it does

1. Parses `Circle Stage.mvr` → 74 fixtures with DMX patch (universe/address) + 3D position
2. Parses the 5 Robe GDTF profiles → per-channel attribute, byte offset(s), defaults
   (handles **CMY** Esprite/LedPOINTE *and* **RGBW** Spiider/Tetra; opens shutters via GDTF defaults)
3. Renders a beat-synced "show" (kick pulses beams, downbeats shift colour, movers sweep)
4. Streams it as **sACN** at 44 fps

Universes in this rig: `[1,2,3,4, 11,12,13,14, 21,22,23,24, 31]`

## Run

```bash
cd poc
./.venv/bin/python poc_dmx.py inspect     # rig inventory + resolved patch
./.venv/bin/python poc_dmx.py check        # render + validate bytes + prove beat-sync (no network)
./.venv/bin/python poc_dmx.py selftest     # stream to loopback, receive + validate on the wire
./.venv/bin/python poc_dmx.py stream --seconds 60 --unicast 127.0.0.1   # live feed for Blender
```

## Watch it in BlenderDMX

1. Open the imported Circle Stage scene in Blender (BlenderDMX addon).
2. In the **DMX** panel → enable **DMX input**, protocol **sACN**.
3. Run:  `./.venv/bin/python poc_dmx.py stream --seconds 120 --unicast 127.0.0.1`
4. The 74 fixtures should pulse/sweep/colour-shift on a 128 BPM grid.

If nothing moves, universe numbering may differ — try
`--universe-offset -1` (or `+1`). If fixtures stay dark, the shutter default
may need an explicit open (we can set Shutter1=96).

## Deps (installed in ./.venv)
`pygdtf` (GDTF parsing) · `sacn` (E1.31 output) · `pymvr` (installed, not yet used — we parse the scene XML directly)
