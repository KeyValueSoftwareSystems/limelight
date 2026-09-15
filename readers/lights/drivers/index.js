"use strict";
/* The driver registry: a layout fixture declares a device `type`, and this maps it
   to that device's driver. Add a new device = add its module here (and its profile).
   Separate drivers per device type, one shared runtime (driver.js).

   par7 and head13 were generated from rig.py -- the hardware this project was
   first built against. The seven below were read out of the GDTF files under
   mvr/gdtf/, one profile per real fixture, except laser8, which is invented and
   says so in its own note. */
const REGISTRY = {
  par7: require("./par7.js"),
  head13: require("./head13.js"),

  par5: require("./par5.js"),               /* LED PAR 64 RGBW            */
  wash12: require("./wash12.js"),           /* Martin MAC Aura            */
  spot29: require("./spot29.js"),           /* Robe Robin MMX Spot        */
  strobe3: require("./strobe3.js"),         /* Martin Atomic 3000         */
  blinder1: require("./blinder1.js"),       /* Chauvet STRIKE Array 4     */
  pixelbar24: require("./pixelbar24.js"),   /* Showtec Cameleon PixelBar  */
  laser8: require("./laser8.js"),           /* invented -- see its note   */
};

function forType(type) {
  const d = REGISTRY[type];
  if (!d) throw new Error("no driver for device type: " + type +
    " (known: " + Object.keys(REGISTRY).join(", ") + ")");
  return d;
}

/* capability questions the pipeline asks by TYPE, so nothing outside this
   directory has to name a fixture type to know what it can do */
const can = (type, c) => forType(type).can.includes(c);
const moves = type => can(type, "move");
const footprintOf = type => forType(type).footprint;

module.exports = { forType, REGISTRY, types: () => Object.keys(REGISTRY),
                   can, moves, footprintOf };
