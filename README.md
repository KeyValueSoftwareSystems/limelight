# Limelight

**Song → map → show.**

A song goes in. We listen once and write a **map** of it — where the beats are, where the
chapters change, and the moments that matter. Anything that can read the map can put on a
show: a club, a strip behind a TV, a phone, a drone swarm.

The demo is one moment: **the room goes dark half a second before the drop, then detonates.**
No light that listens to a microphone can do that, because when a drop is coming the sound is
getting *louder*. Choosing darkness requires knowing what happens next. We read the whole song
in advance.

---

## Two interfaces. Nothing else crosses between us.

| | what it is | who writes it | who reads it |
|---|---|---|---|
| **the map** — [`MAP.md`](MAP.md) | what the music does | `listen/` | everyone |
| **the frame** — [`FRAME.md`](FRAME.md) | what every light is doing at time *t* | `play/` | `room/`, hardware |

If you ever need something *else* to pass between two people, say so out loud. That is a design
bug, not a task.

## Folders

| folder | owner | one line |
|---|---|---|
| `listen/` | Amal | song → map |
| `play/` | Dheeraj | map + time → frame |
| `room/` | Nikhita | the club, in a browser |
| `portal/` | Muzammil | upload, view, fix a moment, preview |
| `score/` | Sebastian | the tapping tool and the scoreboard |
| `songs/` | Renjith | truth — what a human says is actually there |

## Run it

```bash
make check     # is everything wired
make score     # the scoreboard: maps vs truth
make room      # open the club in a browser
make demo      # the whole chain, one song
```

## Two rules that matter more than the rest

1. **No audio in this repo, ever.** Bring your own copies into `songs/<name>/audio.*` — it is
   gitignored. The product's own posture is *scores, never songs*; the repo practises it.
2. **Changes to `MAP.md` or `FRAME.md` go through a pull request.** They are the only things
   here that are expensive to get wrong. Everything else: push to `main`.

Plan and dates: [`PLAN.md`](PLAN.md). First recipe: [`RECIPE.md`](RECIPE.md).
