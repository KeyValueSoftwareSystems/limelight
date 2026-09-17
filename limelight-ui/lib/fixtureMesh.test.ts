/**
 * The shape of a lighting device, as geometry.
 *
 * A render can't be unit-tested, but the STRUCTURE can: a moving head must have a
 * yoke that pans with a head tilting inside it, and a par must not — get that
 * wrong and the "body follows the beam" step in Stage3D has nothing to turn.
 */
import { test } from "node:test";
import assert from "node:assert";
import * as THREE from "three";
import { buildFixture, fixtureMaterials } from "./fixtureMesh.ts";

const mats = fixtureMaterials();
/* a laser scans, so its profile has pan/tilt and its body must track too */
const MOVERS = ["spot29", "wash12", "head13", "laser8"];
const STATIC = ["par5", "par7", "blinder1", "strobe3", "pixelbar24"];

function isUnder(node: THREE.Object3D, root: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = node;
  while (p) { if (p === root) return true; p = p.parent; }
  return false;
}

test("a moving head has a yoke that pans and a head that tilts inside it", () => {
  for (const t of MOVERS) {
    const f = buildFixture(t, mats);
    assert.ok(f.yoke, `${t} has a yoke`);
    assert.ok(f.head, `${t} has a head`);
    assert.ok(isUnder(f.head!, f.yoke!), `${t}'s head must pivot inside its yoke`);
    assert.ok(isUnder(f.yoke!, f.group), `${t}'s yoke is part of the group`);
  }
});

test("static devices are one body with no moving head", () => {
  for (const t of STATIC) {
    const f = buildFixture(t, mats);
    assert.equal(f.yoke, null, `${t} does not pan`);
    assert.equal(f.head, null, `${t} does not tilt`);
    assert.ok(f.group.children.length > 0, `${t} still has a body`);
  }
});

test("every device is a group with parts and a finite lens anchor", () => {
  for (const t of [...MOVERS, ...STATIC, "unknown-type"]) {
    const f = buildFixture(t, mats);
    assert.ok(f.group instanceof THREE.Group, `${t} is a group`);
    assert.ok(f.group.children.length > 0, `${t} has parts`);
    assert.ok([f.lens.x, f.lens.y, f.lens.z].every(Number.isFinite), `${t} lens finite`);
  }
});

test("a moving head's lens hangs below its pivot, so a truss head points down", () => {
  for (const t of MOVERS) {
    const f = buildFixture(t, mats);
    assert.ok(f.lens.y < 0, `${t} barrel should point down by default`);
  }
});

test("a pixel strip carries its cells as separate segments", () => {
  const f = buildFixture("pixelbar24", mats);
  /* six cells means at least six emitter segments in the body */
  const meshes: THREE.Object3D[] = [];
  f.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o); });
  assert.ok(meshes.length >= 6, `a 6-cell batten needs its segments, got ${meshes.length}`);
});
