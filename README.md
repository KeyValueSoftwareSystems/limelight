# Limelight

**Song → map → show.**

A song goes in. We listen once and write a **map** of it — where the beats are, where the
chapters change, and the moments that matter.

**We are building an understanding of music, not a light show.** The map knows nothing about
output. Anything that can read it can use it: lights in a club, cut points for a video editor,
a note chart for a game, a pace curve for a workout, a colour per seating block for fifty
thousand phones. Lighting is the first *reader* because photons are persuasive on a stage — it
is the proving ground, not the point.

The demo is one moment: **the room goes dark half a second before the drop, then detonates.**
No light that listens to a microphone can do that, because when a drop is coming the sound is
getting *louder*. Choosing darkness requires knowing what happens next. We read the whole song
in advance.

---

## Two interfaces. Nothing else crosses between us.

| | what it is | who writes it | who reads it |
|---|---|---|---|
| **the map** — [`MAP.md`](MAP.md) | what the music does. universal. one per song | `listen/` | every reader |
| **the frame** — [`readers/lights/FRAME.md`](readers/lights/FRAME.md) | what every light is doing at time *t*. **the lighting reader's format, not a universal one** | `play/` | `readers/lights/`, hardware |

**The map describes the song. The frame describes the room.** One per song, versus forty per
second. Other readers have their own output shapes and never touch the frame.

If you ever need something *else* to pass between two people, say so out loud. That is a design
bug, not a task.

## Folders

| folder | owner | one line |
|---|---|---|
| `listen/` | Amal | song → map |
| `play/` | Dheeraj | map + time → frame |
| `readers/lights/` | Nikhita | the club, in a browser |
| `readers/chapters/` | anyone, 20 lines | map in, chapter list out. proves "same file" |
| `portal/` | Muzammil | upload, view, fix a moment, preview |
| `bench/` | Sebastian | the tapping tool and the scoreboard |
| `songs/` | Renjith | truth — what a human says is actually there |

## Run it

```bash
make check     # is everything wired
make bench     # the scoreboard: maps vs truth
make lights    # open the club in a browser
make demo      # the whole chain, one song
```

## Two rules that matter more than the rest

1. **No audio in this repo, ever.** Bring your own copies into `songs/<name>/audio.*` — it is
   gitignored. The product's own posture is *scores, never songs*; the repo practises it.
2. **Changes to `MAP.md` or `FRAME.md` go through a pull request.** They are the only things
   here that are expensive to get wrong. Everything else: push to `main`.

Plan and dates: [`PLAN.md`](PLAN.md). Lighting recipe: [`readers/lights/RECIPE.md`](readers/lights/RECIPE.md). GPUs: [`listen/GPU.md`](listen/GPU.md).
