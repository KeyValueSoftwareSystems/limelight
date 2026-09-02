# Recipe v0.5 — colour in hue space, motion that varies, fixtures as individuals

Four notes from Renjith, all of them right.

## "Why are the colours limited?"

Because v0.4 hardcoded **fourteen RGB values** — two per chapter — and every fixture in the room
got the same one. A rig does not get its richness from more presets; it gets it from **hue offsets
across fixtures** and from **the complement**.

So colour now lives in hue space. Each chapter carries a hue *anchor* and a *range* it may wander,
walked on a two-phrase clock. Energy pushes the hue toward the hot end of that range and raises
saturation. Then:

- **PARs** get a hue gradient across the room, ±14° — six visibly different colours in a line
- **uplights** get −22° and more saturation, so the wall reads deeper than the floor
- **moving heads** get **+166°, the complement** — instant contrast between wash and beams
- **strips** alternate base and complement along their length

Measured: **14,980 distinct fixture colours across the song**, against 14 before.

## "Why are the moving heads moving slowly all the time?"

Because they had one sinusoid with an eight-bar period and nothing ever changed it. The first
attempt at a fix used discrete modes per look — sway, fan, circle, ballyhoo, snap — and it
**teleported the heads at 22.96 units per second**, because different modes read the phase at
different harmonics, so the phase itself jumped at a mode change.

That failure taught the rule: **a lamp can cut in one frame; a motor cannot.** So there are no
modes. Character is driven by energy, which is continuous:

| | |
|---|---|
| shape | sways when calm, circles when energetic (`smoothstep(0.35, 0.85, e)`) |
| amplitude | 0.13 → 0.43 of pan range |
| **dwell** | up to 55% of each cycle spent **holding still** when the music is calm |

The dwell is the part that reads as life. Measured pan travel over an eight-second window: **0.03
at 2:05 in the breakdown, 0.86 in the verse.** Still, then sweeping, with everything between —
and the perception of movement comes from that contrast, not from peak speed.

Position also deliberately ignores `stop`: a real head holds its aim while its lamp goes dark.
Trying to make it "hold still" during a 0.22 s crossfade slewed it at 1.64 /s.

Slew limits in `layout.json` were also too conservative at 0.45 — a decent head does 540° of pan
in about two seconds, so about 0.85 of its range per second. Measured now: **pan 0.36 /s, tilt
0.40 /s**, inside limits with headroom.

## "Why not send separate input to them, like an actual setup?"

The sharpest of the four. Every fixture of a kind shared one formula with an index offset, which
hardcodes *this* rig.

**Fixtures are now addressed by position, derived from `layout.json` at load.** Each one gets a
normalised `xn` across the room plus derived predicates — `outer`, `centre`, `left`, `odd`. Then:

- the PAR wave travels **in metres**, not in array indices, so different spacing still reads right
- the outer PARs carry the wash and the inner ones the accent, chosen by position
- uplights **hand over odd to even across the bar** — a classic uplight look, and genuinely
  different values per fixture rather than one curve with a phase shift
- head fan, mirror and lead all come from where the head hangs
- heads carry a small positional term in their base level, because **in a real rig no two fixtures
  ever read the same**

Measured at one instant mid-drop: six distinct PAR colours, four distinct uplight levels, four
distinct head pans and colours. The point is not the variety — it is that **the same recipe now
runs on a different layout**, which is the entire reason those are separate files.

## "Full screen, and the club UX could be better"

The visualiser is now the page. Full-bleed stage, translucent HUD over it, panels behind
<kbd>tab</kbd>, and <kbd>f</kbd> for real fullscreen.

## Smoothness held through all of it

p90 0.082, p99 0.137, and **9 frames of 7,026 change by more than 0.15** — the drops, a strobe
entry, the return, and two uplight handovers at 0.153.
