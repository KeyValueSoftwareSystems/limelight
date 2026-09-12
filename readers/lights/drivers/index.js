"use strict";
/* The driver registry: a layout fixture declares a device `type`, and this maps it
   to that device's driver. Add a new device = add its module here (and its profile).
   Separate drivers per device type, one shared runtime (driver.js). */
const REGISTRY = {
  par7: require("./par7.js"),
  head13: require("./head13.js"),
};

function forType(type) {
  const d = REGISTRY[type];
  if (!d) throw new Error("no driver for device type: " + type +
    " (known: " + Object.keys(REGISTRY).join(", ") + ")");
  return d;
}

module.exports = { forType, REGISTRY, types: () => Object.keys(REGISTRY) };
