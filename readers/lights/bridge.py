#!/usr/bin/env python3
"""Play a baked show on the real rig, reusing success-limelight's rig.py + artnet.py.

Maps device-agnostic intents (from bake.js) -> DMX via rig.set_par / rig.set_head,
and streams them at the baked frame rate. Owns the time-domain safety rig.py does not:
  - park frame first and last (never leave the head to its auto-program),
  - pan/tilt SLEW-LIMIT from the last pose actually sent (seeded to the park pose),
    so no packet can whip the head across the room,
  - never emit an all-zero frame,
  - catch OSError per send and keep going,
  - a dim GAIN for a cautious first light (the user's eyes).

    python3 readers/lights/bridge.py <frames.json> [--gain 0.35] [--full] [--dry-run]

--dry-run prints a safety summary and sample frames WITHOUT sending anything.
"""
import argparse, json, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
GAMMA = 1.6
MAX_STEP = 7          # DMX per frame for pan/tilt (success-limelight's HeadState cap)
HEAD_PROFILE = os.path.join(HERE, "drivers", "profiles", "head13.profile.json")


def load_aim(profile):
    """The head's aim from the JS driver profile (generated from rig.py): per axis
    either three DMX anchors [lo, centre, hi] (0 -> lo, 0.5 -> the wall, 1 -> hi,
    piecewise) or a two-anchor window [lo, hi]. One source of truth with the JS
    drivers; None means the profile has no aim (full travel, 0.5 = the ceiling)."""
    aim = (profile or {}).get("aim") or {}
    if not (isinstance(aim.get("pan"), list) and isinstance(aim.get("tilt"), list)):
        return None
    return {"pan": [int(v) for v in aim["pan"]], "tilt": [int(v) for v in aim["tilt"]]}


def head_pose(intent, aim, last):
    """(pan, tilt) DMX for an intent. A normalised value maps through the aim
    anchors (or the full travel without any); an intent that carries no pan/tilt
    HOLDS the last pose -- a blackout beat must not re-aim the head at park and back."""
    def one(key):
        v = intent.get(key)
        if v is None:
            return int(last[key])
        n = max(0.0, min(1.0, float(v)))
        if aim:
            a = aim[key]
            if len(a) == 3:
                lo, mid, hi = a
                raw = lo + (n / 0.5) * (mid - lo) if n <= 0.5 else mid + ((n - 0.5) / 0.5) * (hi - mid)
            else:
                raw = a[0] + n * (a[1] - a[0])
            return int(round(max(0.0, min(255.0, raw))))
        return int(round(n * 255))
    return one("pan"), one("tilt")


def find_rig():
    for c in [os.environ.get("RIG_PY_DIR"),
              os.path.join(HERE, "../../experimentation/music_sync"),
              os.path.join(HERE, "../../../experimentation/music_sync")]:
        if c and os.path.isfile(os.path.join(c, "rig.py")):
            return os.path.abspath(c)
    sys.exit("could not find rig.py; set RIG_PY_DIR")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("frames")
    ap.add_argument("--gain", type=float, default=0.35)   # dim by default; --full for the show
    ap.add_argument("--full", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--gateway", default="2.0.0.100")
    ap.add_argument("--audio")                 # a .wav to pw-play in sync with the lights
    ap.add_argument("--offset-ms", type=int, default=0)   # >0 lights lead, <0 audio leads
    args = ap.parse_args()
    gain = 1.0 if args.full else args.gain

    sys.path.insert(0, find_rig())
    import rig
    show = json.load(open(args.frames))
    fps = show["fps"]
    ticks = show["ticks"]
    clamp = lambda v, lo, hi: max(lo, min(hi, v))
    try:
        aim = load_aim(json.load(open(HEAD_PROFILE)))
    except (OSError, ValueError):
        aim = None
    # slew-limit state = what we last put on the wire, seeded to the park pose; the
    # same dict is the pose the head HOLDS when an intent carries no pan/tilt
    last = {"pan": rig.PAN_WALL_CENTRE, "tilt": rig.TILT_UP}

    def build(fixtures):
        """intents -> a 512 DMX frame via rig.py (keep-zero channels enforced there)."""
        f = rig.blank_frame()
        for fx in fixtures:
            it = fx.get("intent") or {}
            lvl = it.get("level", 0) or 0
            if fx["type"] == "par7":
                addr = fx_addr(show, fx["id"])
                rgb = it.get("colour") if isinstance(it.get("colour"), list) else (0, 0, 0)
                g = (clamp(lvl, 0, 1) ** GAMMA) * gain
                rig.set_par(f, addr, rgb, g)
                if it.get("strobe"):
                    f[addr - 1 + rig.PAR_STROBE] = clamp(int(round(255 * it["strobe"])), 0, 255)
            elif fx["type"] == "head13":
                pan, tilt = head_pose(it, aim, last)
                dim = int(round(255 * clamp(lvl, 0, 1) * gain))
                col = 0
                if it.get("spin"):
                    col = rig.COLOUR_SPIN_MIN
                elif isinstance(it.get("colour"), str) and it["colour"] in rig.COLOUR_BY_NAME:
                    col = rig.COLOUR_BY_NAME[it["colour"]][0]
                gobo = {"flower": rig.GOBO_FLOWER, "open": rig.GOBO_OPEN}.get(it.get("gobo"), 0)
                prism = rig.PRISM_6 if it.get("prism") else 0
                strobe = clamp(int(round(255 * it.get("strobe", 0))), 0, 255)
                rig.set_head(f, pan, tilt, dim, col, gobo, prism, speed=40, strobe=strobe)
        return f

    def fx_addr(show, fid):
        for f in show["fixtures"]:
            if f["id"] == fid:
                return f["address"]
        raise KeyError(fid)

    def slew(f):
        for ch, key in ((rig.H_PAN, "pan"), (rig.H_TILT, "tilt")):
            want = f[ch - 1]
            step = clamp(want - last[key], -MAX_STEP, MAX_STEP)
            last[key] = last[key] + step
            f[ch - 1] = last[key]
        return f

    def safe(f):
        f = slew(f)
        if not any(f):                       # never an all-zero frame
            return rig.park_frame(width=len(f))
        return f

    if args.dry_run:
        lvls, pans = [], []
        allzero = 0
        for tk in ticks:
            f = safe(build(tk["fixtures"]))
            for a in rig.PAR_ADDRS:
                lvls.append(max(f[a], f[a + 1], f[a + 2]))
            pans.append(f[rig.H_PAN - 1])
            if not any(f):
                allzero += 1
        print(f"DRY RUN  {len(ticks)} ticks @ {fps}fps, gain {gain}")
        print(f"  PAR channel range: {min(lvls)}..{max(lvls)}   (cap for a dim test ~64)")
        print(f"  head pan range:    {min(pans)}..{max(pans)}   head dim slew ok")
        print(f"  all-zero frames:   {allzero}  (must be 0)")
        print("  first lit frame:", next((tk['t'] for tk in ticks if any(build(tk['fixtures']))), None), "s")
        print("no packets sent (dry run).")
        return

    # ---- live: sole sender. park, play, park. ------------------------------
    import subprocess
    sender = artnet_sender(rig, args.gateway)
    park = rig.park_frame(width=512 if hasattr(rig, "FRAME_LEN") else 512)
    audio = None
    off = args.offset_ms / 1000.0            # >0 lights lead (audio starts later), <0 audio leads
    try:
        for _ in range(int(fps * 0.5)):      # 0.5s of park before we move
            sender.send(park); time.sleep(1 / fps)
        if args.audio and off < 0:           # audio leads: start it, wait, then lights
            audio = subprocess.Popen(["pw-play", args.audio], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            time.sleep(-off)
        t0 = time.perf_counter()
        if args.audio and off >= 0:          # together / lights lead
            if off: time.sleep(off)
            audio = subprocess.Popen(["pw-play", args.audio], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for i, tk in enumerate(ticks):
            f = safe(build(tk["fixtures"]))
            try:
                sender.send(f)
            except OSError as e:
                print("send error (continuing):", e)
            due = (i + 1) / fps
            dt = due - (time.perf_counter() - t0)
            if dt > 0:
                time.sleep(dt)
    except KeyboardInterrupt:
        print("\ninterrupted")
    finally:
        if audio:
            try: audio.terminate()
            except Exception: pass
        for _ in range(int(fps * 0.5)):      # park + blackout on the way out
            try: sender.send(rig.park_frame(width=512))
            except OSError: pass
            time.sleep(1 / fps)
        print("parked.")


def artnet_sender(rig, gateway):
    import artnet
    return artnet.Sender(gateway=gateway, universe=rig.UNIVERSE, pad_to=512)


if __name__ == "__main__":
    main()
