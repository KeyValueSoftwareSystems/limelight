# A deliberately ordinary first attempt

`the-nights.candidate.json` is hand-built to look like a realistic first pipeline run, and
`expected-report.txt` is what the bench says about it. Four lessons are planted in that output:

1. **Beats 0.979, downbeats 0.099.** The candidate derived downbeats as `beats[::4]`. One missing
   beat shifts the bar phase and it never recovers. Two different problems, two different models.
2. **A stop 350 ms short, flagged audible.** Onset perfect, `holds` estimated instead of measured.
3. **A span with IoU 1.00 and the wrong `rise`.** Right place, wrong shape — a room that lifts at
   the wrong time.
4. **Energy r = 0.981 with heavy noise added.** Correlation flatters any curve with strong
   structure. Look at the shape, not the coefficient.

Neither file was produced by a model. They exist so the bench has something to say on day one.
