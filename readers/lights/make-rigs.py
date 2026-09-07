#!/usr/bin/env python3
"""Every rig in one file.

A layout is not decoration -- it is the half of `frame = f(map, layout, recipe, t)`
that says what the room can physically do, and it is where safety lives (rule 5).
Hand-kept layouts drift, so all of them are generated here from one vocabulary.

Fixture classes are the ones a real touring rig actually carries. The distinction
that matters to a reader is not the brand, it is:
  - how wide the beam is        (beam_deg)   a Sharpy is 3.8 deg, a wash is 40
  - which way it throws         (face)       up, down, crowd, cross
  - whether it can move         (can.move)
so a reader that has never heard of a MegaPointe still does the right thing.
`model` is documentation; readers ignore fields they do not recognise.
"""
import json, os, copy

HERE = os.path.dirname(os.path.abspath(__file__))

# class -> (beam_deg, can, default face, emits)
#
# `emits` is the field that stops every reader guessing from names. A hazer and
# a CO2 jet both take a level and neither is light; counting them as brightness
# is a mistake this repo has already paid for twice. A reader asks what a
# fixture emits rather than matching a list of kind names it happens to know.
CLASS = {
    "beam":     (4.0,  ["colour", "level", "move", "strobe"], "up",    "light"),
    "spot":     (15.0, ["colour", "level", "move", "strobe"], "down",  "light"),
    "wash":     (40.0, ["colour", "level", "move"],           "down",  "light"),
    "par":      (25.0, ["colour", "level"],                   "down",  "light"),
    "bar":      (18.0, ["colour", "level", "pixels"],         "cross", "light"),
    "uplight":  (30.0, ["colour", "level"],                   "up",    "light"),
    "blinder":  (70.0, ["level", "strobe"],                   "crowd", "light"),
    "strobe":   (60.0, ["level", "strobe"],                   "crowd", "light"),
    "laser":    (1.0,  ["colour", "level"],                   "up",    "light"),
    "sky":      (7.0,  ["colour", "level"],                   "up",    "light"),
    "wall":     (0.0,  ["pixels"],                            "out",   "media"),
    "co2":      (8.0,  ["level"],                             "up",    "air"),
    "fog":      (0.0,  ["level"],                             "up",    "air"),
    "pyro":     (6.0,  ["level"],                             "up",    "effect"),
    "confetti": (90.0, ["level"],                             "down",  "effect"),
}

def fx(fid, klass, at, zone, model, **kw):
    deg, can, face, emits = CLASS[klass]
    f = {"id": fid, "kind": klass, "can": list(can), "emits": emits,
         "at": [round(v, 2) for v in at], "zone": zone,
         "beam_deg": kw.pop("beam_deg", deg), "face": kw.pop("face", face),
         "model": model}
    f.update(kw)
    return f

def pair(out, base, klass, x, y, z, zone, model, w, **kw):
    """Mirrored about the centre line, so left and right answer each other by
    construction rather than by the recipe folding coordinates."""
    for side, xx in (("l", x), ("r", w - x)):
        out.append(fx("%s_%s%d" % (base, side, kw.get("n", 1)), klass,
                      (xx, y, z), zone, model,
                      **{k: v for k, v in kw.items() if k != "n"}))

def mainstage(w=16.0, d=11.0, h=8.0, scale=1.0):
    """A festival mainstage: three overhead trusses, scenic towers of pixel bar,
    a floor package that throws straight up, and an upstage wall."""
    F = []
    def P(base, klass, xs, y, z, zone, model, **kw):
        for i, x in enumerate(xs):
            kw2 = dict(kw); kw2["n"] = i + 1
            pair(F, base, klass, x, y, z, zone, model, w, **kw2)

    # -- overhead: front truss carries the sharp light, mid the colour, back the aerials
    P("beam_front", "beam", [2.4, 4.0, 5.6, 7.2], h*0.90, d*0.20, "front_truss", "Claypaky Sharpy")
    P("spot_front", "spot", [3.2, 6.4],           h*0.90, d*0.20, "front_truss", "Robe BMFL Spot")
    P("wash_mid",   "wash", [2.0, 3.8, 5.6, 7.4], h*0.95, d*0.45, "mid_truss",   "Martin MAC Aura XB")
    P("beam_back",  "beam", [2.4, 4.2, 6.0, 7.6], h*0.90, d*0.72, "back_truss",  "Robe MegaPointe")

    # -- upstage par row: the static colour workhorse, still on every real rig
    P("par_up", "par", [1.6, 3.2, 4.8, 6.4], h*0.42, d*0.94, "upstage_wall", "PAR 64 / Sunstrip")

    # -- scenic towers: vertical pixel bar is what makes a mainstage read as a mainstage
    for i, ty in enumerate([1.0, 2.4, 3.8, 5.2]):
        P("bar_tower", "bar", [1.0, 2.5], ty, d*0.82, "towers", "GLP X4 Bar 20",
          pixels=16, axis="v", n=i+1)
    # deck-level bar washing the upstage face
    P("bar_deck", "bar", [4.0, 6.0], 0.30, d*0.90, "deck_edge", "GLP X4 Bar 20", pixels=16, axis="h")

    # -- the floor package: beams that throw UP. This is the signature aerial look
    P("beam_deck", "beam", [3.0, 4.6, 6.2, 7.6], 0.40, d*0.84, "deck", "Robe MegaPointe", face="up")
    P("up_deck",   "uplight", [2.2, 5.0, 7.4],   0.25, d*0.88, "deck", "Chauvet COLORdash", face="up")

    # -- audience-facing: blinders and strobes live on the downstage edge
    P("blind", "blinder", [2.8, 5.2, 7.6], h*0.72, d*0.10, "audience", "Molefay 8-lite", face="crowd")
    P("strobe", "strobe", [3.6, 6.4],      h*0.60, d*0.30, "strobe_pods", "Atomic 3000", face="crowd")

    # -- sky beams stand outside the stage box and go straight up
    P("sky", "sky", [0.4], h*0.30, d*0.55, "wings", "Syncrolite SX-5", face="up")

    # -- upstage wall
    F.append(fx("wall_1", "wall", (w/2, h*0.55, d*0.97), "upstage_wall", "ROE CB5 LED",
                size_m=[w*0.72, h*0.62], pixels=48, face="out"))

    # -- effects
    P("laser", "laser", [1.8, 4.4],  h*0.80, d*0.50, "ceiling", "Kvant Atom", face="up")
    P("co2",   "co2",   [3.4, 5.8],  1.10,   d*0.16, "deck_fx", "MagicFX CO2 Jet", face="up")
    P("pyro",  "pyro",  [3.0, 6.0],  0.80,   d*0.78, "deck_fx", "Galaxis Gerb", face="up")
    P("conf",  "confetti", [4.2],    h*0.85, d*0.18, "overhead_fx", "MagicFX Stadium Shot", face="down")
    P("haze",  "fog",   [1.4, 6.0],  0.60,   d*0.60, "haze", "MDG Atmosphere APS")
    return F

def scaled(w, d, h, keep):
    """A smaller room carries a subset of the same vocabulary, never a different one."""
    F = [f for f in mainstage(w, d, h) if f["kind"] in keep]
    return F

def zones_of(F):
    z = {}
    for f in F:
        z.setdefault(f["zone"], []).append(f["id"])
    return [{"name": k, "fixtures": v} for k, v in z.items()]

LIMITS = {
    "max_strobe_hz": 4.0,
    "laser_zones": ["ceiling"],
    "laser_min_height_m": 3.0,
    "no_audience_scan": True,
    "max_pan_per_s": 1.05,
    "max_tilt_per_s": 1.15,
    "note": ("Fraction of range per second. A fast head does about 0.5, so this "
             "budget is generous; the recipe derives its amplitude from it."),
    "pyro_zones": [],
    "co2_max_burst_s": 1.2,
    "pyro_interlock": "virtual: this rig is an emulator, no device can physically fire",
    "pyro_min_gap_s": 20.0,
}

RIGS = {
    "festival": dict(room="festival", w=16.0, d=11.0, h=8.0, default=True, keep=None,
        note="Festival mainstage. Three overhead trusses, four levels of pixel bar on "
             "scenic towers a side, a floor package of beams throwing straight up, "
             "blinders and strobes on the downstage edge, sky beams in the wings and "
             "an upstage wall. Every fixture is a mirrored pair about the centre line."),
    "mainstage": dict(room="mainstage", w=22.0, d=14.0, h=11.0, default=False, keep=None,
        note="Stadium. The same vocabulary in a much bigger room, so throws are long "
             "and the aerial work carries."),
    "show": dict(room="show", w=13.0, d=9.0, h=7.0, default=False,
        keep={"beam","spot","wash","bar","uplight","blinder","strobe","wall","laser","co2","confetti","fog"},
        note="Theatre-scale touring show: no pyro, no sky beams, everything else intact."),
    "club": dict(room="club", w=9.0, d=6.5, h=4.2, default=False,
        keep={"beam","wash","bar","uplight","blinder","strobe","laser","fog"},
        note="Club. Low trim, no wall, no fireworks; the beams do the work."),
    "small": dict(room="small", w=7.0, d=5.0, h=3.4, default=False, static=True,
        keep={"wash","par","bar","uplight","blinder","fog"},
        note="A small room with no movers at all. If the recipe needs a moving head "
             "to look like anything, this rig is the test that says so."),
    "beat": dict(room="beat", w=10.0, d=7.0, h=5.0, default=False,
        keep={"beam","wash","bar","uplight","strobe","blinder","fog"},
        note="A beat-driven rig: strobes, bar and beam, nothing scenic."),
}

def build(name, spec):
    F = mainstage(spec["w"], spec["d"], spec["h"])
    if spec.get("keep"):
        F = [f for f in F if f["kind"] in spec["keep"]]
    if spec.get("static"):
        for f in F:
            f["can"] = [c for c in f["can"] if c != "move"]
    lim = copy.deepcopy(LIMITS)
    if not any(f["kind"] == "laser" for f in F):
        lim["laser_zones"] = []
    out = {
        "layout": 0.3,
        "room": spec["room"],
        "note": spec["note"],
        "size_m": {"w": spec["w"], "d": spec["d"], "h": spec["h"]},
        "limits": lim,
        "zones": zones_of(F),
        "fixtures": F,
    }
    if spec["default"]:
        out["default"] = True
    return out

if __name__ == "__main__":
    from collections import Counter
    for name, spec in RIGS.items():
        rig = build(name, spec)
        p = os.path.join(HERE, name, "layout.json")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w") as fh:
            json.dump(rig, fh, indent=1)
            fh.write("\n")
        c = Counter(f["kind"] for f in rig["fixtures"])
        print("%-10s %3d fixtures  %s" % (name, len(rig["fixtures"]),
              " ".join("%s:%d" % kv for kv in sorted(c.items()))))
