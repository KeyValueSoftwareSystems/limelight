"use strict";
/* The PIXEL BAR driver for the Showtec Cameleon PixelBar 18-4: six RGBW cells
   in a row, driven as one lamp by the shared runtime.

   Its channel truth is the profile beside it; the shared runtime (driver.js) does
   the rest. Device-specific behaviour, if any is ever needed, goes here as an
   override -- there is none yet. */
const { Driver } = require("./driver.js");
const profile = require("./profiles/pixelbar24.profile.json");
module.exports = Driver(profile);
