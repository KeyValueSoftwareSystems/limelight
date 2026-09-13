# Presets

A preset is a short clip of a real song plus the protocol response for exactly
that stretch, cut so that it proves one thing and nothing else. You play it, you
watch the rig, and the only variable in the room is the one being tested.

What is committed here is the recipe, never the audio — no audio in git, ever.
The recipe says which song, what to look for in it, and which effect the clip is
meant to demonstrate. `tools/preset.js` finds the passage, cuts the clip, pulls
the response, and writes a folder for the hub.

    node tools/preset.js build presets/build-dont-look-down.json

A recipe names what to find rather than hard bar numbers, so a preset stays
correct when the pipeline regenerates a score and the bars move.

## The clip does not need to start on a bar line

Each built preset carries `starts_at_s`, the song-second its first sample
corresponds to. A player adds that to its own position to get song time, and the
response — which is in bars and beats — then lines up exactly. So the cut can be
sloppy at both ends; what matters is that the offset is recorded.

## A preset is not always a fragment

Some questions cannot be asked of a short clip. Whether the second drop is
bigger than the first needs both drops in view, and whether a show escalates
across a set needs the whole track. How much of a song a test needs is the
test's business, so `find` accepts `whole-song` alongside the passage finders.
Short clips are for isolating one moment; full songs are for anything about
shape across a song.

## The ladder

Each preset should add exactly one capability to the one before it, so a failure
is never ambiguous. Roughly: land on the beat and breathe with the track, then
get busier through a build, then look the same when material returns, then stay
out of the way in a quiet passage, then spend the whole rig on one big moment,
then act as four lamps rather than two halves.
