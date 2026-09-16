/**
 * A rig, playing something, with no server in the loop.
 *
 * The venue catalogue needs every card to show what that room can DO, including
 * the rooms you have no access to. Baking a real show per card would mean a job,
 * a poll and a frame download each — for a page you are only scrolling past, and
 * for locked venues it would mean baking against a rig you are not allowed to
 * target. So this is a loop, not a show: eight bars of house, derived from the
 * layout's own fixture list, evaluated at a time in seconds.
 *
 * It is deliberately NOT the arranger. Nothing here should be mistaken for what
 * the pipeline would actually produce — it is a demo reel, and the card says so.
 */

import type { Fixture, LampState } from "./types";
import { profileOf, moves, type FixtureKind } from "./profiles.ts";
import { placeFixtures } from "./fixtures.ts";

const BPM = 128;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const LOOP = BAR * 8;

/** Warm amber through to cold blue — the two ends most rigs actually live between. */
const PALETTE: Array<[number, number, number]> = [
  [1, 0.42, 0.12],
  [1, 0.13, 0.42],
  [0.55, 0.2, 1],
  [0.13, 0.5, 1],
  [0.1, 1, 0.72],
];

const ease = (x: number) => x * x * (3 - 2 * x);

/* Everything on a truss points DOWN at the room. The renderer's rot = 0 is the
   top of the frame, so a hanging fixture sits near PI and fans either side of
   it; a lamp on the deck is the one thing that points back up. */
const DOWN = Math.PI;
/** 1 on the hit, falling away over `tail` beats. */
const decay = (since: number, tail: number) => Math.max(0, 1 - since / tail);

function colourAt(bar: number): [number, number, number] {
  return PALETTE[Math.floor(bar / 2) % PALETTE.length];
}

/**
 * Build one frame of the demo.
 *
 * `fixtures` is the layout's own list, so the loop lands on whatever the room
 * actually has: a rig with no blinder simply never gets the blinder stab.
 */
export function demoStates(fixtures: Fixture[], t: number): { lamps: LampState[] } {
  const place = placeFixtures({ fixtures } as never);
  if (!place.lamps.length) return { lamps: [] };

  const time = ((t % LOOP) + LOOP) % LOOP;
  const beat = time / BEAT;
  const bar = Math.floor(time / BAR);
  const beatInBar = beat % 4;
  const sinceBeat = beat % 1;
  /* bars 4–7 are the drop: everything is louder and the blinders come in */
  const drop = bar >= 4;
  const colour = colourAt(bar);
  const accent = PALETTE[(Math.floor(bar / 2) + 2) % PALETTE.length];

  /* group the lamps so a chase has an order to run along */
  const byKind = new Map<FixtureKind, typeof place.lamps>();
  for (const l of place.lamps) {
    const g = byKind.get(l.kind);
    if (g) g.push(l); else byKind.set(l.kind, [l]);
  }
  for (const g of byKind.values()) g.sort((a, b) => a.x - b.x);

  const lamps: LampState[] = place.lamps.map((pos) => {
    const prof = profileOf(pos.type);
    const peers = byKind.get(pos.kind) ?? [pos];
    const n = peers.length;
    const i = peers.indexOf(pos);
    const phase = n > 1 ? i / (n - 1) : 0.5;

    let k = 0;
    let rgb: [number, number, number] = colour;
    let strobe = 0;
    let rot = 0;
    let reach = 0.8;
    let spreadDeg = prof.beamDeg[0];
    let prism = false;
    let gobo = 0;
    let cells: LampState["cells"];

    switch (pos.kind) {
      case "par": {
        /* a chase with a tail, so it reads as one thing moving rather than as
           lamps blinking in turn */
        const head = (beat * (drop ? 2 : 1)) % n;
        const dist = Math.min(Math.abs(i - head), Math.abs(i - head + n), Math.abs(i - head - n));
        k = Math.max(decay(dist, drop ? 2.6 : 1.8), drop ? 0.2 : 0.07);
        rgb = i % 2 === 0 ? colour : accent;
        break;
      }
      case "wash": {
        /* a slow breath, opposite halves out of phase, zoom opening on the drop */
        const side = phase < 0.5 ? 0 : Math.PI;
        k = (drop ? 0.55 : 0.3) + 0.35 * (0.5 + 0.5 * Math.sin(time * 1.1 + side));
        rgb = colour;
        /* washes splay outward from the centre line and drift */
        rot = DOWN - (phase - 0.5) * 0.9 - Math.sin(time * 0.42 + phase * 2.4) * 0.16;
        reach = 0.9;
        spreadDeg = prof.beamDeg[0] + (prof.beamDeg[1] - prof.beamDeg[0]) * (drop ? 0.75 : 0.35);
        break;
      }
      case "spot": {
        /* a fan that opens and closes: the signature beam move */
        const open = 0.25 + 0.75 * ease(0.5 + 0.5 * Math.sin(time * 0.55));
        rot = DOWN - (phase - 0.5) * 1.75 * open;
        reach = 1;
        k = drop ? 0.95 : 0.4 + 0.5 * (0.5 + 0.5 * Math.sin(time * 0.9 - phase * 1.6));
        rgb = accent;
        spreadDeg = prof.beamDeg[0] + (prof.beamDeg[1] - prof.beamDeg[0]) * 0.15;
        prism = drop && beatInBar >= 2;
        gobo = drop ? 60 : 0;
        break;
      }
      case "blinder": {
        /* the four, on the four, and only once it has earned it */
        k = drop && beatInBar >= 3 ? decay(sinceBeat, 0.55) : 0;
        rgb = [1, 0.86, 0.66];
        break;
      }
      case "strobe": {
        /* the last bar of the loop, as the turnaround */
        const live = bar === 7 && beatInBar >= 2;
        k = live ? 1 : 0;
        strobe = live ? 0.8 : 0;
        rgb = [1, 0.97, 0.92];
        break;
      }
      case "strip": {
        const count = prof.cells ?? 6;
        cells = Array.from({ length: count }, (_, c) => {
          const up = (beat * 1.5 - c * 0.35) % count;
          return {
            k: Math.max(decay(Math.abs(up - count * 0.5), 2.2), drop ? 0.18 : 0.06),
            rgb: c % 2 === 0 ? colour : accent,
          };
        });
        k = 1;
        break;
      }
      case "laser": {
        /* only in the drop, and only ever sweeping above the crowd */
        k = drop ? 0.85 : 0;
        /* a scanner stays high and wide -- it sweeps the air over the crowd, which
           is the only place laser_zones lets it go */
        rot = DOWN - (phase - 0.5) * 1.1 - Math.sin(time * 1.6 + phase * Math.PI) * 0.5;
        rgb = [0.15, 1, 0.5];
        break;
      }
    }

    return {
      ...pos,
      k: Math.max(0, Math.min(1, k)),
      rgb,
      strobe,
      spreadDeg,
      gobo,
      prism,
      rot: moves(pos.type) ? rot : 0,
      reach,
      az: 0,
      el: 0,
      cells,
    };
  });

  return { lamps };
}

export const DEMO_LOOP_SECONDS = LOOP;
