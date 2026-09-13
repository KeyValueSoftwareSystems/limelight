# Briefs

One file per thing we want the rig to do. A brief names a moment in a song, the
effect we are after, and — because the effect is one of a small set of named
measurements — how it will be judged. Nothing here is prose for a human to
interpret; `node tools/briefs.js` runs every one of them against the real baked
output and says which are landing.

Add one by copying a file and changing four fields. You do not need to touch any
code: the effects are already measurable, and a brief only says where to look.

    {
      "song": "levels",        the score to bake
      "from_bar": 25,          where the moment starts
      "bars": 9,               how long it is
      "effect": "speed-rises", one of the named effects
      "want": "...",           one sentence, in your words, for whoever builds it
      "seen": "..."            optional: what it looked like last time it was watched
    }

The named effects live in `tools/measure.js`. Adding a new one means writing a
measurement, which is a real piece of work — so prefer reusing an effect at a
new moment, which costs nothing.
