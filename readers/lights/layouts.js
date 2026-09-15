"use strict";
/* Which RIG a command is running against, and which effect library to enumerate
   against it.
   ---------------------------------------------------------------------------
   A rig is a layout file: `<base>.layout.json`, with its enumeration cached
   beside it as `<base>.matrix.json`. Every CLI here took the one layout as a
   literal require, so a second venue could not be addressed at all.

   The PALETTE is not a rig asset. Its sequences declare `requires: {groups,
   caps}` -- capabilities and named groups, never fixture ids -- which is exactly
   what makes an effect library portable: enumerate() re-checks every look
   against the rig in front of it and keeps the ones that fit. So a layout with
   no palette of its own gets the shared library rather than an empty one; it
   happens to live under the first rig's name because that rig is where it was
   generated. A layout that DOES want its own looks just puts them in
   `<base>.palette.json` beside itself. */
const fs = require("fs"), path = require("path");

const HERE = __dirname;
const DEFAULT_LAYOUT = path.join(HERE, "arc4-head.layout.json");
const DEFAULT_LIBRARY = path.join(HERE, "arc4-head.palette.json");

const baseOf = file => path.basename(file).replace(/\.layout\.json$|\.json$/, "");

const readJSON = file => JSON.parse(fs.readFileSync(file, "utf8"));

/* resolve(layoutFile?, paletteFile?) -> { file, base, dir, rig, layout, palette,
                                           paletteFile, matrixFile, isDefault } */
function resolve(layoutFile, paletteFile) {
  const file = layoutFile ? path.resolve(layoutFile) : DEFAULT_LAYOUT;
  const dir = path.dirname(file), base = baseOf(file);
  const own = path.join(dir, base + ".palette.json");
  const pf = paletteFile ? path.resolve(paletteFile)
           : fs.existsSync(own) ? own : DEFAULT_LIBRARY;
  let palette = [];
  try { palette = readJSON(pf); } catch (e) { /* no library: the base vocabulary alone */ }
  const layout = readJSON(file);
  return { file, base, dir, rig: layout.rig || base, layout, palette,
           paletteFile: pf, matrixFile: path.join(dir, base + ".matrix.json"),
           isDefault: file === DEFAULT_LAYOUT };
}

/* the renderer library: the palette's looks plus the base vocabulary's gestures */
function libraryOf(palette) {
  const seqs = Array.isArray(palette) ? palette : (palette && palette.sequences) || [];
  return { ...Object.fromEntries(seqs.map(s => [s.id, s])),
           ...require("./preflight.js").baseLibrary() };
}

/* --layout FILE / --palette FILE off an argv slice, for the CLIs */
function fromArgs(args) {
  const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  return resolve(opt("--layout"), opt("--palette"));
}

module.exports = { resolve, fromArgs, libraryOf, baseOf, DEFAULT_LAYOUT, DEFAULT_LIBRARY };
