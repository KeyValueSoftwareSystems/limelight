/* Mouse input: two buttons, two sabers.
     left button  -> blue saber  (hand: left)
     right button -> red saber   (hand: right)
   The right mouse button normally opens the browser context menu, which would
   swallow the red-saber swing. We preventDefault the contextmenu on the mount
   for the life of the source, and restore it on stop(). */
"use strict";
(function () {
  function MouseSource(mount) {
    let bx = 0.5, by = 0.5;          // current pointer, normalized
    let px = 0.5, py = 0.5;          // previous, for velocity
    let leftDown = false, rightDown = false;

    const onMove = (e) => {
      const r = mount.getBoundingClientRect();
      bx = (e.clientX - r.left) / r.width;
      by = (e.clientY - r.top) / r.height;
    };
    const onDown = (e) => {
      if (e.button === 0) leftDown = true;
      if (e.button === 2) { rightDown = true; e.preventDefault(); }
    };
    const onUp = (e) => {
      if (e.button === 0) leftDown = false;
      if (e.button === 2) rightDown = false;
    };
    const onContext = (e) => e.preventDefault();   // <-- the fix

    function start() {
      mount.addEventListener("pointermove", onMove);
      mount.addEventListener("pointerdown", onDown);
      window.addEventListener("pointerup", onUp);
      mount.addEventListener("contextmenu", onContext);
      return Promise.resolve();
    }
    function stop() {
      mount.removeEventListener("pointermove", onMove);
      mount.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      mount.removeEventListener("contextmenu", onContext);
    }
    function read() {
      const vx = bx - px, vy = by - py;
      px = bx; py = by;
      const vel = { x: vx, y: vy };
      const sabers = [];
      // both sabers track the cursor; a button makes one "active" (swinging)
      sabers.push({ hand: "left", color: "blue", tip: { x: bx, y: by },
                    vel: leftDown ? vel : { x: 0, y: 0 }, active: leftDown });
      sabers.push({ hand: "right", color: "red", tip: { x: bx, y: by },
                    vel: rightDown ? vel : { x: 0, y: 0 }, active: rightDown });
      return sabers;
    }
    return { start, stop, read };
  }

  if (window.SaberSources) window.SaberSources.register("mouse", MouseSource);
})();
