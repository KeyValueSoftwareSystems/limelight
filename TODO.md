# Open list — every ask still outstanding

## A. Rig / stage (new ask: "entire redesign, fixtures that match real concerts")
- [x] A1 Delete every existing fixture; rebuild rigs from real touring inventories (Coldplay stadium, Garrix mainstage)
- [x] A2 Real fixture classes: beam, spot, wash, batten/bar, blinder, strobe, LED wall, sky beam
- [x] A3 Scenic architecture: towers, layered upstage, B-stage — not one flat wall
- [x] A4 Every new kind must be understood by recipe4 + room.js + wire.js, or it renders dark
- [x] A5 Heads must produce AERIAL beams (room.js currently aims them down — no beams in the air)

## B. Sync / meaning (teammates: "very random, no sync, no emotion")
- [x] B1 fixed: Starlight's drop now runs 12.9 rig switches/s vs verse 3.6; ordering drop>build>verse>quiet>idle now holds on all 5 songs
- [x] B2 The Nights grid sits ~13 ms early against its own kicks
- [~] B3 Mizhiyoram sync measured at 35.4% — the outlier; its reference is thin (34 kicks in the whole song)
- [x] B4 novelty is now a CHECK on chapters, not a second writer of them: 72-91% of boundaries corroborated, and the orphan peaks are recorded as where to listen first

## C. Map fields that drive nothing (ablation, my actual lane)
- [x] C1 lyrics now earn their place as vocal phrases: the line landing lifts, the rig calms under the voice and hands over in the gap
- [x] C2 chords now measured for all 5 songs by ear.py, and colour follows chord identity
- [~] C3 voice 0.002%, novelty 0.024%, stems.vocals 0.043% — decoration
- [x] C4 downbeats 0.000% — suspect measurement artifact, verify on a song with bar_phase != 0
- [x] C5 Publish the ablation as the map's feedback loop

## D. Found while measuring (this pass)
- [x] D1 showscore + 5 other bench tools were reading a stale /tmp map cache — all now compact from maps/model
- [x] D2 fixture-sync had no instrument assigned to beam/spot/sky/bar/wall after the rig rename — 5x more fixtures now graded, and an unassigned kind is reported instead of skipped
- [x] D3 I wrote the grid-offset sign convention backwards into 5 maps; corrected
- [ ] D4 Sync caps at 34-58% because grid-gated fixtures can only be as tight as the grid; accent-driven ones already hit 81-100%
- [ ] D5 The sync metric penalises a legitimate 16th-note chase (4 rises per beat, 1 kick to land on) — fix the metric before chasing the number
- [ ] D6 Grid phase is the dominant lever on sync and is measurably off on levels and the-nights; needs a truth/PROTOCOL.md listening session to decide, not a tuned constant
- [ ] D7 phrase_grid is measured but no reader consumes it yet — wiring look changes to it is the direct fix for "why is this showing up now?"
