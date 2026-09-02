# club — the one canonical room

Two files, deliberately separate. See [`../../../WORDS.md`](../../../WORDS.md).

| file | answers | who reads it |
|---|---|---|
| `layout.json` | what is in this room, what each fixture can do, which zone it is in, where it sits | `play/` and the browser room |
| `wiring.json` | universe, address, channel mode, physical lag, safety caps | the hardware layer only |

**The browser and the real rig share `layout.json`.** Only `wiring.json` differs. That is why
what we tune in the simulator is what happens in the room.

## Two fields worth noticing

`can` — what a fixture is capable of: `colour`, `level`, `move`, `strobe`, `pixels`, `burst`.
A recipe asks for a sweep; if nothing in the zone `can` move, something else has to happen. That
substitution is a design decision, not a bug, and it is how one file plays on a big rig and on
two floods.

`lag_ms` — how long this fixture takes to obey. A flood is 2 ms. A moving head is 180 ms and has
to be told **early**, in the dark, so it arrives aimed before its light comes up. Fog is nine
seconds. Ignore this and a cue that should land together arrives smeared.
