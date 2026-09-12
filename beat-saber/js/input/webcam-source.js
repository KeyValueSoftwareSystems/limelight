/* Webcam hand-tracking saber input via MediaPipe HandLandmarker.
   Same {start, stop, read} contract as the mouse source.

   Calibration is the whole game here: a fingertip's position in the CAMERA
   frame is not a screen position. A hand only sweeps a comfortable patch of the
   view, so we learn that patch (its min/max box) and map it onto the full
   playfield. Without this the saber can't reach the outer lanes and its centre
   is wherever your hand happened to rest. The box is captured by calibrate()
   and kept in localStorage, so it survives across sessions and songs. */
"use strict";
(function () {
  const VISION_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
  const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
  const CAL_KEY = "bs-webcam-cal";
  // A centred default box (~40% of the frame) so it is usable before calibrating.
  const DEFAULT_CAL = { minX: 0.30, maxX: 0.70, minY: 0.25, maxY: 0.75, flipX: true, flipY: false };

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  // Pure: a raw fingertip {x,y} (0..1 in the camera frame) -> playfield {x,y}.
  // Also returns the mirrored raw (rx,ry) so calibration can learn the box.
  function mapPoint(lm, cal) {
    const rx = cal.flipX ? 1 - lm.x : lm.x;
    const ry = cal.flipY ? 1 - lm.y : lm.y;
    const dx = cal.maxX - cal.minX, dy = cal.maxY - cal.minY;
    const sx = dx > 1e-3 ? (rx - cal.minX) / dx : rx;
    const sy = dy > 1e-3 ? (ry - cal.minY) / dy : ry;
    return { x: clamp01(sx), y: clamp01(sy), rx: rx, ry: ry };
  }

  function loadCal() {
    try {
      const s = localStorage.getItem(CAL_KEY);
      if (s) return Object.assign({}, DEFAULT_CAL, JSON.parse(s));
    } catch (e) {}
    return Object.assign({}, DEFAULT_CAL);
  }
  function saveCal(cal) { try { localStorage.setItem(CAL_KEY, JSON.stringify(cal)); } catch (e) {} }

  function WebcamSource(mount) {
    let video, landmarker, stream, prev = {}, latest = [], rafId = 0;
    let cal = loadCal();
    let calibrating = false, box = null;

    async function start() {
      const vision = await import(VISION_URL + "/vision_bundle.mjs");
      const fileset = await vision.FilesetResolver.forVisionTasks(VISION_URL + "/wasm");
      landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL },
        numHands: 2, runningMode: "VIDEO",
      });
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      video = document.createElement("video");
      video.autoplay = true; video.playsInline = true; video.srcObject = stream;
      await video.play();
      const track = () => {
        rafId = requestAnimationFrame(track);
        if (!landmarker || video.readyState < 2) return;
        onFrame(landmarker.detectForVideo(video, performance.now()));
      };
      track();
    }

    function onFrame(res) {
      const sabers = [];
      const hands = (res && res.handedness) || [];
      for (let i = 0; i < hands.length; i++) {
        const label = hands[i][0].categoryName;                 // 'Left' | 'Right'
        const lm = res.landmarks[i][8];                         // index fingertip
        const hand = label === "Left" ? "right" : "left";       // mirror: your right reads Left
        const color = hand === "left" ? "blue" : "red";
        const m = mapPoint(lm, cal);
        if (calibrating && box) {
          box.minX = Math.min(box.minX, m.rx); box.maxX = Math.max(box.maxX, m.rx);
          box.minY = Math.min(box.minY, m.ry); box.maxY = Math.max(box.maxY, m.ry);
        }
        const tip = { x: m.x, y: m.y };
        const p = prev[hand] || tip;
        const vel = { x: tip.x - p.x, y: tip.y - p.y };
        prev[hand] = tip;
        sabers.push({ hand: hand, color: color, tip: tip, vel: vel, active: true });
      }
      latest = sabers;
    }

    // Sweep-to-learn: for `ms` collect the fingertip's reach, then store the box.
    function calibrate(ms) {
      box = { minX: 1, maxX: 0, minY: 1, maxY: 0 };
      calibrating = true;
      return new Promise((resolve) => {
        setTimeout(() => {
          calibrating = false;
          const dx = box.maxX - box.minX, dy = box.maxY - box.minY;
          if (dx > 0.05 && dy > 0.05) {
            // Pad the box inward a little so the extremes are comfortably reachable
            // (they then map just past 0/1 and clamp), without inverting a small sweep.
            const px = Math.min(0.04, dx / 4), py = Math.min(0.04, dy / 4);
            cal = { minX: box.minX + px, maxX: box.maxX - px,
                    minY: box.minY + py, maxY: box.maxY - py,
                    flipX: cal.flipX, flipY: cal.flipY };
            saveCal(cal);
          }
          resolve({ cal: cal, ok: dx > 0.05 && dy > 0.05 });
        }, ms);
      });
    }

    function setFlip(flipX, flipY) {
      if (flipX !== undefined) cal.flipX = !!flipX;
      if (flipY !== undefined) cal.flipY = !!flipY;
      saveCal(cal);
    }

    function stop() {
      if (rafId) cancelAnimationFrame(rafId);
      if (landmarker && landmarker.close) landmarker.close();
      if (stream) stream.getTracks().forEach((t) => t.stop());
      landmarker = stream = video = null; latest = []; prev = {}; calibrating = false;
    }
    function read() { return latest; }
    return { start: start, stop: stop, read: read, calibrate: calibrate,
             setFlip: setFlip, getCalibration: function () { return cal; } };
  }

  const API = { WebcamSource: WebcamSource, mapPoint: mapPoint, DEFAULT_CAL: DEFAULT_CAL,
                loadCal: loadCal, saveCal: saveCal, CAL_KEY: CAL_KEY };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined" && window.SaberSources) window.SaberSources.register("webcam", WebcamSource);
})();
