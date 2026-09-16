"""Recolour a show plan by mapping its existing palette to a new one.

Given a limelight.show/1 dict and a replacement colour palette, this module
derives the colours the show actually uses, builds a positional mapping from
old entries to new entries, and rewrites every colour value in the plan.
Everything else -- effects, timing, amounts, extents, why text -- is preserved.
"""
import copy
import math


COLOUR_KEYS = ("colour", "under", "to", "from", "bed_colour")

_WHITE_THRESHOLD = 0.08  # Euclidean distance below which a colour counts as white


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _as_rgb(c):
    """Normalise a colour value to a [r, g, b] list (0..1), or None."""
    if isinstance(c, str) and c.startswith("#") and len(c) == 7:
        try:
            return [int(c[i:i + 2], 16) / 255.0 for i in (1, 3, 5)]
        except ValueError:
            return None
    if isinstance(c, (list, tuple)) and len(c) == 3:
        try:
            return [max(0.0, min(1.0, float(x))) for x in c]
        except (TypeError, ValueError):
            return None
    return None


def _dist(a, b):
    """Squared Euclidean distance between two RGB triples."""
    return sum((x - y) ** 2 for x, y in zip(a, b))


def _is_white(rgb):
    """True when rgb is close enough to pure white to be treated specially."""
    return _dist(rgb, (1.0, 1.0, 1.0)) < _WHITE_THRESHOLD ** 2


def _round_rgb(rgb):
    return [round(x, 3) for x in rgb]


# ---------------------------------------------------------------------------
# Extract palette
# ---------------------------------------------------------------------------

def extract_palette(show, keep=8, near=0.06):
    """Derive the ordered palette a show actually uses.

    Walks every colour key in states / bindings / gestures, counts occurrences,
    and clusters nearby colours (Euclidean distance < `near`) into single
    entries.  Returns a list of (label, (r, g, b)) sorted by frequency
    (most-used first).  Near-white colours are collected but placed at the end
    so they don't consume a positional slot meant for a chromatic colour.
    """
    seen = {}
    for section_key in ("states", "bindings", "gestures"):
        for cue in (show.get(section_key) or []):
            # single-value colour keys
            for ck in COLOUR_KEYS:
                v = cue.get(ck)
                rgb = _as_rgb(v)
                if rgb:
                    k = tuple(round(float(x), 4) for x in rgb)
                    seen[k] = seen.get(k, 0) + 1
            # colour-pair key
            arr = cue.get("colours")
            if isinstance(arr, list):
                for item in arr:
                    rgb = _as_rgb(item)
                    if rgb:
                        k = tuple(round(float(x), 4) for x in rgb)
                        seen[k] = seen.get(k, 0) + 1

    # cluster nearby colours (greedy, most-frequent first absorbs neighbours)
    chromatic = []
    whites = []
    pool = sorted(seen.items(), key=lambda kv: -kv[1])

    while pool and len(chromatic) + len(whites) < keep:
        rgb, count = pool.pop(0)
        entry = (f"c{len(chromatic) + len(whites) + 1}", rgb)
        if _is_white(rgb):
            whites.append(entry)
        else:
            chromatic.append(entry)
        # remove anything too close to this entry
        pool = [(c, n) for c, n in pool if _dist(c, rgb) > near ** 2]

    # chromatic first, whites at the end
    return chromatic + whites


# ---------------------------------------------------------------------------
# Build mapping
# ---------------------------------------------------------------------------

def build_mapping(old_palette, new_palette):
    """Build a dict mapping old RGB tuples to new RGB lists.

    Positional: the i-th chromatic old entry maps to the i-th new entry.
    White entries in the old palette map to the last new entry if its name
    contains 'white' or 'highlight', otherwise they stay white.

    Returns:
        mapping  -- dict of { old_rgb_tuple: new_rgb_list }
        report   -- list of { old, new, name } dicts for UI display
    """
    new_rgbs = []
    for entry in new_palette:
        rgb = _as_rgb(entry.get("rgb") if isinstance(entry, dict) else entry)
        name = entry.get("name", "?") if isinstance(entry, dict) else "?"
        if rgb:
            new_rgbs.append({"name": name, "rgb": rgb})

    if not new_rgbs:
        return {}, []

    # find the white / highlight slot in the new palette (last entry, or
    # the one explicitly named white/highlight)
    white_target = None
    for nr in reversed(new_rgbs):
        low = nr["name"].lower()
        if "white" in low or "highlight" in low:
            white_target = nr["rgb"]
            break
    if white_target is None and _is_white(new_rgbs[-1]["rgb"]):
        white_target = new_rgbs[-1]["rgb"]

    mapping = {}
    report = []

    # separate old chromatic from old whites
    old_chromatic = [(name, rgb) for name, rgb in old_palette if not _is_white(rgb)]
    old_whites = [(name, rgb) for name, rgb in old_palette if _is_white(rgb)]
    new_chromatic = [nr for nr in new_rgbs if not _is_white(nr["rgb"])]

    for i, (oname, orgb) in enumerate(old_chromatic):
        if i < len(new_chromatic):
            target = new_chromatic[i]["rgb"]
            tname = new_chromatic[i]["name"]
        else:
            # wrap around if new palette is shorter
            target = new_chromatic[i % len(new_chromatic)]["rgb"]
            tname = new_chromatic[i % len(new_chromatic)]["name"]
        mapping[orgb] = target
        report.append({"old": list(orgb), "old_name": oname,
                       "new": _round_rgb(target), "new_name": tname})

    for oname, orgb in old_whites:
        target = white_target if white_target else [1.0, 1.0, 1.0]
        mapping[orgb] = target
        report.append({"old": list(orgb), "old_name": oname,
                       "new": _round_rgb(target), "new_name": "white/highlight"})

    return mapping, report


# ---------------------------------------------------------------------------
# Apply mapping
# ---------------------------------------------------------------------------

def _nearest_old(rgb, mapping_keys):
    """Find the nearest old palette entry for a colour that may not match
    exactly (e.g. slight rounding differences)."""
    best, bd = None, 9e9
    for ok in mapping_keys:
        d = _dist(rgb, ok)
        if d < bd:
            best, bd = ok, d
    return best


def _apply_to_cue(cue, mapping):
    """Rewrite colour values on a single cue dict (mutates in place)."""
    keys = list(mapping.keys())
    if not keys:
        return

    for ck in COLOUR_KEYS:
        v = cue.get(ck)
        rgb = _as_rgb(v)
        if rgb is None:
            continue
        nearest = _nearest_old(rgb, keys)
        if nearest is not None:
            cue[ck] = _round_rgb(mapping[nearest])

    arr = cue.get("colours")
    if isinstance(arr, list):
        out = []
        for item in arr:
            rgb = _as_rgb(item)
            if rgb is None:
                out.append(item)
                continue
            nearest = _nearest_old(rgb, keys)
            if nearest is not None:
                out.append(_round_rgb(mapping[nearest]))
            else:
                out.append(item)
        cue["colours"] = out


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def recolour(show, new_palette):
    """Return a copy of *show* with every colour remapped to *new_palette*.

    Args:
        show:        a ``limelight.show/1`` dict (states, bindings, gestures).
        new_palette: list of ``{"name": str, "rgb": [r, g, b]}`` entries,
                     ordered by role (primary, secondary, accent, highlight...).

    Returns:
        (recoloured_show, mapping_report) where mapping_report is a list of
        dicts describing each old-to-new substitution.
    """
    result = copy.deepcopy(show)

    # 1. derive the old palette from the show's actual colour usage
    #    (or use its declared palette if present)
    declared = show.get("palette")
    if declared and isinstance(declared, list) and len(declared) > 0:
        old_palette = []
        for entry in declared:
            rgb = _as_rgb(entry.get("rgb") if isinstance(entry, dict) else entry)
            name = entry.get("name", "?") if isinstance(entry, dict) else "?"
            if rgb:
                old_palette.append((name, tuple(rgb)))
    else:
        old_palette = extract_palette(show)

    if not old_palette:
        return result, [{"level": "warn", "msg": "no colours found in show to remap"}]

    # 2. build old -> new mapping
    mapping, report = build_mapping(old_palette, new_palette)

    if not mapping:
        return result, [{"level": "warn",
                         "msg": "new palette produced no valid colours"}]

    # 3. walk every cue and replace colours
    for section_key in ("states", "bindings", "gestures"):
        for cue in (result.get(section_key) or []):
            _apply_to_cue(cue, mapping)

    # 4. update the top-level palette field
    result["palette"] = [{"name": e.get("name", "?") if isinstance(e, dict) else "?",
                          "rgb": _as_rgb(e.get("rgb") if isinstance(e, dict) else e)}
                         for e in new_palette
                         if _as_rgb(e.get("rgb") if isinstance(e, dict) else e)]

    return result, report
