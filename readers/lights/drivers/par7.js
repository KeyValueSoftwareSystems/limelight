"use strict";
/* The PAR driver: a 7-channel RGB par. Brightness lives in the colour channels, a
   master dimmer held full, two locked program channels. Its channel truth is the
   profile generated from rig.py; the shared runtime does the rest. Device-specific
   behaviour, if any is ever needed, goes here as an override -- there is none yet. */
const { Driver } = require("./driver.js");
const profile = require("./profiles/par7.profile.json");
module.exports = Driver(profile);
