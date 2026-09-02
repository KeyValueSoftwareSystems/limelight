# Sources

`limelight.html` at the repo root is **built**, not written. These are the parts.
`build.sh` concatenates them in order and inlines the map, so a single file opens
from a filesystem with no server and no network.

| file | what it is |
|---|---|
| `recipe4.js` | the lighting reader. `frame(t)` and nothing else — no state, no history |
| `render_gl.js` | the room: WebGL when it can, canvas 2-D when it can't, and it says which |
| `render5.js` | the canvas-2-D room, standalone. The copy inside `render_gl.js` is generated from this |
| `sky.js` | the drone-show renderer |
| `drones.js` | the drone reader. Same map, different art form — this is the universality claim, tested |
| `score_lanes.js` | the score view: 18 lanes drawn straight from the map |
| `appglue.js`, `app.html` | tabs, transport, venue switching, file loading |
| `apptest.js` | headless. Evaluates the built page and asserts every reader draws |
| `smooth.js` | the physics check: per-frame deltas, and head slew against the layout's declared limits |

```
bash readers/src/build.sh      # writes limelight.html
node readers/src/apptest.js    # must print ok for all three readers
node readers/src/smooth.js     # p90 must stay under 0.15
```

`build.sh` expects the map next to the working copy. It is a hackathon build script,
not a build system, and it is checked in because losing it would cost more than it took
to write.
