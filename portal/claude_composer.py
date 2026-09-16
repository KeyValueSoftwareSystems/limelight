#!/usr/bin/env python3
import argparse
import json
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import composer as C
from validator import validate, format_report

WORK = os.path.join(HERE, "work")
DEFAULT_MODEL = "opus"
BUDGET = 22


def score_file(song):
    base = os.path.join(REPO, "hub", "files", "score")
    flat = os.path.join(base, song + ".score")
    if os.path.isfile(flat):
        return flat
    store = os.path.join(base, ".versions", song + ".score")
    try:
        ns = [int(x.split(".")[0]) for x in os.listdir(store)
              if x.endswith(".score") and x.split(".")[0].isdigit()]
    except OSError:
        return flat
    return os.path.join(store, "%d.score" % max(ns)) if ns else flat


def effect_behaviour(rig):
    try:
        out = subprocess.run(["node", os.path.join(HERE, "venues", "probe.js"), rig],
                             capture_output=True, text=True, timeout=120).stdout
    except Exception:
        return "  (could not measure the rig)"
    keep = [l for l in out.splitlines() if l.strip() and not l.startswith(rig)]
    return "\n".join("  " + l for l in keep)


def rig_facts(rig):
    at = os.path.join(HERE, "venues", rig, "manifest.json")
    lim = os.path.join(HERE, "limits.json")
    bits = []
    try:
        m = json.load(open(at))
        fx = m.get("fixtures") or {}
        bits.append(f"  {rig}: {fx.get('pars', '?')} PAR cans (RGB) and "
                    f"{fx.get('heads', '?')} moving head(s), {m.get('total_channels')} DMX channels.")
        if (fx.get("pars") or 0) <= 6:
            bits.append("  This is a SMALL rig. An extent that names half of it leaves the")
            bits.append("  other half dim, and effects that want many lamps - spectrum, chase -")
            bits.append("  have little room to read. Prefer whole-rig moves and colour.")
    except Exception:
        pass
    try:
        L = json.load(open(lim))
        mi = L.get("max_intensity") or {}
        bits.append(f"  Ceilings: pars {mi.get('par')}, head {mi.get('head')}.")
        for z in (L.get("keep_out") or []):
            bits.append(f"  KEEP OUT: the head may not throw light between "
                        f"{z.get('pan_from_deg')} and {z.get('pan_to_deg')} degrees "
                        f"({z.get('name')}). Aiming there blacks the head out.")
        st = L.get("strobe") or {}
        if not st.get("allowed", True):
            bits.append("  Strobe is FORBIDDEN in this venue; do not use strobing effects.")
    except Exception:
        pass
    return "\n".join(bits) or "  (rig unknown)"


def bar_table(song):
    try:
        import composer as C
        sc = C._score_of({"_song": song})
    except Exception:
        return []
    beats = [b.get("t") if isinstance(b, dict) else b for b in (sc.get("beats") or [])]
    beats = [t for t in beats if isinstance(t, (int, float))]
    if not beats:
        return []
    bpb = int(((sc.get("grid") or {}).get("beats_per_bar")) or 4)
    ac = sc.get("acoustic") or {}
    loud = ac.get("loudness") or []
    w = ac.get("window_s") or 0.5
    if not loud:
        return []
    lo, hi = min(loud), max(loud)
    rng = (hi - lo) or 1.0
    hits = [h.get("t") for h in ((sc.get("rhythm") or {}).get("hits") or [])
            if isinstance(h, dict) and isinstance(h.get("t"), (int, float))]
    st = sc.get("stems_temporal") or {}
    lanes = st.get("stems") or {}
    lw = st.get("window_s") or 0.5
    rows = []
    for bar in range(len(beats) // bpb):
        t0 = beats[bar * bpb]
        t1 = beats[min(len(beats) - 1, (bar + 1) * bpb)]
        if t1 <= t0:
            continue
        seg = loud[int(t0 / w):max(int(t0 / w) + 1, int(t1 / w))]
        pct = int(round(((sum(seg) / len(seg)) - lo) / rng * 100)) if seg else 0
        n = sum(1 for h in hits if t0 <= h < t1)
        top = []
        for name, ser in lanes.items():
            a0, a1 = int(t0 / lw), max(int(t0 / lw) + 1, int(t1 / lw))
            part = ser[a0:a1]
            if part and max(part) > 0.45:
                top.append((max(part), name))
        top.sort(reverse=True)
        rows.append((bar + 1, t0, pct, n, [n2 for _v, n2 in top[:3]]))
    return rows


def brief_for(song, overview, effects_block, hub, rig="arc4-head"):
    EFFECT_BEHAVIOUR = effect_behaviour(rig)
    RIG_FACTS = rig_facts(rig)
    ask = os.path.join(REPO, "portal", "ask.py")
    SCORE_AT = score_file(song)
    return "\n".join(
        [
            f"Compose the lighting show for `{song}`.",
            "",
            "THE SONG, AS MEASURED",
            "",
            C.format_overview(overview),
            "",
            "THE EFFECT CATALOG",
            "",
            "THE EFFECT CATALOG is in your system prompt, with every dial and its",
            "range. It is not repeated here.",
            "",
            "THE SONG BAR BY BAR",
            "",
            "loud is that bar's mean loudness as a percentage of this song's own",
            "range, hits is how many drum onsets were struck in it, and the names are",
            "the lanes running loudest. This is where the highs and lows are. A",
            "section is an average of these; the show does not have to be.",
            "",
            *[f"  bar {b:3d}  {t:6.1f}s  loud {p:3d}%  hits {n:2d}  {', '.join(names)}"
              for b, t, p, n, names in bar_table(song)],
            "",
            "ASKING THE SCORE FOR MORE",
            "",
            "The brief above is structure. Detail is a shell command away, and you",
            "are expected to use it - a show written from the summary alone is a show",
            "that could have been written for any song. Ask as many as you need -",
            "there is no budget. A question costs a fraction of a second and the",
            "answer is measured; guessing costs the show.",
            "",
            f"    HUB_URL={hub} python3 {ask} {song} <question> [args]",
            "",
            "    lane harp 110 125            does the harp actually carry that span?",
            "    compare lead-vocal,back-vocal 22 39    do two voices alternate or overlap?",
            "    onsets 40 48                 how busy are the drums into the drop?",
            "    chords 48 82 / melody 48 82  what the harmony and the tune do",
            "    moment 16 / section 2        everything known about one of them",
            "",
            "THE SCORE ITSELF",
            "",
            "Nothing above is the whole file. The score is on disk and you may read it",
            "directly for anything these questions do not cover - every beat time, the",
            "per-bar emotion curves, the chord list, 39 instrument lanes at half-second",
            "resolution, the melody notes:",
            "",
            f"    {SCORE_AT}",
            "",
            "    jq '.emotion[] | {start, energy, brightness, groove, mode}' <file>",
            "    jq '.beats | length' <file>      jq '.stems_temporal.stems | keys' <file>",
            "",
            "Beats are measured, not computed from bpm, and this song may change tempo -",
            "so if you want the instant a bar lands, read the beat rather than multiplying.",
            "",
            "Spend them where a cue depends on the answer. Whether the harp earns its",
            "own lamp depends on the harp's lane; whether two vocals may trade places",
            "depends on comparing them. Do not ask about spans you will not light.",
            "",
            "WHAT THE SCORE MEANS",
            "",
            "Nothing in the file is a model's opinion; every field is measured.",
            "",
            "  moments    an instant worth answering. `intensity` is 0..1 WITHIN this",
            "             song, so 1.00 means the biggest of its kind here, not in music.",
            "             climax = the fullest passage, peak = the loudest stretch - they",
            "             are different claims and often different places.",
            "  sections   the song's form. The NAME is a pop-song label and may be wrong",
            "             for this music; the numbers under it are not. Never light a",
            "             section from its name alone - read what is playing in it.",
            "  emotion    energy / brightness / groove measured per bar, 0..10 WITHIN this",
            "             song, and mode -1 minor to +1 major. Scaled per song, so 7 is",
            "             mid here, not loud in absolute terms.",
            "  lanes      39 separated instruments at half-second resolution, each with",
            "             its dB in the mix. This is what the audience actually hears.",
            "  beats      measured beat times, not bpm arithmetic. On a song that changes",
            "             tempo the two disagree by over a second by the end.",
            "",
            "HOW THE LAMPS ACTUALLY BEHAVE",
            "",
            "Measured by rendering each effect on this rig and reading the DMX:",
            "",
            EFFECT_BEHAVIOUR,
            "",
            "  peak/floor are the rig's average level 0..1, swing is peak minus floor,",
            "  `lit` is how many of the lamps it touches. An effect with swing near zero",
            "  changes colour or place, not brightness.",
            "",
            "THE RIG YOU ARE WRITING FOR",
            "",
            RIG_FACTS,
            "",
            "DESIGNING LIKE A PERSON, NOT A LABEL",
            "",
            "  A section called `intro` is not automatically dark. On this song the",
            "  intro carries ten instruments including the loudest vocal in the track,",
            "  and a `drone` at 0.12 over it reads as a fault, not a choice. Set the",
            "  resting level from what is PLAYING - the instrument list above gives you",
            "  dB and coverage for every lane.",
            "  Contrast is the whole craft: if everything is at 0.8 nothing is bright,",
            "  and if everything is at 0.15 the rig looks broken. Give a song a floor",
            "  and a ceiling and spend the range.",
            "  A gesture is worth having only if the thing before it was different.",
            "  Hold a look; change it when the music changes, not on a timer.",
            "  COLOUR IS YOURS. There is no cap on how many colours a show may use and",
            "  nothing snaps your colours to a list unless you ask for it. Choose them",
            "  from what the song measures - mode below zero is minor and above is",
            "  major, brightness is a measured timbre, energy and groove move per bar,",
            "  and the emotion spans give you all four per section. A song that turns",
            "  minor should turn colour with it. The only rule is the measured one: no",
            "  single colour may hold more than 72% of the show, because a rig that is",
            "  one colour end to end cannot show the song's form.",
            "",
            "  If you WANT the discipline of a fixed set, declare a `palette` and every",
            "  colour will be snapped to it - but that is a choice you make, not a",
            "  requirement. Declaring one is optional:",
            "  to five colours, each with a name and a reason, and then every colour",
            "  anywhere in the show must be one of them:",
            "",
            '      "palette": [',
            '        {"name": "saffron", "rgb": [1, 0.72, 0.28],',
            '         "why": "the major mode this song lives in"},',
            '        {"name": "indigo",  "rgb": [0.3, 0.38, 0.85],',
            '         "why": "for the minor trench at moment 4"},',
            '        {"name": "white",   "rgb": [1, 1, 1], "why": "hits only"} ],',
            "",
            "  A show that invents a slightly different amber for every cue looks",
            "  random, because it is - the last one used thirteen colours of which",
            "  eight were the same orange a few degrees apart. Two or three colours",
            "  used with discipline read as a decision. Anything you write that is not",
            "  in the palette is snapped to the nearest entry, so choose the palette",
            "  deliberately and then spend it.",
            "",
            "  Colour carries meaning here: mode below zero is minor, above is major,",
            "  and brightness is a measured timbre, not a mood word. Tie palette",
            "  entries to those measurements in their `why`.",
            "",
            "  EVERY SECTION NEEDS SOMETHING CONTINUOUS OVER IT. A state is a still",
            "  frame held for the whole section - on its own the rig does not move for",
            "  thirty seconds and an audience reads it as broken. A BINDING is what",
            "  makes the rig answer the music second by second, and it is the only",
            "  thing that does. Three exist and all are measured, not guessed:",
            "",
            "    follow  <stream>            level rides that instrument's envelope",
            "    accent  threshold=<0..1>    flashes ABOVE a bed on drum onsets",
            "    split   <streamA>,<streamB> two halves of the rig trade on two lanes",
            "    chase   <stream>            one lamp lit, running along the rig on the beat",
            "    ripple  <stream>            a soft wave travelling across the lamps",
            "    alternate <stream>          odd lamps then even, flipping on the beat",
            "",
            "  MEASURED ON THIS RIG, each of the three alone over a plain 0.25 wash:",
            "",
            "      chase      98.8% of rises on a measured beat (+3.5 sd), lamp",
            "                 correlation 0.10",
            "      ripple     100.0% (+3.2 sd), correlation 0.14",
            "      alternate  100.0% (+3.0 sd), correlation -0.72",
            "",
            "  All three answer `on the grid` and `lamps act apart` on their own. What",
            "  dilutes them is layering something NOT beat-locked over the top: accent",
            "  rides onsets, which land on a beat 36% of the time, and follow rides an",
            "  instrument lane, which lands wherever the player played. Both are worth",
            "  using - but if a section carries a travelling binding AND a heavy accent,",
            "  the beat-locked rises get outnumbered and the show stops reading as",
            "  synced. Let the travelling binding lead and keep the others under it.",
            "",
            "  THE LAST THREE ARE NEW AND THEY ARE THE ONES THAT MAKE A RIG LOOK ALIVE.",
            "  follow and accent drive every lamp with the SAME number, so the rig grows",
            "  and fades as one body - measured, our four pars moved with a correlation",
            "  of 0.89 and not one pair led another, where a hand-built show sat at 0.50",
            "  with eight lead-and-follow pairs. That difference is the whole reason a",
            "  show reads as designed rather than bland. chase, ripple and alternate",
            "  give each lamp its own moment: they step on the song\'s MEASURED beats and",
            "  their brightness rides the stream you bind, so the sequence is musical",
            "  and not a clock. Put one under any section that should move, and layer a",
            "  dim bed under it so the travelling lamp has something to stand out from.",
            "",
            "  A stream is any instrument lane in the roster above, OR one of three",
            "  measured grid streams. The grid streams are the song's own beat times,",
            "  not a metronome - this performance breathes and they breathe with it:",
            "",
            "    beat      rings at 1.0 on every measured beat, falls to 0 before the next",
            "    downbeat  the same, but only on the first beat of a bar",
            "    bar       an alias of downbeat, decaying across the whole bar",
            "",
            "  An instrument lane is sampled every 0.5s, which on most songs is about",
            "  one number per beat. That makes lanes a good answer to WHICH instrument",
            "  is present and a poor answer to WHEN the music hits. For pulse, bind a",
            "  grid stream. A show whose brightness rises never land on a measured beat",
            "  reads as random blinking however carefully the levels were chosen - this",
            "  is the single most common way a show fails.",
            "",
            "  THE RIG MUST NEVER SIT STILL FOR LONG. In a real show nothing holds a",
            "  frame for ten seconds. A `follow` on a voice or a string pad moves",
            "  smoothly and will not, on its own, make a rig look alive - it needs",
            "  something percussive layered with it. `accent` is that: it rides the",
            "  measured onset envelope, which peaks near 0.45 on this song, so a",
            "  threshold around 0.10 fires on roughly a third of the track and a",
            "  threshold above 0.2 never fires at all.",
            "",
            "  THE LANES ARE FINE NOW. Each instrument is sampled every 0.05 seconds,",
            "  about twenty numbers a second, so a lane carries a note attack and not",
            "  just its presence. That cuts both ways: bound raw, a lane puts the lamp",
            "  on every attack and reads as jitter. `follow` has a `smooth` dial and it",
            "  is a real filter - 0 is the raw attack, 1 is a slow swell. Measured: raw",
            "  fine data made 584 single-frame jumps over 30 DMX; the same binding at",
            "  smooth 0.35 made 325. Set it per section: low where you want a",
            "  percussive edge, high where a voice or a pad should breathe.",
            "",
            "  MEASURED, SO YOU DO NOT HAVE TO GUESS: `accent` rides drum ONSETS, and",
            "  onsets are not beats - a show driven by accent alone put only 35.8% of",
            "  its brightness rises on a measured beat, barely above the 22% you get by",
            "  chance. The same show driven by a grid stream put 63.7% on a beat. If you",
            "  want the rig to look locked to the song, a grid stream is the thing that",
            "  does it, and accent is not a substitute for one.",
            "",
            "  `accent` also flashes THE WHOLE RIG AT ONCE. Six accent bindings and",
            "  nothing else drove `lamps doing different things` from 78% down to 2.7% -",
            "  a rig blinking in unison is the definition of a wall. Never let one",
            "  binding effect carry every section: pair any whole-rig binding with a",
            "  place binding (`split`) or a narrower `extent` so the lamps can disagree.",
            "",
            "  Bindings LAYER. A section may carry several and they combine, so the",
            "  designer's normal move is available: the wash follows the voice while",
            "  the pars answer the kick. One binding per section is a thin section.",
            "",
            "  Bind every section to a stream that actually carries it - the instrument",
            "  list gives you dB and coverage, and `compare` tells you whether two",
            "  lanes alternate. A section may be left still only if you say why in its",
            "  `why`, and stillness must be the exception.",
            "  Nothing downstream will add movement for you. If the plan does not ask",
            "  for it, the rig holds a frame - and a person opening this show in the",
            "  editor must be able to see and change every reason it moves.",
            "",
            "  USE THE WHOLE VOCABULARY. There are 34 effects across four dimensions,",
            "  and a show built from wash, drone and impact is three of them. Brightness",
            "  is the least interesting thing a rig does; an audience reads colour and",
            "  movement first. A song of any length wants several colour moves and",
            "  several place moves, not one of each. If you reach for the same effect",
            "  twice, ask whether the second one wanted a different dimension.",
            "  What you must NOT do is decorate: every cue still answers something",
            "  measured. Variety in HOW you answer, never in WHETHER there is anything",
            "  to answer.",
            "",
            "CHECK YOUR OWN WORK BEFORE YOU FINISH",
            "",
            "You do not have to guess whether the show passes. Write plan.json, then",
            "bake and score it yourself - it takes under half a second - read the",
            "result, fix what failed, and write the file again. Loop until it passes",
            "or you run out of turns. A show handed over unmeasured is a draft.",
            "",
            f"    cd {REPO}",
            f"    node portal/baker.js {SCORE_AT} plan.json \\",
            f"      --rig {rig} --lights /tmp/self-{song}.lights.json",
            f"    node tools/shape.js /tmp/self-{song}.lights.json {SCORE_AT}",
            "",
            "shape.js prints one line per question, `pass` or `FAIL`, with the number",
            "it measured. Fix the FAILs. The numbers tell you which way to move: if",
            "`held back` says 70% of frames sit mid-level, your state amounts are all",
            "in the middle; if `lamps act apart` says 0.9, every lamp is doing the same",
            "thing and you need a travelling binding.",
            "",
            "HOW MUCH SHOW TO MAKE",
            "",
            "A lighting designer built a show for this song by hand. It makes 117",
            "separate assignments across 131 seconds - a change roughly every second.",
            "The last one written here made 36, a change every three and a half",
            "seconds, and it reads as a rig that is waiting rather than playing.",
            "",
            "That is not a target to hit, it is a sense of scale. A section is not one",
            "decision. Within a single chorus the drums enter, a voice answers, a line",
            "repeats higher, the bass drops out for two bars - each of those is a",
            "moment a designer would light, and the score has them all. Work at the",
            "bar and the phrase, not only at the section.",
            "",
            "THERE IS NO RUBRIC",
            "",
            "Nothing scores this show against a list of required properties. Earlier",
            "versions of this brief carried one and it made the shows worse: a cap on",
            "colours had the composer refusing to use spectrum, shift, trade, ramp,",
            "swell, fade, ripple and breathe, to protect a number. Design the show you",
            "think the song deserves.",
            "",
            "You can still bake and score your own plan - the commands are below and",
            "the numbers are useful for spotting something BROKEN, a rig stuck dark or",
            "every lamp moving as one body. Read them as a smoke test, not as a target,",
            "and ignore any of them you have a reason to.",
            "",
            "WRITE YOUR OWN EFFECTS IF THE CATALOGUE HAS NO WORD FOR IT",
            "",
            "The catalogue is a vocabulary, not a ceiling. If the move you want does",
            "not exist - two waves crossing, a lamp answering its neighbour a beat",
            "later, a fade that runs down the row - write it. Put it in `effects` at",
            "the top of plan.json and name it from a state, binding or gesture like",
            "any built-in. It is registered beside them, the validator accepts it, and",
            "a person opening the show in the editor sees a named effect with dials.",
            "",
            "    \"effects\": [{",
            "      \"id\": \"counterspin\",",
            "      \"kind\": \"binding\",          // state | binding | gesture",
            "      \"dimension\": \"place\",       // amount | colour | place | rate",
            "      \"dials\": {\"stream\": null, \"level\": 0.9, \"rest\": 0.08},",
            "      \"body\": \"function counterspin(params, ctx) { ... }\"",
            "    }]",
            "",
            "The body is a JS function evaluated with the venue helpers in scope as",
            "`H`. Return `{frames, loop_beats, per_fixture}` for something that plays",
            "a fixed figure, or add `binding: true` and `render(value, t)` for",
            "something that rides a stream frame by frame. `ctx` carries bpm, fps,",
            "restColour, and beatAt(t) for the MEASURED beat position.",
            "",
            "H gives you: PARS, HEADS, PAR_IDS, HEAD_IDS, INNER, OUTER, LEFT, RIGHT,",
            "ENDS, parsForExtent, emptyFrame, setPar(frame, par, colour, level),",
            "setHead(frame, head, {level, colour, pan, tilt, strobe, gobo, prism}),",
            "setParStrobe, parseColour, parseColours, clamp, framesPerBeat, easeLinear,",
            "easeInOut, easeSettle, easeCurve, hitEnv, swellEnv.",
            "",
            "Address lamps through PARS and the extents, never channel numbers - that",
            "is what keeps the same show working on a 16-lamp rig. Two rules the rig",
            "enforces regardless: the head's colour is a WHEEL with eight slots, and",
            "aiming it into the venue keep-out blacks it out.",
            "",
            "HOW THE RIG ACTUALLY BEHAVES",
            "",
            "Mechanics, not taste. These are things the hardware and the baker do,",
            "measured by rendering them, and knowing them saves you a surprise.",
            "",
            "  FLOORS ACCUMULATE, AND THIS IS THE TRAP. Every binding holds its lamps",
            "  at some resting level - follow has `floor`, accent/chase/ripple/alternate",
            "  /split have `rest`. Layers take the BRIGHTER value, so the effective",
            "  floor of a section is the HIGHEST floor among its bindings, not the one",
            "  you set on any single binding. Three bindings at floor 0.36, 0.44 and",
            "  0.52 give a lamp that can never fall below 0.52 - DMX 133 - for that",
            "  whole section, so a blackout written over it still leaves the rig lit",
            "  and the section never breathes.",
            "",
            "  Measured on the last show: sections carrying three bindings at floors",
            "  0.40-0.52 held every lamp above DMX 100 for 60 of 131 seconds. Each par",
            "  was genuinely dark 3% of the show where a hand-built one is dark 27%.",
            "  That difference is most of what makes a rig look alive: lamps that",
            "  SWITCH rather than lamps that dim.",
            "",
            "  So if you want a section to have any bottom, the lowest-floor binding",
            "  decides nothing - drop them all, or carry fewer layers there. A single",
            "  binding at floor 0 goes to black between phrases; four at 0.4 never do.",
            "",
            "  Layers composite by taking the BRIGHTER value per lamp. A pattern laid",
            "  under a brighter bed is invisible - the bed wins every lamp. If you want",
            "  a chase or a ripple to read, its level has to sit above whatever else",
            "  covers those lamps, or the bed has to come down.",
            "",
            "  Effects differ in how much of the rig they light. wash, breathe and",
            "  hold touch every lamp; chase and travelling looks light one or two at a",
            "  time; split and alternate light half. A 4-lamp rig makes a chase one",
            "  lamp, which is very little light - that may be exactly what you want in",
            "  a quiet passage, and is worth knowing before you put one on a climax.",
            "",
            "  A state holds for its whole section unless something departs from it.",
            "  Bindings move continuously; gestures are bounded and either return or",
            "  become the new resting look.",
            "",
            "  Sections cross over about a second. A binding starting at a section edge",
            "  crosses from whatever was lit before it. Gestures marked instant -",
            "  impact, blackout, cut, stab, strobe, flare, bump - do not cross, by",
            "  design, because a hit is a cut.",
            "",
            "  The head runs a COLOUR WHEEL, not RGB: it can show white, red, yellow,",
            "  blue, green, pink, orange or light blue, and nothing between them. It",
            "  also has a gobo wheel and a prism. Its pan and tilt are worth using -",
            "  the hand-built show swept the full pan range and moved the head in 59%",
            "  of frames.",
            "",
            "  The venue forbids the head throwing light into a range of pan angles;",
            "  aiming there blacks it out. The keep-out is listed with the rig above.",
            "",
            "PLACE CUES ON WHAT THE MUSIC DOES, NOT ON ITS LABELS",
            "",
            "Where a section is called `chorus` and the numbers under it say otherwise,",
            "follow the numbers and say so in the `why`. The section names come from a",
            "pop-song vocabulary that may not fit this music at all; the measurements",
            "under them are not in doubt.",
            "",
            "WHAT TO WRITE",
            "",
            "Write your show to `plan.json` in the working directory, as one JSON",
            "object with `plan`, `states`, `bindings` and `gestures`, exactly the shape",
            "the system prompt describes. Nothing else goes in that file.",
            "",
            "Every section index 0..N-1 needs exactly one state or it renders as",
            "darkness on the rig. Anchor every gesture to a moment, section or span",
            "that the brief already numbered - never compute a bar yourself.",
            "",
            "Then reply with one short paragraph on what you decided and why. The file",
            "is the deliverable; the reply is for the person reading the log.",
        ]
    )


def run_claude(work, brief, system_prompt, model, turns):
    cmd = [
        "claude",
        "-p",
        brief,
        "--append-system-prompt",
        system_prompt,
        "--allowed-tools",
        "Bash",
        "Read",
        "Write",
        "--permission-mode",
        "acceptEdits",
        "--max-turns",
        str(turns),
        "--model",
        model,
    ]
    r = subprocess.run(
        cmd,
        cwd=work,
        capture_output=True,
        text=True,
        timeout=5400,
        stdin=subprocess.DEVNULL,
    )
    return r.returncode, (r.stdout or "").strip(), (r.stderr or "").strip()


def read_plan(work):
    at = os.path.join(work, "plan.json")
    if os.path.isfile(at):
        with open(at) as f:
            return json.load(f)
    return None


def compose(song, model=None, hub=None, turns=90, keep=False, notes=None):
    model = model or DEFAULT_MODEL
    if hub:
        C.HUB = hub.rstrip("/")
    hub = C.HUB

    catalog = json.load(open(C.CATALOG_FILE))["effects"]
    system_prompt = (
        open(C.PROMPT_FILE)
        .read()
        .replace("{effects_block}", C.build_effects_block(catalog))
    )
    overview = C.fetch_overview(song)

    work = os.path.join(WORK, f"{song}.claude")
    if os.path.isdir(work) and not keep:
        shutil.rmtree(work)
    os.makedirs(work, exist_ok=True)

    brief = brief_for(song, overview, C.build_effects_block(catalog), hub)
    if notes:
        brief = brief + "\n\n" + notes
    with open(os.path.join(work, "brief.md"), "w") as f:
        f.write(brief)

    code, out, err = run_claude(work, brief, system_prompt, model, turns)
    plan = read_plan(work)
    if plan is None:
        block = re.search(r"\{[\s\S]*\}", out or "")
        if block:
            try:
                plan = json.loads(block.group(0))
            except json.JSONDecodeError:
                plan = None
    if plan is None:
        raise RuntimeError(
            f"the composer wrote no plan.json (exit {code})\n"
            f"--- stdout ---\n{out[-1500:]}\n--- stderr ---\n{err[-800:]}"
        )

    cleaned, report = validate(plan, catalog, overview)
    return cleaned, report, overview, out, work


def main():
    ap = argparse.ArgumentParser(description="Compose a lighting show with Claude")
    ap.add_argument("song")
    ap.add_argument("--hub", default=C.HUB)
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--turns", type=int, default=90)
    ap.add_argument("--notes", default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--keep", action="store_true")
    args = ap.parse_args()

    print(f"composing '{args.song}' with claude ({args.model})...", flush=True)
    plan, report, overview, said, work = compose(
        args.song, model=args.model, hub=args.hub, turns=args.turns, keep=args.keep,
        notes=(open(args.notes).read() if args.notes and os.path.exists(args.notes) else None)
    )

    print(format_report(report))
    print(f"\nplan: {plan.get('plan', '(none)')}")
    print(
        f"states:   {len(plan.get('states', []))} of {len(overview.get('sections') or [])} sections"
    )
    print(f"bindings: {len(plan.get('bindings', []))}")
    print(f"gestures: {len(plan.get('gestures', []))}")
    if said:
        print(f"\nthe composer says:\n{said[-1200:]}")

    out = args.out or os.path.join(WORK, f"{args.song}.plan.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        json.dump(plan, f, indent=1)
    print(f"\nwrote -> {out}\nworkings in {work}")


if __name__ == "__main__":
    main()
