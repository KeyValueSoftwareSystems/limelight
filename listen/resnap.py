#!/usr/bin/env python3
"""Put the drops back where the record puts them.

Found on 8 Sept. Every drop in Amal's Levels map sits at pos %% 4 == 0.000 --
snapped to a bar line, to three decimals. But the drops in Levels land on HALF
bars, at odd multiples of two beats. Snapping to the next 4-beat line overshoots
by exactly two beats, which is 0.938 s at 128 bpm, and five of his six drops are
late by that amount. On the stage it means the rig is still sitting in the break
when the drop lands: 9 units of light where the older, lower-scoring map gives 82.

This is a correction, not a rewrite, and it is deliberately a script rather than
an edit so that Amal can read it, re-run it, or throw it away:

  - only drops and stops move. A build is a ramp and a quiet is often a slow
    filter close; this instrument cannot see either, so it does not touch them.
    Rule 2 -- never fill a field you did not measure.
  - the new time is the nearest TWO-beat boundary to the measured step, not the
    raw measured time. The measurement moves about 0.2 s depending on the
    analysis window; the grid does not move at all. A drop does land on a musical
    boundary -- just a half-bar one, not a full bar.
  - every entry keeps its original time in `was`, and the map gets a provenance
    block saying what ran and why. Nothing is destroyed.
  - chapters move with their moment. The chapter is what drives the look, so a
    corrected moment with an uncorrected chapter changes nothing on the stage.

    python3 listen/resnap.py synth/maps/amal/levels.map.json
    python3 listen/resnap.py synth/maps/amal/levels.map.json --dry
"""
import sys, os, json, datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mapeval as M

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOULDERS = (0.5, 1.0, 1.5, 2.0)   # never shorter: a quarter-second window finds
SEARCH = 2.5                       # the resume after a gap, not the drop itself
RISE, FALL = {"drop"}, {"stop"}


def entries(o):
    return o if isinstance(o, list) else ((o or {}).get("entries") or [])


def real_step(B, t, want_up):
    """Median across four windows. One window is a guess; four that agree is a
    measurement, and the disagreement of the fifth is what found this bug."""
    dt, rms = B["dt"], B["rms"]
    votes = []
    for sh in SHOULDERS:
        W = max(1, int(sh / dt))
        best, bt, u = None, None, t - SEARCH
        while u <= t + SEARCH:
            i = int(u / dt)
            if i - W >= 0 and i + W < len(rms):
                v = sum(rms[i:i+W]) / W - sum(rms[i-W:i]) / W
                if best is None or (v > best if want_up else v < best):
                    best, bt = v, u
            u += dt
        if bt is not None:
            votes.append(bt)
    if not votes:
        return None
    votes.sort()
    return votes[len(votes) // 2]


def run(path, dry=False):
    m = json.load(open(path))
    slug = os.path.basename(path).split(".")[0]
    sig, sr, B = M.audio_for(slug)
    if B is None:
        print(f"  no audio for {slug} -- cannot correct what cannot be measured")
        return 0
    per = m["grid"]["period"]
    mo = entries(m.get("moments"))
    ch = entries(m.get("chapters"))

    origin = None
    for x in mo + ch:
        if x.get("pos") is not None and x.get("at") is not None:
            origin = x["at"] - x["pos"] * per
            break
    if origin is None:
        origin = m["grid"].get("phase", 0.0)

    moved, log, skipped, taken = 0, [], [], []
    for x in mo:
        k = x.get("kind")
        if k not in RISE | FALL:
            continue
        t = x.get("at", x.get("t"))
        if t is None:
            continue
        rt = real_step(B, t, k in RISE)
        if rt is None:
            continue
        raw_pos = (rt - origin) / per
        new_pos = round(raw_pos / 2) * 2                    # nearest HALF bar
        new_t = round(origin + new_pos * per, 4)
        if abs(new_t - t) < 0.02:
            continue

        # Three guards, all of them earned by the first dry run, which cheerfully
        # merged two separate drops into one timestamp and shifted a stop by six
        # beats on the strength of a single measurement.
        #
        # The diagnosis was a TWO-BEAT overshoot. That is the whole of what this
        # tool is entitled to correct. Anything larger is not this bug, and a
        # correction that quietly relocates events is worse than the error it
        # claims to fix, because the next person cannot tell measurement from
        # repair.
        if abs(new_pos - (t - origin) / per) > 2.01:
            skipped.append(f"{k}@{t:.2f} would move "
                           f"{abs(new_pos - (t-origin)/per):.1f} beats -- larger than "
                           f"the 2-beat snap this corrects, left alone")
            continue
        # The measured step has to actually sit near a half-bar. When it does not,
        # the search found some other event and the grid is not the thing at fault.
        if abs(raw_pos - new_pos) > 0.5:
            skipped.append(f"{k}@{t:.2f} measured {abs(raw_pos-new_pos):.1f} beats "
                           f"off a half-bar -- not a snap error, left alone")
            continue
        # Two moments must never become one.
        if any(abs(o - new_t) < 0.02 for o in taken):
            skipped.append(f"{k}@{t:.2f} would land on another moment already at "
                           f"{new_t:.2f}, left alone")
            continue
        taken.append(new_t)
        log.append({"kind": k, "was": t, "now": new_t,
                    "measured_at": round(rt, 3),
                    "beats_moved": round((new_t - t) / per, 2)})
        if not dry:
            x["was"] = t
            if "at" in x: x["at"] = new_t
            else: x["t"] = new_t
            x["pos"] = new_pos
            # the chapter that shares this boundary drives the look; move it too
            for c in ch:
                ct = c.get("at", c.get("t"))
                if ct is not None and abs(ct - t) < 0.02 and c.get("name") == k:
                    c["was"] = ct
                    if "at" in c: c["at"] = new_t
                    else: c["t"] = new_t
                    c["pos"] = new_pos
        moved += 1

    print(f"  {os.path.relpath(path, ROOT)}")
    for e in log:
        print(f"     {e['kind']:5} {e['was']:8.2f} -> {e['now']:8.2f}   "
              f"{e['beats_moved']:+.2f} beats   (step measured at {e['measured_at']})")
    for w in skipped:
        print(f"     skip  {w}")
    if not log:
        print("     nothing to move")
    if dry or not moved:
        return moved

    m.setdefault("corrections", []).append({
        "by": "listen/resnap.py",
        "when": datetime.datetime.now().isoformat(timespec="seconds"),
        "what": ("drops and stops were snapped to 4-beat bar lines; in this song "
                 "they land on half bars, so the snap overshot by two beats"),
        "anchored_to": "the recording -- median loudness step across 0.5/1.0/1.5/2.0 s windows",
        "moved": log,
        "not_touched": "builds and quiets, which this instrument cannot measure",
        "declined": skipped,
    })
    json.dump(m, open(path, "w"), indent=1)
    return moved


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    dry = "--dry" in sys.argv
    total = sum(run(a, dry) for a in (args or ["synth/maps/amal/levels.map.json"]))
    print(f"\n  {total} moment(s) {'would move' if dry else 'moved'}")
