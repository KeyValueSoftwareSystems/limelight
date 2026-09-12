/* Mouse input: one saber that follows the cursor.
   The blade is always on (like a real saber); the sharp tip is the mouse
   pointer, and touching a block near the strike line cuts it — colour and
   button don't matter, there is a single blade. The context menu is suppressed
   so a right-click never interrupts play. */
"use strict";
(function () {
  function MouseSource(mount) {
    let bx = 0.5, by = 0.5;          // current pointer, normalized 0..1
    let px = 0.5, py = 0.5;          // previous, for swing velocity

    const onMove = (e) => {
      const r = mount.getBoundingClientRect();
      bx = (e.clientX - r.left) / r.width;
      by = (e.clientY - r.top) / r.height;
    };
    const onContext = (e) => e.preventDefault();

    function start() {
      mount.addEventListener("pointermove", onMove);
      mount.addEventListener("contextmenu", onContext);
      return Promise.resolve();
    }
    function stop() {
      mount.removeEventListener("pointermove", onMove);
      mount.removeEventListener("contextmenu", onContext);
    }
    function read() {
      const vx = bx - px, vy = by - py;
      px = bx; py = by;
      return [{ hand: "center", color: "white", tip: { x: bx, y: by },
                vel: { x: vx, y: vy }, active: true }];
    }
    return { start, stop, read };
  }

  if (window.SaberSources) window.SaberSources.register("mouse", MouseSource);
})();
