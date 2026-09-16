"use strict";
/* The BLINDER driver for the Chauvet STRIKE Array 4: a single channel, pointed
   at the audience rather than the stage.

   Its channel truth is the profile beside it; the shared runtime (driver.js) does
   the rest. Device-specific behaviour, if any is ever needed, goes here as an
   override -- there is none yet. */
const { Driver } = require("./driver.js");
const profile = require("./profiles/blinder1.profile.json");
module.exports = Driver(profile);
