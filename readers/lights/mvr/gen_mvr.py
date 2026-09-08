#!/usr/bin/env python3
"""Bind a Limelight layout to real fixtures and emit an MVR + a patch.

    python3 readers/lights/mvr/gen_mvr.py                 # club, phase-0 binding
    python3 readers/lights/mvr/gen_mvr.py --layout small

Stdlib only. No pip, no node.

WHAT THIS IS
------------
A Limelight `layout.json` says what is in the room in the abstract -- a fixture
is a `par` that `can` do `colour` and `level`, sitting at a position in metres.
It deliberately carries no DMX: no addresses, no channel order, no fixture model.
That is `wiring.json`'s job, and `wiring.json` is hand-written and guesses the
channel order (see readers/lights/wire.js `MODES`).

This binds each fixture to a REAL device -- a GDTF profile -- and reads the
channel order out of that profile instead of guessing it. From that it writes:

  out/<layout>.mvr    an MVR (My Virtual Rig): the industry interchange format.
                      A zip of GeneralSceneDescription.xml + the .gdtf files it
                      references. BlenderDMX and real consoles import it and get
                      the fixtures, their positions, and their DMX patch in one
                      step. Structure mirrors a known-good sample MVR so an
                      importer accepts it.

  out/<layout>.patch.json   the DERIVED wiring: per fixture, its universe, DMX
                      start address, and the ORDERED list of channel attributes
                      the GDTF declares (e.g. Dimmer, ColorAdd_R, ...). The sACN
                      sender reads this so the bytes it streams land on the same
                      channels the .mvr patched -- the browser sim and the real
                      rig therefore agree by construction, not by hope.

PHASE 0 SCOPE
-------------
Only fixtures whose kind is in BINDING are patched. Today that is the colour+
level fixtures (par, uplight), bound to the one real GDTF we have. Heads/strobes/
etc. join once their profiles are downloaded (Phase 1). Addresses are assigned by
each profile's real footprint, so a 5-channel real PAR never overlaps the way it
would if we reused wiring.json's hand addresses (which assumed 4).

AXES / UNITS
------------
Limelight `at` is [x, y, z] metres with y up, z depth (z=0 stage, z=d back wall).
MVR is millimetres, right-handed, Z up. So MVR pos = (x, z, y) * 1000: depth maps
to MVR-Y, height maps to MVR-Z. Rotation is identity for now (orientation is a
later refinement; position is what an importer needs to place the fixture).
"""
import argparse, json, math, os, sys, uuid, zipfile
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
GDTF_DIR = os.path.join(HERE, "gdtf")
OUT_DIR = os.path.join(HERE, "out")

# kind -> {gdtf filename in gdtf/, DMX mode name inside it}
# Phase 0: the fixtures the one real profile fits. Grows as profiles arrive.
BINDING = {
    "par":     {"gdtf": "LED PAR 64 RGBW.gdtf", "mode": "Default"},
    "uplight": {"gdtf": "LED PAR 64 RGBW.gdtf", "mode": "Default"},
    "head":    {"gdtf": "Martin_Professional@MAC_Aura@20230201NoMeas.gdtf", "mode": "Standard"},
    "strobe":  {"gdtf": "Martin_Professional@Atomic_3000_DMX@Rev_1.0.gdtf", "mode": "3 Channel"},
    "blinder": {"gdtf": "Chauvet_Professional@STRIKE_Array_4@Rev_1.0.5.gdtf", "mode": "1Ch Mode"},
    "strip":   {"gdtf": "Showtec@Cameleon_PixelBar_18-4_24Ch@Rev_1_4_WORKING.gdtf", "mode": "24 Ch"},
    # fog: no profile downloaded yet -> stays skipped
}


def gdtf_channels(path, mode_name):
    """Return the ordered channel list of one DMX mode, read from the GDTF.

    Each entry is {"attribute": str, "offsets": [int, ...]} where len(offsets)
    is 1 for an 8-bit channel and 2 for a 16-bit (coarse, fine) one. Offsets are
    1-based DMX slots relative to the fixture's start address, as GDTF declares.
    """
    with zipfile.ZipFile(path) as z:
        root = ET.fromstring(z.read("description.xml"))
    modes = [m for m in root.iter("DMXMode") if m.get("Name") == mode_name]
    if not modes:
        have = [m.get("Name") for m in root.iter("DMXMode")]
        raise SystemExit(f"{os.path.basename(path)}: no DMX mode {mode_name!r}; has {have}")
    chans = []
    for ch in modes[0].iter("DMXChannel"):
        off = ch.get("Offset")
        offsets = [] if not off or off == "None" else [int(x) for x in off.split(",")]
        lc = ch.find("LogicalChannel")
        attr = (lc.get("Attribute") if lc is not None else None)
        if not attr:
            cf = ch.find(".//ChannelFunction")
            attr = cf.get("Attribute") if cf is not None else "?"
        if offsets:  # a channel with no offset occupies no DMX slot; skip it
            chans.append({"attribute": attr, "offsets": offsets, "default": _channel_default(ch, attr)})
    chans.sort(key=lambda c: min(c["offsets"]))
    return chans


def _channel_default(ch, attr):
    """Idle DMX byte for a channel the frame does not drive. Mostly 0, but a
    shutter must sit in its OPEN set or the fixture stays dark regardless of the
    dimmer (the classic 'why is it black' on real GDTF modes -- e.g. MAC Aura
    Shutter1 is Closed at 0, Open at 20)."""
    a = (attr or "").lower()
    if a.startswith("shutter"):
        for cs in ch.iter("ChannelSet"):
            if (cs.get("Name") or "").strip().lower() == "open":
                return int((cs.get("DMXFrom") or "0/1").split("/")[0])
    return 0


def footprint(chans):
    return max((max(c["offsets"]) for c in chans), default=0)


ROOM_W, ROOM_D, ROOM_H = 8.0, 6.0, 3.4   # club size_m (width, depth, height)
EDGE = 0.5                               # keep a fixture body this far inside the walls

# GDTF beam travels along the fixture's local +Z. If fixtures end up aimed the
# wrong way in the sim, flip this one flag and regenerate.
BEAM_LOCAL_PLUS_Z = True


def _norm(v):
    m = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) or 1.0
    return (v[0] / m, v[1] / m, v[2] / m)


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _beam_dir(kind):
    """Where this kind of fixture should aim, in Blender world (x=width, y=depth, z=up)."""
    if kind == "uplight": return (0.0, 0.0, 1.0)      # wash straight up the wall
    if kind == "strip":   return (0.0, 0.0, 1.0)      # floor bar glows up
    if kind == "blinder": return (0.0, -0.7, -0.7)    # at the crowd: forward + down
    return (0.0, 0.0, -1.0)                             # par / head / strobe: hang, point down


def _basis(kind):
    """Orthonormal fixture basis (local X,Y,Z in world) that aims the beam."""
    d = _norm(_beam_dir(kind))
    v3 = d if BEAM_LOCAL_PLUS_Z else (-d[0], -d[1], -d[2])   # local +Z -> beam
    ref = (0.0, 0.0, 1.0) if abs(v3[2]) < 0.99 else (0.0, 1.0, 0.0)
    v1 = _norm(_cross(ref, v3))
    v2 = _cross(v3, v1)
    return v1, v2, v3


def _inset_pos(f):
    """Layout [x=width, height, z=depth] inset to clear the walls; returns metres
    as (width, depth, height) -- the order MVR/Blender use."""
    x, y, z = f["at"]
    x = min(max(x, EDGE), ROOM_W - EDGE)
    z = min(max(z, EDGE), ROOM_D - EDGE)
    return x, z, y


def matrix(f):
    """Fixture -> MVR Matrix (mm, Z up): inset position + per-kind base aim."""
    x, depth, height = _inset_pos(f)
    v1, v2, v3 = _basis(f.get("kind"))
    pos = (x * 1000.0, depth * 1000.0, height * 1000.0)
    return "".join("{%.6f,%.6f,%.6f}" % p for p in (v1, v2, v3, pos))


def focus_point(f):
    """Where this fixture aims, as an MVR position (mm). BlenderDMX points every
    fixture at its focus point; with none, it defaults them ALL at the origin --
    which is why an un-aimed rig stares at one corner."""
    x, depth, height = _inset_pos(f)
    k = f.get("kind")
    if k in ("uplight", "strip"):
        t = (x, depth, ROOM_H)                 # straight up the wall
    elif k == "blinder":
        t = (x, max(0.3, depth - 3.0), 0.0)    # forward, at the crowd, on the floor
    else:
        t = (x, depth, 0.0)                    # straight down to the floor
    return tuple(c * 1000.0 for c in t)


def build(layout_name):
    layout_path = os.path.join(REPO, "readers", "lights", layout_name, "layout.json")
    layout = json.load(open(layout_path))
    fixtures = layout.get("fixtures", [])

    # parse each bound profile once
    profiles = {}
    for kind, b in BINDING.items():
        gp = os.path.join(GDTF_DIR, b["gdtf"])
        if not os.path.exists(gp):
            raise SystemExit(f"missing profile for {kind}: {gp}")
        chans = gdtf_channels(gp, b["mode"])
        profiles[kind] = {"gdtf": b["gdtf"], "mode": b["mode"],
                          "channels": chans, "footprint": footprint(chans), "path": gp}

    # auto-patch on universe 1 by real footprint, in layout order
    universe, addr = 1, 1
    patched, skipped = [], []
    for f in fixtures:
        kind = f.get("kind")
        if kind not in profiles:
            skipped.append(f["id"]); continue
        p = profiles[kind]
        if addr + p["footprint"] - 1 > 512:
            universe += 1; addr = 1
        patched.append({
            "id": f["id"], "kind": kind, "gdtf": p["gdtf"], "mode": p["mode"],
            "universe": universe, "address": addr,
            "channels": [c["attribute"] for c in p["channels"]],
            "offsets": [c["offsets"] for c in p["channels"]],
            "defaults": [c["default"] for c in p["channels"]],
            "at": f.get("at"),
        })
        addr += p["footprint"]

    if not patched:
        raise SystemExit("nothing patched -- no fixture kind matched the binding")

    os.makedirs(OUT_DIR, exist_ok=True)
    mvr_path = os.path.join(OUT_DIR, f"{layout_name}.mvr")
    patch_path = os.path.join(OUT_DIR, f"{layout_name}.patch.json")
    _write_mvr(mvr_path, layout_name, patched, profiles)
    json.dump({"layout": layout_name, "fixtures": patched}, open(patch_path, "w"), indent=1)
    return layout_name, patched, skipped, profiles, mvr_path, patch_path


def _write_mvr(mvr_path, layout_name, patched, profiles):
    layer_uuid = "00000000-0000-0000-0000-000001000000"
    class_uuid = "00000000-0000-0000-0000-000002000000"
    ident = "{1.000000,0.000000,0.000000}{0.000000,1.000000,0.000000}{0.000000,0.000000,1.000000}"
    fx_xml = []
    fp_xml = []
    for i, f in enumerate(patched, start=1):
        absaddr = (f["universe"] - 1) * 512 + f["address"]
        fuuid = str(uuid.uuid4())
        fp_xml.append(f'''          <FocusPoint name="focus_{f['id']}" uuid="{fuuid}">
            <Matrix>{ident}{{{focus_point(f)[0]:.6f},{focus_point(f)[1]:.6f},{focus_point(f)[2]:.6f}}}</Matrix>
          </FocusPoint>''')
        fx_xml.append(f'''          <Fixture name="{f['id']}" uuid="{uuid.uuid4()}">
            <Matrix>{matrix(f)}</Matrix>
            <GDTFSpec>{f['gdtf']}</GDTFSpec>
            <GDTFMode>{f['mode']}</GDTFMode>
            <Focus>{fuuid}</Focus>
            <Classing>{class_uuid}</Classing>
            <Addresses>
              <Address break="0">{absaddr}</Address>
            </Addresses>
            <FixtureID>{i}</FixtureID>
            <UnitNumber>0</UnitNumber>
            <FixtureTypeId>0</FixtureTypeId>
            <CustomId>0</CustomId>
            <Color>0.312712,0.329008,100.000000</Color>
            <CastShadow>false</CastShadow>
            <Mappings/>
          </Fixture>''')
    xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<GeneralSceneDescription verMajor="1" verMinor="5">
  <UserData/>
  <Scene>
    <Layers>
      <Layer name="{layout_name}" uuid="{layer_uuid}">
        <GDTFSpec></GDTFSpec>
        <GDTFMode></GDTFMode>
        <ChildList>
{chr(10).join(fp_xml)}
{chr(10).join(fx_xml)}
        </ChildList>
      </Layer>
    </Layers>
    <AUXData>
      <Class name="None" uuid="{class_uuid}"/>
    </AUXData>
  </Scene>
</GeneralSceneDescription>
'''
    used = {p["gdtf"]: p["path"] for p in profiles.values()
            if any(f["gdtf"] == p["gdtf"] for f in patched)}
    with zipfile.ZipFile(mvr_path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("GeneralSceneDescription.xml", xml)
        for name, path in used.items():
            z.write(path, name)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--layout", default="club")
    args = ap.parse_args()
    name, patched, skipped, profiles, mvr_path, patch_path = build(args.layout)
    unis = sorted({f["universe"] for f in patched})
    print(f"layout '{name}': patched {len(patched)} fixtures, skipped {len(skipped)}")
    for kind, p in profiles.items():
        print(f"  {kind:8} -> {p['gdtf']} [{p['mode']}]  {p['footprint']}ch: "
              f"{', '.join(c['attribute'] for c in p['channels'])}")
    print(f"  universes used: {unis}")
    if skipped:
        print(f"  skipped (no profile yet): {', '.join(skipped)}")
    print(f"  wrote {os.path.relpath(mvr_path, REPO)}")
    print(f"  wrote {os.path.relpath(patch_path, REPO)}")


if __name__ == "__main__":
    main()
