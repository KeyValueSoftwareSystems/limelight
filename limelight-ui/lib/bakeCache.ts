/**
 * One bake per show, for the life of the tab.
 *
 * Every live preview used to bake its own show the first time it scrolled into
 * view, and bake it AGAIN on the next visit to the page - twenty-one listings
 * meant twenty-one round trips, every time. The work is identical for identical
 * intent, so it is keyed on the intent and shared: the first card to ask pays,
 * everything after it is instant, including on a second visit.
 */
import * as api from "@/lib/api";
import { placeFixtures } from "@/lib/fixtures";
import type { Show, FixturePlacement } from "@/lib/types";

export interface Baked {
  show: Show;
  frames: Uint8Array;
  place: FixturePlacement;
}

interface Intent {
  song: string;
  seed: number;
  edits: Array<{ type: string; bar: number; beats: number }>;
  layout?: string;
}

/* Rigs a preview may run on. A grid where every card is the same four lamps in
   a line tells you nothing about what these shows DO; the same cue list on an
   arena and on a desk are different pictures, which is the point of the
   product. Chosen per show, not at random per render, so a card looks the same
   every time you come back to it. */
const RIGS = [
  "halo-portal.layout.json",
  "arc4-head.layout.json",
  "club12-2head.layout.json",
  "club16-2head.layout.json",
  "echostage.layout.json",
  "keycode-arena.layout.json",
  "keycode-basic.layout.json",
];

export function rigFor(key: string): string {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return RIGS[Math.abs(h) % RIGS.length];
}

const cache = new Map<string, Promise<Baked | null>>();

/* Two at a time. A page of thirty-two cards asking at once is thirty-two bakes
   racing each other, which is slower for every one of them than a short queue
   and hard on the server besides. */
const LANES = 2;
let running = 0;
const waiting: Array<() => void> = [];

function lane<T>(job: () => Promise<T>): Promise<T> {
  const start = () =>
    job().finally(() => {
      running -= 1;
      waiting.shift()?.();
    });
  if (running < LANES) {
    running += 1;
    return start();
  }
  return new Promise<T>((resolve) => {
    waiting.push(() => {
      running += 1;
      resolve(start());
    });
  });
}

const keyOf = (i: Intent) => `${i.song}|${i.seed}|${i.layout ?? ""}|${JSON.stringify(i.edits ?? [])}`;

async function run(intent: Intent): Promise<Baked | null> {
  try {
    const bake = await api.show.bake(intent);
    if (bake.error) return null;

    let status: Awaited<ReturnType<typeof api.show.status>> | null = null;
    for (let i = 0; i < 200; i++) {
      status = await api.show.status(bake.job);
      if (status.state !== "baking") break;
      await new Promise((r) => setTimeout(r, 300));
    }
    if (!status?.show || !status.frames_url) return null;

    const frames = await api.show.frames(status.frames_url);
    return { show: status.show, frames, place: placeFixtures(status.show) };
  } catch {
    return null;
  }
}

export function bakeOnce(intent: Intent): Promise<Baked | null> {
  const key = keyOf(intent);
  let hit = cache.get(key);
  if (!hit) {
    hit = lane(() => run(intent));
    cache.set(key, hit);
    /* A failure must not be remembered as a failure for ever: drop it so the
       next card that needs it can try again. */
    hit.then((v) => { if (!v) cache.delete(key); });
  }
  return hit;
}
