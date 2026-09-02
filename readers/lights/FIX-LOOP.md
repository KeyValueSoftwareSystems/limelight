# The fix loop

Renjith's design, and it is the right one: *"if I am giving you feedback it has to change the map
so fast I can test it immediately, and since the exact millisecond is impossible you will have to
use the nearest beat."*

## Why snapping is not a convenience

A human watching a show is reliable to perhaps ±200 ms. The beat grid is known to about 10 ms.
So a snapped click is not a rounded-off approximation of a human's intent — it is **more accurate
than the human could ever be**, and it converts a loose gesture into an exact musical fact.

## Snap to the grid the field belongs on

Snapping everything to the nearest beat would let a drop land on beat 3 of a bar, which is worse
than not snapping. So the target grid is a property of the field:

| field | snaps to | why |
|---|---|---|
| `drop`, `quiet`, `return` | **downbeat** | no dance record drops on beat 3. This is what let one confirmed drop settle the bar phase for the whole song |
| `stop`, `spotlight` | **any beat** | a stop can begin anywhere in the bar |
| chapter boundary, span edge | **four-bar line** | sections and phrases arrive on phrase boundaries, not on arbitrary bars |
| `energy` | **nothing** | it is a value, not an instant |

When a snap moves the click by more than half a bar the log says so, because that means either
the click was loose or the bar phase is wrong — and the second is worth knowing.

## Map fixes and look fixes go to different places

About half of any real feedback is not about the map at all. *"The drop is late"* is the map, and
Renjith fixes it himself in the page at one keypress, testing it on the next frame. *"The drop
should be white, not magenta"* is the **recipe**, which is code — `l` logs that complaint with the
whole frame attached, so it arrives with its context instead of as a sentence.

Keeping these separate is not tidiness. Without it, every session spends its first ten minutes
working out which of the two is being discussed.

## Every edit is provenance, so the export is also a truth file

Each fix records who made it and when. On export the map carries a `verified` list of the moments
a human placed, plus the full `change_log`. That means **the fifteen minutes spent fixing the show
also produces the truth file** — not a separate tapping exercise afterwards — and the log is the
first row of the correction corpus.

Anything in `verified` is truth. Everything else is model output and is not, and the two must
never be confused.

## Bugs the test found

Writing the property test for this caught three, one of which would have been genuinely nasty:

- **`size` survived a retype into `holds`.** Turning a drop into a stop carried a size of 0.9
  across into a 0.9-*second* hold. Different quantities, different units, silently swapped.
- **A snapped moment was no longer an exact grid member.** The beat array was built at four
  decimals and snapping rounded to three, so index lookups failed by 0.3 ms — harmless musically,
  fatal to any exact-match logic. Everything is now at the map's own three-decimal precision.
- **Changing the bar phase left the downbeat grid stale**, so subsequent snaps used the old one.
