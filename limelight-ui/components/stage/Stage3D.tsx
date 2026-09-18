"use client";

import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

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
import { frameFor } from "@/lib/sync";
import { profileOf, moves } from "@/lib/profiles";
import { DEG } from "@/lib/dmx";
import { frameLight, roomAmbient } from "@/lib/exposure";
import {
  worldOf, aimOf, roomOf, cameraOf, barsOf, bodyOf, staticAim,
  deckOf, towersOf, boothOf, screensOf, surfaceHit, type Deck, type Walls,
} from "@/lib/stage3d";
import { buildFixture, fixtureMaterials } from "@/lib/fixtureMesh";
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

    /* A shaft reads as a solid cone of lit air, but only just: pushed too hard,
       a rig with forty beams up adds to a flat white blob and every shaft loses
       its shape. The base term fills the middle of the cone (the volume you see
       in haze); edge is the hot rim where you look down its length. The haze
       term now falls off much harder with distance, so a long throw or a far
       camera dims the way real light does through air rather than staying full. */
    /* The base term is the flat fill that reads as fog and stacks to a white wash
       when many beams overlap; kept low so the room stays dark. The edge term is
       the defined silhouette of the shaft and carries most of the look, so it
       stays strong — what makes a beam read as a punchy shaft rather than haze. */
    float a = uIntensity * (mix(0.02, 0.048, uSoft) + edge * 1.0)
            * fall * root * mix(0.4, 1.0, haze) * facing;

    /* SOFT CLIP. Hard clamping is what turned a bright beam into a flat wedge of
       paint: everything past 1.0 became the same value, so the shaft lost its
       shading all at once and read as a solid object. Rolling off exponentially
       keeps the gradient at the top end, the way film shoulders a highlight
       instead of blowing it. */
    a = 1.0 - exp(-a * 1.15);
    gl_FragColor = vec4(uColour, clamp(a, 0.0, 1.0));
  }
`;

/* ── the room's own surfaces ─────────────────────────────────────────────────
   Nothing in this room used to be touched by the rig. The floor, deck and walls
   were MeshBasicMaterial with hard-coded darks and the scene held no light at
   all, so the only pixels that ever changed were the beams themselves — which is
   why a blackout read as cones switching off rather than as a room going dark.

   Real lighting is not available to us: three recompiles its shaders against the
   light count, and a 46-fixture arena is far past what that handles. So the room
   gets ONE number and ONE colour for the whole frame, and each surface decides
   how much of it to catch. Two uniform writes per frame for the entire room. */

const ROOM_VERT = /* glsl */ `
  varying vec3 vW;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const ROOM_FRAG = /* glsl */ `
  uniform vec3  uBase;       // the surface's own colour, unlit
  uniform vec3  uTint;       // the rig's colour this frame
  uniform float uAmbient;    // how much of it to catch, 0..AMBIENT_GAIN
  uniform vec2  uCentre;     // the room's centre, in x and z
  uniform float uSpan;       // the larger of the room's two dimensions
  varying vec3 vW;
  void main() {
    /* Distance in the HORIZONTAL plane only. Including height would darken the
       floor directly beneath the truss, which is the one place a rig most
       obviously lights. */
    float d = distance(vW.xz, uCentre) / max(uSpan, 0.001);

    /* A floor of 0.55 rather than a fade to nothing. A hard falloff puts a
       spotlight on the middle of the room and leaves the corners as black as
       they were, which reads as a bug rather than as depth. */
    float fall = mix(0.55, 1.0, 1.0 - clamp(d, 0.0, 1.0));

    gl_FragColor = vec4(uBase + uTint * uAmbient * fall, 1.0);
  }
`;

/** One lamp's drawable parts, kept so a frame is an update rather than a rebuild. */
interface Rig {
  lamp: { id: string; type: string; kind: string; world: [number, number, number] };
  /** the panning yoke and tilting head of a mover, so the body follows the beam */
  yoke: THREE.Object3D | null;
  head: THREE.Object3D | null;
  /** true for a mover standing on the deck (barrel up at rest) vs hung (barrel down) */
  floorHead: boolean;
  beam: THREE.Mesh;
  beamMat: THREE.ShaderMaterial;
  lens: THREE.Sprite;
  lensMat: THREE.SpriteMaterial;
  pool: THREE.Mesh | null;
  poolMat: THREE.MeshBasicMaterial | null;
  cells: Array<{ sprite: THREE.Sprite; mat: THREE.SpriteMaterial }>;
  maxThrow: number;
  deck: Deck;
  /** the room's walls, so a beam lands and glows on them instead of passing through */
  walls: Walls;
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

/** One LED pixel cell: a lit face with a dark gutter, tiled to make a video wall. */
function ledGridTexture(): THREE.Texture {
  const s = 32;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, s, s);
  /* the emitting pixel, inset so a dark grid shows between cells */
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(2, 2, s - 4, s - 4);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
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

  /* THE BODY FOLLOWS THE BEAM. A mover's yoke pans and its head tilts to the same
     pan/tilt the beam is aimed by, so the lamp visibly points where the light
     goes instead of hanging as a static can. The head is modelled pointing down
     -Y, so straight-down is tilt 0 and the horizon is a quarter-turn from it. */
  if (rig.yoke && rig.head) {
    const el = (l.el ?? 0) * DEG;
    rig.yoke.rotation.y = (l.az ?? 0) * DEG;
    /* a hung head is modelled barrel-down (straight down = tilt 0); a floor head
       is modelled barrel-up, so its tilt is the mirror of that */
    rig.head.rotation.x = rig.floorHead ? (Math.PI / 2 - el) : -(Math.PI / 2 + el);
  }

  /* the nearest surface the beam meets — floor, deck or a wall. The shaft stops
     there (so it no longer runs through the walls and screens) and its glow is
     laid against that surface below. */
  const hit = surfaceHit(rig.lamp.world, dir, rig.maxThrow, rig.deck, rig.walls);
  const len = hit ? hit.dist : rig.maxThrow;
  /* zoom is live, so the cone is rescaled every frame, not just aimed */
  const spread = Math.tan(Math.min(70, l.spreadDeg) * 0.5 * Math.PI / 180);
  const r = Math.max(0.02, len * spread);

  rig.beam.visible = k > 0.004;
  rig.beam.scale.set(r, len, r);
  rig.beamMat.uniforms.uLength.value = len;
  (rig.beamMat.uniforms.uAxis.value as THREE.Vector3).set(dir[0], dir[1], dir[2]);
  /* density is applied TWICE for the beams. Once (in `d`) it keeps total output
     roughly constant as the rig grows; but additive cones that OVERLAP still sum
     toward white, and a 46-fixture arena all pointing at the deck is nothing but
     overlap. The second factor bites only when many lamps are up (d is near 1 for
     a small rig, so it leaves the desk rig alone) and is what stops a dense rig
     washing to a white blob. */
  rig.beamMat.uniforms.uIntensity.value = k * d * d;
  (rig.beamMat.uniforms.uColour.value as THREE.Color).setRGB(l.rgb[0], l.rgb[1], l.rgb[2]);

  /* the cone is modelled down -Y, so point that at the aim vector */
  AIM_FROM.set(0, -1, 0);
  AIM_TO.set(dir[0], dir[1], dir[2]);
  rig.beam.quaternion.setFromUnitVectors(AIM_FROM, AIM_TO);

  rig.lensMat.opacity = Math.min(0.55, k * (0.28 + 0.4 * d));
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
    if (hit && k > 0.01) {
      const pr = Math.max(0.55, r * 2.5);
      rig.pool.visible = true;
      /* sit just off the surface and lie flat against it — floor, deck OR wall */
      rig.pool.position.set(
        hit.point[0] + hit.normal[0] * 0.02,
        hit.point[1] + hit.normal[1] * 0.02,
        hit.point[2] + hit.normal[2] * 0.02,
      );
      POOL_N.set(hit.normal[0], hit.normal[1], hit.normal[2]);
      rig.pool.quaternion.setFromUnitVectors(POOL_UP, POOL_N);
      rig.pool.scale.set(pr, pr, 1);
      /* same overlap problem as the beams: many pools converge and stack to white,
         so density is folded in here too */
      rig.poolMat.opacity = Math.min(0.32, k * 0.32 * d * (0.4 + 0.6 * d));
      rig.poolMat.color.setRGB(l.rgb[0], l.rgb[1], l.rgb[2]);
    } else {
      rig.pool.visible = false;
    }
  }
}

/** Put one lamp out. Beside updateRig, and outside the component for the same
 *  reason: mutating three.js objects in place is how an imperative renderer
 *  works, and React's compiler is right to stop it happening inside a hook. */
function blankRig(rig: Rig): void {
  rig.beam.visible = false;
  rig.lensMat.opacity = 0;
  if (rig.pool) rig.pool.visible = false;
  for (const c of rig.cells) c.mat.opacity = 0;
}

/* scratch, so a 46-fixture frame does not allocate 92 vectors */
const AIM_FROM = new THREE.Vector3();
const AIM_TO = new THREE.Vector3();
/* the glow quad is built facing +Z; POOL_N is the surface normal it is turned onto */
const POOL_UP = new THREE.Vector3(0, 0, 1);
const POOL_N = new THREE.Vector3();
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
  const composerRef = useRef<EffectComposer | null>(null);
  /* the renderer is imperative, so the scene effect reaches the current paint
     (and the current framing) through refs rather than by re-subscribing */
  const paintRef = useRef<() => void>(() => {});
  const homeRef = useRef<() => void>(() => {});
  const rigsRef = useRef<Rig[]>([]);
  /* the room's shared uniforms, so paint can write them without rebuilding */
  const roomUniformsRef = useRef<{
    uTint: { value: THREE.Color };
    uAmbient: { value: number };
    uCentre: { value: THREE.Vector2 };
    uSpan: { value: number };
  } | null>(null);
  const discRef = useRef<THREE.Texture | null>(null);
  /* the LED screens' materials, so paint can drive them with the frame colour */
  const screensRef = useRef<THREE.MeshBasicMaterial[] | null>(null);
  const failedRef = useRef(false);
  const tearingDownRef = useRef(false);
  /* how many times we have rebuilt after losing a context, so it cannot spin */
  const recoveriesRef = useRef(0);
  /* a blinder at full does not light a room, it takes it over */
  const floodRef = useRef<HTMLDivElement>(null);
  /* bumped to rebuild the scene after the GPU hands the context back */
  const [generation, setGeneration] = useState(0);

  const show = usePortalStore((s) => s.show);
  const frames = usePortalStore((s) => s.frames);
  const place = usePortalStore((s) => s.place);
  const trims = usePortalStore((s) => s.trims);
  const syncLatency = usePortalStore((s) => s.syncLatency);
  const syncNudge = usePortalStore((s) => s.syncNudge);
  const syncOffset = syncLatency + syncNudge;

  /* What the scene is actually built from. A re-bake changes `show` without
     moving a single lamp, and rebuilding on that threw the viewer's camera back
     to the front-of-house default every time they edited a cue. */
  const rigKey = useMemo(
    () => (show?.fixtures ?? [])
      .map((f) => `${f.id}:${f.type}:${(f.at ?? []).join(",")}`)
      .join("|"),
    [show],
  );

  /* the effect is keyed on the rig, so it reads the current show through a ref */
  const showRef = useRef(show);
  useEffect(() => { showRef.current = show; }, [show]);

  /* ── build the room and the rig, once per layout ───────────────────────── */
  useEffect(() => {
    const box = boxRef.current;
    if (!box || failedRef.current) return;
    tearingDownRef.current = false;
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
    box.appendChild(gl.domElement);

    /* A GPU reset used to black this canvas for good: the default action on
       context loss is to give up, and nothing here asked for it back. */
    /* A context we lost by accident is one we have to ask for again OURSELVES.
       Waiting on `webglcontextrestored` is what the spec suggests and it is not
       enough: a context the browser EVICTED to make room for another is simply
       taken, and no restore event is ever fired for it. That is how the room
       went black and stayed black. preventDefault still matters — it is what
       makes the canvas reusable at all — but the rebuild is ours to schedule.

       Our own teardown calls forceContextLoss after removing these listeners, so
       a loss arriving here is always a real one. The cap is there because if the
       GPU cannot keep a context at all, rebuilding forever would be a spin. */
    const onLost = (e: Event) => {
      e.preventDefault();
      if (tearingDownRef.current) return;
      if (recoveriesRef.current >= 3) return;
      recoveriesRef.current++;
      setGeneration((g) => g + 1);
    };
    const onRestored = () => { setGeneration((g) => g + 1); };
    gl.domElement.addEventListener("webglcontextlost", onLost);
    gl.domElement.addEventListener("webglcontextrestored", onRestored);
    gl.domElement.style.display = "block";
    gl.domElement.style.width = "100%";
    gl.domElement.style.height = "100%";
    glRef.current = gl;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x05070c, 0.026);   // a little more air for the beams to cut
    sceneRef.current = scene;

    /* Two constant lights, ONLY so the solid hardware — fixtures, truss, deck —
       has form to read. This is not the show: the beams and the room's own
       ambient still carry that. It is a fixed cost regardless of fixture count,
       unlike per-lamp point lights, which is what the note below rules out. The
       set pieces use MeshStandardMaterial so these actually shade them; the
       floor and walls stay on the ambient shader and keep reacting to the rig. */
    scene.add(new THREE.HemisphereLight(0x5a6884, 0x0a0c12, 1.05));
    const keyLight = new THREE.DirectionalLight(0x9fb0d0, 0.55);
    keyLight.position.set(3, 10, 8);
    scene.add(keyLight);

    const fixtures: Fixture[] = showRef.current?.fixtures ?? [];
    const room = roomOf(fixtures);

    /* One set of uniform OBJECTS, shared by reference across every room surface.
       Spreading them into each material copies the references, not the values, so
       writing roomU.uAmbient.value once updates the floor, the deck and all three
       walls together. */
    const roomU = {
      uTint: { value: new THREE.Color(0, 0, 0) },
      uAmbient: { value: 0 },
      uCentre: { value: new THREE.Vector2(room.centreX, room.centreZ) },
      uSpan: { value: Math.max(room.width, room.depth) },
    };
    roomUniformsRef.current = roomU;

    const roomMaterial = (base: number) =>
      new THREE.ShaderMaterial({
        uniforms: { ...roomU, uBase: { value: new THREE.Color(base) } },
        vertexShader: ROOM_VERT,
        fragmentShader: ROOM_FRAG,
      });

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

    /* Opaque now. The 0.82 was there so the mirrored beams below could show
       through; those are gone, and an opaque floor is what stops anything under
       the deck ever reading as a reflection again. */
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(deckW, deckD),
      roomMaterial(0x080b12),
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

    /* ── the stage: a raised deck the rig is actually lighting ──────────────── */
    const stage = deckOf(room);
    const deckBox: Deck = stage;                 // StageDeck is a Deck; beams land on it

    /* A raised deck only when the rig hangs in the air. A floor rig gets a flush
       deck (height 0) — its fixtures stand on the ground plane, so the riser box,
       its skirt and its front lip are skipped and the floor grid shows through. */
    if (stage.height > 0.05) {
      /* the deck top reacts to the show through the ambient shader, like the floor */
      const deck = new THREE.Mesh(
        new THREE.BoxGeometry(stage.width, stage.height, stage.depth),
        roomMaterial(0x0c1119),
      );
      deck.position.set(stage.centreX, stage.height / 2, stage.centreZ);
      deck.renderOrder = 3;
      scene.add(deck);

      /* a dark fascia skirt across the downstage face, so the deck reads as raised */
      const skirt = new THREE.Mesh(
        new THREE.PlaneGeometry(stage.width, stage.height),
        new THREE.MeshStandardMaterial({ color: 0x05070b, roughness: 0.92, metalness: 0.08 }),
      );
      skirt.position.set(stage.centreX, stage.height / 2, stage.frontZ + 0.002);
      scene.add(skirt);

      /* a bright metal lip along the front edge of the stage */
      const lip = new THREE.Mesh(
        new THREE.BoxGeometry(stage.width, 0.05, 0.06),
        new THREE.MeshStandardMaterial({ color: 0x51618a, roughness: 0.4, metalness: 0.75 }),
      );
      lip.position.set(stage.centreX, stage.height, stage.frontZ);
      scene.add(lip);
    }

    /* ── the LED screens and DJ booth ─────────────────────────────────────────
       Stage dressing for a built venue (raised deck): an upstage LED wall + two
       side pillars, and a booth downstage-of-centre. A floor rig (the desk) is a
       bare setup — just its fixtures on the ground — so all of this is skipped.
       Screens are emissive (ignore scene lights) and paint() drives their colour
       off the frame, throwing that colour across the stage through the bloom. */
    const screenTexs: THREE.Texture[] = [];
    const screenMats: THREE.MeshBasicMaterial[] = [];
    if (stage.height > 0.05) {
      const makeScreen = (sc: { x: number; y: number; z: number; w: number; h: number }) => {
        const tex = ledGridTexture();
        tex.repeat.set(Math.max(1, Math.round(sc.w * 7)), Math.max(1, Math.round(sc.h * 7)));
        screenTexs.push(tex);
        const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0x0b0e16, toneMapped: false, fog: false });
        const panel = new THREE.Mesh(new THREE.PlaneGeometry(sc.w, sc.h), mat);
        panel.position.set(sc.x, sc.y, sc.z);
        panel.renderOrder = 2;
        scene.add(panel);
        screenMats.push(mat);
        /* a dark bezel just behind, so the panel reads as a screen in a frame */
        const bezel = new THREE.Mesh(
          new THREE.PlaneGeometry(sc.w + 0.22, sc.h + 0.22),
          new THREE.MeshStandardMaterial({ color: 0x04050a, roughness: 0.8, metalness: 0.3 }),
        );
        bezel.position.set(sc.x, sc.y, sc.z - 0.05);
        scene.add(bezel);
      };
      const screens = screensOf(room, stage);
      makeScreen(screens.wall);
      for (const p of screens.pillars) makeScreen(p);

      /* the DJ booth, downstage-of-centre, facing the crowd */
      const booth = boothOf(stage);
      scene.add(new THREE.Mesh(
        new THREE.BoxGeometry(booth.w, booth.h, booth.d),
        new THREE.MeshStandardMaterial({ color: 0x0e1118, roughness: 0.7, metalness: 0.3 }),
      ).translateX(booth.x).translateY(stage.top + booth.h / 2).translateZ(booth.z));
      const boothFace = new THREE.Mesh(
        new THREE.PlaneGeometry(booth.w * 0.92, booth.h * 0.44),
        new THREE.MeshStandardMaterial({
          color: 0x16233c, roughness: 0.5, metalness: 0.4,
          emissive: 0x0b1a34, emissiveIntensity: 0.7,
        }),
      );
      boothFace.position.set(booth.x, stage.top + booth.h * 0.58, booth.z + booth.d / 2 + 0.002);
      scene.add(boothFace);
    }
    screensRef.current = screenMats;

    /* upstage wall and two returns, so beams aimed high land on something and
       the room has corners to read the perspective against */
    const wallMat = roomMaterial(0x070a11);
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

    /* the wall planes as maths, so a beam lands and glows on them (see surfaceHit) */
    const wallsBounds: Walls = {
      backZ: room.minZ - 2.6,
      minX: room.centreX - deckW / 2,
      maxX: room.centreX + deckW / 2,
      wallTop: wallH,
      frontZ: room.centreZ + deckD / 2,
    };

    /* ── the steel: box-truss, goalpost towers, hanging motors ──────────────── */
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x3c424e, roughness: 0.45, metalness: 0.82 });
    const motorMat = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.6, metalness: 0.4 });
    const TS = 0.26;                              // truss cross-section (square)
    const CH = 0.04;                              // chord thickness

    /* a curved truss (an arch) is one short box per consecutive pair of points,
       each turned onto its own segment — a single x0..x1 box would cut the chord
       and read as a girder through the middle of the arch */
    const addCurve = (points: [number, number, number][]) => {
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
        const segLen = Math.hypot(dx, dy, dz);
        if (segLen < 1e-6) continue;
        const seg = new THREE.Mesh(new THREE.BoxGeometry(segLen, 0.1, 0.1), steelMat);
        seg.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
        seg.quaternion.setFromUnitVectors(
          new THREE.Vector3(1, 0, 0),
          new THREE.Vector3(dx, dy, dz).normalize(),
        );
        scene.add(seg);
      }
    };

    /* a horizontal box-truss along x: four chords, with vertical and diagonal
       webbing on the downstage face so it reads as lattice, not a solid beam */
    const addHTruss = (x0: number, x1: number, y: number, z: number) => {
      const len = x1 - x0 + 0.9;
      const cx = (x0 + x1) / 2;
      const chordGeo = new THREE.BoxGeometry(len, CH, CH);
      for (const dy of [TS / 2, -TS / 2]) for (const dz of [TS / 2, -TS / 2]) {
        const c = new THREE.Mesh(chordGeo, steelMat);
        c.position.set(cx, y + dy, z + dz);
        scene.add(c);
      }
      const bays = Math.max(2, Math.round(len / 1.1));   // fewer struts — lighter, less busy
      const bay = len / bays;
      const vGeo = new THREE.BoxGeometry(0.026, TS, 0.026);
      const dGeo = new THREE.BoxGeometry(0.022, Math.hypot(bay, TS), 0.022);
      const ang = Math.atan2(bay, TS);
      for (let i = 0; i <= bays; i++) {
        const px = x0 - 0.45 + bay * i;
        const v = new THREE.Mesh(vGeo, steelMat);
        v.position.set(px, y, z + TS / 2);
        scene.add(v);
        if (i < bays) {
          const d = new THREE.Mesh(dGeo, steelMat);
          d.position.set(px + bay / 2, y, z + TS / 2);
          d.rotation.z = i % 2 ? ang : -ang;
          scene.add(d);
        }
      }
    };

    /* a vertical goalpost tower from the floor to the truss, with a base plate */
    const addTower = (x: number, z: number, yTop: number) => {
      const chordGeo = new THREE.BoxGeometry(CH, yTop, CH);
      for (const dx of [TS / 2, -TS / 2]) for (const dz of [TS / 2, -TS / 2]) {
        const c = new THREE.Mesh(chordGeo, steelMat);
        c.position.set(x + dx, yTop / 2, z + dz);
        scene.add(c);
      }
      const bays = Math.max(2, Math.round(yTop / 0.95));
      const rGeo = new THREE.BoxGeometry(TS, 0.024, 0.024);
      for (let i = 0; i <= bays; i++) {
        const py = (yTop * i) / bays;
        const rf = new THREE.Mesh(rGeo, steelMat);
        rf.position.set(x, py, z + TS / 2);
        scene.add(rf);
        const rs = new THREE.Mesh(rGeo, steelMat);
        rs.rotation.y = Math.PI / 2;
        rs.position.set(x + TS / 2, py, z);
        scene.add(rs);
      }
      const plate = new THREE.Mesh(new THREE.BoxGeometry(TS * 1.9, 0.08, TS * 1.9), steelMat);
      plate.position.set(x, 0.04, z);
      scene.add(plate);
    };

    /* a chain hoist where a bar meets its tower */
    const addMotor = (x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.16), motorMat);
      m.position.set(x, y + TS / 2 + 0.12, z);
      scene.add(m);
    };

    /* a light single-tube bar, for the small artistic fixture clusters that would
       read as clutter if every one got a full box-truss */
    const addThinBar = (x0: number, x1: number, y: number, z: number) => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 0.5, 0.05, 0.05), steelMat);
      bar.position.set((x0 + x1) / 2, y, z);
      scene.add(bar);
    };

    /* A full box-truss is only warranted for a wide overhead run; a rig laid out
       as many small groups (echostage's crown) otherwise becomes a wall of
       frames. Narrow groups get a light bar. */
    const bars = barsOf(fixtures);
    const mainSpan = room.width * 0.55;
    const isWide = (b: typeof bars[number]) => (b.x1 - b.x0) >= mainSpan;
    const flown: { x0: number; x1: number; y: number; z: number }[] = [];
    for (const bar of bars) {
      if (bar.kind === "curve") { addCurve(bar.points); continue; }   // arches are self-standing
      if (bar.y < 1) continue;   // a floor rig stands on the deck — no overhead truss or stand
      if (isWide(bar)) {
        addHTruss(bar.x0, bar.x1, bar.y, bar.z);
        addMotor(bar.x0, bar.y, bar.z);
        addMotor(bar.x1, bar.y, bar.z);
      } else {
        addThinBar(bar.x0, bar.x1, bar.y, bar.z);
      }
      flown.push({ x0: bar.x0, x1: bar.x1, y: bar.y, z: bar.z });
    }

    /* Overhead trusses hang from house rigging, not from nothing — without it they
       read as frames floating in the air. Draw a light rigging grid up top and drop
       each truss from it; the single widest truss also stands on goalpost towers. */
    const mainTruss = bars.filter((b) => b.kind !== "curve" && b.y > 1 && isWide(b))
      .sort((a, b) => (b.x1 - b.x0) - (a.x1 - a.x0))[0];
    if (flown.length) {
      const rigTop = room.maxY + 1.0;
      const gx0 = room.minX - 0.4, gx1 = room.maxX + 0.4;
      const beamXGeo = new THREE.BoxGeometry(gx1 - gx0, 0.05, 0.05);
      const zs = [...new Set(flown.map((b) => Math.round(b.z * 100) / 100))];
      for (const z of zs) {
        const beam = new THREE.Mesh(beamXGeo, steelMat);
        beam.position.set((gx0 + gx1) / 2, rigTop, z);
        scene.add(beam);
      }
      if (zs.length > 1) {                       // tie the grid front-to-back
        const zmin = Math.min(...zs) - 0.2, zmax = Math.max(...zs) + 0.2;
        const beamZGeo = new THREE.BoxGeometry(0.05, 0.05, zmax - zmin);
        for (const gx of [gx0, gx1]) {
          const b = new THREE.Mesh(beamZGeo, steelMat);
          b.position.set(gx, rigTop, (zmin + zmax) / 2);
          scene.add(b);
        }
      }
      const addHang = (x: number, y: number, z: number) => {
        const h = rigTop - y;
        if (h < 0.2) return;
        const rod = new THREE.Mesh(new THREE.BoxGeometry(0.03, h, 0.03), steelMat);
        rod.position.set(x, y + h / 2, z);
        scene.add(rod);
      };
      for (const b of flown) { addHang(b.x0, b.y, b.z); addHang(b.x1, b.y, b.z); }
    }
    if (mainTruss) for (const t of towersOf([mainTruss])) addTower(t.x, t.z, t.yTop);

    /* ── one rig entry per fixture ── */
    const fmats = fixtureMaterials();
    const rigs: Rig[] = [];
    const maxThrow = Math.max(14, room.depth + room.maxY + 12);

    for (const f of fixtures) {
      const prof = profileOf(f.type);
      const world = worldOf(f.at);
      const body = bodyOf(f.type);

      /* a fixture below a metre is standing on the deck (a floor uplighter or a
         head on a base) rather than hung — it gets the deck-standing geometry */
      const onFloor = world[1] < 1;
      const fm = buildFixture(f.type, fmats, onFloor);
      fm.group.position.set(world[0], world[1], world[2]);
      if (!moves(f.type) && !onFloor) {
        /* a hung static body is turned to how it was hung — a par points down and
           a bit downstage, a blinder faces the crowd; the geometry's own emit axis
           (its lens vector) is rotated onto that aim. A floor uplighter is already
           built pointing up, so it is left as is. */
        const aim = staticAim(prof.kind, world[1]);
        const def = fm.lens.clone().normalize();
        if (def.lengthSq() > 1e-6) {
          fm.group.quaternion.setFromUnitVectors(def, new THREE.Vector3(aim[0], aim[1], aim[2]));
        }
      }
      scene.add(fm.group);

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
          /* more haze than before, so a long throw or a distant view loses
             strength instead of reading at full brightness across the room */
          uFogDensity: { value: 0.03 },
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
      lens.scale.setScalar(body.radius * 2.8);
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
        /* built facing +Z; updateRig turns it onto whatever surface it lands on */
        pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), poolMat);
        pool.position.set(world[0], 0.02, world[2]);
        pool.renderOrder = 4;
        pool.visible = false;
        scene.add(pool);
      }

      rigs.push({
        lamp: { id: f.id, type: f.type, kind: prof.kind, world },
        yoke: fm.yoke, head: fm.head, floorHead: onFloor && moves(f.type),
        beam, beamMat, lens, lensMat, pool, poolMat, cells, maxThrow, deck: deckBox,
        walls: wallsBounds,
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

    /* BLOOM, and NOT tone mapping. See the note at the top of this file: colour
       management is off on purpose, so the numbers reaching a pixel are the same
       ones the flat canvas writes. OutputPass would apply tone mapping and an
       sRGB conversion and undo exactly that, so the chain ends at the bloom. */
    const composer = new EffectComposer(gl);
    composer.addPass(new RenderPass(scene, cam));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      0.16,      // strength — a restrained glow, not a halo that smears the room together
      0.4,       // radius — tighter, so the bloom hugs the source instead of spreading
      0.85,      // threshold: only genuinely hot pixels bloom at all
    );
    composer.addPass(bloom);
    composerRef.current = composer;

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
      composerRef.current?.setSize(r.width, r.height);
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
      tearingDownRef.current = true;
      ro.disconnect();
      controls.removeEventListener("change", onControls);
      controls.dispose();
      controlsRef.current = null;
      const disposedMats = new Set<THREE.Material>();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        /* shared fixture geometry is cached across mounts — leave it alone */
        if (m.geometry && !m.geometry.userData?.shared) m.geometry.dispose();
        const mat = (m as unknown as { material?: THREE.Material | THREE.Material[] }).material;
        const one = (x: THREE.Material) => { if (!disposedMats.has(x)) { disposedMats.add(x); x.dispose(); } };
        if (Array.isArray(mat)) mat.forEach(one);
        else if (mat) one(mat);
      });
      disc.dispose();
      for (const t of screenTexs) t.dispose();
      screensRef.current = null;
      /* EffectComposer.dispose() frees its own two targets and nothing its
         passes own; UnrealBloomPass holds eleven more. */
      bloom.dispose();
      composer.dispose();
      composerRef.current = null;

      /* LISTENERS BEFORE forceContextLoss, because that call fires
         `webglcontextlost` — and a handler still attached would read our own
         teardown as a GPU fault and schedule a rebuild, which is precisely the
         loop the next line exists to stop. */
      gl.domElement.removeEventListener("webglcontextlost", onLost);
      gl.domElement.removeEventListener("webglcontextrestored", onRestored);
      gl.dispose();
      /* dispose() releases three's objects and leaves the browser's WebGL
         context alive until GC gets to it. Chrome caps contexts per page and
         evicts the OLDEST when a new one is asked for, which arrives as a real
         "Context Lost" on a canvas still on screen — three rebuilds was enough
         to trigger it here. This is the only way to hand one back deliberately. */
      gl.forceContextLoss();
      if (gl.domElement.parentNode === box) box.removeChild(gl.domElement);
      glRef.current = null;
      sceneRef.current = null;
      rigsRef.current = [];
    };
  }, [rigKey, generation]);

  /* ── one frame ─────────────────────────────────────────────────────────── */
  const paint = useCallback(() => {
    const gl = glRef.current;
    const scene = sceneRef.current;
    const cam = camRef.current;
    if (!gl || !scene || !cam) return;
    const draw = () => {
      const c = composerRef.current;
      /* gl.render, NOT draw() — a blanket rename once turned this fallback into
         a call to itself, which is an unbounded recursion the moment there is no
         composer, and a stack overflow inside a rAF paints the canvas black. */
      if (c) c.render(); else gl.render(scene, cam);
    };
    if (!show || !frames || !place) { draw(); return; }

    const t = clockRef.current?.position() ?? 0;
    /* what the listener is hearing NOW is t minus the output latency */
    const idx = frameFor(t, show.fps, show.frame_count, syncOffset);
    const raw = readFixtures(idx, frames, show, place);
    if (!raw) {
      /* The flat view draws bare ground here. This one used to leave the last
         frame's lamps burning, so the two disagreed in opposite directions on
         the same edge case. */
      const dark = roomUniformsRef.current;
      if (dark) dark.uAmbient.value = 0;
      const sdark = screensRef.current;
      if (sdark) for (const m of sdark) m.color.setRGB(0.02, 0.02, 0.03);
      if (floodRef.current) floodRef.current.style.opacity = "0";
      for (const rig of rigsRef.current) blankRig(rig);
      draw();
      return;
    }
    const fx = trimFixtures(raw, trims);

    const byId = new Map<string, LampState>();
    for (const l of fx.lamps) byId.set(l.id, l);

    /* The same numbers the flat view uses, from the same function. They carry no
       memory: an identical frame renders at an identical brightness whatever came
       before it, which is exactly what the old smoothed version could not do. */
    const fl = frameLight(fx.lamps);
    const d = fl.density;

    /* What the room itself catches. Two writes for every surface in it. */
    const roomU = roomUniformsRef.current;
    if (roomU) {
      roomU.uAmbient.value = roomAmbient(fl);
      roomU.uTint.value.setRGB(fl.tint[0], fl.tint[1], fl.tint[2]);
    }

    /* the LED screens run the show's colour and energy: a faint idle glow plus
       the frame's output, tinted by the rig's colour. Bloom carries that glow
       out across the stage, which is what makes a video wall feel like light. */
    const screenMatsNow = screensRef.current;
    if (screenMatsNow) {
      /* The wall is a big emissive surface, so even at half brightness it is the
         single largest light in frame and washes the room — most of all when the
         show colour is white. Held to a low ceiling it reads as a moody glowing
         backdrop that colours the stage instead of a white lightbox. The dark
         pixel gutters in the texture drop the effective level further still. */
      const b = 0.03 + Math.min(0.4, fl.output * 0.6);
      for (const m of screenMatsNow) m.color.setRGB(
        Math.min(0.5, fl.tint[0] * b + 0.012),
        Math.min(0.5, fl.tint[1] * b + 0.012),
        Math.min(0.52, fl.tint[2] * b + 0.016),
      );
    }

    /* A BLINDER TAKES THE ROOM OVER. The beam shader deliberately knocks a cone
       aimed at the camera down to 22%, which is right for a beam and wrong for
       the one fixture whose entire job is being in your eyes. Same threshold and
       slope the flat view uses, so a hit lands with the same weight in both. */
    const flood = floodRef.current;
    if (flood) {
      let hottest = 0;
      let hot: LampState | null = null;
      for (const l of fx.lamps) {
        if (l.kind !== "blinder") continue;
        const k = l.k * (l.strobe > 0.001 ? ((t * (1 + l.strobe * 22)) % 1 < 0.32 ? 1 : 0.06) : 1);
        if (k > hottest) { hottest = k; hot = l; }
      }
      if (hot && hottest > 0.5) {
        const c = hot.rgb;
        flood.style.backgroundColor =
          `rgb(${(c[0] * 255) | 0} ${(c[1] * 255) | 0} ${(c[2] * 255) | 0})`;
        flood.style.opacity = String((hottest - 0.5) * 0.12);
      } else {
        flood.style.opacity = "0";
      }
    }

    for (const rig of rigsRef.current) updateRig(rig, byId, t, d);

    draw();
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

  return (
    <div ref={boxRef} className="absolute inset-0">
      {/* `screen` rather than `plus-lighter`: the flat view draws its flood under
          `lighter`, and screen is the blend every browser here agrees on. */}
      <div
        ref={floodRef}
        aria-hidden
        className="absolute inset-0 pointer-events-none opacity-0"
        style={{ mixBlendMode: "screen" }}
      />
    </div>
  );
}

/** Whether this browser can run the 3D view at all. */
/* Probed once per page, and the answer kept.

   This is read as a useSyncExternalStore SNAPSHOT, which React calls on every
   single render — and the probe below opens a real WebGL context. StagePreview
   re-renders once per animation frame while a song plays, because it carries the
   playhead, so this was opening a context per frame and never closing one.

   A browser keeps a small number of live contexts — Chrome around sixteen — and
   when asked for one too many it EVICTS THE OLDEST, which is the stage's own
   renderer. That arrives as `webglcontextlost` on a canvas in the middle of the
   screen, and an evicted context is never restored. It is why the room went dark
   partway through a song and stayed dark while every other part of the page went
   on working: nothing was wrong with the show, the renderer had simply had its
   context taken away and handed to a probe that only ever answered yes.

   Caching it also satisfies what useSyncExternalStore asks for in the first
   place: a snapshot is a cached value, not work. */
let webglOK: boolean | null = null;

export function webglAvailable(): boolean {
  if (typeof document === "undefined") return false;
  if (webglOK !== null) return webglOK;
  try {
    const cv = document.createElement("canvas");
    const probe = (cv.getContext("webgl2") ?? cv.getContext("webgl")) as
      WebGLRenderingContext | null;
    webglOK = !!probe;
    /* hand the probe's own context straight back rather than waiting for GC */
    probe?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webglOK = false;
  }
  return webglOK;
}
