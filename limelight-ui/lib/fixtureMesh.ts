/**
 * The SHAPE of a lighting device, in three dimensions.
 *
 * Stage3D used to draw every fixture as one tapered cylinder, so a 29-channel spot
 * and an audience blinder were the same blob on a wire. This builds the real thing
 * per family: a moving head with a base, a panning yoke and a tilting head; a par
 * can with a lens and a clamp; a blinder's cell grid; a strobe panel; an LED
 * batten's segments; a laser projector.
 *
 * PERFORMANCE. Geometry and materials are created ONCE per shape and shared across
 * every instance of it — a 46-fixture arena allocates a handful of buffers, not
 * forty-six. Each `buildFixture` call returns a fresh Group of light Meshes that
 * point at those shared buffers, so the only per-fixture cost is a transform.
 *
 * ORIENTATION. Movers are built hanging, barrel down -Y, with `yoke` (pans about
 * Y) and `head` (tilts about X) pivots at the origin for Stage3D to drive each
 * frame. Static devices are built already facing the way they are hung (a par
 * points down, a blinder faces the crowd, a batten stands up), so Stage3D leaves
 * them alone. The origin of every group is its hang point.
 */
import * as THREE from "three";
import { profileOf, moves } from "./profiles.ts";
import { bodyOf } from "./stage3d.ts";

export interface FixtureMaterials {
  /** the dark plastic/aluminium housing */
  body: THREE.Material;
  /** bright steel: yoke arms, clamps, truss */
  metal: THREE.Material;
  /** the dark glass of a lens, seen when the lamp is off */
  lens: THREE.Material;
  /** a lighter accent for trim, handles, cell frames */
  accent: THREE.Material;
}

export function fixtureMaterials(): FixtureMaterials {
  return {
    body: new THREE.MeshStandardMaterial({ color: 0x15181f, roughness: 0.62, metalness: 0.35 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x40454f, roughness: 0.38, metalness: 0.85 }),
    lens: new THREE.MeshStandardMaterial({ color: 0x0a0d12, roughness: 0.18, metalness: 0.2 }),
    accent: new THREE.MeshStandardMaterial({ color: 0x23272f, roughness: 0.7, metalness: 0.3 }),
  };
}

export interface FixtureMesh {
  /** the whole device; caller sets group.position to the hang point */
  group: THREE.Group;
  /** the panning yoke of a mover (rotation.y = pan); null for static devices */
  yoke: THREE.Object3D | null;
  /** the tilting head of a mover (rotation.x = tilt); null for static devices */
  head: THREE.Object3D | null;
  /** where the light leaves the device, in group-local metres */
  lens: THREE.Vector3;
}

/* ── shared geometry, made once per shape ─────────────────────────────────── */

const CACHE = new Map<string, THREE.BufferGeometry>();
function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = CACHE.get(key);
  if (!g) {
    g = make();
    /* Marked so Stage3D's teardown does NOT dispose it: this buffer is shared by
       every instance of the shape and reused across mounts. Disposing it would
       free the GPU copy the next scene still points at. */
    g.userData.shared = true;
    CACHE.set(key, g);
  }
  return g;
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(g, m);
}

/* ── the families ─────────────────────────────────────────────────────────── */

function buildMovingHead(type: string, mats: FixtureMaterials, onFloor = false): FixtureMesh {
  const b = bodyOf(type);
  const r = b.radius;
  const L = b.length;                       // barrel length
  const ax = r * 1.25;                      // half the yoke width

  /* A floor unit (a Sharpy set on the deck) stands on a base plate with the yoke
     and head ABOVE it and the barrel pointing up at rest, rather than hanging
     from a truss. Stage3D tilts it with the same pan/tilt, from this up pose. */
  if (onFloor) {
    const group = new THREE.Group();
    const colTop = 0.22;                     // trunnion height above the deck
    const base = mesh(
      geo(`mh-fbase-${type}`, () => new THREE.BoxGeometry(r * 2.6, 0.06, r * 2.2)),
      mats.body,
    );
    base.position.y = 0.03;
    group.add(base);

    const yoke = new THREE.Object3D();
    yoke.position.y = colTop;
    group.add(yoke);

    const armGeo = geo(`mh-farm-${type}`, () => new THREE.BoxGeometry(0.05, colTop, 0.09));
    for (const sx of [-1, 1] as const) {
      const arm = mesh(armGeo, mats.metal);
      arm.position.set(sx * ax, -colTop / 2 + 0.03, 0);
      yoke.add(arm);
    }

    const head = new THREE.Object3D();
    yoke.add(head);

    const barrel = mesh(
      geo(`mh-fbarrel-${type}`, () => {
        const g = new THREE.CylinderGeometry(r, r * 0.92, L, 20);
        g.translate(0, L / 2, 0);            // point up from the trunnion
        return g;
      }),
      mats.body,
    );
    head.add(barrel);

    const finGeo = geo(`mh-ffin-${type}`, () => new THREE.BoxGeometry(r * 2.15, 0.015, r * 2.15));
    for (let i = 0; i < 4; i++) {
      const fin = mesh(finGeo, mats.accent);
      fin.position.y = L * 0.18 + i * 0.03;
      head.add(fin);
    }

    const ring = mesh(
      geo(`mh-fring-${type}`, () => {
        const g = new THREE.CylinderGeometry(r * 1.06, r * 1.06, 0.05, 20);
        g.translate(0, L + 0.02, 0);
        return g;
      }),
      mats.metal,
    );
    head.add(ring);

    const glass = mesh(
      geo(`mh-fglass-${type}`, () => {
        const g = new THREE.CircleGeometry(r * 0.94, 20);
        g.rotateX(-Math.PI / 2);             // face up +Y
        g.translate(0, L + 0.04, 0);
        return g;
      }),
      mats.lens,
    );
    head.add(glass);

    return { group, yoke, head, lens: new THREE.Vector3(0, colTop + L + 0.04, 0) };
  }

  const group = new THREE.Group();

  /* the yoke carries everything that pans; base above the trunnion, head below it */
  const yoke = new THREE.Object3D();
  group.add(yoke);

  /* base + clamp, above the origin, fixed to the truss */
  const base = mesh(
    geo(`mh-base-${type}`, () => new THREE.BoxGeometry(r * 2.3, 0.16, r * 2.0)),
    mats.body,
  );
  base.position.y = 0.16;
  yoke.add(base);

  const clamp = mesh(
    geo("mh-clamp", () => new THREE.CylinderGeometry(0.028, 0.028, 0.14, 8)),
    mats.metal,
  );
  clamp.position.y = 0.3;
  yoke.add(clamp);

  /* the two yoke arms, curving from the base down to the trunnion at the origin */
  const armGeo = geo(`mh-arm-${type}`, () => new THREE.BoxGeometry(0.05, 0.32 + L * 0.4, 0.09));
  for (const sx of [-1, 1] as const) {
    const arm = mesh(armGeo, mats.metal);
    arm.position.set(sx * ax, 0.02, 0);
    yoke.add(arm);
  }

  /* the head tilts within the yoke, about the trunnion at the origin */
  const head = new THREE.Object3D();
  yoke.add(head);

  const barrel = mesh(
    geo(`mh-barrel-${type}`, () => {
      const g = new THREE.CylinderGeometry(r, r * 0.92, L, 20);
      g.translate(0, -L / 2, 0);            // hang down from the trunnion
      return g;
    }),
    mats.body,
  );
  head.add(barrel);

  /* cooling fins near the top of the barrel — the detail that says "moving head" */
  const finGeo = geo(`mh-fin-${type}`, () => new THREE.BoxGeometry(r * 2.15, 0.015, r * 2.15));
  for (let i = 0; i < 4; i++) {
    const fin = mesh(finGeo, mats.accent);
    fin.position.y = -L * 0.18 - i * 0.03;
    head.add(fin);
  }

  /* the lens ring at the mouth of the barrel */
  const ring = mesh(
    geo(`mh-ring-${type}`, () => {
      const g = new THREE.CylinderGeometry(r * 1.06, r * 1.06, 0.05, 20);
      g.translate(0, -L - 0.02, 0);
      return g;
    }),
    mats.metal,
  );
  head.add(ring);

  const glass = mesh(
    geo(`mh-glass-${type}`, () => {
      const g = new THREE.CircleGeometry(r * 0.94, 20);
      g.rotateX(Math.PI / 2);               // face down -Y
      g.translate(0, -L - 0.04, 0);
      return g;
    }),
    mats.lens,
  );
  head.add(glass);

  return { group, yoke, head, lens: new THREE.Vector3(0, -L - 0.04, 0) };
}

function buildParCan(type: string, mats: FixtureMaterials, onFloor = false): FixtureMesh {
  const b = bodyOf(type);
  const r = b.radius, L = b.length;
  const group = new THREE.Group();

  /* A floor uplighter: the can stands on a base plate on the deck and points
     straight up, instead of hanging mouth-down from a bar. */
  if (onFloor) {
    const base = mesh(
      geo(`par-fbase-${type}`, () => new THREE.CylinderGeometry(r * 1.25, r * 1.45, 0.06, 18)),
      mats.metal,
    );
    base.position.y = 0.03;
    group.add(base);

    const can = mesh(
      geo(`par-fcan-${type}`, () => {
        const g = new THREE.CylinderGeometry(r * 1.04, r, L, 18);
        g.translate(0, 0.06 + L / 2, 0);     // sits on the base, mouth up
        return g;
      }),
      mats.body,
    );
    group.add(can);

    const ring = mesh(
      geo(`par-fring-${type}`, () => {
        const g = new THREE.CylinderGeometry(r * 1.08, r * 1.08, 0.04, 18);
        g.translate(0, 0.06 + L, 0);
        return g;
      }),
      mats.metal,
    );
    group.add(ring);

    const glass = mesh(
      geo(`par-fglass-${type}`, () => {
        const g = new THREE.CircleGeometry(r * 0.95, 18);
        g.rotateX(-Math.PI / 2);             // face up +Y
        g.translate(0, 0.06 + L + 0.02, 0);
        return g;
      }),
      mats.lens,
    );
    group.add(glass);

    return { group, yoke: null, head: null, lens: new THREE.Vector3(0, 0.06 + L + 0.02, 0) };
  }

  /* clamp + a short drop so it reads as hung from the bar, not floating */
  const drop = mesh(
    geo("par-drop", () => new THREE.CylinderGeometry(0.02, 0.02, 0.16, 6)),
    mats.metal,
  );
  drop.position.y = 0.14;
  group.add(drop);

  const can = mesh(
    geo(`par-can-${type}`, () => {
      const g = new THREE.CylinderGeometry(r, r * 1.04, L, 18);
      g.translate(0, -L / 2 - 0.02, 0);     // barrel below the clamp, mouth down
      return g;
    }),
    mats.body,
  );
  group.add(can);

  const ring = mesh(
    geo(`par-ring-${type}`, () => {
      const g = new THREE.CylinderGeometry(r * 1.08, r * 1.08, 0.04, 18);
      g.translate(0, -L - 0.02, 0);
      return g;
    }),
    mats.metal,
  );
  group.add(ring);

  const glass = mesh(
    geo(`par-glass-${type}`, () => {
      const g = new THREE.CircleGeometry(r * 0.95, 18);
      g.rotateX(Math.PI / 2);
      g.translate(0, -L - 0.04, 0);
      return g;
    }),
    mats.lens,
  );
  group.add(glass);

  return { group, yoke: null, head: null, lens: new THREE.Vector3(0, -L - 0.04, 0) };
}

function buildBlinder(type: string, mats: FixtureMaterials): FixtureMesh {
  const b = bodyOf(type);
  const s = b.radius;                        // a blinder is squat and square
  const group = new THREE.Group();

  /* a 2×2 frame of reflector cells, facing +Z (the crowd) */
  const frame = mesh(
    geo("blind-frame", () => new THREE.BoxGeometry(s * 2.2, s * 2.2, 0.12)),
    mats.body,
  );
  group.add(frame);

  const cellGeo = geo("blind-cell", () => {
    const g = new THREE.CylinderGeometry(s * 0.52, s * 0.52, 0.05, 16);
    g.rotateX(Math.PI / 2);                  // face +Z
    return g;
  });
  for (const cx of [-1, 1] as const) for (const cy of [-1, 1] as const) {
    const cell = mesh(cellGeo, mats.accent);
    cell.position.set(cx * s * 0.55, cy * s * 0.55, 0.05);
    group.add(cell);
  }

  const clamp = mesh(
    geo("blind-clamp", () => new THREE.CylinderGeometry(0.02, 0.02, 0.14, 6)),
    mats.metal,
  );
  clamp.position.y = s * 1.1 + 0.06;
  group.add(clamp);

  return { group, yoke: null, head: null, lens: new THREE.Vector3(0, 0, 0.1) };
}

function buildStrobe(type: string, mats: FixtureMaterials): FixtureMesh {
  const b = bodyOf(type);
  const s = b.radius;
  const group = new THREE.Group();

  const housing = mesh(
    geo("strobe-housing", () => new THREE.BoxGeometry(s * 2.6, s * 1.7, 0.14)),
    mats.body,
  );
  group.add(housing);

  /* the xenon tube behind a diffuser, facing the crowd */
  const tube = mesh(
    geo("strobe-tube", () => {
      const g = new THREE.BoxGeometry(s * 2.1, s * 0.7, 0.04);
      g.translate(0, 0, 0.07);
      return g;
    }),
    mats.lens,
  );
  group.add(tube);

  const clamp = mesh(
    geo("strobe-clamp", () => new THREE.CylinderGeometry(0.02, 0.02, 0.14, 6)),
    mats.metal,
  );
  clamp.position.y = s * 0.85 + 0.06;
  group.add(clamp);

  return { group, yoke: null, head: null, lens: new THREE.Vector3(0, 0, 0.1) };
}

function buildStrip(type: string, mats: FixtureMaterials): FixtureMesh {
  const b = bodyOf(type);
  const prof = profileOf(type);
  const cells = prof.cells ?? 6;
  const len = b.length;                      // an LED batten is long
  const w = b.radius * 2.2;
  const group = new THREE.Group();

  /* the extrusion, standing upright as a tower */
  const bar = mesh(
    geo(`strip-bar-${type}`, () => new THREE.BoxGeometry(w, len, w * 0.7)),
    mats.body,
  );
  group.add(bar);

  /* one emitter segment per cell, stacked up the face toward the crowd */
  const cellGeo = geo(`strip-cell-${type}`, () => {
    const g = new THREE.BoxGeometry(w * 0.8, (len / cells) * 0.7, 0.03);
    return g;
  });
  for (let c = 0; c < cells; c++) {
    const seg = mesh(cellGeo, mats.lens);
    seg.position.set(0, -len / 2 + (len * (c + 0.5)) / cells, w * 0.36);
    group.add(seg);
  }

  return { group, yoke: null, head: null, lens: new THREE.Vector3(0, 0, w * 0.4) };
}

function buildLaser(type: string, mats: FixtureMaterials): FixtureMesh {
  const b = bodyOf(type);
  const r = b.radius, L = b.length;
  const group = new THREE.Group();

  const box = mesh(
    geo(`laser-box-${type}`, () => {
      const g = new THREE.BoxGeometry(r * 2.4, r * 1.8, L);
      g.translate(0, -r, 0);
      return g;
    }),
    mats.body,
  );
  group.add(box);

  /* the aperture on the front face, pointing down-and-out like a par */
  const aperture = mesh(
    geo(`laser-ap-${type}`, () => {
      const g = new THREE.CylinderGeometry(r * 0.3, r * 0.3, 0.04, 12);
      g.translate(0, -L / 2 - r, 0);
      return g;
    }),
    mats.lens,
  );
  group.add(aperture);

  const clamp = mesh(
    geo("laser-clamp", () => new THREE.CylinderGeometry(0.02, 0.02, 0.12, 6)),
    mats.metal,
  );
  clamp.position.y = 0.06;
  group.add(clamp);

  return { group, yoke: null, head: null, lens: new THREE.Vector3(0, -L / 2 - r, 0) };
}

/** A scanning laser: a compact projector on a pan/tilt yoke, so it tracks its beam. */
function buildLaserHead(type: string, mats: FixtureMaterials): FixtureMesh {
  const b = bodyOf(type);
  const r = b.radius, L = b.length;
  const group = new THREE.Group();

  const yoke = new THREE.Object3D();
  group.add(yoke);

  const base = mesh(
    geo(`lh-base-${type}`, () => new THREE.BoxGeometry(r * 2.0, 0.1, r * 1.6)),
    mats.body,
  );
  base.position.y = 0.13;
  yoke.add(base);

  const clamp = mesh(
    geo("lh-clamp", () => new THREE.CylinderGeometry(0.02, 0.02, 0.12, 6)),
    mats.metal,
  );
  clamp.position.y = 0.24;
  yoke.add(clamp);

  const armGeo = geo(`lh-arm-${type}`, () => new THREE.BoxGeometry(0.04, 0.2, 0.08));
  for (const sx of [-1, 1] as const) {
    const arm = mesh(armGeo, mats.metal);
    arm.position.set(sx * r * 1.25, 0.03, 0);
    yoke.add(arm);
  }

  const head = new THREE.Object3D();
  yoke.add(head);

  const box = mesh(
    geo(`lh-box-${type}`, () => {
      const g = new THREE.BoxGeometry(r * 1.9, r * 1.4, L);
      g.translate(0, -r * 0.9, 0);
      return g;
    }),
    mats.body,
  );
  head.add(box);

  const aperture = mesh(
    geo(`lh-ap-${type}`, () => {
      const g = new THREE.CylinderGeometry(r * 0.3, r * 0.3, 0.05, 12);
      g.translate(0, -r * 0.9 - L / 2 - 0.02, 0);
      return g;
    }),
    mats.lens,
  );
  head.add(aperture);

  return { group, yoke, head, lens: new THREE.Vector3(0, -r * 0.9 - L / 2 - 0.04, 0) };
}

/**
 * Build the geometry for one device, choosing the family from its profile.
 *
 * `onFloor` builds a deck-standing variant (base plate, body pointing up) for the
 * families that a floor rig uses — par uplighters and a moving head set on the
 * deck — instead of the truss-hung default.
 */
export function buildFixture(type: string, mats: FixtureMaterials, onFloor = false): FixtureMesh {
  if (moves(type)) {
    return profileOf(type).kind === "laser"
      ? buildLaserHead(type, mats)
      : buildMovingHead(type, mats, onFloor);
  }
  switch (profileOf(type).kind) {
    case "blinder": return buildBlinder(type, mats);
    case "strobe": return buildStrobe(type, mats);
    case "strip": return buildStrip(type, mats);
    case "laser": return buildLaser(type, mats);
    default: return buildParCan(type, mats, onFloor);   // par, and any unknown type
  }
}
