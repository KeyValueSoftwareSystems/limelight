"use strict";
/* The WASH driver for the Martin MAC Aura: 12 channels of zooming RGBW mover.
   Its Shutter1 channel is both shutter and strobe, so the profile declares a
   strobe_range and the shared runtime opens it rather than leaving it dark.

   Its channel truth is the profile beside it; the shared runtime (driver.js) does
   the rest. Device-specific behaviour, if any is ever needed, goes here as an
   override -- there is none yet. */
const { Driver } = require("./driver.js");
const profile = require("./profiles/wash12.profile.json");
module.exports = Driver(profile);
