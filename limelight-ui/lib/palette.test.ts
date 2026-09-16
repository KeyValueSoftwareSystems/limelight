/**
 * A palette travels between three vocabularies: the picker speaks hex, the
 * baker speaks rgb 0..1 (portal/validator.py snaps every cue colour to the
 * nearest declared entry), and a person reads names. Getting any of those
 * conversions wrong shows up as the wrong colour in the room, so they are
 * pinned here rather than trusted.
 */
import { test } from "node:test";
import assert from "node:assert";
import { colourName, hexToRgb01, rgb01ToHex, nextColour } from "./palette.ts";

test("hexToRgb01 puts the channels in the 0..1 the baker reads", () => {
  assert.deepEqual(hexToRgb01("#000000"), [0, 0, 0]);
  assert.deepEqual(hexToRgb01("#ffffff"), [1, 1, 1]);
  assert.deepEqual(hexToRgb01("#ff0000"), [1, 0, 0]);
});

test("hexToRgb01 takes the short form and a missing hash", () => {
  assert.deepEqual(hexToRgb01("#f00"), [1, 0, 0]);
  assert.deepEqual(hexToRgb01("00ff00"), [0, 1, 0]);
});

test("hexToRgb01 on something that is not a colour is black, not a crash", () => {
  assert.deepEqual(hexToRgb01(""), [0, 0, 0]);
  assert.deepEqual(hexToRgb01("#zzz"), [0, 0, 0]);
});

test("rgb01ToHex round-trips what hexToRgb01 produced", () => {
  for (const hex of ["#ff0000", "#00ccff", "#8000ff", "#ffb300", "#101216"]) {
    assert.equal(rgb01ToHex(hexToRgb01(hex)), hex);
  }
});

test("colourName says what a lighting person would call it", () => {
  assert.equal(colourName("#ff0000"), "red");
  assert.equal(colourName("#ffb300"), "amber");
  assert.equal(colourName("#00ff00"), "green");
  assert.equal(colourName("#00ccff"), "cyan");
  assert.equal(colourName("#0000ff"), "blue");
  assert.equal(colourName("#8000ff"), "violet");
  assert.equal(colourName("#ff00cc"), "magenta");
});

test("colourName does not call an unsaturated colour a hue", () => {
  assert.equal(colourName("#ffffff"), "white");
  assert.equal(colourName("#000000"), "black");
  assert.equal(colourName("#808080"), "grey");
});

/* A name is derived, never carried: change a swatch from red to blue and a
   stored name would still say "red", and the plan the baker reads would lie
   about its own palette. */
test("colourName follows the hex it is given, not the one before it", () => {
  assert.notEqual(colourName("#ff0000"), colourName("#0000ff"));
});

test("nextColour picks a hue the palette does not already have", () => {
  const used = ["#ff0000", "#00ff00", "#0000ff"];
  const added = nextColour(used);
  assert.ok(!used.includes(added), `${added} is already in the palette`);
  assert.match(added, /^#[0-9a-f]{6}$/);
});

test("nextColour still answers when every hue is taken", () => {
  const used = Array.from({ length: 40 }, (_, i) => rgb01ToHex([i / 40, 0.5, 0.5]));
  assert.match(nextColour(used), /^#[0-9a-f]{6}$/);
});

/* HSL saturation blows up near the lightness extremes: #e6eaf2 is the app's own
   off-white and the formula calls it 31% saturated, which was enough to have it
   named "blue" in the plan handed to the baker. Whether a colour HAS a hue is a
   question about chroma, not about saturation. */
test("colourName calls a near-white white, however the formula scores it", () => {
  assert.equal(colourName("#e6eaf2"), "white");
  assert.equal(colourName("#f5f0e6"), "white");
});

test("colourName calls a near-black black", () => {
  assert.equal(colourName("#101216"), "black");
  assert.equal(colourName("#0a0b0e"), "black");
});

test("colourName still names a washed-out but real hue", () => {
  assert.equal(colourName("#d4a373"), "amber");
  assert.equal(colourName("#6a4c93"), "violet");
});

/* ── the client's mirror of portal/recolour.py:extract_palette ──────────────
   A show declares no palette until it has been recoloured once, so the editor
   has to derive the colours it already uses in order to show them. The server
   derives the same set to map FROM, and the two disagreeing would mean the
   swatches described one palette while the remap read another — so this reads
   the real showfile off disk and pins the answer to what the Python produces.
   The expectation below is `extract_palette` run against this same file. */
import fs from "node:fs";
import path from "node:path";
import { extractPalette } from "./palette.ts";

const SHOWFILE = path.join(
  import.meta.dirname, "fixtures", "raga-of-revenge.show.json",
);

test("extractPalette derives what portal/recolour.py derives", () => {
  const show = JSON.parse(fs.readFileSync(SHOWFILE, "utf8"));
  const got = extractPalette(show).map((c) => c.hex);
  assert.deepEqual(got, [
    rgb01ToHex([1.0, 0.52, 0.12]),
    rgb01ToHex([0.85, 0.16, 0.04]),
    rgb01ToHex([1.0, 0.78, 0.34]),
    rgb01ToHex([1.0, 1.0, 1.0]),
  ]);
});

test("extractPalette prefers a palette the show declares over one it infers", () => {
  const show = {
    palette: [{ name: "red", rgb: [1, 0, 0] }, { name: "blue", rgb: [0, 0, 1] }],
    states: [{ effect: "wash", colour: [0, 1, 0] }],
  };
  assert.deepEqual(extractPalette(show).map((c) => c.hex), ["#ff0000", "#0000ff"]);
});

test("extractPalette reads a hex colour as readily as a triple", () => {
  const show = { gestures: [{ effect: "stab", colour: "#ff0000" }, { effect: "stab", colour: [0, 0, 1] }] };
  assert.deepEqual(new Set(extractPalette(show).map((c) => c.hex)), new Set(["#ff0000", "#0000ff"]));
});

test("extractPalette keeps whites last so they do not take a colour's slot", () => {
  const show = {
    states: [
      { effect: "wash", colour: [1, 1, 1] }, { effect: "wash", colour: [1, 1, 1] },
      { effect: "wash", colour: [1, 1, 1] }, { effect: "drone", colour: [0, 0, 1] },
    ],
  };
  assert.deepEqual(extractPalette(show).map((c) => c.hex), ["#0000ff", "#ffffff"]);
});

test("extractPalette on a show with no colours is empty, not a crash", () => {
  assert.deepEqual(extractPalette({}), []);
  assert.deepEqual(extractPalette({ states: [{ effect: "wash" }] }), []);
});
