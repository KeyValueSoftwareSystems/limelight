# Briefs — taste as data, never as code

A brief is to the video reader what a layout is to the lighting reader: the part
that changes per job, kept out of the program that reads it. `policy_rules.js`
must produce a different edit for every file in here without a line of it
knowing which file it was handed, and the same is true of the LLM policy.

That is not tidiness. A vertical hard-coded into a policy is a vertical that has
to be re-implemented for the next client, and it is untestable — you cannot tell
a policy that generalises from one that was tuned until the demo looked good.
The test is `bench/cutscore.py --brief-swap`: run every brief over the same song
and the same clips, and if two briefs produce the same edit, one of them is not
being read.

## The fields

| field | meaning |
|---|---|
| `format` | output geometry and frame rate. Clips are conformed to this, never the reverse |
| `budgets.cuts_per_minute` | how much visual attention there is to spend in total |
| `budgets.min_shot_s` / `max_shot_s` | the shortest and longest a shot may be |
| `restraint.min_rest_s` | the shortest a deliberate hold is allowed to be |
| `restraint.hold_before_major_s` | quiet bought immediately before a big moment |
| `restraint.preserve_headroom` | whether to spend under budget so the peak has somewhere to go |
| `prefers.*` | ranges over measured clip features. A range, not a target: outside it costs, inside it is free |
| `salience_floor` | the moment strength below which a musical event is not worth a cut |
| `callbacks` | whether repeated music should get repeated picture |

Every `prefers` key must name a field that `assets/index.py` actually measures.
A brief asking for something nobody measures is a brief asking for a guess, and
`briefs/check.py` refuses it.

## What a brief is not

It is not a description of the music. Nothing in here mentions beats, drops or
sections — the map already says what the song does, and a brief that restated it
would be a second writer for the same fact.

It is not a description of the footage either. `prefers` states what this job
wants; `assets/INDEX.json` states what the clips are. Keeping those apart is what
lets one brief run over somebody else's footage.
