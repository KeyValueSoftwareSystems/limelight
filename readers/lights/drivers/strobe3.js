"use strict";
/* The STROBE driver for the Martin Atomic 3000: 3 channels, white only. The one
   fixture on the rig that cannot be tinted, so it always reads as a hit.

   Its channel truth is the profile beside it; the shared runtime (driver.js) does
   the rest. Device-specific behaviour, if any is ever needed, goes here as an
   override -- there is none yet. */
const { Driver } = require("./driver.js");
const profile = require("./profiles/strobe3.profile.json");
module.exports = Driver(profile);
