# v1-ours

A self-contained frame recipe (a `function frame(t)` body injected through
`mkReader`, same seam as `readers/src/recipe4.js`). Selectable in `/analyse`
as an alternative to the default `v0-prod` engine.

## What it is
Forked from an **earlier** `recipe4.js` (1090 lines) — before prod's current
rewrite (now 1396 lines). It is **not** rebased on prod; the two have since
diverged by ~600 lines. It is experimental and is **not** held to the golden
frames.

## Our distinctive delta vs prod
- **Chapter-label normalizer** (`CH_ALIAS` / `chMap`, unique to this version):
  translates *foreign* chapter names into the recipe's own vocabulary so
  model-authored maps light up instead of falling through to the near-black
  `idle` look — chorus→drop, inst→drop, high→drop, low→break, mid/theme→verse,
  start→intro, end→outro. Applied inside `rolesFor` and `primaryLook`; it only
  rewrites labels the recipe doesn't already know, so authored-song output is
  unchanged.

Prod (`v0-prod`) has since independently grown its own accents handling and
label logic; the two are not line-comparable. When a single "main" recipe is
agreed, its author folds in whatever of the above still earns its place and
this folder is deleted (see `../DESIGN.md`).
