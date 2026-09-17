/* rigs.test.js -- a show is {score, seed, edits} and the VENUE re-derives it, so
   the reader has to survive a change of layout. This pins the second rig
   (club12-2head), the resolution that lets any command address it, the wire's
   width and multi-head hold, and the end-to-end claim: the same score at the same
   seed on two different rigs puts the same music at the same seconds, and the
   bigger rig lights more of itself without dropping anything to darkness.
   Plain node idiom. */
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");
const drivers = require("./drivers/index.js");
const { groupsOf, enumerate, validateSequence } = require("./preflight.js");
const layouts = require("./layouts.js");
const wire = require("./wire.js");

const out = [];
const ok = (name, cond, detail) => out.push([!!cond, name, detail || ""]);

const CLUB = path.join(__dirname, "club12-2head.layout.json");

/* ---- the second rig is an honest rig ---------------------------------------- */
{
  const L = JSON.parse(fs.readFileSync(CLUB, "utf8"));
  const pars = L.fixtures.filter(f => f.type === "par7");
  const heads = L.fixtures.filter(f => f.type === "head13");

  ok("every fixture names a device type that has a driver",
     L.fixtures.every(f => { try { return !!drivers.forType(f.type); } catch (e) { return false; } }),
     [...new Set(L.fixtures.map(f => f.type))].join(","));
  ok("a small-club count: 12 par7 and 2 head13",
     pars.length === 12 && heads.length === 2 && L.fixtures.length === 14,
     `${pars.length} par + ${heads.length} head`);

  /* the one thing a patch sheet must get right */
  const spans = L.fixtures
    .map(f => ({ id: f.id, a: f.address, b: f.address + drivers.forType(f.type).footprint - 1 }))
    .sort((x, y) => x.a - y.a);
  const overlap = spans.filter((s, i) => i > 0 && s.a <= spans[i - 1].b).map(s => s.id);
  ok("no two fixtures share a DMX channel", overlap.length === 0, overlap.join(","));
  ok("every address is inside one 512-channel universe",
     spans[0].a >= 1 && spans[spans.length - 1].b <= 512 && L.fixtures.every(f => f.universe === 0),
     `1..${spans[spans.length - 1].b}`);
  ok("the channel count is what the drivers say it is",
     spans[spans.length - 1].b === 12 * 7 + 2 * 13, String(spans[spans.length - 1].b));

  /* positions: metres in the audience frame, like arc4-head */
  ok("it states its frame of reference and geometry", L.frame === "audience" && L.geometry === "line");
  const xs = pars.map(f => f.at[0]);
  ok("the pars are a line at real, distinct metre positions, left to right",
     xs.every((x, i) => i === 0 || x > xs[i - 1]) && new Set(xs).size === xs.length &&
     Math.abs(xs[xs.length - 1] - xs[0] - 5.5) < 1e-9, JSON.stringify(xs));
  ok("the lamps hang above the deck and the heads hang downstage of them",
     pars.every(f => f.at[2] > 2) && heads.every(f => f.at[2] > pars[0].at[2] && f.at[1] > pars[0].at[1]));
  ok("it carries the head's enforced slew limits",
     L.limits && L.limits.max_pan_per_frame === 7 && L.limits.max_tilt_per_frame === 7);

  /* groupsOf splits inner/outer at floor(n/2); only a multiple of four is symmetric,
     which is why the rig has twelve pars and not ten */
  const g = groupsOf(L);
  const mirror = a => a.map(f => f.x).sort((p, q) => p - q);
  ok("the derived groups see the whole rig",
     g.pars.length === 12 && g.movers.length === 2 && g.arc.length === 12 && Math.abs(g.span - 5.5) < 1e-9);
  ok("inner and outer are symmetric about the centre",
     g.inner.length === 6 && g.outer.length === 6 &&
     mirror(g.inner).every((x, i, a) => Math.abs(x + a[a.length - 1 - i]) < 1e-9) &&
     mirror(g.outer).every((x, i, a) => Math.abs(x + a[a.length - 1 - i]) < 1e-9),
     "inner " + mirror(g.inner).join(",") + "  outer " + mirror(g.outer).join(","));
}

/* ---- addressing a rig ------------------------------------------------------- */
{
  const A = layouts.resolve(), B = layouts.resolve(CLUB);
  ok("with no argument the default rig is still arc4-head",
     A.rig === "arc4-head" && A.isDefault && A.base === "arc4-head");
  ok("the default rig uses its own palette file",
     A.paletteFile === layouts.DEFAULT_LIBRARY && A.palette.length === 98, String(A.palette.length));
  ok("a rig caches its enumeration beside itself",
     B.matrixFile === path.join(__dirname, "club12-2head.matrix.json"), B.matrixFile);
  ok("a rig with no palette of its own gets the shared effect library, not an empty one",
     B.palette.length === A.palette.length && B.paletteFile === layouts.DEFAULT_LIBRARY,
     `${B.palette.length} looks from ${path.basename(B.paletteFile)}`);
  ok("--layout off an argv slice picks the rig",
     layouts.fromArgs(["score.json", "3", "--layout", CLUB]).rig === "club12-2head");
  ok("--palette off an argv slice overrides the library",
     layouts.fromArgs(["--palette", path.join(__dirname, "arc4-head.palette.json")]).paletteFile
       === path.join(__dirname, "arc4-head.palette.json"));
  const lib = layouts.libraryOf(B.palette);
  ok("the renderer library is the palette plus the base looks' own gestures",
     lib.hold_warm_white && lib.travelling_pulse && lib.travelling_pulse.gesture.direction === "bounce",
     String(Object.keys(lib).length) + " entries");
}

/* ---- the effect library is rig-independent ---------------------------------- */
{
  const A = layouts.resolve(), B = layouts.resolve(CLUB);
  const refused = rig => rig.palette.filter(s => !validateSequence(s, rig.layout).ok);
  ok("every look in the library is possible on the small rig", refused(A).length === 0);
  ok("every look in the library is possible on the club rig too", refused(B).length === 0,
     refused(B).map(s => s.id).join(","));

  const ea = enumerate(A.layout, { palette: A.palette }), eb = enumerate(B.layout, { palette: B.palette });
  ok("both rigs enumerate the same set of sequences",
     JSON.stringify(ea.sequences.map(s => s.id)) === JSON.stringify(eb.sequences.map(s => s.id)),
     `${ea.sequences.length} vs ${eb.sequences.length}`);
  ok("a laser look stays impossible on both (no lasers, no limits)",
     ea.report.impossible.includes("laser_sweep") && eb.report.impossible.includes("laser_sweep"));
  /* the enumeration is a function of the rig, not a constant: a chase across
     twelve lamps lands better than the same chase across four */
  ok("the rig changes the fit of a look that depends on how many lamps there are",
     eb.fit.travelling_pulse > ea.fit.travelling_pulse && eb.fit.build_ramp > ea.fit.build_ramp,
     `travelling_pulse ${ea.fit.travelling_pulse} -> ${eb.fit.travelling_pulse}`);
}

/* ---- the wire: as wide as the rig, every head held ------------------------- */
{
  const A = layouts.resolve().layout, B = layouts.resolve(CLUB).layout;
  ok("the frame is as wide as the layout's last channel (41 on arc4-head, unchanged)",
     wire.widthOf(A) === 41 && wire.widthOf(B) === 110, `${wire.widthOf(A)} / ${wire.widthOf(B)}`);
  const frames = k => wire.toLightsFrames(k, B);
  ok("a club-rig frame carries every channel", frames([tick(B, {})])[0].length === 110);

  /* head_l is driven to the far end of travel, head_r is given no pose at all:
     the driven one travels 7 DMX a frame, the undriven one holds the park pose
     instead of taking its neighbour's. */
  const [hl, hr] = B.fixtures.filter(f => f.type === "head13");
  const ks = Array.from({ length: 12 }, () => tick(B, {
    [hl.id]: { pan: 1, tilt: 0, level: 1 }, [hr.id]: { level: 0 } }));
  const f = frames(ks);
  const pl = f.map(x => x[hl.address - 1]), pr = f.map(x => x[hr.address - 1]);
  ok("a driven head travels toward its target at the slew limit",
     pl[1] - pl[0] === 7 && pl[pl.length - 1] > pl[0], JSON.stringify(pl.slice(0, 3)));
  ok("a second, undriven head holds the park pose instead of the first head's",
     pr.every(v => v === wire.PARK.pan), JSON.stringify(pr.slice(0, 3)));
}
function tick(layout, intents) {
  return { t: 0, bar: 1, beat: 1, fixtures: layout.fixtures.map(f =>
    ({ id: f.id, type: f.type, intent: intents[f.id] || (f.type === "par7" ? { colour: [1, 0, 0], level: 1 } : { level: 0 }) })) };
}

/* ---- end to end: one file, two venues --------------------------------------- */
{
  const SCORE = {
    score: "rigtest",
    grid: { bpm: 120, first_beat_s: 1.0, beats_per_bar: 4, bars: 18, first_bar: 0, last_bar: 17 },
    sections: [
      { from: { bar: 0, beat: 1 }, to: { bar: 9, beat: 1 }, name: "intro" },
      { from: { bar: 9, beat: 1 }, to: { bar: 17, beat: 1 }, name: "drop" },
    ],
    energy: { per: "bar", from_bar: 0, values: [
      0.05, 0.05, 0.06, 0.05, 0.07, 0.06, 0.05, 0.05, 0.06,
      0.90, 0.92, 0.95, 0.90, 0.93, 0.88, 0.90, 0.95, 0.90] },
    moments: [{ bar: 9, beat: 1, is: "entrance", what: "drums", sure: 1, weight: 0.9 },
              { bar: 13, beat: 3, is: "pause", what: "everything but bass", sure: 0.8, for_beats: 4, weight: 0.5 }],
    personality: { user: "test", colours: [{ name: "red", hex: "#ff0000" }, { name: "white", hex: "#ffffff" }] },
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rigs-"));
  const scoreFile = path.join(tmp, "rigtest.score.json");
  fs.writeFileSync(scoreFile, JSON.stringify(SCORE));

  const r = require("./compare.js").compare({ score: scoreFile, seed: 3, against: CLUB, seeds: 8, dir: tmp });

  ok("the two bakes run the same number of frames", r.showA.count === r.showB.count, `${r.showA.count} / ${r.showB.count}`);
  ok("the score's moments land at the same seconds on both rigs", r.timing.moments);
  ok("the sections start and end at the same seconds on both rigs", r.timing.phases);
  ok("the per-bar facts the picks were made from are the same", r.timing.facts);
  ok("every look occupies the same span on both rigs", r.timing.spans,
     JSON.stringify(r.showA.looks.map(l => l.start)) + " vs " + JSON.stringify(r.showB.looks.map(l => l.start)));
  ok("no assignment moves in time on any seed of the sweep", r.sweep.movedSpans === 0,
     `${r.sweep.movedSpans} of ${r.sweep.seeds} seeds`);

  ok("the bigger rig lights more lamps at the peak",
     r.mB.maxLit > r.mA.maxLit && r.mB.maxLit === r.mB.fixtures, `${r.mA.maxLit}/${r.mA.fixtures} vs ${r.mB.maxLit}/${r.mB.fixtures}`);
  ok("the bigger rig does not merely repeat one picture across its lamps",
     r.mB.maxDistinct > r.mA.maxDistinct, `${r.mA.maxDistinct} vs ${r.mB.maxDistinct}`);

  /* the failure that would break the pitch */
  ok("nothing lit on the small rig goes dark on the big one", r.darkness.darkOnB === 0,
     r.darkness.firstDark !== null ? "first at " + r.darkness.firstDark + "s" : "");
  ok("no frame lights fewer lamps on the big rig", r.darkness.fewerOnB === 0, String(r.darkness.fewerOnB));

  /* the artist's colours are musical intent, so they must survive the rig too */
  ok("the artist's palette reaches the plan", r.palette.length === 2);
  ok("every lit PAR is one of the artist's colours on the small rig", r.mA.offPalette.length === 0,
     JSON.stringify(r.mA.offPalette.slice(0, 2)));
  ok("every lit PAR is one of the artist's colours on the club rig", r.mB.offPalette.length === 0,
     JSON.stringify(r.mB.offPalette.slice(0, 2)));
  ok("the heads only ever reach for a wheel slot the artist allowed",
     r.mB.headNames.every(n => ["red", "white"].includes(n)), r.mB.headNames.join("/"));

  /* the page is self-contained: it must open from a file:// URL with no network */
  const html = require("./compare.js").page(r);
  ok("the page carries both shows' frames and asks the network for nothing",
     html.includes("const RIG_A =") && html.includes("const RIG_B =") &&
     !/<(script|link|img)[^>]+(src|href)=["']?https?:/i.test(html), String(html.length) + " bytes");

  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ---- halo-portal: the concert portal rig ------------------------------------ */
{
  const HALO = path.join(__dirname, "halo-portal.layout.json");
  const L = JSON.parse(fs.readFileSync(HALO, "utf8"));
  const by = t => L.fixtures.filter(f => f.type === t);

  ok("every fixture names a device type that has a driver",
     L.fixtures.every(f => { try { return !!drivers.forType(f.type); } catch (e) { return false; } }),
     [...new Set(L.fixtures.map(f => f.type))].join(","));

  ok("the concert count: 24 par5, 4 pixelbar24, 6 spot29, 6 wash12, 6 blinder1, 2 strobe3, 2 laser8",
     by("par5").length === 24 && by("pixelbar24").length === 4 &&
     by("spot29").length === 6 && by("wash12").length === 6 &&
     by("blinder1").length === 6 && by("strobe3").length === 2 &&
     by("laser8").length === 2 && L.fixtures.length === 50,
     String(L.fixtures.length) + " fixtures");

  const spans = L.fixtures
    .map(f => ({ id: f.id, a: f.address, b: f.address + drivers.forType(f.type).footprint - 1 }))
    .sort((x, y) => x.a - y.a);
  const overlap = spans.filter((s, i) => i > 0 && s.a <= spans[i - 1].b).map(s => s.id);
  ok("no two fixtures share a DMX channel", overlap.length === 0, overlap.join(","));
  ok("the whole rig is inside ONE 512-channel universe",
     spans[0].a >= 1 && spans[spans.length - 1].b <= 512 && L.fixtures.every(f => f.universe === 0),
     `1..${spans[spans.length - 1].b}`);
  ok("the channel count is what the drivers say it is",
     spans[spans.length - 1].b === 490, String(spans[spans.length - 1].b));

  ok("it states its frame of reference and its arch geometry",
     L.frame === "audience" && L.geometry === "arch", String(L.geometry));

  /* Each arch satisfies the parametric rule it was generated from, to a
     millimetre, and is mirror-symmetric about centre. Checking the RULE rather
     than a table of numbers is what makes the generator the source of truth. */
  const Z0 = 1.2;
  for (const [g, R, H, y, lo, hi, n] of [
    ["arch_a", 7.0, 9.0, 3.0, 18, 162, 10],
    ["arch_b", 5.6, 7.6, 1.5, 22.5, 157.5, 8],
    ["arch_c", 4.2, 6.2, 0.0, 27, 153, 6],
  ]) {
    const arc = L.fixtures.filter(f => f.group === g);
    ok(`${g} has ${n} pars, all at depth ${y}`,
       arc.length === n && arc.every(f => Math.abs(f.at[1] - y) < 1e-9), String(arc.length));
    const onRule = arc.every((f, i) => {
      const th = ((lo + ((hi - lo) * i) / (n - 1)) * Math.PI) / 180;
      return Math.abs(f.at[0] - R * Math.cos(th)) < 1e-3 &&
             Math.abs(f.at[2] - (Z0 + (H - Z0) * Math.sin(th))) < 1e-3;
    });
    ok(`${g} sits on x=R*cos(t), z=${Z0}+(H-${Z0})*sin(t) to the millimetre`, onRule);
    const xs = arc.map(f => f.at[0]);
    ok(`${g} is mirror-symmetric about centre`,
       xs.every((x, i) => Math.abs(x + xs[xs.length - 1 - i]) < 1e-3), JSON.stringify(xs));
    ok(`${g} rises to its apex and comes back down`,
       arc[0].at[2] < arc[Math.floor(n / 2)].at[2] && arc[n - 1].at[2] < arc[Math.floor(n / 2)].at[2]);
  }

  ok("the arches nest: A is widest and tallest, C is narrowest and shortest",
     Math.max(...L.fixtures.filter(f => f.group === "arch_a").map(f => f.at[0])) >
     Math.max(...L.fixtures.filter(f => f.group === "arch_b").map(f => f.at[0])) &&
     Math.max(...L.fixtures.filter(f => f.group === "arch_b").map(f => f.at[0])) >
     Math.max(...L.fixtures.filter(f => f.group === "arch_c").map(f => f.at[0])));

  /* groupsOf's "pars" bucket is CAPABILITY-based -- colour and level and not
     move -- so it holds the 4 pixelbar24 as well as the 24 par5: 28 fixtures,
     split 14/14. That is not something to route around. The property
     club16-2head's note cares about is that NO MIRROR PAIR IS SPLIT, which
     needs the bucket to be a multiple of four AND symmetric about centre. Both
     hold here, and the pixelbars are placed symmetrically so they keep holding
     -- which is exactly what these three checks defend. */
  const g = groupsOf(L);
  ok("groupsOf sees 28 colour-and-level fixtures: the 24 arch pars plus the 4 pixelbars",
     g.pars.length === 28, String(g.pars.length));
  ok("it splits them 14/14 -- a multiple of four, so no mirror pair is broken",
     g.inner.length === 14 && g.outer.length === 14, `${g.inner.length}/${g.outer.length}`);
  const symmetric = a => {
    const xs = a.map(p => p.x).sort((u, v) => u - v);
    return xs.every((x, i) => Math.abs(x + xs[xs.length - 1 - i]) < 1e-3);
  };
  ok("inner and outer are each mirror-symmetric about centre",
     symmetric(g.inner) && symmetric(g.outer));

  ok("it declares its laser zones, so preflight can offer laser_sweep",
     L.limits && L.limits.laser_zones === 2, String(L.limits && L.limits.laser_zones));
  ok("it carries the mover slew limits", L.limits.max_pan_per_frame === 7 && L.limits.max_tilt_per_frame === 7);

  const en = enumerate(L, { palette: [] });
  ok("the rig enumerates a non-empty effect library", Array.isArray(en) ? en.length > 0 : Object.keys(en).length > 0);
}

for (const [pass, name, detail] of out)
  console.log(`  ${pass ? "pass" : "FAIL"}  ${name}${detail ? "   -- " + detail : ""}`);
const bad = out.filter(r => !r[0]).length;
console.log(bad ? `\n${bad} FAILED` : `\nall ${out.length} checks pass`);
process.exit(bad ? 1 : 0);
