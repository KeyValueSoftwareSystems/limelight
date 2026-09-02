# Five words. Then the set is closed.

If you need a sixth word, say so out loud — it usually means something is designed wrong.

| word | the plain question it answers | how often it changes | owner |
|---|---|---|---|
| **map** | what is the *music* doing? | once per song, ever | Amal |
| **layout** | what is *in this room*? | once per venue | Nikitha |
| **wiring** | how is it *connected*? | once per rig | Alnas |
| **recipe** | what should a *moment look like*? | whenever taste changes | Renjith, with Nikitha |
| **frame** | so *what is lit right now*? | forty times a second | Dheeraj produces it |

## The whole system in one line

```
frame = f(map, layout, recipe, t)        then        bytes = wire(frame, wiring)
```

**Map and layout are nouns. The frame is a verb.** The map says what is happening in the
music, the layout says what is in the room, and the frame is the answer to "so what should be
on right now".

## Why layout and wiring are separate files

Lighting people bolt these together and call it a "patch". They are two unrelated things:

- **layout** — which fixtures exist, what each can do, which zone it is in, where it sits
- **wiring** — universe, channel, channel map, physical lag

Splitting them buys one important property: **the browser club and the real club share the same
layout file.** Only the wiring differs. So what we tune in the simulator is what happens in the
room by construction, not by hope. That is the whole reason the simulator can be trusted.

It also settles who reads what. The browser room needs the layout and must never see a DMX
address. The wire code needs addresses and must never care about zones.

## Words we are not using

| not this | because |
|---|---|
| "patch" | lighting jargon, and it means two things at once. Use **layout** and **wiring** |
| "score" for the music file | it also means the scoreboard. The music file is the **map**; the game's number is the **bench** |
| "cue" | it smuggles lighting into the music. The map has **moments**; the recipe turns a moment into a look |
| "universal frame" | there is no such thing. The frame is the **lighting reader's** output. Other readers output other shapes |
