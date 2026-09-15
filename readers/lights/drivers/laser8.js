"use strict";
/* The LASER driver. Its profile is INVENTED -- there is no laser GDTF in this
   repo. Read the note in the profile before trusting it with anything real.

   Its channel truth is the profile beside it; the shared runtime (driver.js) does
   the rest. Device-specific behaviour, if any is ever needed, goes here as an
   override -- there is none yet. */
const { Driver } = require("./driver.js");
const profile = require("./profiles/laser8.profile.json");
module.exports = Driver(profile);
