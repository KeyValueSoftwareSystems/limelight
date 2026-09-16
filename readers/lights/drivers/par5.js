"use strict";
/* The PAR driver for the GDTF LED PAR 64 RGBW: 5 channels. Brightness rides the
   colour channels with the master held full, as on par7; the fourth emitter
   carries the achromatic part of the colour.

   Its channel truth is the profile beside it; the shared runtime (driver.js) does
   the rest. Device-specific behaviour, if any is ever needed, goes here as an
   override -- there is none yet. */
const { Driver } = require("./driver.js");
const profile = require("./profiles/par5.profile.json");
module.exports = Driver(profile);
