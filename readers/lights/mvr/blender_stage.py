"""Build a stage for the imported club rig, inside Blender.

Run this AFTER importing readers/lights/mvr/out/club.mvr:
  Scripting workspace -> New -> paste -> Run   (or: blender --python blender_stage.py)

It does three things, all idempotent (safe to re-run):

  1. SURFACES  floor + 3 walls sized to the club (8 x 6 x 3.4 m), so the beams
     have something to land on and colour/movement become readable.

  2. RIG       a ceiling truss over each row of hung fixtures, plus a drop rod
     from every overhead fixture up to it -- so nothing hovers unanchored. Read
     from the real fixture positions in club/layout.json.

  3. DARK ROOM the World is set to black and the default lamp removed, so the
     ONLY light is the DMX fixtures. That kills the "shadows from all directions"
     -- those come from Blender's grey environment dome, not from your rig.

Coordinates: BlenderDMX places MVR millimetres / 1000, and gen_mvr maps a layout
[x, height, depth] to Blender (x, depth, height). So here X=width 0..8,
Y=depth 0..6, Z=height 0..3.4 -- matching where the fixtures land.

After running, switch the viewport to Rendered (top-right sphere) to see it.
"""
import bpy, json, os
from math import radians

REPO = "/home/alnas/Documents/Code/KeyCode/2026/limelight"
LAYOUT = os.path.join(REPO, "readers/lights/club/layout.json")
W, D, H = 8.0, 6.0, 3.4          # club size_m (width, depth, height)


def _mat(name, color, rough=0.85, metal=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    if b:
        b.inputs["Base Color"].default_value = (*color, 1.0)
        if "Roughness" in b.inputs: b.inputs["Roughness"].default_value = rough
        if "Metallic" in b.inputs:  b.inputs["Metallic"].default_value = metal
    return m


def _clear(prefix):
    for o in list(bpy.data.objects):
        if o.name.startswith(prefix):
            bpy.data.objects.remove(o, do_unlink=True)


def _plane(name, sx, sy, loc, rot=(0, 0, 0), mat=None):
    bpy.ops.mesh.primitive_plane_add(size=1.0, location=loc, rotation=rot)
    o = bpy.context.active_object; o.name = name; o.scale = (sx, sy, 1.0)
    if mat: o.data.materials.append(mat)
    return o


def _box(name, sx, sy, sz, loc, mat=None):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc)
    o = bpy.context.active_object; o.name = name; o.scale = (sx, sy, sz)
    if mat: o.data.materials.append(mat)
    return o


def surfaces():
    _clear("Stage_")
    surf = _mat("StageSurface", (0.05, 0.05, 0.06))
    _plane("Stage_Floor", W, D, (W / 2, D / 2, 0.0), mat=surf)
    _plane("Stage_BackWall", W, H, (W / 2, D, H / 2), rot=(radians(90), 0, 0), mat=surf)
    _plane("Stage_WallL", D, H, (0.0, D / 2, H / 2), rot=(radians(90), 0, radians(90)), mat=surf)
    _plane("Stage_WallR", D, H, (W,   D / 2, H / 2), rot=(radians(90), 0, radians(90)), mat=surf)


def rig():
    _clear("Rig_")
    try:
        fx = json.load(open(LAYOUT))["fixtures"]
    except Exception as e:
        print("Rig: could not read layout (%s) -- skipping truss." % e); return
    metal = _mat("TrussMetal", (0.10, 0.10, 0.11), rough=0.4, metal=1.0)

    # overhead fixtures = mounted above 1 m (layout at = [x, height, depth])
    over = [f for f in fx if f.get("at") and f["at"][1] > 1.0]

    # cluster by depth into truss rows; draw a bar spanning the fixtures' X range
    rows = {}
    for f in over:
        key = round(f["at"][2] * 2) / 2          # 0.5 m buckets by depth
        rows.setdefault(key, []).append(f)
    for depth, group in rows.items():
        xs = [f["at"][0] for f in group]
        x0, x1 = min(xs) - 0.4, max(xs) + 0.4
        _box("Rig_Truss_%.1f" % depth, (x1 - x0), 0.10, 0.10,
             ((x0 + x1) / 2, depth, H - 0.05), mat=metal)

    # a drop rod from each overhead fixture up to the ceiling truss
    for f in over:
        x, height, depth = f["at"][0], f["at"][1], f["at"][2]
        top = H - 0.05
        _box("Rig_Drop_%s" % f["id"], 0.04, 0.04, max(0.05, top - height),
             (x, depth, (height + top) / 2), mat=metal)


def dark_room():
    scene = bpy.context.scene
    w = scene.world or bpy.data.worlds.new("World"); scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (0, 0, 0, 1)
        bg.inputs["Strength"].default_value = 0.0
    # remove Blender's default lamp/cube so the DMX fixtures are the only light
    for name in ("Light", "Lamp", "Cube"):
        o = bpy.data.objects.get(name)
        if o and (o.type == "LIGHT" or name == "Cube"):
            bpy.data.objects.remove(o, do_unlink=True)


if __name__ == "__main__":
    surfaces()
    rig()
    dark_room()
    print("Stage ready: surfaces + truss/drops + dark room. Switch viewport to Rendered.")
