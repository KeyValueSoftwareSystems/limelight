# room — the club, in a browser

**Owner: Nikitha.** One fixed setup: four floods, two moving lights, two strips, a fog nozzle.

## It already runs

```
make lights        # or just open readers/lights/index.html
```

**Nikitha owns this.** A working v1 is in the repo so nobody is blocked waiting for it, and so
you inherit something running rather than an empty file. Everything in it is yours to replace.

What it does today: reads `club/layout.json` and a map, applies `RECIPE.md`, draws the room,
shows the **frame** it would send (the pane on the right — that is the exact shape `play/` must
produce), and puts the map's chapters, beats and moments on a timeline you can click to scrub.

**Load an audio file and the clock comes from the audio device**, not from a timer — which is
rule two, demonstrated rather than described.

## What I deliberately left for you

| | why it matters |
|---|---|
| **It is functional, not beautiful** | The beams are flat triangles. Real beams have soft edges, a hot core, and they scatter in haze. This is the single biggest visual win available |
| **Hot reload of the recipe** | Right now the recipe is inside the file. Pull it out so a change is visible in two seconds. **This is the highest-leverage thing in the whole repo** — taste is found by trying fifty things, and cycle time decides how many you get |
| **Moving heads snap** | They should have travel time. A head with 180 ms of lag has to *start moving early*, in the dark, and arrive aimed. See `club/wiring.json` |
| **The strips are crude** | 30 blocks. They should run patterns — a chase, the riff, a wave |
| **No fog behaviour** | Haze is a flat overlay. Real haze builds and disperses, and a burst has nine seconds of lag before it is visible |
| **Two heads only, fixed positions** | The layout has 3D positions. Nothing uses them yet. If the room knows where fixtures are, "sweep across the dancefloor" becomes geometry rather than guesswork |

## The seam that matters

Today the recipe runs *inside* this page. Soon `play/` produces frames and this page only
draws them. Keep the boundary clean — everything the renderer decides should be visible in the
frame pane, and nothing should be decided in the drawing code.

## Why this is not a mock-up
This is the **simulator**, and it is where taste gets found. Real hardware gives you one
expensive try; a browser gives you a thousand cheap ones. The thing that decides whether the
demo is beautiful is how fast someone can change the recipe and *see* it — so hot-reload and a
scrub bar are worth more than any single effect.

Real lights are one more room, later. Same frames.
