/* The pluggable input contract. A SaberSource yields 0..2 sabers per frame,
   each a tip position and a swing velocity, so the gameplay never changes when
   the input source does (mouse now, webcam later). */
"use strict";
(function () {
  const factories = {};
  function register(name, factory) { factories[name] = factory; }
  function has(name) { return !!factories[name]; }
  function create(name, mountEl) {
    const f = factories[name] || factories["mouse"];
    return f(mountEl);
  }
  window.SaberSources = { register, has, create };
})();
