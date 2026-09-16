"use client";

import { useRef, useEffect, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/* COLOUR PARITY WITH THE FLAT VIEW.
   three manages colour by default: a Color set to (1, 0, 0) is taken as LINEAR
   and converted to sRGB on the way out, which lands somewhere brighter and more
   orange than the #ff0000 the 2D canvas writes for the same lamp. Switching from
   Plot to Room is a change of viewpoint, not of the show, so the two must agree
   — and the numbers coming off the wire are already the sRGB values the canvas
   uses. Turning management off makes three pass them through unchanged. */
THREE.ColorManagement.enabled = false;
import { usePortalStore } from "@/store/portal";
import { useAnimationLoop } from "@/hooks/useAnimationLoop";
import { readFixtures, trimFixtures } from "@/lib/fixtures";
import { clamp } from "@/lib/grid";
import { frameFor } from "@/lib/sync";
import { profileOf } from "@/lib/profiles";
import {
  worldOf, aimOf, throwOf, landingOf, roomOf, cameraOf, barsOf, bodyOf, type Deck,
} from "@/lib/stage3d";
import type { AnchoredClock } from "@/hooks/useAnchoredClock";
import type { LampState, Fixture } from "@/lib/types";

/* ── the beam material ───────────────────────────────────────────────────────
   A real shaft of light is haze scattering along a cone, which is a volume, and
   volumes are expensive. The cheap stand-in that actually convinces is a cone
   SHELL lit by its own silhouette: where the surface turns away from the camera
   you are looking along more of it, so it should be brighter. That one term —
   1 - |dot(normal, view)| — is what makes a flat mesh read as something with
   air inside it.

   Everything is additive with depth writing off, because light adds and a beam
   never hides what is behind it. */

const BEAM_VERT = /* glsl */ `
  uniform float uLength;
  varying vec3 vN;
  varying vec3 vV;
  varying float vAlong;          // 0 at the lens, 1 at the far end
  varying float vDepth;          // metres from the camera
  void main() {
    vAlong = clamp(-position.y / uLength, 0.0, 1.0);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal);
    vV = normalize(cameraPosition - wp.xyz);
    vDepth = length(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const BEAM_FRAG = /* glsl */ `
  uniform vec3  uColour;
  uniform float uIntensity;
  uniform float uSoft;           // 0 = hard-edged beam, 1 = soft-edged wash
  uniform float uFogDensity;
  uniform vec3  uAxis;           // the beam's own direction, in world space
  varying vec3 vN;
  varying vec3 vV;
  varying float vAlong;
  varying float vDepth;
  void main() {
    if (uIntensity <= 0.001) discard;

    /* THE ONE TERM THAT MATTERS. The cone is a shell, not a volume, so there is
       no thickness to integrate — but the amount of lit air behind a fragment is
       well approximated by how edge-on that fragment is. Face-on you are looking
       through the thin wall; grazing, you are looking down the length of it. */
    float edge = 1.0 - abs(dot(normalize(vN), normalize(vV)));
    edge = pow(clamp(edge, 0.0, 1.0), mix(2.6, 1.7, uSoft));

    /* a beam holds together down its throw; a wash falls apart almost at once */
    float fall = pow(1.0 - vAlong, mix(1.6, 3.2, uSoft));

    /* the first handspan out of the lens is always the brightest part of a shaft */
    float root = 1.0 + 1.3 * pow(1.0 - vAlong, 14.0);

    /* haze: the far end of a long throw is seen through more room than the near
       end, so it loses a little strength. It must NOT tint — mixing toward a fog
       colour swung the hue with distance, so the same lamp read as two different
       colours depending on where it was pointing. */
    float haze = exp(-uFogDensity * vDepth);

    /* A shaft pointed straight at the camera has no silhouette to read — every
       fragment is edge-on at once, so the whole cone saturates into a flat disc
       of colour. Fading it back toward the lens glow keeps a lamp aimed at you
       reading as a bright SOURCE rather than as a slab of paint. */
    float head_on = abs(dot(normalize(uAxis), normalize(vV)));
    float facing = 1.0 - 0.78 * pow(head_on, 3.0);

    float a = uIntensity * (mix(0.04, 0.12, uSoft) + edge * 1.05)
            * fall * root * mix(0.72, 1.0, haze) * facing;

    /* SOFT CLIP. Hard clamping is what turned a bright beam into a flat wedge of
       paint: everything past 1.0 became the same value, so the shaft lost its
       shading all at once and read as a solid object. Rolling off exponentially
       keeps the gradient at the top end, the way film shoulders a highlight
       instead of blowing it. */
    a = 1.0 - exp(-a * 1.7);
    gl_FragColor = vec4(uColour, clamp(a, 0.0, 1.0));
  }
`;
/** One lamp's drawable parts, kept so a frame is an update rather than a rebuild. */
interface Rig {
  lamp: { id: string; type: string; kind: string; world: [number, number, number] };
  beam: THREE.Mesh;
  beamMat: THREE.ShaderMaterial;
  lens: THREE.Sprite;
  lensMat: THREE.SpriteMaterial;
  mirror: THREE.Mesh;
  pool: THREE.Mesh | null;
  poolMat: THREE.MeshBasicMaterial | null;
  cells: Array<{ sprite: THREE.Sprite; mat: THREE.SpriteMaterial }>;
  maxThrow: number;
  deck: Deck;
}

/** A soft round sprite, used for every lens flare and floor pool. */
function discTexture(): THREE.Texture {
  const s = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const ctx = cv.getContext("2d")!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.55)");
  g.addColorStop(0.6, "rgba(255,255,255,0.13)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}


/* ── one lamp, one frame ─────────────────────────────────────────────────────
   Deliberately outside the component. Everything below mutates three.js objects
   in place, which is how an imperative renderer works and is the opposite of how
   React state works — keeping it out here says so, and keeps the per-frame path
   free of hook machinery. */
function updateRig(rig: Rig, byId: Map<string, LampState>, t: number, d: number): void {
  /* placeFixtures spaces the id out for display; match on that */
  const l = byId.get(rig.lamp.id.replace(/_/g, " "));
  if (!l) return;

  /* a strobe is dark most of the time, which is the whole effect */
  let k = l.k;
  if (l.strobe > 0.001) {
    const hz = 1 + l.strobe * 22;
    k *= (t * hz) % 1 < 0.32 ? 1 : 0.06;
  }

  const dir = aimOf(l, rig.lamp.world[1]);
  const len = throwOf(rig.lamp.world, dir, rig.maxThrow, rig.deck);
  /* zoom is live, so the cone is rescaled every frame, not just aimed */
  const spread = Math.tan(Math.min(70, l.spreadDeg) * 0.5 * Math.PI / 180);
  const r = Math.max(0.02, len * spread);

  rig.beam.visible = k > 0.004;
  rig.beam.scale.set(r, len, r);
  rig.beamMat.uniforms.uLength.value = len;
  (rig.beamMat.uniforms.uAxis.value as THREE.Vector3).set(dir[0], dir[1], dir[2]);
  rig.beamMat.uniforms.uIntensity.value = k * d;
  (rig.beamMat.uniforms.uColour.value as THREE.Color).setRGB(l.rgb[0], l.rgb[1], l.rgb[2]);

  /* the cone is modelled down -Y, so point that at the aim vector */
  AIM_FROM.set(0, -1, 0);
  AIM_TO.set(dir[0], dir[1], dir[2]);
  rig.beam.quaternion.setFromUnitVectors(AIM_FROM, AIM_TO);

  /* the reflection is the same beam through the floor plane: mirror the aim in
     y, and mirror the lamp's height too */
  rig.mirror.visible = rig.beam.visible;
  rig.mirror.scale.set(r, -len, r);
  AIM_TO.set(dir[0], -dir[1], dir[2]);
  rig.mirror.quaternion.setFromUnitVectors(AIM_FROM, AIM_TO);

  rig.lensMat.opacity = Math.min(1, k * (0.5 + 0.65 * d));
  /* the same whitening the flat renderer's emitter() applies, so a hot lamp
     reads the same colour in both views */
  const w = Math.min(1, k * 0.75);
  rig.lensMat.color.setRGB(
    l.rgb[0] + (1 - l.rgb[0]) * w,
    l.rgb[1] + (1 - l.rgb[1]) * w,
    l.rgb[2] + (1 - l.rgb[2]) * w,
  );

  if (rig.cells.length && l.cells) {
    for (let c = 0; c < rig.cells.length; c++) {
      const cell = l.cells[c] ?? ZERO_CELL;
      rig.cells[c].mat.opacity = Math.min(1, cell.k * 1.2);
      rig.cells[c].mat.color.setRGB(cell.rgb[0], cell.rgb[1], cell.rgb[2]);
    }
  }

  if (rig.pool && rig.poolMat) {
    const at = landingOf(rig.lamp.world, dir, rig.maxThrow, rig.deck);
    if (at && k > 0.01) {
      const pr = Math.max(0.5, r * 2.4);
      rig.pool.visible = true;
      rig.pool.position.set(at[0], at[1] + 0.02, at[2]);
      rig.pool.scale.set(pr, pr, 1);
      rig.poolMat.opacity = Math.min(0.85, k * 0.5 * (0.45 + 0.55 * d));
      rig.poolMat.color.setRGB(l.rgb[0], l.rgb[1], l.rgb[2]);
    } else {
      rig.pool.visible = false;
    }
  }
}

/* scratch, so a 46-fixture frame does not allocate 92 vectors */
const AIM_FROM = new THREE.Vector3();
const AIM_TO = new THREE.Vector3();
const ZERO_CELL = { k: 0, rgb: [0, 0, 0] as [number, number, number] };

interface Stage3DProps {
  clockRef: React.RefObject<AnchoredClock | null>;
  playing: boolean;
  currentTime?: number;
  /** hands the page a function that returns the camera to its opening view */
  onHome?: (home: () => void) => void;
}

export function Stage3D({ clockRef, playing, currentTime, onHome }: Stage3DProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const camRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  /* the renderer is imperative, so the scene effect reaches the current paint
     (and the current framing) through refs rather than by re-subscribing */
  const paintRef = useRef<() => void>(() => {});
  const homeRef = useRef<() => void>(() => {});
  /* smoothed auto-exposure, so a 46-lamp rig does not clip to white */
  const exposureRef = useRef(1);
  const rigsRef = useRef<Rig[]>([]);
  const discRef = useRef<THREE.Texture | null>(null);
  const failedRef = useRef(false);

  const show = usePortalStore((s) => s.show);
  const frames = usePortalStore((s) => s.frames);
  const place = usePortalStore((s) => s.place);
  const trims = usePortalStore((s) => s.trims);
  const syncLatency = usePortalStore((s) => s.syncLatency);
  const syncNudge = usePortalStore((s) => s.syncNudge);
  const syncOffset = syncLatency + syncNudge;

  /* ── build the room and the rig, once per layout ───────────────────────── */
  useEffect(() => {
    const box = boxRef.current;
    if (!box || failedRef.current) return;

    let gl: THREE.WebGLRenderer;
    try {
      gl = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    } catch {
      failedRef.current = true;
      return;                                   // StagePreview falls back to 2D
    }
    gl.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    gl.setClearColor(0x05070c, 1);
    gl.outputColorSpace = THREE.LinearSRGBColorSpace;   // see the note at the top
    gl.localClippingEnabled = true;
    box.appendChild(gl.domElement);
    gl.domElement.style.display = "block";
    gl.domElement.style.width = "100%";
    gl.domElement.style.height = "100%";
    glRef.current = gl;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x05070c, 0.022);
    sceneRef.current = scene;

    const fixtures: Fixture[] = show?.fixtures ?? [];
    const room = roomOf(fixtures);
    const disc = discTexture();
    discRef.current = disc;

    const cam = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
    camRef.current = cam;

    /* ── the room ───────────────────────────────────────────────────────────
       A beam is only visible because of what it lands on and what it travels
       through. An empty void gives it neither, which is why the first pass read
       as coloured plastic: there was no floor to catch it and no room to judge
       its length against. */
    const deckW = room.width + 16;
    const deckD = room.depth + 30;

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(deckW, deckD),
      new THREE.MeshBasicMaterial({ color: 0x080b12, transparent: true, opacity: 0.82 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(room.centreX, 0, room.centreZ);
    floor.renderOrder = 1;
    scene.add(floor);

    /* The grid is the single strongest depth cue in the frame: parallel lines
       converging is what the eye reads as distance. Two of them — a fine one for
       texture and a coarse one that survives at the far end. */
    for (const [step, colour, opacity] of [[1, 0x243049, 0.5], [4, 0x44557a, 0.6]] as const) {
      const span = Math.ceil(Math.max(deckW, deckD) / step) * step;
      const g = new THREE.GridHelper(span, span / step, colour, colour);
      g.position.set(room.centreX, 0.004, room.centreZ);
      const gm = g.material as THREE.Material;
      gm.transparent = true;
      gm.opacity = opacity;
      gm.depthWrite = false;
      g.renderOrder = 2;
      scene.add(g);
    }

    /* the deck: a low riser upstage, so the rig is lighting something */
    const stageD = Math.max(2.4, room.depth * 0.5);
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(room.width + 3, 0.6, stageD),
      new THREE.MeshBasicMaterial({ color: 0x0c1119 }),
    );
    deck.position.set(room.centreX, 0.3, room.minZ + stageD / 2 - 1.2);
    const deckBox: Deck = {
      top: 0.6,
      minX: room.centreX - (room.width + 3) / 2,
      maxX: room.centreX + (room.width + 3) / 2,
      minZ: deck.position.z - stageD / 2,
      maxZ: deck.position.z + stageD / 2,
    };
    deck.renderOrder = 3;
    scene.add(deck);

    const deckLines = new THREE.LineSegments(
      new THREE.EdgesGeometry(deck.geometry),
      new THREE.LineBasicMaterial({ color: 0x38455f, transparent: true, opacity: 0.8 }),
    );
    deckLines.position.copy(deck.position);
    scene.add(deckLines);

    /* upstage wall and two returns, so beams aimed high land on something and
       the room has corners to read the perspective against */
    const wallMat = new THREE.MeshBasicMaterial({ color: 0x070a11 });
    const wallH = room.maxY + 7;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(deckW, wallH), wallMat);
    back.position.set(room.centreX, wallH / 2, room.minZ - 2.6);
    scene.add(back);

    for (const sx of [-1, 1] as const) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(deckD, wallH), wallMat);
      side.rotation.y = sx * Math.PI / 2;
      side.position.set(room.centreX + sx * deckW / 2, wallH / 2, room.centreZ);
      scene.add(side);
    }

    /* ── the steel ── */
    const trussMat = new THREE.MeshBasicMaterial({ color: 0x242c3c });
    for (const bar of barsOf(fixtures)) {
      const len = bar.x1 - bar.x0 + 0.9;
      const chord = new THREE.Mesh(new THREE.BoxGeometry(len, 0.07, 0.07), trussMat);
      /* two chords and a gap reads as truss; one bar reads as wire */
      for (const dy of [0.16, -0.16]) {
        const c = chord.clone();
        c.position.set((bar.x0 + bar.x1) / 2, bar.y + dy, bar.z);
        scene.add(c);
      }
      for (const dz of [0.13, -0.13]) {
        const c = chord.clone();
        c.position.set((bar.x0 + bar.x1) / 2, bar.y + 0.16, bar.z + dz);
        scene.add(c);
      }
    }

    /* ── one rig entry per fixture ── */
    const bodyMat = new THREE.MeshBasicMaterial({ color: 0x11151f });
    const rigs: Rig[] = [];
    const maxThrow = Math.max(14, room.depth + room.maxY + 12);

    for (const f of fixtures) {
      const prof = profileOf(f.type);
      const world = worldOf(f.at);
      const body = bodyOf(f.type);

      const yoke = new THREE.Mesh(
        new THREE.CylinderGeometry(body.radius, body.radius * 0.86, body.length, 12),
        bodyMat,
      );
      yoke.position.set(world[0], world[1], world[2]);
      scene.add(yoke);

      /* The cone is built apex-at-origin pointing down -Y, then turned to face
         wherever the lamp is aimed. Building it open-ended matters: a capped
         cone shows a bright disc at the far end that reads as a solid object. */
      const half = Math.max(0.6, Math.tan(Math.min(70, prof.beamDeg[1]) * 0.5 * Math.PI / 180));
      const geo = new THREE.ConeGeometry(1, 1, 28, 1, true);
      geo.translate(0, -0.5, 0);                    // apex at the origin

      const beamMat = new THREE.ShaderMaterial({
        uniforms: {
          uColour: { value: new THREE.Color(1, 1, 1) },
          uIntensity: { value: 0 },
          uLength: { value: 1 },
          uSoft: { value: prof.kind === "spot" || prof.kind === "laser" ? 0 : 1 },
          uFogDensity: { value: 0.018 },
          uAxis: { value: new THREE.Vector3(0, -1, 0) },
        },
        vertexShader: BEAM_VERT,
        fragmentShader: BEAM_FRAG,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.BackSide,
      });
      const beam = new THREE.Mesh(geo, beamMat);
      beam.position.set(world[0], world[1], world[2]);
      beam.renderOrder = 5;
      beam.frustumCulled = false;
      beam.userData.half = half;
      scene.add(beam);

      const lensMat = new THREE.SpriteMaterial({
        map: disc, color: 0xffffff, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
      });
      const lens = new THREE.Sprite(lensMat);
      lens.scale.setScalar(body.radius * 4.5);
      lens.position.set(world[0], world[1], world[2]);
      lens.renderOrder = 6;
      scene.add(lens);

      /* a pixel bar is several emitters in one footprint */
      const cells: Rig["cells"] = [];
      if (prof.cells) {
        for (let c = 0; c < prof.cells; c++) {
          const m = new THREE.SpriteMaterial({
            map: disc, transparent: true, blending: THREE.AdditiveBlending,
            depthWrite: false, opacity: 0,
          });
          const sp = new THREE.Sprite(m);
          sp.scale.setScalar(0.42);
          sp.position.set(world[0], world[1] - body.length / 2 + (body.length * (c + 0.5)) / prof.cells, world[2]);
          sp.renderOrder = 6;
          scene.add(sp);
          cells.push({ sprite: sp, mat: m });
        }
      }

      /* the puddle a downward beam lays on the deck */
      let pool: THREE.Mesh | null = null;
      let poolMat: THREE.MeshBasicMaterial | null = null;
      if (prof.kind !== "laser" && prof.kind !== "blinder" && prof.kind !== "strobe") {
        poolMat = new THREE.MeshBasicMaterial({
          map: disc, transparent: true, blending: THREE.AdditiveBlending,
          depthWrite: false, opacity: 0, side: THREE.DoubleSide,
        });
        pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), poolMat);
        pool.rotation.x = -Math.PI / 2;
        pool.position.set(world[0], 0.02, world[2]);
        pool.renderOrder = 4;
        pool.visible = false;
        scene.add(pool);
      }

      /* The floor throws light back. A mirrored copy of the shaft, squashed and
         dimmed under the deck, costs one extra draw per lamp and is most of what
         separates "a room with lights in it" from "cones on a dark background".
         It shares the beam's material, so it can never disagree about colour. */
      const mirror = new THREE.Mesh(geo, beamMat);
      mirror.scale.set(1, -1, 1);
      mirror.position.set(world[0], -world[1], world[2]);
      mirror.renderOrder = 4;
      mirror.frustumCulled = false;
      scene.add(mirror);

      rigs.push({
        lamp: { id: f.id, type: f.type, kind: prof.kind, world },
        beam, beamMat, lens, lensMat, mirror, pool, poolMat, cells, maxThrow, deck: deckBox,
      });
    }
    rigsRef.current = rigs;

    /* ── the viewer walks around ──────────────────────────────────────────
       A fixed camera answers "what does the room look like"; it cannot answer
       "is that beam actually hitting the drummer". Orbit is clamped so you stay
       in the room: never under the floor, never so close you are inside a lamp,
       never so far the rig is a dot. */
    const controls = new OrbitControls(cam, gl.domElement);
    controlsRef.current = controls;
    /* Damping is deliberately OFF. With it on the camera keeps easing after the
       mouse stops, which needs a frame every tick to settle — and since a paint
       calls controls.update() and update() fires "change", that is a paint
       calling itself until the stack gives out. Undamped, "change" fires only on
       real input and one repaint answers it. */
    controls.enableDamping = false;
    controls.rotateSpeed = 0.55;
    controls.zoomSpeed = 0.7;
    controls.panSpeed = 0.6;
    controls.screenSpacePanning = false;
    controls.minDistance = 2.5;
    controls.maxDistance = Math.max(30, room.depth + room.width + 30);
    /* stop just short of the horizon: below it you are under the deck looking up
       through the floor, which is never what anyone meant to do */
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.minPolarAngle = 0.08;

    /* dragging has to repaint even while the show is paused */
    const onControls = () => { paintRef.current(); };
    controls.addEventListener("change", onControls);

    const frame = (aspect: number) => {
      const view = cameraOf(room, aspect);
      cam.fov = view.fov;
      cam.position.set(...view.position);
      controls.target.set(...view.target);
      cam.updateProjectionMatrix();
      controls.update();
    };
    homeRef.current = () => { frame(cam.aspect); paintRef.current(); };

    let framed = false;
    const resize = () => {
      const r = box.getBoundingClientRect();
      if (!r.width || !r.height) return;
      gl.setSize(r.width, r.height, false);
      cam.aspect = r.width / r.height;
      /* frame the rig once; after that the viewpoint is the viewer's, and
         resizing must not throw away where they moved to */
      if (!framed) { frame(cam.aspect); framed = true; }
      else cam.updateProjectionMatrix();
      paintRef.current();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(box);

    return () => {
      ro.disconnect();
      controls.removeEventListener("change", onControls);
      controls.dispose();
      controlsRef.current = null;
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = (m as unknown as { material?: THREE.Material | THREE.Material[] }).material;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      disc.dispose();
      gl.dispose();
      if (gl.domElement.parentNode === box) box.removeChild(gl.domElement);
      glRef.current = null;
      sceneRef.current = null;
      rigsRef.current = [];
    };
  }, [show]);

  /* ── one frame ─────────────────────────────────────────────────────────── */
  const paint = useCallback(() => {
    const gl = glRef.current;
    const scene = sceneRef.current;
    const cam = camRef.current;
    if (!gl || !scene || !cam) return;
    if (!show || !frames || !place) { gl.render(scene, cam); return; }

    const t = clockRef.current?.position() ?? 0;
    /* what the listener is hearing NOW is t minus the output latency */
    const idx = frameFor(t, show.fps, show.frame_count, syncOffset);
    const raw = readFixtures(idx, frames, show, place);
    if (!raw) { gl.render(scene, cam); return; }
    const fx = trimFixtures(raw, trims);

    const byId = new Map<string, LampState>();
    for (const l of fx.lamps) byId.set(l.id, l);

    /* EXPOSURE. Light ADDS, so a frame with forty lamps up is forty times the
       light of a frame with one — and additive blending clips long before that.
       Without this the room swung between washed-out white and barely-lit as
       the show played, which reads as the renderer being unreliable rather than
       as the show being loud. The flat view has carried the same term for a
       while; the 3D view never did, which is why only this one "randomly" got
       better and worse.

       Smoothed over time because the correction must not be visible: snapping
       it per frame turns every hit into a pump, the way a badly set compressor
       breathes. Up fast (a blackout must go dark now), down slow. */
    const lit = fx.lamps.filter((l) => l.k > 0.01);
    const want = clamp(3.4 / Math.sqrt(Math.max(1, lit.length)), 0.32, 1);
    const prev = exposureRef.current;
    exposureRef.current = want < prev ? prev + (want - prev) * 0.25 : prev + (want - prev) * 0.08;
    const d = exposureRef.current;

    for (const rig of rigsRef.current) updateRig(rig, byId, t, d);

    gl.render(scene, cam);
  }, [show, frames, place, trims, syncOffset, clockRef]);

  useEffect(() => { paintRef.current = paint; }, [paint]);

  /* let the page put the camera back where it started */
  useEffect(() => {
    if (!onHome) return;
    onHome(() => homeRef.current());
  }, [onHome]);

  useAnimationLoop(paint, playing);

  useEffect(() => {
    if (playing) return;
    paint();
  }, [show, frames, place, trims, currentTime, playing, paint]);

  return <div ref={boxRef} className="absolute inset-0" />;
}

/** Whether this browser can run the 3D view at all. */
export function webglAvailable(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const cv = document.createElement("canvas");
    return !!(cv.getContext("webgl2") || cv.getContext("webgl"));
  } catch {
    return false;
  }
}
