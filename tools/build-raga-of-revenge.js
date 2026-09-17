#!/usr/bin/env node
/* Raga of Revenge on arc4-head -- the whole show from one set of rules, every anchor read from the score. */
const fs = require("fs");
const out = "portal/showfiles/raga-of-revenge.show.json";
const prev = JSON.parse(fs.readFileSync(out, "utf8"));
const sc = JSON.parse(fs.readFileSync("hub/files/score/raga-of-revenge.score", "utf8"));
const RED = "#e01313", BLUE = "#2f5bff", WHITE = "#ffffff", AMBER = "#ff8a1a";
const B = sc.beats.map(b => b.t), DOWN = sc.beats.filter(b => b.downbeat).map(b => b.t);
const bar = n => DOWN[n - 1];                                   // downbeat of bar n (1-based, as the editor shows them)
const beatAfter = t => B.find(b => b >= t - 0.03);
const before = (h, n) => B[B.findIndex(b => b >= h - 0.03) - n];
const secIdx = t => { const i = sc.sections.findIndex(s => t >= s.start - 1e-6 && t < s.end); return i < 0 ? sc.sections.length - 1 : i; };
const r2 = x => Math.round(x * 1000) / 1000;
const PARK = [0.663, 0.498];                                    // where the head sits through a blackout

const states = [], G = [];
/* a state is clamped by the baker to the section it names, so a bed that crosses a
   section boundary is cut into one piece per section -- otherwise the tail past
   the boundary (or a bed that starts a few ms before it) is silently lost. */
const bed = (from_s, to_s, effect, patch, why) => {
  const pieces = sc.sections.map((s, i) => [Math.max(from_s, s.start), Math.min(to_s, s.end), i]).filter(([a, b]) => b - a > 0.02);
  pieces.forEach(([a, b, i], k) => states.push({ effect, extent: "all", head: false, ...patch, section: i, from_s: r2(a), to_s: r2(b), why: k === 0 ? why : why + " (continued across the section line)" }));
};
const wash = (a, b, amount, colour, why, fade = 500) => bed(a, b, "wash", { amount, colour, fade_ms: fade }, why);
const drive = (a, b, floor, colours, why, extra = {}) => bed(a, b, "drive", { colours, floor, peak: 1, ...extra }, why);
const row = (colour, amount, extent, from_s, to_s, extra, why) => G.push({ effect: "glare", colour, amount, extent, from_s: r2(from_s), to_s: r2(to_s), fade_ms: 450, head: false, ...extra, why });
const hit = (colour, at_s, beats, why, amount = 1) => G.push({ effect: "glare", colour, amount, extent: "all", at_s: r2(at_s + 0.005), for_beats: beats, fade_ms: 0, head: false, why });
const impact = (at_s, why) => G.push({ effect: "impact", colour: WHITE, extent: "all", at_s: r2(at_s), for_beats: 2, fade_ms: 0, head: false, why });
/* a drop LANDS when it is the brightest thing in the sequence and stays for a beat:
   the impact's burst, a full white beat held under it, and the head at full,
   strobing, from the spot the blackout parked it. Everything before it (the
   flicks) is dimmer on purpose. */
const land = (at_s, why) => {
  impact(at_s, why);
  G.push({ effect: "glare", colour: WHITE, amount: 1, extent: "all", from_s: r2(at_s + 0.003), to_s: r2(beatAfter(at_s + 0.3)), fade_ms: 0, head: false, why: "…held full white for the whole first beat." });
  G.push({ effect: "beam", pattern: "hold", pan: PARK[0], tilt: PARK[1], colour: WHITE, amount: 1, prism: 100, strobe: 20, strobe_on: "always", from_s: r2(at_s), to_s: r2(beatAfter(at_s + 0.3)), fade_ms: 0, why: "…and the head at full, white, strobing, for that beat." });
  hp = PARK.slice();
};
const black = (a, b, why) => G.push({ effect: "blackout", from_s: r2(a), to_s: r2(b), fade_ms: 0, why });
const run = (t, dir, why) => G.push({ effect: "trade", travel: true, direction: dir, runs: 1, rest: 0.3, peak: 1, colours: [RED, BLUE], from_s: r2(t), to_s: r2(t + 0.5), for_beats: 1, fade_ms: 0, head: false, why });
const walk = (a, b, dir, why) => G.push({ effect: "chase", direction: dir, per_beat: 0.25, step: true, colour: RED, amount: 1, rest: 0, extent: "all", from_s: r2(a), to_s: r2(b), fade_ms: 0, head: false, why });
/* the sudden transition: a hard RED flick on every syllable / note the score gives -- red on black, so the white impact that follows reads as the explosion in [a, b), or on the eighth notes if the voice is not there */
const flicks = (a, b, why) => {
  let ts = sc.melody.filter(n => n.start >= a && n.start < b - 0.1 && n.velocity >= 0.3).map(n => n.start).sort((x, y) => x - y)
    .filter((t, i, arr) => i === 0 || t - arr[i - 1] >= 0.1);
  if (ts.length < 3) { ts = []; for (let t = beatAfter(a); t < b - 0.1; t += 0) { ts.push(t); const nb = B.find(x => x > t + 0.01); if (!nb) break; ts.push((t + nb) / 2); t = nb; } ts = ts.filter(t => t >= a && t < b - 0.1); }
  ts.forEach((t, i) => {
    G.push({ effect: "glare", colour: RED, amount: 0.9, extent: "all", from_s: r2(t), to_s: r2(t + 0.10), fade_ms: 0, head: false, why: i === 0 ? why : "…" });
    G.push({ effect: "beam", pattern: "hold", pan: PARK[0], tilt: PARK[1], colour: RED, amount: 0.8, prism: 0, strobe: 0, from_s: r2(t), to_s: r2(t + 0.10), fade_ms: 0, why: i === 0 ? "The head flicks with the row, from where the blackout parked it." : "…" });
  });
  return ts;
};
/* the head: a chain of holds and glides; every cue starts where the last one left the head */
let hp = [0.30, 0.40];
const headHold = (a, b, colour, amount, extra, why) => { G.push({ effect: "beam", pattern: "hold", pan: hp[0], tilt: hp[1], colour, amount, prism: 0, strobe: 0, from_s: r2(a), to_s: r2(b), fade_ms: 0, ...extra, why }); };
const glide = (a, b, to, colour, amount, extra, why) => { G.push({ effect: "beam", pattern: "glide", pan: hp[0], tilt: hp[1], pan_to: to[0], tilt_to: to[1], colour, amount, prism: 0, strobe: 0, from_s: r2(a), to_s: r2(b), fade_ms: 0, ...extra, why }); hp = to; };
const parked = () => { hp = PARK.slice(); };
const DROPHEAD = { prism: 100, strobe: 10, strobe_on: "downbeat" };
const L = 0.20, R = 0.80, C = 0.50;

/* ======================= OPENING (bars 1-6, 0-17.75) ======================= */
wash(0, 9.11, 0.26, BLUE, "The room is lit from the first note: a low blue on all four lamps.", 600);
wash(9.11, 17.75, 0.34, BLUE, "Bars 4-6: the blue bed comes up a step where the score marks the build.", 600);
row(BLUE, 0.5, "inner", 1.76, 8.49, { rise: 0.5 }, "First vocal phrase (1.76-8.49 in the score): the inner pair lifts slowly through the line.");
row(WHITE, 0.6, "all", before(13.83, 2), 13.83, { rise: 0.9, fade_ms: 0 }, "Two beats before the entrance the row swells white from the bed to full, so the hit at 13.83 is the top of a rise already under way.");
hit(WHITE, 13.83, 1, "The entrance at 13.83: one white beat at the top of the swell.", 0.9);
row(BLUE, 0.5, "inner", 15.90, 17.22, { rise: 0.4 }, "Third vocal phrase (15.90-17.22): the inner pair lifts again, into the tempo change at 17.75.");
headHold(0, 12.83, WHITE, 0.25, {}, "Opening: a dim white pin, still. The head at rest is what makes its first move an event.");
glide(12.83, 13.83, [0.72, 0.44], WHITE, 0.30, {}, "The entrance: one smooth move to a new spot over the two beats of the swell, arriving exactly on 13.83.");
headHold(13.83, 25.56, WHITE, 0.30, {}, "Bars 4-10: still at its new spot.");
/* ======================= BRASS STABS (bars 7-10, 17.75-25.56) ======================= */
wash(17.75, 25.56, 0.36, BLUE, "Bars 7-10: a steady blue bed; the brass carries the rhythm and amber carries the brass.", 600);
row(AMBER, 0.7, "outer", 18.18, 18.68, { fade_ms: 0 }, "Bar 7: the horns punch just before beat 2 -- amber on the outer pair for one beat. Amber belongs to the brass.");
row(AMBER, 0.85, "outer", 20.23, 20.73, { fade_ms: 0 }, "Bar 8: the same punch, heavier, brighter.");
row(AMBER, 1, "outer", 22.40, 23.78, { rise: 0.9, fade_ms: 300 }, "Bar 9: the horns climb instead of punching; the outer pair swells amber with them into bar 10.");
row(AMBER, 0.9, "all", 24.70, 25.56, { rise: 1.2, fade_ms: 300 }, "Bar 10: timpani and violins swell for the last beat and a half; the whole row swells amber into the hit.");
hit(AMBER, 25.56, 2, "The hit at 25.56 where the song changes section: full amber for two beats. Then amber is gone until the outro.");
/* ======================= LEAD-IN (bars 11-14, 25.56-33.75) ======================= */
bed(25.56, 33.75, "wash", { amount: 0.36, colour: BLUE, extent: "inner", fade_ms: 600 }, "Bars 11-14: the inner pair holds blue under the voice alone.");
row(BLUE, 0.55, "outer", 27.02, before(33.75, 3), { rise: 0.7 }, "The lead-in phrase (27.02-33.75): the outer pair grows with the singer for six seconds.");
row(WHITE, 0.6, "all", before(33.75, 3), before(33.75, 1), { rise: 0.9, fade_ms: 0 }, "Two beats before the riff, over the pause the score marks at 33.0, the row swells white.");
black(before(33.75, 1), 33.75, "One beat of nothing before the riff lands.");
headHold(25.56, before(33.75, 1), WHITE, 0.22, { fade_ms: 900 }, "Bars 11-14: dimming to a glow under the voice alone; off in the black beat.");
parked();
/* ======================= THE BUILD (bars 15-22, 33.75-49.75) =======================
   What an audience feels as a build is ACCELERATION: the whole room pulsing, the
   pulse doubling -- quarter notes, then eighths, then sixteenths -- and everything
   a step brighter every bar, until the cut. The riff is an eighth-note bass line
   with its heaviest note on beat 1 and its off-beats pushed late (the score puts
   them at 0.56 of the beat), so the eighths land where the music pushes them. */
hit(WHITE, 33.75, 1, "The riff lands: one white beat.");
const barLen = b => bar(b + 1) - bar(b);
const PUSH = 0.56;                                               // where this song's "and" sits inside the beat
const pulse = (t, len, colour, amount, extent, why) => G.push({ effect: "glare", colour, amount, extent, from_s: r2(t), to_s: r2(t + len), fade_ms: 0, head: false, why });
const level = b => 0.55 + (b - 15) * 0.075;                      // bar 15: 0.55 ... bar 21: 1.0
/* the bed under the pulses climbs a step every bar */
for (let b = 15; b <= 21; b++) wash(bar(b), bar(b + 1), 0.10 + (b - 15) * 0.06, BLUE, b === 15 ? "Bars 15-21: a blue floor that climbs a step every bar under the pulses." : "…", 300);
for (let b = 15; b <= 21; b++) {
  const a0 = bar(b), q = barLen(b) / 4, amt = level(b);
  for (let k = 0; k < 4; k++) {
    const t = a0 + k * q;
    if (b >= 19 && k === 0) { hit(WHITE, t, 0.5, b === 19 ? "Phrase two: half a beat of white on every downbeat, the heaviest note of the riff." : "…", 0.95); }
    else if (b <= 18) pulse(t, q * 0.55, RED, amt, "all", b === 15 && k === 0 ? "Bars 15-18, quarter notes: the whole row pulses red on every beat, a step brighter every bar, over the climbing blue floor." : "…");
    else if (b <= 20) pulse(t, q * 0.45, RED, amt, "inner", b === 19 && k === 1 ? "Bars 19-20, eighth notes: the inner pair takes the beats..." : "…");
    if (b >= 17 && b <= 18 && (k === 1 || k === 3)) pulse(t + q * PUSH, q * 0.35, RED, amt * 0.75, "inner", b === 17 && k === 1 ? "Bars 17-18: the pushed off-beats join (at 0.56 of the beat, where the score hears them), on the inner pair, dimmer -- the pulse begins to double." : "…");
    if (b >= 19 && b <= 20) pulse(t + q * PUSH, q * 0.4, BLUE, amt, "outer", b === 19 && k === 0 ? "...and the outer pair, blue, takes every pushed off-beat." : "…");
    if (b === 21) {                                               // sixteenths: red inner / blue outer alternating, all the way to the cut
      for (let j = (k === 0 ? 1 : 0); j < 4; j++) {
        const tt = t + q * (j === 2 ? PUSH : j / 4), inner = j % 2 === 0;
        pulse(tt, q * 0.2, inner ? RED : BLUE, 1, inner ? "inner" : "outer", k === 0 && j === 1 ? "Bar 21, sixteenths: red inner and blue outer in turn on every sixteenth, at full, the floor at its highest -- the fastest the room gets before the cut." : "…");
      }
    }
  }
}
/* the join: two red steps closing inwards on the F-E walk-down, cutting through the pulses */
row(RED, 1, "outer", 41.02, 41.30, { fade_ms: 0 }, "The joining piece: F at 41.02 -- the outer pair, red, full.");
row(RED, 1, "inner", 41.30, 41.75, { fade_ms: 0 }, "E at 41.30 -- the inner pair, red. The steps close inwards and phrase two lands on 41.76.");
/* the head across the build: slow across, faster back, then still and strobing */
glide(33.75, 41.75, [L, 0.45], WHITE, 0.40, { strobe: 12, strobe_on: "downbeat" }, "Riff phrase one: the head glides slowly across the room over the whole phrase (8 seconds), at 40%, with a strobe pop on each downbeat.");
glide(41.75, bar(21), PARK, WHITE, 0.55, { strobe: 12, strobe_on: "beat" }, "Riff phrase two: the head glides back over two bars to the spot the blackout will hold, brighter, popping on every beat.");
headHold(bar(21), bar(22), WHITE, 0.70, { strobe: 14, strobe_on: "beat" }, "Bar 21: the head holds and strobes on every beat as the room peaks.");
/* bar 22: the volume collapses, then "pa da ni sa ri", then the drop */
const syll = sc.melody.filter(n => n.start > 48.3 && n.start < 49.6 && n.velocity >= 0.4).map(n => n.start).sort((a, b) => a - b);
black(bar(22), 49.75, "Bar 22: the whole band falls away at 47.7 (the score's pause at 48.0) -- full blackout, head included, as the volume shrinks.");
flicks(syll[0] - 0.001, 49.75, "\"pa da ni sa ri\": a hard white flick on each of the six syllables the score hears at " + syll.map(t => t.toFixed(2)).join(", ") + " -- the sudden transitions -- with black between them, then the drop.");
parked();
/* ======================= DROP 1 (bars 23-29, 49.75-63.76) ======================= */
land(49.75, "Drop 1 lands: the impact.");
drive(49.75, bar(26), 0.80, [RED, BLUE], "Bars 23-25: the drop arrives. Red and blue trade bars on a high floor, a hit on every beat by its measured weight.");
hit(WHITE, 52.76, 1, "52.76, the score's climax moment: one white beat.");
glide(beatAfter(50.0), bar(25), [L, 0.50], RED, 0.70, DROPHEAD, "Drop 1: the head glides from one side of the room to the other over two bars -- a slow pendulum on the bar grid, prism on, a strobe pop on each downbeat. The same pendulum in every drop.");
glide(bar(25), bar(26), [C, 0.50], RED, 0.70, DROPHEAD, "…and to the centre for the singer.");
drive(bar(26), bar(29), 0.66, [BLUE, BLUE], "Bars 26-28: the bass drops out and the singer leads. The room turns blue and the pairs swap at half speed.", { every_beats: 2 });
hit(WHITE, bar(26), 1, "Bar 26, beat 1: one white beat marks the singer's entrance.");
[26, 27, 28].forEach((b, i) => run(bar(b) + (bar(b + 1) - bar(b)) * 0.75, i % 2 ? "rl" : "lr", i === 0 ? "Bars 26-28, beat 4: a fast red run across the blue room, the pickup into the next bar." : "…"));
glide(bar(26), bar(29), [C, 0.62], WHITE, 0.45, {}, "Bars 26-28: centre, white, 45%, rising slowly through the singer's bars.");
drive(bar(29), bar(30), 0.80, [RED, BLUE], "Bar 29: bass and drums return, hardest in the section. Red home, floor higher.");
hit(WHITE, bar(29), 1, "Bar 29, beat 1: one white beat as the bass and drums come back.");
glide(bar(29), bar(30), PARK, RED, 0.70, DROPHEAD, "Bar 29: back to red prism, gliding to the spot the blackout will hold.");
/* bar 30: the drums stop -- blackout, flicks, drop 2 */
black(bar(30), 65.75, "Bar 30: the drums stop dead -- blackout for the first two beats.");
flicks(before(65.75, 2), 65.75, "Bar 30, beats 3-4: white flicks on the voice's notes (the score's melody), then drop 2.");
parked();
/* ======================= DROP 2 + BACKBEAT + SILENT BAR (bars 31-39, 65.75-83.75) ======================= */
land(65.75, "Drop 2 lands.");
drive(65.75, before(73.75, 2), 0.76, [RED, BLUE], "Bars 31-34: drop 2. Red home, blue kicks, high floor.");
glide(beatAfter(66.0), bar(32), [L, 0.50], RED, 0.70, DROPHEAD, "Drop 2: the pendulum again, two bars a side.");
glide(bar(32), bar(34), [R, 0.50], RED, 0.70, DROPHEAD, "…");
glide(bar(34), bar(35), [C, 0.50], RED, 0.70, DROPHEAD, "…to the centre for the backbeat section.");
drive(before(73.75, 2), bar(35), 0.60, [RED, BLUE], "Bar 34, beats 3-4: the floor comes down a step on the way into the backbeat bars.");
drive(bar(35), bar(38), 0.45, [RED, BLUE], "Bars 35-37: the score shows a kick on every beat, heaviest on 2 and 4, drums thickening in bar 36, strings held. The same drive at a lower floor -- the drop breathing.");
glide(bar(35), bar(36), [0.25, 0.62], WHITE, 0.30, {}, "Bars 35-37: a slow figure through the backbeat bars -- down to the left, across and up to the right, back to the centre -- one bar a side, dim white.");
glide(bar(36), bar(37), [0.75, 0.38], WHITE, 0.30, {}, "…");
glide(bar(37), bar(38), [C, 0.50], WHITE, 0.30, {}, "…");
wash(bar(38), bar(39), 0.30, BLUE, "Bar 38: the whole band stops -- only the voice. A low blue floor.", 300);
row(WHITE, 0.6, "all", beatAfter(80.2), bar(39), { rise: 0.9, fade_ms: 0 }, "Bar 38 from beat 2, where the voice re-enters alone: the row climbs white for three beats and lands on the band's return at 81.76.");
glide(bar(38), bar(39), [C, 0.58], WHITE, 0.30, {}, "Bar 38: the head rises with the white climb.");
drive(bar(39), before(83.75, 2), 0.70, [RED, BLUE], "Bar 39, beats 1-2: the band is back.");
glide(bar(39), before(83.75, 2), PARK, RED, 0.70, DROPHEAD, "Bar 39: red prism, gliding to the parked spot.");
black(before(83.75, 2), 83.75, "Bar 39, beat 3: blackout as the score's build moment at 83.26 approaches.");
flicks(before(83.75, 1), 83.75, "Bar 39, beat 4: white flicks, then drop 3.");
parked();
/* ======================= DROP 3, BAR 45, RESOLVE (bars 40-48, 83.75-97.76) ======================= */
land(83.75, "Drop 3 lands.");
drive(83.75, bar(43), 0.80, [RED, BLUE], "Bars 40-42: drop 3, the highest floor of the three.");
hit(WHITE, 85.76, 1, "Bar 41, beat 1: one white beat.");
glide(beatAfter(84.0), bar(41), [L, 0.50], RED, 0.70, DROPHEAD, "Drop 3: the pendulum.");
glide(bar(41), bar(42), [R, 0.50], RED, 0.70, DROPHEAD, "…");
glide(bar(42), bar(43), PARK, RED, 0.70, DROPHEAD, "…to the parked spot before bar 43.");
wash(bar(43), 91.76, 0.38, BLUE, "Bar 43: the drums stop; a plain floor under the white climb.", 300);
row(WHITE, 0.85, "all", bar(43), before(91.76, 1), { rise: 0.35, fade_ms: 0 }, "Bar 43: the row climbs white for three beats into the resolve -- a release, not a drop, so it rises rather than flicks.");
black(before(91.76, 1), 91.76, "One black beat before the resolve.");
headHold(bar(43), before(91.76, 1), WHITE, 0.70, { strobe: 14, strobe_on: "beat" }, "Bar 43: the head holds and strobes on the beat under the climb.");
parked();
G.push({ effect: "impact", colour: WHITE, extent: "all", at_s: 91.76, for_beats: 1, fade_ms: 0, head: false, why: "The resolve lands: one beat of white." });
wash(91.76, bar(47), 0.40, BLUE, "The resolve: the brightest bed in the show under the colour wave.", 600);
[[92.26, "lr", 2, 2.0], [94.26, "rl", 2, 2.0], [96.26, "lr", 2, 2.0]].forEach(([t, dir, runs, len], i) => G.push({ effect: "trade", travel: true, direction: dir, runs, rest: 0.62, peak: 0.85, colours: [RED, BLUE], from_s: t, to_s: r2(t + len), for_beats: Math.round(len * 2), head: false, fade_ms: 0, why: i === 0 ? "The resolve: three slow colour waves, red over blue, two crossings each, turning round every two bars." : "…" }));
glide(91.76, bar(47), [C, 0.55], RED, 0.30, { fade_ms: 800 }, "The resolve: red, dim, drifting slowly to the centre under the waves.");
/* ======================= CLIMAX (bars 48-53, 97.76-109.76) ======================= */
drive(bar(47), 109.76, 0.80, [RED, WHITE], "The loudest twelve seconds on the record: red and white, the highest floor, a hit on every beat.");
G.push({ effect: "strobe", hz: 12, colour: WHITE, intensity: 1, extent: "all", head: false, at_s: 98.26, for_beats: 2, fade_ms: 0, why: "98.26: white strobe for two beats on the first big kick of the climax." });
G.push({ effect: "strobe", hz: 12, colour: WHITE, intensity: 1, extent: "all", head: false, from_s: 100.76, to_s: 102.25, for_beats: 3, fade_ms: 0, why: "100.76: white strobe for three beats up to the single black beat before the loudest kick in the song." });
black(102.25, 102.76, "One beat of nothing before the loudest kick.");
G.push({ effect: "glare", colour: RED, amount: 1, extent: "all", at_s: 102.76, for_beats: 4, rise: -0.5, fade_ms: 0, head: false, why: "102.76, the loudest kick: full red, falling away over four beats." });
const CH = { prism: 100, strobe: 12, strobe_on: "downbeat" };
glide(bar(47), bar(48), [L, 0.50], WHITE, 1.0, CH, "The climax: the pendulum at one bar a side, white prism at full, strobe pop on each downbeat -- the one place the head is the brightest thing in the room.");
glide(bar(48), bar(49), [R, 0.50], WHITE, 1.0, CH, "…");
glide(bar(49), 102.25, PARK, WHITE, 1.0, CH, "…to the parked spot for the black beat.");
parked();
glide(102.76, bar(50), [L, 0.50], WHITE, 1.0, CH, "…");
glide(bar(50), bar(51), [R, 0.50], WHITE, 1.0, CH, "…");
glide(bar(51), bar(52), [L, 0.50], WHITE, 1.0, CH, "…");
glide(bar(52), 109.76, [C, 0.50], WHITE, 1.0, CH, "…to the centre for the come-down.");
/* ======================= OUTRO (109.76-131.29) ======================= */
wash(109.76, 113.00, 0.34, AMBER, "The come-down: amber, the orchestra's colour from bars 7-10, returns as the room's colour.", 800);
row(AMBER, 0.55, "all", 109.76, 111.76, { rise: -0.9, fade_ms: 0 }, "The breakdown at 109.76: the room turns amber at the drive's level and falls over four beats to the come-down bed.");
wash(113.00, 113.50, 0.14, AMBER, "113.0: the score marks a pause and the band is at 3%; the room dips with it.", 200);
wash(113.50, 123.77, 0.34, AMBER, "The strings return; the amber bed with them.", 300);
row(AMBER, 0.6, "all", 113.75, 120.29, { rise: 1.0 }, "The strings enter at 113.75 and swell for six seconds; the room swells amber with them up to the register shift at 120.29.");
row(WHITE, 0.6, "all", 121.32, 123.77, { rise: 0.8 }, "The violins climb from 120.3; the room swells white into the last entrance.");
row(AMBER, 0.9, "all", 123.77, 126.00, { rise: 0.2 }, "The last entrance at 123.77 and the song's final peak at 124.5: amber, nearly full, held to where the band drops away at 126.");
wash(123.77, 127.61, 0.30, AMBER, "The last entrance: amber settles a step.", 600);
wash(127.61, 128.28, 0.22, AMBER, "The beat has gone; the room settles again.", 600);
black(127.23, 127.75, "One beat of nothing where the beat drops away, as the score marks the rhythm change.");
wash(128.28, 131.29, 0.06, AMBER, "The song ends in silence; the room fades to black with it.", 2500);
glide(109.76, 116.76, [0.10, 0.56], AMBER, 0.30, { fade_ms: 600 }, "The outro: one wide, slow sweep of the room in amber -- seven seconds to the far left...");
glide(116.76, 123.77, [0.90, 0.62], AMBER, 0.30, {}, "...seven seconds across to the far right as the strings swell...");
glide(123.77, 127.23, [C, 0.70], AMBER, 0.35, {}, "...and home to the centre, a touch brighter, for the last entrance. Off with the black beat at 127.23, and it stays off.");

/* ---- write ---- */
const start = g => g.at_s ?? g.from_s;
G.sort((a, b) => start(a) - start(b)); states.sort((a, b) => a.from_s - b.from_s);
const show = { ...prev, states, bindings: [], gestures: G };
fs.writeFileSync(out, JSON.stringify(show, null, 2) + "\n");
console.log("states", states.length, "gestures", G.length, "| devices:", [...new Set(G.map(g => g.effect + (g.pattern ? ":" + g.pattern : "")))].join(" "));
console.log("syllables:", syll.map(t => t.toFixed(2)).join(" "));
