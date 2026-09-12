/* Three.js view for the playfield. Knows nothing about audio, scoring, or the
   protocol — it is handed notes and a progress function and draws them. */
"use strict";
(function () {
  const FAR_Z = -60;        // where blocks spawn
  const STRIKE_Z = 0;       // the hit line, nearest the camera
  const LANE_X = [-3, -1, 1, 3];
  const BLOCK_Y = 0;

  const COLORS = { red: 0xff2d55, blue: 0x2ec5ff };
  const BASE_FOV = 70, BASE_CAM_Z = 9;
  let renderer, scene, camera, mount, raycaster;
  let blocks = new Map();   // key -> { mesh, note }
  let saberMeshes = [];

  // music-reactive background state
  let stars = null, gridHelper = null, tunnelRings = [];
  let music = { energy: 0.4, phase: 0 };
  let pulseVal = 0, punchVal = 0, lastStep = 0;

  // tunnel geometry constants — nested SQUARE frames, each turned a little more
  // than the last so the edges spiral into a diamond/square corridor.
  const TUN_COUNT = 22, TUN_DZ = 3.6, TUN_NEAR = BASE_CAM_Z + 4;
  const TUN_SPAN = TUN_COUNT * TUN_DZ, TUN_RX = 9, TUN_RY = 6.5, TUN_ROT_STEP = 0.40;
  const TUN_BASE = new THREE.Color(0x2ec5ff), TUN_FLASH = new THREE.Color(0xffffff), TUN_DOWN = new THREE.Color(0xff2d55);
  let tunnelSpin = 0;

  function init(mountEl) {
    mount = mountEl;
    raycaster = new THREE.Raycaster();
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x05060c, 30, 65);

    const w = mount.clientWidth || 800, h = mount.clientHeight || 600;
    camera = new THREE.PerspectiveCamera(70, w / h, 0.1, 200);
    camera.position.set(0, 2.4, 9);
    camera.lookAt(0, 0, FAR_Z / 2);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.domElement.className = "scene3d-canvas";
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0x8899ff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 0.8);
    key.position.set(0, 8, 10); scene.add(key);

    // neon lane floor — brightness pulses on the beat
    gridHelper = new THREE.GridHelper(120, 60, 0x2ec5ff, 0x1b2740);
    gridHelper.position.z = FAR_Z / 2; gridHelper.position.y = -2;
    gridHelper.material.transparent = true;
    scene.add(gridHelper);

    // strike line
    const lineGeo = new THREE.PlaneGeometry(9, 0.12);
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
    const line = new THREE.Mesh(lineGeo, lineMat);
    line.position.set(0, BLOCK_Y - 1.2, STRIKE_Z); line.rotation.x = -Math.PI / 2.2;
    scene.add(line);

    makeStars();
    makeTunnel();
    music = { energy: 0.4, phase: 0 }; pulseVal = 0; punchVal = 0; tunnelSpin = 0;
    lastStep = performance.now();
  }

  // A tunnel of square frames receding down the lane. Frames scroll toward the
  // camera (fly-through) and each is turned a little more than the one behind it,
  // so their edges spiral into diamonds/squares. Beats brighten + expand them;
  // downbeats flash them red.
  function makeTunnel() {
    const corners = [
      new THREE.Vector3(1, 1, 0), new THREE.Vector3(-1, 1, 0),
      new THREE.Vector3(-1, -1, 0), new THREE.Vector3(1, -1, 0),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(corners);  // closed by LineLoop
    for (let i = 0; i < TUN_COUNT; i++) {
      const mat = new THREE.LineBasicMaterial({ color: 0x2ec5ff, transparent: true, opacity: 0.28 });
      const ring = new THREE.LineLoop(geo, mat);
      ring.position.set(0, 0, TUN_NEAR - (i + 1) * TUN_DZ);
      ring.scale.set(TUN_RX, TUN_RY, 1);
      ring.userData.baseRot = i * TUN_ROT_STEP;      // the spiral: each frame turned more
      ring.rotation.z = ring.userData.baseRot;
      scene.add(ring);
      tunnelRings.push(ring);
    }
  }

  // A starfield streaming toward the camera down the lane — the depth illusion.
  function makeStars() {
    const N = 500;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 26;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 15;
      pos[i * 3 + 2] = FAR_Z + Math.random() * (BASE_CAM_Z - FAR_Z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    stars = new THREE.Points(g, new THREE.PointsMaterial({
      color: 0x9fd8ff, size: 0.18, transparent: true, opacity: 0.7, depthWrite: false }));
    scene.add(stars);
  }

  // ---- music input --------------------------------------------------------
  function setMusic(m) {
    if (!m) return;
    if (typeof m.energy === "number") music.energy = Math.max(0, Math.min(1, m.energy));
    if (typeof m.phase === "number") music.phase = m.phase;
  }
  // Called once per beat; a downbeat kicks the camera as well as the grid.
  function pulse(isDownbeat) {
    pulseVal = isDownbeat ? 1 : 0.6;
    if (isDownbeat) punchVal = 1;
  }

  // Advance the reactive background one frame (called once per frame from update).
  function stepBackground() {
    const t = performance.now();
    let dt = (t - lastStep) / 1000; lastStep = t;
    if (dt > 0.1) dt = 0.1;                 // absorb a stall rather than teleport

    if (stars) {
      const arr = stars.geometry.attributes.position.array;
      const speed = (7 + music.energy * 45) * dt;   // faster when the music is bigger
      const nearZ = BASE_CAM_Z + 2;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i + 2] += speed;
        if (arr[i + 2] > nearZ) {           // recycle to the far end
          arr[i + 2] = FAR_Z;
          arr[i] = (Math.random() - 0.5) * 26;
          arr[i + 1] = (Math.random() - 0.5) * 15;
        }
      }
      stars.geometry.attributes.position.needsUpdate = true;
      stars.material.opacity = 0.45 + music.energy * 0.5;
    }

    pulseVal = Math.max(0, pulseVal - dt * 3.2);
    if (gridHelper) gridHelper.material.opacity = 0.28 + pulseVal * 0.6;

    if (tunnelRings.length) {
      const speed = (7 + music.energy * 45) * dt;         // fly with the starfield
      tunnelSpin += dt * (0.12 + music.energy * 0.35);    // whole spiral turns, faster when loud
      const bump = 1 + pulseVal * 0.14;                   // frames swell on the beat
      const op = Math.min(1, 0.24 + pulseVal * 0.55 + music.energy * 0.14);
      const col = TUN_BASE.clone().lerp(TUN_FLASH, pulseVal * 0.7);
      if (punchVal > 0) col.lerp(TUN_DOWN, punchVal * 0.5);  // downbeat flash
      for (const ring of tunnelRings) {
        ring.position.z += speed;
        if (ring.position.z > TUN_NEAR) ring.position.z -= TUN_SPAN;   // wrap to the far end
        ring.rotation.z = ring.userData.baseRot + tunnelSpin;
        ring.scale.set(TUN_RX * bump, TUN_RY * bump, 1);
        ring.material.opacity = op;
        ring.material.color.copy(col);
      }
    }

    punchVal = Math.max(0, punchVal - dt * 4.0);
    if (camera) {
      camera.fov = BASE_FOV + punchVal * 7;
      camera.position.z = BASE_CAM_Z - punchVal * 0.5;
      camera.updateProjectionMatrix();
    }
  }

  // an arrow texture drawn once per direction, cached
  const arrowCache = {};
  function arrowTexture(direction) {
    if (arrowCache[direction]) return arrowCache[direction];
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d");
    g.fillStyle = "rgba(255,255,255,0.95)";
    g.translate(32, 32);
    const ang = { "up": Math.PI, "down": 0, "left": Math.PI / 2, "right": -Math.PI / 2,
      "up-left": Math.PI * 0.75, "up-right": -Math.PI * 0.75,
      "down-left": Math.PI * 0.25, "down-right": -Math.PI * 0.25 }[direction] || 0;
    g.rotate(ang);
    g.beginPath(); g.moveTo(0, 16); g.lineTo(-13, -6); g.lineTo(13, -6); g.closePath(); g.fill();
    const tex = new THREE.CanvasTexture(c); arrowCache[direction] = tex; return tex;
  }

  function spawnBlock(note) {
    if (blocks.has(note.key)) return;
    const geo = new THREE.BoxGeometry(1.4, 1.4, 1.4);
    const mat = new THREE.MeshStandardMaterial({
      color: COLORS[note.color], emissive: COLORS[note.color],
      emissiveIntensity: 0.35, metalness: 0.3, roughness: 0.4 });
    const mesh = new THREE.Mesh(geo, mat);
    // arrow on the face toward the camera (+z)
    const arrowMat = new THREE.MeshBasicMaterial({ map: arrowTexture(note.direction), transparent: true });
    const arrow = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.0), arrowMat);
    arrow.position.z = 0.72; mesh.add(arrow);
    mesh.position.set(LANE_X[note.lane], BLOCK_Y, FAR_Z);
    mesh.userData.key = note.key;               // so a raycast hit maps back to the note
    scene.add(mesh);
    blocks.set(note.key, { mesh: mesh, note: note });
  }

  // ---- pointer picking: the mouse is a sharp point cast into the scene -------
  // Normalized playfield coords (0..1) -> the world point where the cursor ray
  // crosses the block plane (z = STRIKE_Z). This is where the saber tip is drawn
  // and, via a ray, which block the pointer is actually over.
  function ndcFrom(nx, ny) { return new THREE.Vector2(nx * 2 - 1, -(ny * 2 - 1)); }

  function planePoint(nx, ny) {
    if (!camera) return null;
    raycaster.setFromCamera(ndcFrom(nx, ny), camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -STRIKE_Z);
    const pt = new THREE.Vector3();
    return raycaster.ray.intersectPlane(plane, pt) ? pt : null;
  }

  // Which block keys the pointer is currently over, nearest first.
  function pickBlocks(nx, ny) {
    if (!camera) return [];
    raycaster.setFromCamera(ndcFrom(nx, ny), camera);
    const meshes = [];
    blocks.forEach((b) => meshes.push(b.mesh));
    const hits = raycaster.intersectObjects(meshes, true);
    const keys = [];
    for (const h of hits) {
      let o = h.object;
      while (o && o.userData.key == null && o.parent) o = o.parent;  // arrow child -> block
      if (o && o.userData.key != null && keys.indexOf(o.userData.key) === -1) keys.push(o.userData.key);
    }
    return keys;
  }

  function update(progressOf) {
    stepBackground();                        // advance the reactive background once/frame
    blocks.forEach((b, key) => {
      const p = progressOf(key);
      if (p == null) return;
      b.mesh.position.z = FAR_Z + (STRIKE_Z - FAR_Z) * Math.min(p, 1.25);
      b.mesh.rotation.z += 0.01;
    });
    render();
  }

  function removeWith(key, scaleTo, fade) {
    const b = blocks.get(key); if (!b) return;
    blocks.delete(key);
    const owner = scene;              // the scene this mesh belongs to
    const start = performance.now();
    (function anim() {
      if (!scene || scene !== owner) { // scene was disposed/replaced mid-animation
        try { owner.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); } catch (e) {}
        return;
      }
      const t = Math.min(1, (performance.now() - start) / 180);
      b.mesh.scale.setScalar(1 + (scaleTo - 1) * t);
      b.mesh.material.opacity = 1 - t; b.mesh.material.transparent = true;
      render();
      if (t < 1) requestAnimationFrame(anim);
      else { scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); }
    })();
  }
  function sliceBlock(key) { removeWith(key, 1.8, true); }
  function missBlock(key) { removeWith(key, 0.6, true); }

  function setSabers(sabers) {
    while (saberMeshes.length < sabers.length) saberMeshes.push(makeSaber());
    const UP = new THREE.Vector3(0, 1, 0);
    saberMeshes.forEach((g, i) => {
      const s = sabers[i];
      g.visible = !!s;
      if (!s) return;
      const blade = g.userData.blade, glow = g.userData.glow, hilt = g.userData.hilt;
      const col = COLORS[s.color] || 0xffffff;
      blade.material.color.setHex(col); glow.material.color.setHex(col);

      // Hilt sits at a "hand" near a bottom corner (left hand left, right right),
      // slightly toward the camera. The blade aims UP to the cursor on the block
      // plane, so it naturally tilts to its side, rises, and its tip meets blocks.
      const side = s.hand === "left" ? -1 : s.hand === "right" ? 1 : 0;
      const hand = new THREE.Vector3(side * 2.6, -2.6, STRIKE_Z + 3.0);
      // Tip is exactly under the mouse pointer (same ray used for picking), so the
      // sharp point the player aims with is the point that meets the block.
      const tipPt = planePoint(s.tip.x, s.tip.y) ||
                    new THREE.Vector3((s.tip.x - 0.5) * 9, (0.5 - s.tip.y) * 5, STRIKE_Z);

      const dir = new THREE.Vector3().subVectors(tipPt, hand);
      const len = Math.max(dir.length(), 0.001);
      const mid = new THREE.Vector3().addVectors(hand, tipPt).multiplyScalar(0.5);
      const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());

      blade.position.copy(mid); blade.quaternion.copy(q); blade.scale.set(1, len, 1);
      glow.position.copy(mid);  glow.quaternion.copy(q);  glow.scale.set(1, len, 1);
      hilt.position.copy(hand); hilt.quaternion.copy(q);

      const on = s.active ? 1 : 0.6;
      blade.material.opacity = on; glow.material.opacity = on * 0.3;
    });
    render();   // paint the sabers this frame (update() rendered before this)
  }

  // A saber: a bright unit-height blade (scaled to length per frame) with a soft
  // glow sheath and a dark hilt. Built along +Y so a quaternion can aim it from
  // the hand up to the cursor.
  function makeSaber() {
    const g = new THREE.Group();
    const blade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.07, 1, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
    g.add(blade);
    const glow = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.16, 1, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false }));
    g.add(glow);
    const hilt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.17, 0.17, 0.85, 10),
      new THREE.MeshStandardMaterial({ color: 0x2a3140, metalness: 0.8, roughness: 0.3 }));
    g.add(hilt);
    g.userData.blade = blade; g.userData.glow = glow; g.userData.hilt = hilt;
    scene.add(g);
    return g;
  }

  function render() { if (renderer) renderer.render(scene, camera); }
  function resize() {
    if (!renderer || !mount) return;
    const w = mount.clientWidth, h = mount.clientHeight;
    camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h); render();
  }
  function clear() { blocks.forEach((b) => { scene.remove(b.mesh); }); blocks.clear(); }
  function dispose() {
    clear();
    if (renderer) { renderer.dispose(); if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement); }
    renderer = scene = camera = null; saberMeshes = []; stars = null; gridHelper = null; tunnelRings = [];
  }

  window.Scene3D = { init, resize, spawnBlock, update, sliceBlock, missBlock,
                     setSabers, setMusic, pulse, pickBlocks, planePoint,
                     clear, dispose, LANE_X: LANE_X };
})();
