"use strict";
/* The moving-head driver: 13-channel, master dimmer brightness, a mechanical colour
   wheel (snap-to-nearest, adjacent-slot stepping is a taste rule enforced upstream),
   16-bit pan/tilt, gobo/prism/spin. Its channel truth is the profile generated from
   rig.py; the shared runtime does the rest. Head-specific overrides would live here. */
const { Driver } = require("./driver.js");
const profile = require("./profiles/head13.profile.json");
module.exports = Driver(profile);
