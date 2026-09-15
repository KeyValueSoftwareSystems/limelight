"use strict";
/* The SPOT driver for the Robe Robin MMX Spot, 8-bit mode: 29 channels. A
   SUBTRACTIVE CMY mover -- gobos, prism, frost, iris, and an 8-55 degree zoom
   that is what makes this the beam fixture on a rig.

   Its channel truth is the profile beside it; the shared runtime (driver.js) does
   the rest. Device-specific behaviour, if any is ever needed, goes here as an
   override -- there is none yet. */
const { Driver } = require("./driver.js");
const profile = require("./profiles/spot29.profile.json");
module.exports = Driver(profile);
