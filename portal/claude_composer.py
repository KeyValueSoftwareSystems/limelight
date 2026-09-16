#!/usr/bin/env python3
import argparse
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
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
    flags = [i for i, b in enumerate(sc.get("beats") or [])
             if isinstance(b, dict) and b.get("downbeat")]
    phase = (flags[0] % bpb) if flags else 0
    rows = []
    for bar in range((len(beats) - phase) // bpb):
        i0 = phase + bar * bpb
        t0 = beats[i0]
        t1 = beats[min(len(beats) - 1, i0 + bpb)]
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


def stream_table(song):
    try:
        import composer as C
        sc = C._score_of({"_song": song})
    except Exception:
        return []
    fine = sc.get("stems_fine") or sc.get("stems_temporal") or {}
    lanes = fine.get("stems") or {}
    rows = []
    for name, ser in lanes.items():
        vals = [v for v in (ser or []) if isinstance(v, (int, float))]
        if not vals:
            continue
        vals_sorted = sorted(vals)
        n = len(vals_sorted)
        p50 = vals_sorted[n // 2]
        p90 = vals_sorted[min(n - 1, int(n * 0.90))]
        peak = vals_sorted[-1]
        above = 100.0 * sum(1 for v in vals if v > 0.5) / n
        rows.append((name, p50, p90, peak, above))
    rows.sort(key=lambda r: -r[4])
    return rows


def rig_shape(rig="arc4-head"):
    try:
        r = subprocess.run(["node", "-e",
                            "console.log(require(%r).describe(process.argv[1]).join('\\n'))"
                            % os.path.join(REPO, "portal", "rig.js"), rig],
                           capture_output=True, text=True, timeout=60)
        return [ln for ln in (r.stdout or "").splitlines() if ln.strip()]
    except Exception:
        return []


def filmstrip(rig="arc4-head"):
    try:
        r = subprocess.run(["node", os.path.join(REPO, "portal", "filmstrip.js"), rig, "32"],
                           capture_output=True, text=True, timeout=120)
        return [ln for ln in (r.stdout or "").splitlines() if ln.strip()]
    except Exception:
        return []


def ink_table(rig="arc4-head"):
    try:
        r = subprocess.run(["node", os.path.join(REPO, "portal", "ink.js"), rig],
                           capture_output=True, text=True, timeout=120)
        return [ln for ln in (r.stdout or "").splitlines() if ln.strip()]
    except Exception:
        return []


def peak_table(song):
    try:
        import composer as C
        sc = C._score_of({"_song": song})
    except Exception:
        return []
    rows = []
    ac = sc.get("acoustic") or {}
    loud = ac.get("loudness") or []
    w = ac.get("window_s") or 0.5
    if loud:
        i = max(range(len(loud)), key=lambda k: loud[k])
        rows.append(("the recording itself", i * w, "loudest 0.5s window"))
        top = sorted(range(len(loud)), key=lambda k: -loud[k])[:8]
        lo, hi = min(top) * w, max(top) * w
        rows.append(("  its loudest 8 windows", None, f"{lo:.0f}s to {hi:.0f}s"))
    em = sc.get("emotion") or []
    best = None
    for e in em:
        if isinstance(e, dict) and isinstance(e.get("energy"), (int, float)):
            if best is None or e["energy"] > best["energy"]:
                best = e
    if best:
        t = best.get("t", best.get("start"))
        if isinstance(t, (int, float)):
            rows.append(("measured emotion", t, f"energy {best['energy']}"))
    for m in (sc.get("moments") or []):
        if not isinstance(m, dict):
            continue
        k = str(m.get("kind", "")).lower()
        if "peak" in k or "climax" in k or "drop" in k:
            if isinstance(m.get("t"), (int, float)):
                rows.append((f"moments[] {k}", m["t"], m.get("what", "")))
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
            "You are designing every second of this song. Not a rule applied over a",
            "section, not a pattern repeated because it fits - a decision about what",
            "this room should look like at each moment, and why that serves the music.",
            "A show is judged the way a person watches it: a few dead seconds and it",
            "is gone, however good the average is.",
            "",
            "Nothing below is a rule. Everything below is something that was measured,",
            "usually because a previous show got it wrong and someone watching said so.",
            "The mechanics sections describe what the hardware and the renderer will",
            "actually do with what you write, so that you are not surprised. The taste",
            "is entirely yours: which effects, which colours, how often, how still, how",
            "violent. If a measurement here points one way and the song points another,",
            "follow the song and say why in the `why` field.",
            "",
            "What has gone wrong before, in the words of the person watching: the lights",
            "flash with no meaning, they do not coordinate, nothing lands on the beat,",
            "there is no tempo or rhythm to it, it feels like a machine following rules,",
            "and a broken streetlight would be no worse. Every one of those was true of",
            "a show that passed every automated check.",
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
            "WHAT EACH STREAM CAN ACTUALLY DRIVE",
            "",
            "show's shape. Every lane touches 1.00 at least once, so peak tells you",
            "nothing; median and above.5 are what decide whether a lane can carry the",
            "light. A lane with median 0.01 and above.5 of 0.8% is silent almost all",
            "the time - bind the amount of light to it and you get a near-black show",
            "that reads as a bug, however you set the dials. Those lanes are still",
            "worth having: they are precise, so they are good for accents, for colour",
            "changes, or for picking which lamp moves. Lanes with a high median can",
            "carry continuous brightness. A name not on this list does not exist, and",
            "",
            "This table is about AMOUNT of light and nothing else. beat, downbeat and",
            "bar are not on it because they are not lanes - they are the grid, and they",
            "are how light lands ON the beat rather than merely near it. A show with no",
            "against a 22.1% null, which is below chance: it had stopped being in time",
            "with the song at all. Use the lanes for what the band is doing and the grid",
            "for when it is doing it; most sections want one of each, not one or the",
            "other.",
            "",
            *[f"  {nm:18s} median {a:.2f}  p90 {b:.2f}  peak {c:.2f}  above.5 {d:4.1f}%"
              for nm, a, b, c, d in stream_table(song)[:18]],
            "",
            "WHAT EACH EFFECT PUTS ON THE RIG",
            "",
            "Measured by rendering every effect on its own at default dials. ink is",
            "the share of lamps it lights, differ is how often the lamps are doing",
            "different things from each other, peak is the brightest any lamp gets.",
            "",
            *ink_table(rig),
            "",
            "WHAT EACH ONE LOOKS LIKE",
            "",
            "Each strip is four beats of that effect on every lamp and the head,",
            "left to right, at its default dials. ' ' is off and '@' is full. This is",
            "the effect itself, not a guess at it - a travelling bump reads as a",
            "diagonal, a unison flash as a vertical edge, a breather as a slow swell.",
            "",
            *filmstrip(rig),
            "",
            "Two things measured on the last show, both of which a person watching",
            "named before any number did:",
            "",
            "  NOTHING TRAVELLED. Every neighbouring pair of lamps moved at a lag of",
            "  exactly 0.000s - the whole rig rising and falling at the same instant",
            "  all show. Symmetry was there (the outer pair matched 82% of the time)",
            "  but flow was not, and four lamps flashing in lockstep reads as one lamp",
            "  however many there are. `stagger` on drive and breakdown delays each",
            "  lamp by a fraction of a beat across the rig, and pulse travels already.",
            "",
            "  NOTHING RESTED. Colour on a lamp held for a median of 0.42s, 220",
            "  separate holds in a two-minute song. A look that is never kept cannot",
            "  be recognised, and a change means nothing when the last one was half a",
            "  second ago. Hold a look across a phrase and change it when the music",
            "  does.",
            "",
            "rig-lifts/beat is how many times a second of that effect raises the WHOLE",
            "rig by more than 30 of 255. It is the difference between a room that",
            "breathes and a room that flickers. A hand-built show for a two-minute song",
            "lifts the whole rig 33 times end to end - roughly once every four seconds,",
            "each one a deliberate event. A show built mostly from effects at 4 or 5",
            "lifts per beat does it 299 times, which is nine times as often and reads",
            "as a fault in the rig rather than a decision. Effects at 0.0 hold still:",
            "they are how a look is held so that the next lift means something.",
            "",
            "Read the two columns together and the shape of the catalog is plain:",
            "almost nothing is both bright and varied. Everything at ink 1.00 moves",
            "the rig as one body (differ 0%), and everything that genuinely differs",
            "lights at most 42% of it. trade is the one exception, ink 1.00 at differ",
            "98%. So a loud section wanting texture needs TWO layers - a full-ink bed",
            "carrying the room and a varied pattern over it - while a quiet section",
            "wants one. A chase on a 4-lamp rig is one lit lamp: at the climax that",
            "empties the room, and in a quiet passage it is the whole idea.",
            "",
            "WHERE THIS SONG IS LOUDEST, AND WHERE THE SIGNALS DISAGREE",
            "",
            *[f"  {nm:24s} {'' if t is None else f'{t:7.1f}s'}  {note}"
              for nm, t, note in peak_table(song)],
            "",
            "These are separate measurements of the same question and they do not",
            "always agree. When they disagree, the recording's own loudness is the one",
            "to trust for deciding when the rig should be brightest - it is the thing",
            "an audience is standing in front of. A show whose brightest moment sits",
            "somewhere other than the song's own loudest passage reads as out of step",
            "with it, however well the rest is built.",
            "",
            "moments[] is still the best thing in the score for saying WHAT an event",
            "is - an entrance, an exit, a register shift. Use it for that. Do not use",
            "it alone to decide when the show should be bright.",
            "",
            "HOW THIS IS DONE ON A REAL DESK",
            "",
            "Design this the way a lighting designer would, and the rest of the brief",
            "is there so you are not guessing: what the song does, what each effect",
            "looks like, and what the hardware will do with your plan.",
            "",
            "This rig:",
            "",
            *rig_shape(rig),
            "",
            "A designer treats the lamps as groups rather than as one row, and moves",
            "light across them - a figure that starts at one end and arrives at the",
            "other, one group answering another, the head leading or following. `extent`",
            "selects a group: all, inner, outer, left, right, ends, single - where",
            "single is the rig's centre, one lamp if the count is odd and the middle",
            "pair if it is even. Lamps doing unrelated things is not coordination, and",
            "neither is all of them doing the same thing. On a symmetric row a lamp",
            "acting alone reads as a fault rather than a choice, so it is worth",
            "spending deliberately and briefly.",
            "",
            "A designer builds a CUE LIST against the song's landmarks: intro, verse,",
            "pre, chorus, bridge, breakdown, drop, outro. Each cue is a look with a",
            "fade time and a trigger. Cues carry the architecture - arrivals,",
            "transitions, blackouts - and CHASES carry motion and energy inside them.",
            "A chase is parameter-driven and runs at a musical rate; it is not the",
            "audio turned into brightness.",
            "",
            "Coherence comes from PALETTES. A designer fixes a handful of colours,",
            "positions and beam looks at the start and reuses them all night, so when",
            "a chorus comes round again it is recognisably the same chorus. Picking a",
            "fresh colour for every cue is what makes a show look arbitrary. Decide",
            "your palette for this song first, then spend it.",
            "",
            "Energy is shaped, not tracked: builds climb, breakdowns empty the room,",
            "the drop is where everything arrives at once. You cannot be loud",
            "throughout - the big look only reads as big if the room was smaller a",
            "moment ago.",
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
            "WRITE YOUR OWN EFFECTS IF THE CATALOGUE HAS NO WORD FOR IT",
            "",
            "The catalogue is a vocabulary, not a ceiling. If the move you want does",
            "not exist - two waves crossing, a lamp answering its neighbour a beat",
            "later, a fade that runs down the row - write it. Put it in `effects` at",
            "any built-in. It is registered beside them, the validator accepts it, and",
            "a person opening the show in the editor sees a named effect with dials.",
            "",
            "    \"effects\": [{",
            "      \"id\": \"counterspin\",",
            "      \"dimension\": \"place\",       // amount | colour | place | rate",
            "      \"dials\": {\"stream\": null, \"level\": 0.9, \"rest\": 0.08},",
            "      \"body\": \"function counterspin(params, ctx) { ... }\"",
            "    }]",
            "",
            "The body is a JS function evaluated with the venue helpers in scope as",
            "`H`. Return `{frames, loop_beats, per_fixture}` for something that plays",
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
            "  the waveform moves rather than when the music does. Six of them in a",
            "  plan of 111 cost 14 points of beat alignment and 13 points of darkness:",
            "",
            "      with none         65.4% on a beat, all lit 54.1%",
            "      hand-built ref    81.3% on a beat, all lit 60.7%",
            "",
            "  song wants something genuinely continuous under it is yours to judge.",
            "",
            "  at some resting level - follow has `floor`, accent/chase/ripple/alternate",
            "  /split have `rest`. Layers take the BRIGHTER value, so the effective",
            "  0.52 give a lamp that can never fall below 0.52 - DMX 133 - for that",
            "  whole section, so a blackout written over it still leaves the rig lit",
            "  and the section never breathes.",
            "",
            "  0.40-0.52 held every lamp above DMX 100 for 60 of 131 seconds. Each par",
            "  was genuinely dark 3% of the show where a hand-built one is dark 27%.",
            "  That difference is most of what makes a rig look alive: lamps that",
            "  SWITCH rather than lamps that dim.",
            "",
            "  decides nothing - drop them all, or carry fewer layers there. A single",
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
            "  become the new resting look.",
            "",
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
            "WHAT TO WRITE",
            "",
            "Write your show to `plan.json` in the working directory, as one JSON",
            "object with `plan`, `palette`, `states`, `gestures`, and `effects` if you",
            "wrote any of your own. A state is a look that holds; a gesture is a cue",
            "that happens - a hit, a transition, a blackout, or a chase running over a",
            "span. Nothing else goes in that file.",
            "",
            "Every section index 0..N-1 needs at least one state. A state with only",
            "a `section` covers that whole section, so one per section gives a rig",
            "that is lit from the first bar to the last - which is what every show",
            "so far has done, and it is the main thing that makes them boring.",
            "",
            "A state can instead occupy PART of its section. Give it any of",
            "`from_moment`, `to_moment`, `after_beats` or `for_beats` and it starts",
            "or ends there instead of at the section edge. Where no state covers,",
            "the rig is dark - really dark, not dim - and that is allowed. It is",
            "how a PAR behaves: they go out, often, and for whole phrases.",
            "",
            "One state per section is one look held for a whole section, and a rig",
            "that never goes out reads as broken however good the cues are. A designer",
            "changes the resting look far more often than that, and a good share of",
            "those looks have part of the rig dark.",
            "",
            "One more thing the gamma hides: DMX 12 is not off. The emulator draws it",
            "at 15% brightness, which reads as a lit lamp. Off means 0.",
            "",
            "PUT THE SHOW ON THE GRID",
            "",
            "Anchor a gesture with `at_bar` (and optionally `at_beat`, default 1),",
            "or across a span with `from_bar`/`to_bar`. A state takes the same, plus",
            "`from_moment`/`to_moment` and `after_beats`/`for_beats`. Bar numbers are",
            "the ones in the table above.",
            "",
            "A cue can also sit on a measured moment, or at an absolute second with",
            "`at_s` / `from_s` / `to_s`. Moments mark what the song does; the bar grid",
            "marks when. A show built only on moments can place a cue only where",
            "something was detected, which on most songs is a few dozen places.",
            "",
            "Do not compute a bar's time yourself - give the bar number and let the",
            "baker place it.",
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
        "--restricted",
        "--output-format",
        "stream-json",
        "--verbose",
    ]
    t0 = time.time()
    events = os.path.join(work, "events.jsonl")
    out_lines, text_out = [], []
    with open(events, "w") as log:
        proc = subprocess.Popen(cmd, cwd=work, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True,
                                stdin=subprocess.DEVNULL, bufsize=1)
        try:
            for line in proc.stdout:
                log.write("%.3f %s" % (time.time() - t0, line))
                log.flush()
                out_lines.append(line)
                try:
                    ev = json.loads(line)
                except Exception:
                    continue
                if ev.get("type") == "result" and ev.get("result"):
                    text_out.append(str(ev["result"]))
            proc.wait(timeout=5400)
        except subprocess.TimeoutExpired:
            proc.kill()
            return 124, "\n".join(text_out), "timed out"
    err = proc.stderr.read() if proc.stderr else ""
    return proc.returncode, ("\n".join(text_out) or "".join(out_lines)).strip(), (err or "").strip()


def timing_report(work):
    """Where the wall clock went: one line per tool, plus the turn count."""
    at = os.path.join(work, "events.jsonl")
    if not os.path.isfile(at):
        return []
    turns, tools, last = 0, {}, 0.0
    gaps = []
    for line in open(at):
        try:
            stamp, rest = line.split(" ", 1)
            t = float(stamp)
            ev = json.loads(rest)
        except Exception:
            continue
        if ev.get("type") == "assistant":
            turns += 1
            gaps.append(t - last)
            last = t
        for blk in (ev.get("message") or {}).get("content") or []:
            if isinstance(blk, dict) and blk.get("type") == "tool_use":
                nm = blk.get("name", "?")
                cmd = ((blk.get("input") or {}).get("command") or "")[:40]
                key = nm + (":" + cmd.split()[0] if nm == "Bash" and cmd else "")
                tools[key] = tools.get(key, 0) + 1
        if ev.get("type") == "result":
            last = t
    lines = ["  turns: %d over %.0fs" % (turns, last)]
    if gaps:
        gaps_sorted = sorted(gaps)
        lines.append("  per-turn wall: median %.1fs  p90 %.1fs  max %.1fs"
                     % (gaps_sorted[len(gaps_sorted) // 2],
                        gaps_sorted[int(len(gaps_sorted) * 0.9)], gaps_sorted[-1]))
    for k, v in sorted(tools.items(), key=lambda kv: -kv[1])[:10]:
        lines.append("  %-28s %d calls" % (k, v))
    return lines


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

    # The composer works OUTSIDE the repository. Claude Code keys its memory and
    # project settings to the working directory, so a cwd inside this tree hands
    # the composer sixteen files of one engineer's notes -- head keep-outs, check
    # definitions, things learned while debugging the baker -- as its starting
    # context. Those are not a lighting designer's context, and reading them cost
    # the first forty seconds of every run. From outside the tree it starts clean
    # and is told what it needs by the brief.
    work = os.environ.get("LL_COMPOSER_DIR") or os.path.join(
        tempfile.gettempdir(), "limelight-compose", f"{song}.claude")
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
    rep = timing_report(work)
    if rep:
        print("\nwhere the time went:")
        for line in rep:
            print(line)
    print(f"\nwrote -> {out}\nworkings in {work}")


if __name__ == "__main__":
    main()
