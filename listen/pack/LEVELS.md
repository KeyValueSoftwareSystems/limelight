# The curriculum

We are not trying to build a system that understands all music. We are trying to build one that
understands **one song**, then a song with exactly one new hard property, then another. The method
is borrowed from the way hard problems in machine learning actually got solved — games first,
in order of difficulty, each one adding a single new kind of difficulty rather than a bigger
version of the last one.

A song is the game. The bench is the score. A level is unlocked when the bench says so, not when
it feels close.

| level | new hard property | example | what breaks if you skip ahead |
|---|---|---|---|
| **1** | a rigid grid. Constant tempo, 4/4, machine-made | *The Nights* — Avicii | nothing. This is the calibration level: if the bench is not near 1.0 here, the bug is in your code, not the music |
| **2** | long-form trajectory. Structure measured in minutes, not bars | *Opus* — Eric Prydz · *Strobe* — deadmau5 | span detection. A model tuned on three-minute pop finds no boundary at all in a four-minute riser |
| **3** | human timing. A drummer, not a grid — tempo drifts continuously | most rock, most live recordings | anything that assumed a constant beat interval. Beat *tracking* replaces beat *inference* |
| **4** | a different meter. Cycles that are not four beats long | Indian taal, 7/8, 12/8 | downbeats. "Every fourth beat" stops being a definition and becomes a wrong guess |
| **5** | tempo changes on purpose. Ritardando, half-time, a full modulation | film score, prog, most Anirudh | the single global tempo assumption, everywhere it is hiding |
| **6** | structure without a pulse. Orchestral, ambient, sound design | *Raga of Revenge* — Anirudh Ravichander, from *DC* | the assumption that structure is built on beats at all. Chapters must come from timbre and density |

## Two things about this ladder

**Every level is measured; only three are demoed.** A level costs one truth file — an hour of
careful listening. A *demo* costs a week. So we measure all six and show the three that are ready,
which keeps the ladder honest without letting it eat the calendar.

**Track the bench per level, not just in total.** If level 2 improves while you are working on
level 1, the curriculum is doing real work and the method transfers. If it does not, we are
overfitting one song at a time and should know that early rather than late.

Level 6 is the one that matters for the demo, and it is the one we expect to fail on. That is
useful: playing a song where the machine scores a third, saying so out loud, correcting two
moments by hand, and playing it again is a better demonstration of the system than any song it
gets right.
