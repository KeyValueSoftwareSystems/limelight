/* Three.js view for the playfield. Knows nothing about audio, scoring, or the
   protocol — it is handed notes and a progress function and draws them. */
"use strict";
(function () {
  const FAR_Z = -60;        // where blocks spawn
  const STRIKE_Z = 0;       // the hit line, nearest the camera
  const LANE_X = [-3, -1, 1, 3];
  const BLOCK_Y = 0;

  const COLORS = { red: 0xff2d55, blue: 0x2ec5ff };
  let renderer, scene, camera, mount;
  let blocks = new Map();   // key -> { mesh, note }
  let saberMeshes = [];

  function init(mountEl) {
    mount = mountEl;
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

    // neon lane floor
    const grid = new THREE.GridHelper(120, 60, 0x2ec5ff, 0x1b2740);
    grid.position.z = FAR_Z / 2; grid.position.y = -2;
    scene.add(grid);

    // strike line
    const lineGeo = new THREE.PlaneGeometry(9, 0.12);
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
    const line = new THREE.Mesh(lineGeo, lineMat);
    line.position.set(0, BLOCK_Y - 1.2, STRIKE_Z); line.rotation.x = -Math.PI / 2.2;
    scene.add(line);
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
    scene.add(mesh);
    blocks.set(note.key, { mesh: mesh, note: note });
  }

  function update(progressOf) {
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
    while (saberMeshes.length < sabers.length) {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 3, 8),
        new THREE.MeshBasicMaterial({ color: 0xffffff }));
      m.rotation.x = Math.PI / 2; scene.add(m); saberMeshes.push(m);
    }
    saberMeshes.forEach((m, i) => {
      const s = sabers[i];
      m.visible = !!s;
      if (!s) return;
      m.material.color.setHex(COLORS[s.color] || 0xffffff);
      m.position.set((s.tip.x - 0.5) * 9, (0.5 - s.tip.y) * 5, STRIKE_Z + 1.2);
      m.material.opacity = s.active ? 1 : 0.4; m.material.transparent = true;
    });
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
    renderer = scene = camera = null; saberMeshes = [];
  }

  window.Scene3D = { init, resize, spawnBlock, update, sliceBlock, missBlock,
                     setSabers, clear, dispose, LANE_X: LANE_X };
})();
