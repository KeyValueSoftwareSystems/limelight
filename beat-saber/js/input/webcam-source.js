/* Webcam hand-tracking saber input via MediaPipe HandLandmarker.
     left hand  -> blue saber
     right hand -> red saber
   Same contract as the mouse source; the gameplay does not change. Fallback
   is handled by the caller (ui.js): if start() rejects, it uses 'mouse'. */
"use strict";
(function () {
  const VISION_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
  const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

  function WebcamSource(mount) {
    let video, landmarker, stream, prev = {}, latest = [];
    let rafId = 0;

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
        const res = landmarker.detectForVideo(video, performance.now());
        latest = interpret(res);
      };
      track();
    }

    function interpret(res) {
      const sabers = [];
      const hands = (res && res.handedness) || [];
      for (let i = 0; i < hands.length; i++) {
        const label = hands[i][0].categoryName;                 // 'Left' | 'Right'
        const lm = res.landmarks[i][8];                         // index fingertip
        // camera is mirrored: user's right hand appears on the left of frame
        const hand = label === "Left" ? "right" : "left";
        const color = hand === "left" ? "blue" : "red";
        const tip = { x: 1 - lm.x, y: lm.y };                   // un-mirror x
        const p = prev[hand] || tip;
        const vel = { x: tip.x - p.x, y: tip.y - p.y };
        prev[hand] = tip;
        const active = Math.hypot(vel.x, vel.y) > 0.01;
        sabers.push({ hand, color, tip, vel, active });
      }
      return sabers;
    }

    function stop() {
      if (rafId) cancelAnimationFrame(rafId);
      if (landmarker && landmarker.close) landmarker.close();
      if (stream) stream.getTracks().forEach((t) => t.stop());
      landmarker = stream = video = null; latest = []; prev = {};
    }
    function read() { return latest; }
    return { start, stop, read };
  }

  if (window.SaberSources) window.SaberSources.register("webcam", WebcamSource);
})();
