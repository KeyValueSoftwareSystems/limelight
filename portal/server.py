#!/usr/bin/env python3
"""The portal: pick a song, watch its lighting show, change it in plain English.

  portal/server.py [--port 8800] [--host 127.0.0.1] [--hub URL]

Two sides of one screen. CREATOR picks a song from the hub library, watches the
baked show on the stage view, and drops blackouts into it. VENUE opens a saved
show file and rebuilds it from the song's own score -- a show file carries
INTENT (song, seed, edits) and never frames, so the same show can be re-rendered
against a different rig later.

The library comes from the hub (POST /hub/score). The show comes from the baker
(readers/lights/bake.js --lights), cached under portal/work/. Frames go to the
page as raw bytes, not JSON: 41 channels x 40 fps is a megabyte of digits
otherwise, and the page wants a Uint8Array at the end of it anyway.
"""
import argparse
import functools
import hashlib
import json
import mimetypes
import os
import shutil
import subprocess
import sys
import socket
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
SCORES = os.path.join(REPO, "hub", "files", "score")


def score_path(name):
    flat = os.path.join(SCORES, name + ".score")
    if os.path.isfile(flat):
        return flat
    store = os.path.join(SCORES, ".versions", name + ".score")
    try:
        ns = [int(x.split(".")[0]) for x in os.listdir(store)
              if x.endswith(".score") and x.split(".")[0].isdigit()]
    except OSError:
        return flat
    return os.path.join(store, "%d.score" % max(ns)) if ns else flat
WORK = os.path.join(HERE, "work")
SHOWS = os.path.join(HERE, "shows")
MARKET = os.path.join(HERE, "market")
COVERS = os.path.join(HERE, "covers")
BAKE = os.path.join(HERE, "effects.js")
BAKE_V2 = os.path.join(HERE, "baker.js")
BAKE_CUES = os.path.join(HERE, "cue", "bake.js")
CATALOG = os.path.join(HERE, "effects.json")
CUSTOM = os.path.join(HERE, "custom-effects.json")
HUB = os.environ.get("HUB_URL", "http://127.0.0.1:8770")
PANEL = os.environ.get("PANEL_URL", "http://127.0.0.1:8766")
LIMITS_FILE = os.path.join(HERE, "limits.json")
VENUES_FILE = os.path.join(HERE, "venues.json")
SHOWFILES = os.path.join(HERE, "showfiles")
CUESHOWS = os.path.join(HERE, "cue", "shows")
LOGOS = os.path.join(HERE, "logos")
LIMITS = None

# The rig's own modules, imported rather than copied: artnet.Sender is the wire
# and rig.park_frame() is the safe dark frame (all-zeros whips the head across
# the room, so it is never the thing we send).
sys.path.insert(0, os.path.join(REPO, "readers", "lights", "panel"))

LAYOUTS_DIR = os.path.join(REPO, "readers", "lights")
DEFAULT_LAYOUT = "arc4-head.layout.json"


class Rigmap:
    """Which channels belong to which fixture, for whatever layout a show was
    baked against. Nothing downstream may assume four pars and one head: the
    same show renders on a desk rig of 5 fixtures and a stage rig of 14, and the
    frame is 41 channels wide or 110 accordingly.

    Offsets come from readers/lights/drivers/profiles/*.profile.json: par7 keeps
    its level in R/G/B with the master parked full, head13 has a real dimmer.
    """

    PAR = {"dim": 0, "r": 1, "g": 2, "b": 3, "strobe": 4, "footprint": 7}
    HEAD = {"pan": 0, "pan_fine": 1, "tilt": 2, "tilt_fine": 3, "speed": 4,
            "dim": 5, "strobe": 6, "colour": 7, "footprint": 13}

    def __init__(self, fixtures, channels):
        self.fixtures = fixtures or []
        self.channels = int(channels or 41)
        self.pars = [f["address"] for f in self.fixtures if f.get("type") == "par7"]
        self.heads = [f["address"] for f in self.fixtures if f.get("type") == "head13"]
        if not self.fixtures:                       # a show baked before layouts
            self.pars, self.heads, self.channels = [1, 8, 15, 22], [29], 41

    @classmethod
    def of(cls, show):
        return cls(show.get("fixtures"), show.get("channels"))

    def par_level_idx(self):
        return [a - 1 + o for a in self.pars for o in (self.PAR["r"], self.PAR["g"], self.PAR["b"])]

    def par_strobe_idx(self):
        return [a - 1 + self.PAR["strobe"] for a in self.pars]

    def head_dim_idx(self):
        return [a - 1 + self.HEAD["dim"] for a in self.heads]

    def head_strobe_idx(self):
        return [a - 1 + self.HEAD["strobe"] for a in self.heads]

    def summary(self):
        return {"channels": self.channels, "pars": len(self.pars), "heads": len(self.heads),
                "fixtures": len(self.fixtures) or len(self.pars) + len(self.heads)}


PROFILES_DIR = os.path.join(LAYOUTS_DIR, "drivers", "profiles")


@functools.lru_cache(maxsize=1)
def profiles():
    """Every device type this box has a driver for, as {type: profile}.

    The drivers are JS and the registry that names them is JS, so this reads the
    same profile JSON those drivers read rather than keeping a second list in
    Python. It used to be a literal `13 if head13 else 7`, which quietly
    mis-measured every rig carrying anything else.
    """
    out = {}
    try:
        names = sorted(os.listdir(PROFILES_DIR))
    except OSError:
        return out
    for fn in names:
        if not fn.endswith(".profile.json"):
            continue
        try:
            with open(os.path.join(PROFILES_DIR, fn)) as fh:
                doc = json.load(fh)
        except (OSError, ValueError):
            continue
        if doc.get("type"):
            out[doc["type"]] = doc
    return out


def footprint_of(type_):
    """Channels this device occupies. Unknown types fall back to 7 -- the old
    default -- so an unrecognised layout is still listed rather than dropped."""
    p = profiles().get(type_)
    return (p or {}).get("footprint", 7)


def layouts():
    """Every rig this box can render, newest API first: layouts.js is the
    authority on what a layout is, so this only lists the files it would accept."""
    out = []
    for fn in sorted(os.listdir(LAYOUTS_DIR)):
        if not fn.endswith(".layout.json"):
            continue
        try:
            with open(os.path.join(LAYOUTS_DIR, fn)) as fh:
                doc = json.load(fh)
        except (OSError, ValueError):
            continue
        fx = doc.get("fixtures") or []
        kinds = {}
        for f in fx:
            kinds[f.get("type")] = kinds.get(f.get("type"), 0) + 1
        width = max((f["address"] + footprint_of(f.get("type")) - 1) for f in fx) if fx else 0
        # The page draws the rig, so it needs where each lamp is and what it is --
        # a count of kinds cannot be drawn. Positions only; nothing here is secret,
        # and a layout is already public over /api/layouts.
        shown = [{"id": f.get("id"), "type": f.get("type"), "at": f.get("at"),
                  "address": f.get("address"), "universe": f.get("universe", 0)}
                 for f in fx]
        prof = profiles()
        out.append({"file": fn, "rig": doc.get("rig") or fn[:-len(".layout.json")],
                    "fixtures": len(fx), "kinds": kinds, "channels": width,
                    "geometry": doc.get("geometry"), "note": doc.get("note"),
                    "placeholder": bool(doc.get("placeholder")),
                    "fixture_list": shown,
                    "profiles": {t: {"footprint": p.get("footprint"),
                                     "can": p.get("can", []),
                                     "beam": p.get("beam"),
                                     "cells": p.get("cells"),
                                     "invented": bool(p.get("invented")),
                                     "gdtf": p.get("gdtf")}
                                 for t, p in prof.items()
                                 if t in kinds},
                    "default": fn == DEFAULT_LAYOUT})
    return out

# Effects are no longer painted over finished bytes: portal/effects.js puts
# them in the arranger's plan and the real renderer draws them, so a hit reads
# the look it lands on the way frame.js intends. These two are kept only to
# describe a placement back to the page in channel terms.
PAR_LEVEL_OFFSETS = (1, 2, 3)   # colour.r, colour.g, colour.b
HEAD_LEVEL_OFFSET = 5           # master


def title_of(name):
    return " ".join(w if w.isupper() else w.capitalize() for w in name.replace("_", "-").split("-"))


def grid_clock(grid):
    """seconds for a (bar, beat), by the same rule protocol/session.js uses.

    Bar 1 begins on the first downbeat, whatever grid.first_bar says -- a score
    that opens on a pickup numbers that pickup bar 0, and anchoring on it puts
    every section a whole bar late. Checked against the baked shows: on levels,
    cipher-of-the-last-will and the-nights this reproduces bake.js's own section
    seconds exactly, and the last section ends within 0.35 s of song.length_s.
    """
    bpb = grid.get("beats_per_bar") or 4
    first = grid.get("first_beat_s") or 0.0
    tempo = grid.get("tempo") or [{"from_beat": 0, "at_s": first, "bpm": grid["bpm"]}]
    tempo = sorted(tempo, key=lambda s: s["from_beat"])

    def at_beat(n):
        seg = tempo[0]
        for cand in tempo:
            if cand["from_beat"] <= n:
                seg = cand
            else:
                break
        return seg["at_s"] + (n - seg["from_beat"]) * (60.0 / seg["bpm"])

    def seconds_at(bar, beat=1):
        return at_beat((bar - 1) * bpb + (beat - 1))

    return seconds_at, bpb


def S_at(grid, bar, beat=1):
    """Quick seconds_at from a grid dict, for v2 bake results."""
    sa, _ = grid_clock(grid)
    return sa(bar, beat)


def hub_get(path):
    with urllib.request.urlopen(HUB + path, timeout=20) as r:
        return json.load(r)


def hub_score(body):
    req = urllib.request.Request(HUB + "/hub/score", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def edits_token(edits):
    return hashlib.sha1(json.dumps(edits, sort_keys=True).encode()).hexdigest()[:10]


class Library:
    """The song list. One hub round-trip per song, so it is built once and held."""

    def __init__(self):
        self.lock = threading.Lock()
        self.songs = None
        self.built_at = 0.0

    def audio_for(self, name):
        for s in self.list():
            if s["name"] == name:
                return s["audio"]
        return None

    def list(self, refresh=False):
        with self.lock:
            if self.songs is not None and not refresh:
                return self.songs
            self.songs = self._build()
            self.built_at = time.time()
            return self.songs

    def _build(self):
        index = hub_get("/hub/score/?json")
        out = []
        for p in index.get("paths", []):
            name = p["name"][:-len(".score")] if p["name"].endswith(".score") else p["name"]
            row = {
                "name": name,
                "title": title_of(name),
                "audio": p.get("audio"),
                "version": p.get("version"),
                "bakeable": os.path.isfile(score_path(name)),
                "duration_s": None, "bpm": None, "bars": None,
                "sections": [], "energy": [], "unavailable": None,
            }
            try:
                d = hub_score({"score": name, "fields": ["grid", "song", "sections", "curves",
                                                         "key", "moments", "per_beat"],
                               "curves": ["energy"]})
            except (urllib.error.URLError, ValueError, OSError) as e:
                row["unavailable"] = "the hub would not describe this song (%s)" % e
                out.append(row)
                continue
            grid = d.get("grid") or {}
            song = d.get("song") or {}
            if not grid.get("bpm"):
                row["unavailable"] = "no tempo in the score"
                out.append(row)
                continue
            seconds_at, _ = grid_clock(grid)
            row["bpm"] = grid["bpm"]
            row["bars"] = song.get("bars")
            row["duration_s"] = song.get("length_s")
            row["sections"] = [{"name": s.get("name"),
                                "start": round(seconds_at(s["from"]["bar"], s["from"].get("beat", 1)), 3),
                                "end": round(seconds_at(s["to"]["bar"], s["to"].get("beat", 1)), 3)}
                               for s in (d.get("sections") or [])]
            # What a creator needs to know BEFORE spending an hour on a song.
            # grid.sure is the one number that predicts whether the lights will
            # sit tight against the music; it runs 0.00 to 0.94 across this
            # catalogue and the bottom of that range is not a rounding error.
            grid_sure = grid.get("sure")
            tempo = grid.get("tempo") or []
            key = d.get("key") or {}
            pb = d.get("per_beat") or {}
            lanes = {k: v for k, v in pb.items() if isinstance(v, list)}
            row["quality"] = {
                "sure": grid_sure,
                "lock": lock_words(grid_sure),
                "tempo_changes": max(0, len(tempo) - 1),
                "key": ((key.get("root") or "") + " " + (key.get("scale") or "")).strip() or None,
                "key_confidence": key.get("confidence"),
                "bars": song.get("bars"),
                "moments": len(d.get("moments") or []),
                "per_beat": bool(lanes),
                # a lane that is present but silent is not a stem that was found
                "stems": sorted(k for k, v in lanes.items() if any(x for x in v if x)),
                "stems_absent": sorted(k for k, v in lanes.items() if not any(x for x in v if x)),
            }
            row["cover"] = covers_index().get(name)
            energy = ((d.get("curves") or {}).get("energy") or {}).get("values") or []
            # A few scores have gaps in the curve. Keep them as gaps -- the
            # sparkline breaks its line there rather than drawing a number
            # nobody measured.
            row["energy"] = [None if v is None else round(float(v), 3) for v in energy]
            out.append(row)
        return out




def covers_index():
    try:
        with open(os.path.join(COVERS, "index.json")) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def lock_words(sure):
    """grid.sure in a creator's language. The bottom of the range is a warning,
    not a shrug: a show built on a grid this loose will drift against the music
    and no amount of effect placement will fix it."""
    if sure is None:
        return {"level": "unknown", "says": "the score does not say how sure it is of the beat"}
    if sure >= 0.8:
        return {"level": "tight", "says": "locks tight to the beat"}
    if sure >= 0.6:
        return {"level": "good", "says": "holds the beat well"}
    if sure >= 0.35:
        return {"level": "loose", "says": "the beat wanders; expect the lights to sit loosely"}
    return {"level": "unreliable",
            "says": "the beat grid is not trustworthy on this song — the lights will not lock"}


class Venues:
    """Rooms, not files. A venue is a name with one or more named layouts under
    it, because a room reconfigures and each configuration is a different rig.

    Local to the portal on purpose: this belongs on the hub beside the scores,
    and settling the shape in one place is cheaper than half-building it in two.
    """

    @staticmethod
    def _doc():
        with open(VENUES_FILE) as fh:
            return json.load(fh)

    @classmethod
    def all(cls):
        d = cls._doc()
        known = {r["file"] for r in layouts()}
        out = []
        for v in d.get("venues", []):
            lay = [l for l in v.get("layouts", []) if l.get("file") in known]
            if not lay:
                continue                       # a venue whose rig this box cannot render
            # Take the file that is actually there. The catalogue names one, but a
            # logo arrives as whatever the venue happens to have -- svg, png, jpg,
            # webp -- and a card that silently shows a monogram because somebody
            # saved a .png next to a .svg entry is a bug nobody thinks to look for.
            logo = v.get("logo")
            stem = os.path.splitext(logo)[0] if logo else v.get("id")
            has_logo = False
            for ext in (os.path.splitext(logo)[1] if logo else "", ".svg", ".png", ".jpg", ".jpeg", ".webp"):
                if ext and os.path.isfile(os.path.join(LOGOS, stem + ext)):
                    logo, has_logo = stem + ext, True
                    break
            out.append({**v, "layouts": lay,
                        "locked": v.get("access") == "locked",
                        "logo_url": ("/logos/" + logo) if has_logo else None,
                        "default": v.get("default") if any(l["file"] == v.get("default") for l in lay)
                                   else lay[0]["file"]})
        return out

    @classmethod
    def default(cls):
        d = cls._doc()
        vs = cls.all()
        want = d.get("default_venue")
        return next((v for v in vs if v["id"] == want), vs[0] if vs else None)

    @classmethod
    def get(cls, vid):
        return next((v for v in cls.all() if v["id"] == vid), None)

    @classmethod
    def search(cls, q):
        """Name match, then layout-name match. Anyone who does not care never
        has to type: no query returns everything with the default first."""
        vs = cls.all()
        dflt = cls.default()
        if not q:
            vs.sort(key=lambda v: (v.get("example", False), v["id"] != (dflt or {}).get("id"), v["name"]))
            return vs
        ql = q.strip().lower()
        scored = []
        for v in vs:
            name = v["name"].lower()
            hit = (0 if name.startswith(ql) else 1 if ql in name
                   else 2 if any(ql in l["name"].lower() for l in v["layouts"]) else None)
            if hit is not None:
                scored.append((hit, v.get("example", False), v["name"], v))
        scored.sort(key=lambda t: t[:3])
        return [t[3] for t in scored]

    @classmethod
    def may_use(cls, vid):
        """A venue owns its rig and says who may target it. Nothing here can
        grant access -- there is no account system -- so this only ever refuses,
        and says exactly what is missing rather than pretending to ask."""
        v = cls.get(vid)
        if not v:
            return {"ok": False, "why": "no such venue"}
        if v.get("access") == "locked":
            return {"ok": False, "locked": True,
                    "why": v.get("locked_because") or "this venue has not granted you access",
                    "can_request": False,
                    "note": "There is no request-access flow in this build. "
                            "Nothing is sent when you press that button."}
        return {"ok": True}

    @classmethod
    def describe(cls, vid, layout_file):
        """One line for the creator's header, and the detail for the picker."""
        v = cls.get(vid) or cls.default()
        if not v:
            return None
        lf = layout_file if any(l["file"] == layout_file for l in v["layouts"]) else v["default"]
        rig = next((r for r in layouts() if r["file"] == lf), None)
        lname = next((l["name"] for l in v["layouts"] if l["file"] == lf), None)
        return {"venue": {"id": v["id"], "name": v["name"], "example": v.get("example", False)},
                "layout": {"name": lname, "file": lf},
                "rig": rig}


class Shows:
    """Saved show files: intent only, never frames.

    Identity follows the hub's own model (hub/versions.py): a monotonic integer
    version that increments on every save, with each version kept beside the
    file so a creator can improve a show and anyone holding it can see there is
    a newer one. Two things the hub does not need and a marketplace does: a
    STABLE ID, so renaming a show does not make it a different show, and an
    AUTHOR, so a listing has someone behind it.
    """

    VDIR = ".versions"

    @staticmethod
    def _path(sid):
        return os.path.join(SHOWS, sid + ".show.json")

    @staticmethod
    def _read(path):
        try:
            with open(path) as fh:
                return json.load(fh)
        except (OSError, ValueError):
            return None

    @classmethod
    def list(cls):
        out = []
        if not os.path.isdir(SHOWS):
            return out
        for fn in sorted(os.listdir(SHOWS)):
            if not fn.endswith(".show.json"):
                continue
            doc = cls._read(os.path.join(SHOWS, fn))
            if doc is None:
                continue
            if "frames" in doc:
                # A show file with frames in it is not a show file.
                doc = {**doc, "invalid": "this file carries baked frames; a show is intent only"}
            doc.setdefault("id", fn[:-len(".show.json")])
            doc.setdefault("version", 1)
            doc.setdefault("author", "unknown")
            out.append({"file": fn, **doc})
        return out

    @classmethod
    def get(cls, sid):
        for row in cls.list():
            if row.get("id") == sid:
                return row
        return None

    @classmethod
    def save(cls, body):
        os.makedirs(SHOWS, exist_ok=True)
        name = ("".join(c if (c.isalnum() or c in "-_ ") else "-" for c in (body.get("name") or ""))
                .strip() or "untitled")
        author = (body.get("author") or "").strip() or "unknown"
        sid = body.get("id")
        prev = cls.get(sid) if sid else None
        if prev is None:
            sid = "shw_" + uuid.uuid4().hex[:12]
            version, created = 1, time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        else:
            version = int(prev.get("version", 1)) + 1
            created = prev.get("created") or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        doc = {
            "id": sid,
            "version": version,
            "author": author,
            "name": name,
            "song": body["song"],
            "seed": int(body.get("seed", 1)),
            "edits": validate_edits(body.get("edits") or []),
            "created": created,
            "updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        if body.get("appetite") is not None:
            doc["appetite"] = round(float(body["appetite"]), 3)
        # PROVENANCE, NOT A REQUIREMENT. Nothing reads this to decide whether a
        # show may run: it plays on any rig, with no warning and no downgrade.
        # It is here so a venue can find shows made for their own room, and so a
        # creator can see what they were looking at when they made it.
        # Which score this was made against. An override points at a gesture the
        # arranger generated, and a gesture is only stable while the score is --
        # improved scores are coming, so the file has to be able to say "this was
        # built against version 8" before anything depends on it.
        if body.get("score_version") is not None:
            doc["score_version"] = body["score_version"]
        # THE PLAN, where the show was built from one. A record of {seed, edits}
        # only reconstructs through the legacy bake; a show made from a plan
        # needs the plan back or it opens as a different show. Carrying it here
        # is what makes an entry in this list the show itself rather than a
        # pointer at the song's shared show file -- two shows for one song have
        # one file between them, so the file cannot tell them apart.
        if isinstance(body.get("plan"), dict):
            doc["plan"] = body["plan"]
        if body.get("plan_text"):
            doc["plan_text"] = str(body["plan_text"])
        dv = body.get("designed_for")
        if dv and dv.get("venue_id"):
            doc["designed_for"] = {"venue_id": dv.get("venue_id"),
                                   "venue_name": dv.get("venue_name"),
                                   "layout": dv.get("layout")}
        vdir = os.path.join(SHOWS, cls.VDIR, sid)
        os.makedirs(vdir, exist_ok=True)
        with open(os.path.join(vdir, "%d.show.json" % version), "w") as fh:
            json.dump(doc, fh, indent=1)
        with open(cls._path(sid), "w") as fh:
            json.dump(doc, fh, indent=1)
        return {"file": sid + ".show.json", **doc}

    @classmethod
    def history(cls, sid):
        vdir = os.path.join(SHOWS, cls.VDIR, sid)
        if not os.path.isdir(vdir):
            return []
        out = []
        for fn in sorted(os.listdir(vdir)):
            if not fn.endswith(".show.json"):
                continue
            doc = cls._read(os.path.join(vdir, fn))
            if doc:
                out.append({"version": doc.get("version"), "updated": doc.get("updated"),
                            "edits": len(doc.get("edits") or [])})
        return sorted(out, key=lambda x: x["version"] or 0)


class Market:
    """The marketplace SURFACE. Nothing here transacts, and nothing here holds a
    payment credential -- see entitlement(), which is a stub that always says
    yes and says so.

    Two things it does differently from an app store, both because a lighting
    show is deterministic:

      the product is the LICENCE, not the file. A show is a few kilobytes of
      intent and copies for nothing, so what is sold is the right to perform it,
      and the venue's player asks before a paid show runs.

      credibility is TELEMETRY, not stars. A buyer can watch the preview and
      judge by eye, so there is no review cold-start to solve. What a marketplace
      cannot fake is what the room did: how many venues played it through, and
      whether the operator reached for the master or took manual control while
      it ran. Those two signals come off the console in this same server.
    """

    TIERS = {
        "free":    {"label": "Free",            "perform": 0},
        "preview": {"label": "Preview / paid",  "perform": 1},
        "paid":    {"label": "Paid",            "perform": 1},
    }

    @staticmethod
    def _path(sid):
        return os.path.join(MARKET, sid + ".listing.json")

    @classmethod
    def list(cls):
        out = []
        if not os.path.isdir(MARKET):
            return out
        for fn in sorted(os.listdir(MARKET)):
            if not fn.endswith(".listing.json"):
                continue
            try:
                with open(os.path.join(MARKET, fn)) as fh:
                    doc = json.load(fh)
            except (OSError, ValueError):
                continue
            keys = ("id", "name", "author", "song", "seed", "version", "edits", "updated")
            show = Shows.get(doc.get("show_id"))
            if not show:
                continue
            doc["show"] = {k: show.get(k) for k in keys}
            doc["telemetry"] = ({"measured": False, "example": True}
                                if doc.get("example") else cls.telemetry(doc["show_id"]))
            out.append(doc)
        return out

    @classmethod
    def put(cls, body):
        kind = body.get("kind") or "show"
        tier = body.get("tier") if body.get("tier") in cls.TIERS else "free"
        os.makedirs(MARKET, exist_ok=True)
        # A SET IS JUST A LONG SONG: one recording, one score, one show file. The
        # track list is metadata for credit and discovery -- what Spotify calls
        # the cuts of a DJ mix -- and changes nothing about playback.
        cuts = [{"title": str(c.get("title", ""))[:160], "artist": str(c.get("artist", ""))[:120],
                 **({"at": float(c["at"])} if c.get("at") is not None else {})}
                for c in (body.get("cuts") or [])][:200]
        common = {"kind": kind, "tier": tier, "cuts": cuts,
                  # Where the track list came from, and -- when the tracks are not
                  # in this library -- the fact that what plays is a stand-in.
                  "cuts_source": (body.get("cuts_source") or "").strip()[:160] or None,
                  "stand_in": bool(body.get("stand_in")),
                  "blurb": (body.get("blurb") or "").strip()[:240],
                  "listed": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        # An EXAMPLE listing exists to show what the surface looks like at a
        # scale we do not have. It carries no telemetry, ever: numbers beside a
        # real person's name would assert a relationship that does not exist.
        if body.get("example"):
            common["example"] = True
            common["example_note"] = ("Example listing. Not a real account, no relationship "
                                      "exists, nothing here transacts and no payment is possible.")
        sid = body.get("show_id")
        show = Shows.get(sid)
        if not show:
            return {"error": "no such show"}
        doc = {"show_id": sid, "listed_version": show.get("version"), **common}
        with open(cls._path(sid), "w") as fh:
            json.dump(doc, fh, indent=1)
        return doc

    # ----- telemetry, collected by the console in this process ---------------
    @staticmethod
    def _plays_path(sid):
        return os.path.join(MARKET, sid + ".plays.json")

    @classmethod
    def record_play(cls, sid, rec):
        if not sid:
            return
        os.makedirs(MARKET, exist_ok=True)
        path = cls._plays_path(sid)
        try:
            with open(path) as fh:
                plays = json.load(fh)
        except (OSError, ValueError):
            plays = []
        plays.append(rec)
        with open(path, "w") as fh:
            json.dump(plays[-500:], fh, indent=1)

    @classmethod
    def telemetry(cls, sid):
        try:
            with open(cls._plays_path(sid)) as fh:
                plays = json.load(fh)
        except (OSError, ValueError):
            plays = []
        n = len(plays)
        return {
            "measured": True,
            "plays": n,
            "took_control": sum(1 for p in plays if p.get("took_control")),
            "pulled_master": sum(1 for p in plays if p.get("master_min", 1.0) < 0.9),
            "blackout": sum(1 for p in plays if p.get("blackout")),
            "seconds": round(sum(p.get("seconds", 0) for p in plays), 1),
            "note": ("no venue has played this yet" if not n else None),
        }


def entitlement(show_id, tier):
    """STUB. The real check belongs between a venue pressing play and the first
    frame of a paid show; this is the seam it will occupy. It always says yes,
    and every answer says so, so nothing downstream can mistake it for a
    licence check that happened."""
    return {
        "ok": True,
        "stub": True,
        "show_id": show_id,
        "tier": tier,
        "why": "STUB: no licence was checked and no payment exists. "
               "The real check goes here, before the first frame of a paid show.",
    }



class Baker:
    """Baking takes a second or two, so it runs off the request thread and the
    page polls the job. Raw bakes are cached on disk per (song, seed); edits are
    a post-pass, so changing a blackout never re-bakes."""

    def __init__(self):
        self.lock = threading.Lock()
        self.jobs = {}

    def start(self, song, seed, edits, appetite=None, layout=None):
        job_id = uuid.uuid4().hex[:12]
        with self.lock:
            self.jobs[job_id] = {"state": "baking", "song": song, "seed": seed, "edits": edits,
                                 "appetite": appetite, "layout": layout, "started": time.time()}
            for old in sorted(self.jobs, key=lambda k: self.jobs[k]["started"])[:-16]:
                self.jobs.pop(old, None)
        threading.Thread(target=self._run, args=(job_id, song, seed, edits, appetite, layout), daemon=True).start()
        return job_id

    def start_v2(self, song, plan_data, rig_name="club16-2head"):
        """Bake a show from a v2 plan (states/bindings/gestures) using baker.js."""
        job_id = uuid.uuid4().hex[:12]
        with self.lock:
            self.jobs[job_id] = {"state": "baking", "song": song, "plan": plan_data,
                                 "rig": rig_name, "started": time.time(), "v2": True}
            for old in sorted(self.jobs, key=lambda k: self.jobs[k]["started"])[:-16]:
                self.jobs.pop(old, None)
        threading.Thread(target=self._run_v2, args=(job_id, song, plan_data, rig_name), daemon=True).start()
        return job_id

    def _run_v2(self, job_id, song, plan_data, rig_name):
        try:
            payload = self._bake_v2(job_id, song, plan_data, rig_name)
            with self.lock:
                if job_id in self.jobs:
                    self.jobs[job_id].update(payload)
        except BaseException as e:                                # noqa: BLE001
            import traceback
            sys.stderr.write("_bake_v2 error: %s\n" % e)
            sys.stderr.flush()
            traceback.print_exc()
            with self.lock:
                if job_id in self.jobs:
                    self.jobs[job_id].update({"state": "failed", "error": str(e)})

    def _bake_v2(self, job_id, song, plan_data, rig_name):
        score = score_path(song)
        if not os.path.isfile(score):
            raise RuntimeError("no local score for %s" % song)

        venue_dir = os.path.join(HERE, "venues", rig_name)
        manifest_path = os.path.join(venue_dir, "manifest.json")
        if not os.path.isfile(manifest_path):
            raise RuntimeError("no venue manifest for %s" % rig_name)

        os.makedirs(WORK, exist_ok=True)
        plan_file = os.path.join(WORK, "%s.plan.json" % job_id)
        with open(plan_file, "w") as fh:
            json.dump(plan_data, fh)

        cache = os.path.join(WORK, "%s-v2-%s.lights.json" % (song, job_id))
        node = shutil.which("node")
        if not node:
            raise RuntimeError("node is not on PATH")

        if isinstance(plan_data, dict) and isinstance(plan_data.get("cues"), list):
            cmd = [node, BAKE_CUES, song, "--cues", plan_file, "--rig", rig_name, "--out", cache]
        else:
            cmd = [node, BAKE_V2, score, plan_file, "--rig", rig_name, "--lights", cache]
        r = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True)
        os.unlink(plan_file)
        if r.returncode != 0:
            raise RuntimeError("baker.js failed: " + (r.stderr or r.stdout).strip()[-400:])

        with open(cache) as fh:
            show = json.load(fh)

        rig_manifest = json.load(open(manifest_path))
        W = rig_manifest["total_channels"]
        frames = show["frames"]
        rigmap = Rigmap.of(show)
        buf = bytearray(len(frames) * W)
        for i, f in enumerate(frames):
            row = [max(0, min(255, int(v))) for v in f[:W]] + [0] * max(0, W - len(f))
            buf[i * W:(i + 1) * W] = LIMITS.apply(row[:W], rigmap, None)

        # Try to get sections from the hub; fall back to baker output
        grid = show.get("grid") or {}
        sections = []
        duration_s = show.get("duration")
        try:
            meta = hub_score({"score": song, "fields": ["grid", "song", "sections"]})
            grid = meta.get("grid") or grid
            duration_s = duration_s or (meta.get("song") or {}).get("length_s")
            sections = [{"name": x.get("name"),
                         "start": round(S_at(grid, x["from"]["bar"], x["from"].get("beat", 1)), 3),
                         "end": round(S_at(grid, x["to"]["bar"], x["to"].get("beat", 1)), 3),
                         "phase": x.get("name")}
                        for x in (meta.get("sections") or [])]
        except Exception:
            # hub unavailable: the baker's own phases already carry name + seconds,
            # so the editor still gets Section[]-shaped data (not bare start times).
            sections = [{"name": p.get("phase"), "start": p.get("start"),
                         "end": p.get("end"), "phase": p.get("phase")}
                        for p in (show.get("phases") or [])]

        return {
            "state": "ready",
            "show": {
                "song": song,
                "fps": show.get("fps", 40), "channels": W,
                "frame_count": len(frames),
                "duration_s": duration_s,
                "tempo": show.get("tempo"), "grid": grid,
                "sections": sections,
                "downbeats": show.get("downbeats") or [],
                "key_hue": show.get("key_hue"),
                "moments": show.get("moments") or [],
                "rig": rig_name, "layout": show.get("layout") or rig_manifest["layout_file"],
                "fixtures": show.get("fixtures") or [],
                "pars": rigmap.pars, "heads": rigmap.heads,
                "plan": show.get("plan"),
            },
            "frames_url": "/api/frames/%s.bin" % job_id,
            "bytes": bytes(buf),
        }

    def status(self, job_id):
        with self.lock:
            job = self.jobs.get(job_id)
            if not job:
                return None
            return {k: v for k, v in job.items() if k != "bytes"}

    def frames(self, job_id):
        with self.lock:
            job = self.jobs.get(job_id)
            return job.get("bytes") if job else None

    def _run(self, job_id, song, seed, edits, appetite, layout):
        try:
            payload = self._bake(job_id, song, seed, edits, appetite, layout)
            with self.lock:
                if job_id in self.jobs:
                    self.jobs[job_id].update(payload)
        except Exception as e:                                    # noqa: BLE001
            with self.lock:
                if job_id in self.jobs:
                    self.jobs[job_id].update({"state": "failed", "error": str(e)})

    def _bake(self, job_id, song, seed, edits, appetite=None, layout=None):
        score = score_path(song)
        if not os.path.isfile(score):
            raise RuntimeError("no local score for %s -- it cannot be baked here" % song)
        edits = validate_edits(edits)
        token = edits_token(edits) if edits else "plain"
        want = None if appetite is None else round(max(0.0, min(1.0, float(appetite))), 3)
        lay = layout or DEFAULT_LAYOUT
        if lay not in {r["file"] for r in layouts()}:
            raise RuntimeError("no such rig layout: %s" % lay)
        cache = os.path.join(WORK, "%s-%s-%s%s-%s.lights.json"
                             % (song, seed, token, "" if want is None else "-a%.3f" % want,
                                lay[:-len(".layout.json")]))
        os.makedirs(WORK, exist_ok=True)
        if not os.path.isfile(cache):
            node = shutil.which("node")
            if not node:
                raise RuntimeError("node is not on PATH; the baker needs it")
            spec = cache + ".edits.json"
            with open(spec, "w") as fh:
                json.dump(edits, fh)
            tmp = cache + ".partial"
            env = dict(os.environ)
            if want is not None:
                # arranger.js already honours this; the fader is that override.
                env["LIMELIGHT_APPETITE"] = "%.3f" % want
            cmd = [node, BAKE, score, str(seed), spec, "--lights", tmp]
            if lay != DEFAULT_LAYOUT:
                cmd += ["--layout", os.path.join(LAYOUTS_DIR, lay)]
            r = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True, env=env)
            os.unlink(spec)
            if r.returncode != 0:
                raise RuntimeError("bake failed: " + (r.stderr or r.stdout).strip()[-400:])
            os.replace(tmp, cache)
        with open(cache) as fh:
            show = json.load(fh)

        fps = show["fps"]
        frames = show["frames"]
        # The page draws from these bytes, so they are clamped by the venue's
        # ceiling too: the operator's screen shows the room, not the intent.
        # The rate cap is deliberately not applied here -- it depends on what was
        # actually last sent, which only the sender knows.
        rigmap = Rigmap.of(show)
        W = rigmap.channels
        buf = bytearray(len(frames) * W)
        for i, f in enumerate(frames):
            row = [max(0, min(255, int(v))) for v in f[:W]] + [0] * max(0, W - len(f))
            buf[i * W:(i + 1) * W] = LIMITS.apply(row[:W], rigmap, None)

        meta = hub_score({"score": song, "fields": ["grid", "song", "sections"]})
        grid = meta.get("grid") or {}
        seconds_at, bpb = grid_clock(grid)
        names = [x.get("name") for x in (meta.get("sections") or [])]
        phases = show.get("phases") or []
        if len(names) == len(phases):
            sections = [{"name": names[i], "start": ph["start"], "end": ph["end"],
                         "phase": ph.get("phase")} for i, ph in enumerate(phases)]
        else:
            sections = [{"name": x.get("name"),
                         "start": round(seconds_at(x["from"]["bar"], x["from"].get("beat", 1)), 3),
                         "end": round(seconds_at(x["to"]["bar"], x["to"].get("beat", 1)), 3),
                         "phase": None}
                        for x in (meta.get("sections") or [])]

        applied = describe_edits(show.get("applied") or [], fps, seconds_at, bpb, len(frames))
        return {
            "state": "ready",
            "show": {
                "song": song, "seed": seed,
                "fps": fps, "channels": W, "frame_count": len(frames),
                "duration_s": show.get("duration") or (meta.get("song") or {}).get("length_s"),
                "tempo": show.get("tempo"), "grid": grid,
                "sections": sections,
                "downbeats": show.get("downbeats") or [],
                "key_hue": show.get("key_hue"),
                "moments": show.get("moments") or [],
                "appetite": show.get("appetite"),
                "appetite_natural": show.get("appetite_natural"),
                "rig": show.get("rig"), "layout": show.get("layout") or lay,
                "fixtures": show.get("fixtures") or [],
                "plan": show.get("plan") or {"punctuation": [], "dynamics": [], "looks": []},
                "pars": rigmap.pars, "heads": rigmap.heads,
            },
            "applied": applied,
            "frames_url": "/api/frames/%s.bin" % job_id,
            "bytes": bytes(buf),
        }


# Which dials each typed effect actually reads, from readers/lights/frame.js. A
# creator may only turn dials the renderer looks at: an effect built here is the
# same grammar as a built-in one, so no rig can be handed something it cannot run.
DIALS = {
    "white_blast": ["coverage", "tone", "shape", "spread", "strength"],
    "blackout": ["strength"],
    "pause": ["strength"],
    "hook": ["strength"],
    "whiten": ["amount"],
    "accent_strobe": ["strength"],
    "modulate": ["gain", "motion"],
}
CHOICES = {
    "coverage": ["all", "inner", "outer", "ends", "left", "right", "odd", "even"],
    "tone": ["white", "key"],
    "shape": ["snap", "swell", "travel"],
}


def custom_effects():
    try:
        with open(CUSTOM) as fh:
            return json.load(fh).get("effects", [])
    except (OSError, ValueError):
        return []


def dial_filter(fx, params):
    """Only dials the renderer actually reads, only values it can use. One copy,
    shared by a saved custom effect and by a single placement's own dials."""
    allowed = DIALS.get(fx, [])
    out = {}
    for k, v in (params or {}).items():
        if k not in allowed:
            continue
        if k in CHOICES:
            if v in CHOICES[k]:
                out[k] = v
        else:
            try:
                out[k] = max(0.0, min(1.0, float(v)))
            except (TypeError, ValueError):
                pass
    return out


def dial_types():
    try:
        with open(CATALOG) as fh:
            return json.load(fh).get("dial_types") or {}
    except (OSError, ValueError):
        return {}


def clean_dial(name, value, rule, types):
    spec = dict(types.get(name) or {})
    for k in ("type", "min", "max", "values"):
        if isinstance(rule, dict) and k in rule:
            spec[k] = rule[k]
    kind = spec.get("type")
    if kind == "enum":
        return value if value in (spec.get("values") or []) else None
    if kind == "bool":
        return value if isinstance(value, bool) else None
    if kind == "colour":
        if not isinstance(value, (list, tuple)) or len(value) != 3:
            return None
        try:
            return [max(0.0, min(1.0, float(c))) for c in value]
        except (TypeError, ValueError):
            return None
    if kind in ("int", "float"):
        if isinstance(value, bool):
            return None
        try:
            n = float(value)
        except (TypeError, ValueError):
            return None
        n = max(float(spec.get("min", 0.0)), min(float(spec.get("max", 1.0)), n))
        return int(round(n)) if kind == "int" else n
    return None


def effect_dials(spec, params):
    declared = spec.get("dials")
    if not isinstance(declared, dict):
        return dial_filter(spec.get("fx"), params)
    types = dial_types()
    out = {}
    for k, v in (params or {}).items():
        if k not in declared:
            continue
        clean = clean_dial(k, v, declared[k], types)
        if clean is not None:
            out[k] = clean
    return out


def save_custom(body):
    base = {e["id"]: e for e in json.load(open(CATALOG))["effects"]}.get(body.get("base"))
    if not base:
        return {"error": "no such effect to start from"}
    params = dict(base.get("params") or {})
    params.update(dial_filter(base["fx"], body.get("params")))
    if params.get("coverage") == "all":
        params.pop("coverage", None)
    name = (body.get("name") or "").strip()[:40] or "My effect"
    eid = body.get("id") or ("own_" + uuid.uuid4().hex[:8])
    doc = {"id": eid, "name": name, "blurb": (body.get("blurb") or "").strip()[:120]
           or ("%s, re-dialled" % base["name"]),
           "fx": base["fx"], "base": base["id"], "own": True,
           "beats": max(1, min(64, int(body.get("beats") or base["beats"]))),
           "params": params}
    rows = [e for e in custom_effects() if e["id"] != eid] + [doc]
    with open(CUSTOM, "w") as fh:
        json.dump({"note": "Effects a creator built by re-dialling a built-in one. "
                           "Same grammar, so they travel to any rig.", "effects": rows}, fh, indent=1)
    return doc


def delete_custom(eid):
    rows = [e for e in custom_effects() if e["id"] != eid]
    with open(CUSTOM, "w") as fh:
        json.dump({"effects": rows}, fh, indent=1)
    return {"deleted": eid}


def catalog(limits=None):
    with open(CATALOG) as fh:
        out = json.load(fh)["effects"] + custom_effects()
    if limits is None:
        return out
    # Not offered, rather than offered and clamped: an effect the venue has
    # ruled out never appears in the palette, so nobody places one and then
    # wonders why the room stayed dark.
    return [e for e in out if not limits.forbids(e)]


def validate_edits(edits):
    """Only effects the renderer actually draws get through. An edit the palette
    does not name is dropped here rather than silently ignored downstream."""
    known = {e["id"]: e for e in catalog(LIMITS)}
    out = []
    for e in (edits or []):
        spec = known.get(e.get("type"))
        if not spec:
            continue
        # schema 1 said `beats` and `fx`; schema 2 says `default_beats` and
        # `dimension`. Accept either, so a catalogue swap cannot break placing.
        fallback = spec.get("beats", spec.get("default_beats", 1))
        row = {"type": e["type"], "bar": int(e["bar"]),
               "beat": max(1, min(16, int(e.get("beat") or 1))),
               "beats": max(1, min(256, int(round(float(e.get("beats", fallback) or 1)))))}
        dials = effect_dials(spec, e.get("params"))
        if dials:
            row["params"] = dials
        if e.get("off"):
            row["off"] = True
        out.append(row)
    return out


def describe_edits(applied, fps, seconds_at, bpb, frame_count):
    """Where each placement landed, in the page's own terms."""
    out = []
    for a in applied:
        if a.get("skipped"):
            out.append(a)
            continue
        bar, beats = a["bar"], a["beats"]
        beat = a.get("beat", 1)
        t0 = seconds_at(bar, beat)
        t1 = t0 + beats * (seconds_at(bar, 2) - seconds_at(bar, 1))
        out.append({"type": a["type"], "bar": bar, "beat": beat, "beats": beats,
                    "from_s": round(t0, 3), "to_s": round(t1, 3),
                    "from_frame": max(0, int(round(t0 * fps))),
                    "to_frame": min(frame_count, int(round(t1 * fps))),
                    "hue": a.get("hue")})
    return out



# ── the venue's ceiling ──────────────────────────────────────────────────────

class Limits:
    """What the room allows, whatever the show asks for.

    One pure function stands between every frame and the wire. It runs AFTER the
    live trims, so a fader can only ever ask for less than the ceiling, and it
    runs on park frames too -- there is no path from a show, an edit, a fader or
    a bug to a channel value this has not seen.

    The idiom is preflight.js's: a capability exists only if the layout declares
    the limit that makes it safe (`laser_sweep` needs `limits.laser_zones`).
    Here the same rule runs the other way as well -- see catalog(), which stops
    offering an effect the venue has ruled out instead of clamping it later.
    """

    def __init__(self, doc):
        self.doc = doc
        mi = doc.get("max_intensity") or {}
        self.par_max = float(mi.get("par", 1.0))
        self.head_max = float(mi.get("head", 1.0))
        st = doc.get("strobe") or {}
        self.strobe_allowed = bool(st.get("allowed", True))
        self.strobe_max = int(st.get("max", 255)) if self.strobe_allowed else 0
        self.keep_out = [(float(z["pan_from_deg"]), float(z["pan_to_deg"]), z.get("name", "zone"))
                         for z in (doc.get("keep_out") or []) if "pan_from_deg" in z]
        mr = doc.get("max_rate") or {}
        self.rate_up = mr.get("intensity_up_per_frame")
        self.rate_pan = mr.get("pan_per_frame")
        self.rate_tilt = mr.get("tilt_per_frame")
        self.blocked = 0                  # frames in which something was pulled down

    @classmethod
    def load(cls, path):
        with open(path) as fh:
            return cls(json.load(fh))

    # rig.py, verified by live probing on the real head
    PAN_CENTRE = 169.0
    PAN_DEG_PER_DMX = 540.0 / 255.0

    def pan_deg(self, coarse, fine):
        return ((coarse * 256 + fine) / 256.0 - self.PAN_CENTRE) * self.PAN_DEG_PER_DMX

    def in_keep_out(self, deg):
        """Compared on the circle, so a zone still catches a head that has spun
        past +-180 to reach the same physical direction."""
        for a, b, name in self.keep_out:
            lo, hi = (a, b) if a <= b else (b, a)
            d = ((deg - lo) % 360.0 + 360.0) % 360.0
            if d <= ((hi - lo) % 360.0 + 360.0) % 360.0:
                return name
        return None

    def apply(self, frame, rigmap, prev=None):
        """frame: one DMX frame. rigmap: which channels are what, for the layout
        this show was baked against. prev: what actually went out last, for the
        rate cap."""
        f = list(frame)
        hit = False
        P, H = rigmap.PAR, rigmap.HEAD

        for a in rigmap.pars:
            base = a - 1
            for off in (P["r"], P["g"], P["b"]):
                v = int(f[base + off] * self.par_max)
                if v != f[base + off]:
                    hit = True
                f[base + off] = v
            if f[base + P["strobe"]] > self.strobe_max:
                f[base + P["strobe"]] = self.strobe_max
                hit = True

        for a in rigmap.heads:
            h = a - 1
            v = int(f[h + H["dim"]] * self.head_max)
            if v != f[h + H["dim"]]:
                hit = True
            f[h + H["dim"]] = v
            if f[h + H["strobe"]] > self.strobe_max:
                f[h + H["strobe"]] = self.strobe_max
                hit = True
            if self.keep_out:
                deg = self.pan_deg(f[h + H["pan"]], f[h + H["pan_fine"]])
                if self.in_keep_out(deg) is not None and f[h + H["dim"]]:
                    f[h + H["dim"]] = 0
                    hit = True

        if prev is not None and len(prev) == len(f):
            if self.rate_up is not None:
                cap = int(self.rate_up)
                for idx in rigmap.par_level_idx() + rigmap.head_dim_idx():
                    ceiling = prev[idx] + cap
                    if f[idx] > ceiling:
                        f[idx] = ceiling
                        hit = True
            for a in rigmap.heads:
                h = a - 1
                for off, cap in ((H["pan"], self.rate_pan), (H["tilt"], self.rate_tilt)):
                    if cap is None:
                        continue
                    d = f[h + off] - prev[h + off]
                    if abs(d) > cap:
                        f[h + off] = prev[h + off] + (cap if d > 0 else -cap)
                        hit = True

        if hit:
            self.blocked += 1
        return bytes(max(0, min(255, int(x))) for x in f)

    def forbids(self, effect):
        """Whether the venue has ruled an effect out entirely."""
        if not self.strobe_allowed and (effect.get("fx") == "accent_strobe"
                                        or effect.get("id") in ("gear", "strip")
                                        or (effect.get("params") or {}).get("strobe")):
            return "strobe is off in this venue"
        if self.par_max <= 0 and self.head_max <= 0:
            return "this venue allows no light at all"
        return None

    def summary(self):
        return {
            "venue": self.doc.get("venue"),
            "max_intensity": {"par": self.par_max, "head": self.head_max},
            "strobe": {"allowed": self.strobe_allowed, "max": self.strobe_max},
            "keep_out": [{"name": n, "from": a, "to": b} for a, b, n in self.keep_out],
            "max_rate": {"intensity_up_per_frame": self.rate_up,
                         "pan_per_frame": self.rate_pan, "tilt_per_frame": self.rate_tilt},
            "frames_clamped": self.blocked,
        }


class Trims:
    """The live console. These scale output and nothing else: the show file is
    never written to, and releasing snaps back to the show exactly as authored."""

    def __init__(self):
        self.master = 1.0
        self.par = 1.0
        self.head = 1.0
        self.blackout = False
        self.strobe_kill = False
        self.hold = False
        # milliseconds the lamps are sent EARLY. A par lights a frame or two after
        # the packet arrives and the head's dimmer later still; without this every
        # hit landed a hair after the sound. Set per room, by ear.
        self.lead_ms = 40.0

    def set(self, body):
        for k in ("master", "par", "head"):
            if k in body:
                setattr(self, k, max(0.0, min(1.0, float(body[k]))))
        for k in ("blackout", "strobe_kill", "hold"):
            if k in body:
                setattr(self, k, bool(body[k]))
        if "lead_ms" in body:
            self.lead_ms = max(-300.0, min(300.0, float(body["lead_ms"])))
        return self.state()

    def state(self):
        return {"master": self.master, "par": self.par, "head": self.head,
                "blackout": self.blackout, "strobe_kill": self.strobe_kill, "hold": self.hold,
                "lead_ms": self.lead_ms}

    def apply(self, frame, rigmap):
        f = list(frame)
        P, H = rigmap.PAR, rigmap.HEAD
        if self.blackout:
            for idx in rigmap.par_level_idx() + rigmap.head_dim_idx():
                f[idx] = 0
            return f
        par_k = self.master * self.par
        head_k = self.master * self.head
        for idx in rigmap.par_level_idx():
            f[idx] = int(f[idx] * par_k)
        for idx in rigmap.head_dim_idx():
            f[idx] = int(f[idx] * head_k)
        if self.strobe_kill:
            for idx in rigmap.par_strobe_idx() + rigmap.head_strobe_idx():
                f[idx] = 0
        return f


class Rig:
    """Art-Net out, on the portal's own socket.

    The frames leave on the browser's clock, not a clock of our own: the page
    posts where its audio actually is a few times a second and this thread
    carries that forward between posts, which is the same anchoring
    protocol/clock.js does for the canvas. If no post has arrived for
    STALE_S the rig is parked rather than fed a guess -- lights running on a
    clock nobody is checking is how a rig ends up out of step with the room.

    Nothing here can report an "on" it has not earned. There is no null sender:
    either a real socket exists and `sent` counts real sendto() calls, or
    `sender` is None and the status says exactly why.
    """
    STALE_S = 0.4

    def __init__(self, enabled, gateway, universe, limits, trims, bind=None):
        self.limits = limits
        self.trims = trims
        self.pending = None          # a rebuilt show waiting for its bar line
        self.swap_at = None
        self.swaps = 0
        self.held_frame = None       # what the stage is holding while taken
        self.show_id = None          # the saved show this job came from, for telemetry
        self.rigmap = Rigmap([], 41)
        self.play = None             # what the operator did during this armed session
        self.lock = threading.Lock()
        self.gateway, self.universe = gateway, universe
        self.sender = None
        self.open_error = None if enabled else "started with --no-net"
        self.park = None
        self.armed = False
        self.frames = None
        self.fps = 40
        self.frame_count = 0
        self.job = None
        self.anchor_pos = 0.0
        self.anchor_wall = 0.0
        self.sent = 0
        self.parked = 0
        self.last_index = None
        self.last_error = None
        self.last_ok = 0.0            # monotonic time of the last sendto that did not raise
        self.last_frame = None        # what actually went out, for the rate cap
        self.started = time.time()
        self.enabled, self.bind = enabled, bind
        self.last_try = 0.0
        if enabled:
            self._open()
        self.stop = threading.Event()
        threading.Thread(target=self._run, daemon=True).start()

    # ----- which interface would actually carry the packets ---------------
    def _route(self):
        """The local address the OS would use to reach the gateway, and whether
        that address is on the gateway's own network.

        A UDP socket opens whether or not the rig is reachable, and Art-Net is
        one-way, so "the socket exists" is not "the lamps are being driven" --
        that is the --no-net trap wearing a different hat. What the OS WILL tell
        us is which interface it picked. With the Art-Net cable unplugged, the
        route to 2.0.0.100 resolves to the wifi address and the frames leave down
        the default route into the internet. Report the fact and let a person see
        it; do not refuse on a guess, because an unusual venue setup is not our
        business to veto.
        """
        try:
            probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            try:
                probe.connect((self.gateway, 6454))      # Art-Net's port; a UDP connect only does a route lookup
                local = probe.getsockname()[0]
            finally:
                probe.close()
        except Exception as e:                                    # noqa: BLE001
            return None, False, "no route to %s: %s" % (self.gateway, e)
        same = local.split(".")[0] == self.gateway.split(".")[0]
        if same:
            return local, True, None
        return local, False, ("frames would leave via %s, which is not on the Art-Net "
                              "network (%s) -- check the cable and the interface"
                              % (local, self.gateway))

    # ----- the socket, which may not be openable yet ----------------------
    def _open(self):
        """Try to open the Art-Net socket. Safe to call repeatedly.

        The socket used to be opened exactly once, at startup, and never again.
        That is the wrong shape for a venue: the laptop is up before the rig is,
        somebody plugs the ethernet in, and the portal goes on insisting it
        cannot send until a person thinks to restart it -- at a gig, with the
        room filling. Now it retries, so plugging the cable in is enough.
        """
        if self.sender is not None:
            return True
        now = time.monotonic()
        if now - self.last_try < 2.0:        # do not hammer a down interface
            return False
        self.last_try = now
        try:
            import artnet
            import rig as rigmod
            # bind_ip is a deployment fact, not a constant: a venue whose
            # Art-Net NIC is not on 2.0.0.1 has to say so.
            self.sender = artnet.Sender(gateway=self.gateway, universe=self.universe, pad_to=512,
                                        **({"bind_ip": self.bind} if self.bind else {}))
            self.park = None          # built per show: a park frame is layout-wide
            self._rigmod = rigmod
            self.open_error = None
            return True
        except Exception as e:                                # noqa: BLE001
            self.sender, self.open_error = None, "%s: %s" % (type(e).__name__, e)
            return False

    # ----- what is holding the universe -----------------------------------
    def panel_conflict(self):
        """The dev panel owns the same universe. Two senders on one universe is
        a rig that flickers between two shows, so say so instead of joining in."""
        try:
            with urllib.request.urlopen(PANEL + "/api/status", timeout=1.5) as r:
                st = json.load(r)
        except Exception:                                          # noqa: BLE001
            return None
        if st.get("net") and st.get("playing"):
            return "the panel at %s is playing %s with output on" % (PANEL, st.get("track"))
        return None

    def load(self, job, frames, fps, frame_count, show_id=None, rigmap=None):
        with self.lock:
            self.job, self.frames, self.fps, self.frame_count = job, frames, fps, frame_count
            if rigmap is not None:
                self.rigmap = rigmap
                self.park = (self._rigmod.park_frame(rigmap.channels)
                             if getattr(self, "_rigmod", None) else None)
            if show_id is not None:
                self.show_id = show_id
            self.pending = self.swap_at = None
            self.anchor_wall = 0.0

    def prepare(self, job, frames, fps, frame_count, at_position):
        """Hold a rebuilt show and change to it inside the sender the moment the
        song passes `at_position`. The swap is one assignment under the lock
        between two 25 ms frames, so the wire never sees a gap: the appetite
        fader can rebuild the whole plan without the room noticing."""
        with self.lock:
            if frame_count != self.frame_count or fps != self.fps:
                return {"error": "that rebuild does not line up with the running show"}
            if len(frames) // max(1, frame_count) != self.rigmap.channels:
                return {"error": "that rebuild is for a different rig; reload it instead"}
            self.pending = (job, frames, fps, frame_count)
            self.swap_at = float(at_position)
            return {"swap_at": self.swap_at, "job": job}

    def arm(self, on):
        if on:
            # try the socket again here too: somebody who just plugged the cable
            # in will press Arm, not wait for a status poll
            if self.sender is None and not (self.enabled and self._open()):
                return {"error": "no Art-Net output: %s" % self.open_error}
            clash = self.panel_conflict()
            if clash:
                return {"error": "not arming: " + clash}
            if self.frames is None:
                return {"error": "no show loaded"}
        with self.lock:
            self.armed = bool(on)
            if on:
                # One armed session is one "play": what the operator reached for
                # while it ran is the only review a marketplace cannot fake.
                self.play = {"started": time.monotonic(), "master_min": self.trims.master,
                             "took_control": False, "blackout": False, "frames": self.sent}
            else:
                self.anchor_wall = 0.0
        if not on:
            self._park(3)
            self._close_play()
        return self.status()

    def note_trim(self):
        """Called after every fader move, so the record is what actually happened."""
        with self.lock:
            if not self.play:
                return
            self.play["master_min"] = min(self.play["master_min"], self.trims.master)
            if self.trims.hold:
                self.play["took_control"] = True
            if self.trims.blackout:
                self.play["blackout"] = True

    def _close_play(self):
        with self.lock:
            p, sid = self.play, self.show_id
            self.play = None
        if not p or not sid:
            return
        secs = round((p["frames"] and 0) + (self.sent - p["frames"]) / 40.0, 1)
        if secs < 5:
            return                       # an arm-and-disarm is not a performance
        Market.record_play(sid, {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                                 "seconds": secs, "master_min": round(p["master_min"], 3),
                                 "took_control": p["took_control"], "blackout": p["blackout"]})

    def at(self, job, position):
        with self.lock:
            if job != self.job:
                return False
            self.anchor_pos = float(position)
            self.anchor_wall = time.monotonic()
            return True

    def _park(self, repeats=1):
        if self.sender is None or self.park is None:
            return
        if self.park is None:
            return
        try:
            dark = self.limits.apply(self.park, self.rigmap, None)
            for _ in range(repeats):
                self.sender.send(dark)
                self.parked += 1
            self.last_frame = dark
        except OSError as e:
            self.last_error = str(e)

    def _run(self):
        period = 1.0 / 40.0
        was_live = False
        while not self.stop.wait(period):
            with self.lock:
                armed, frames, fps = self.armed, self.frames, self.fps
                count, anchor, wall = self.frame_count, self.anchor_pos, self.anchor_wall
                held = self.trims.hold
                rm = self.rigmap
                W = rm.channels
            if not (armed and frames is not None and self.sender is not None):
                if was_live:
                    self._park(2)
                    was_live = False
                continue
            # Taken: the operator owns the stage and the song's clock stops
            # mattering. Holding has to survive the clock going away entirely --
            # that is the whole point of taking control -- so this is checked
            # before the staleness guard, not after it.
            if held and self.held_frame is not None:
                try:
                    out = self.limits.apply(self.trims.apply(self.held_frame, rm), rm, self.last_frame)
                    self.last_frame = out
                    self.sender.send(out)
                    self.sent += 1
                    self.last_ok = time.monotonic()
                    was_live = True
                except OSError as e:
                    self.last_error = str(e)
                    was_live = False
                continue

            age = time.monotonic() - wall if wall else 1e9
            if age > self.STALE_S:
                if was_live:
                    self._park(2)
                    was_live = False
                continue
            pos = anchor + age + self.trims.lead_ms / 1000.0   # the lamps are sent early by their own response time
            with self.lock:
                if self.pending and self.swap_at is not None and pos >= self.swap_at:
                    self.job, self.frames, self.fps, self.frame_count = self.pending
                    frames, fps, count = self.frames, self.fps, self.frame_count
                    self.pending = self.swap_at = None
                    self.swaps += 1
            idx = int(pos * fps)
            if idx < 0 or idx >= count:
                if was_live:
                    self._park(2)
                    was_live = False
                continue
            try:
                if held:
                    raw = self.held_frame or frames[idx * W:(idx + 1) * W]
                    self.held_frame = raw
                else:
                    raw = frames[idx * W:(idx + 1) * W]
                    self.held_frame = None
                out = self.limits.apply(self.trims.apply(raw, rm), rm, self.last_frame)
                self.last_frame = out
                self.sender.send(out)
                self.sent += 1
                self.last_index = idx
                self.last_ok = time.monotonic()
                was_live = True
            except OSError as e:
                self.last_error = "%s (frame %d)" % (e, idx)
                was_live = False

    def status(self):
        with self.lock:
            wall, armed = self.anchor_wall, self.armed
        age = (time.monotonic() - wall) if wall else None
        # "sending" means packets are leaving, not that we intend them to: a
        # socket that raises on every sendto is not a rig that is lit.
        since_ok = (time.monotonic() - self.last_ok) if self.last_ok else None
        live = bool(armed and self.sender is not None
                    and since_ok is not None and since_ok <= self.STALE_S
                    and (self.trims.hold or (age is not None and age <= self.STALE_S)))
        return {
            "can_send": (self.sender is not None) or (self.enabled and self._open()),
            "why_not": self.open_error or (self._route()[2] if self.enabled else None),
            "route_via": self._route()[0],
            "route_ok": self._route()[1],
            "gateway": self.gateway, "universe": self.universe,
            "armed": armed,
            "sending": live,
            "frames_sent": self.sent,
            "park_frames_sent": self.parked,
            "last_index": self.last_index,
            "last_error": self.last_error,
            "last_send_ok_ms": None if since_ok is None else int(since_ok * 1000),
            "anchor_age_ms": None if age is None else int(age * 1000),
            "loaded": self.job is not None,
            "swaps": self.swaps,
            "pending": self.swap_at,
            "trim": self.trims.state(),
            "show_id": self.show_id,
            "rigmap": self.rigmap.summary(),
            "limits": self.limits.summary(),
            "conflict": self.panel_conflict() if armed or self.sender is None else None,
        }


def make_handler(library, baker, rig):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):
            if args and not str(args[0]).startswith("GET /api/show?"):
                sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

        # ----- CORS -----
        CORS_ORIGINS = tuple(
            "http://%s:%d" % (host, port)
            for host in ("localhost", "127.0.0.1")
            for port in (3000, 3001, 3002, 3003, 3004, 4000, 4001, 5173, 8080)
        )

        def _cors(self):
            origin = self.headers.get("Origin") or ""
            if origin in self.CORS_ORIGINS:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Access-Control-Allow-Credentials", "true")
            self.send_header("Vary", "Origin")

        def do_OPTIONS(self):
            self.send_response(204)
            origin = self.headers.get("Origin") or ""
            if origin in self.CORS_ORIGINS:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
                self.send_header("Access-Control-Max-Age", "86400")
                self.send_header("Access-Control-Allow-Credentials", "true")
            self.send_header("Content-Length", "0")
            self.end_headers()

        # ----- helpers -----
        def _json(self, obj, code=200):
            body = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self._cors()
            self.end_headers()
            self.wfile.write(body)

        def _body(self):
            n = int(self.headers.get("Content-Length") or 0)
            return json.loads(self.rfile.read(n) or b"{}") if n else {}

        def _raw_body(self):
            n = int(self.headers.get("Content-Length") or 0)
            if not n:
                return b""
            chunks, remaining = [], n
            while remaining > 0:
                chunk = self.rfile.read(min(remaining, 1 << 20))
                if not chunk:
                    break
                chunks.append(chunk)
                remaining -= len(chunk)
            return b"".join(chunks)

        def _bytes(self, blob, ctype):
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(blob)))
            self.send_header("Cache-Control", "no-store")
            self._cors()
            self.end_headers()
            self.wfile.write(blob)

        def _file(self, path, ctype):
            with open(path, "rb") as fh:
                self._bytes(fh.read(), ctype)

        def _proxy_audio(self, song):
            audio = library.audio_for(song)
            if not audio:
                return self._json({"error": "no audio for %s" % song}, 404)
            req = urllib.request.Request(HUB + "/hub/audio/" + audio)
            rng = self.headers.get("Range")
            if rng:
                req.add_header("Range", rng)
            try:
                up = urllib.request.urlopen(req, timeout=30)
            except urllib.error.HTTPError as e:
                return self._json({"error": "hub returned %s for %s" % (e.code, audio)}, e.code)
            except urllib.error.URLError as e:
                return self._json({"error": "hub unreachable: %s" % e}, 502)
            with up:
                self.send_response(up.status)
                for h in ("Content-Type", "Content-Length", "Content-Range"):
                    if up.headers.get(h):
                        self.send_header(h, up.headers[h])
                self.send_header("Accept-Ranges", "bytes")
                self._cors()
                self.end_headers()
                while True:
                    chunk = up.read(65536)
                    if not chunk:
                        break
                    self.wfile.write(chunk)

        # ----- upload -----
        MAX_UPLOAD = 100 * 1024 * 1024  # 100 MB

        def _handle_upload(self):
            ctype = self.headers.get("Content-Type", "")
            length = int(self.headers.get("Content-Length") or 0)
            if length > self.MAX_UPLOAD:
                self._raw_body()  # drain so the connection stays clean
                return self._json({"error": "file too large (max 100 MB)"}, 413)
            if "multipart/form-data" not in ctype:
                return self._json({"error": "expected multipart/form-data"}, 400)
            # extract boundary from Content-Type header
            boundary = None
            for part in ctype.split(";"):
                part = part.strip()
                if part.startswith("boundary="):
                    boundary = part[len("boundary="):]
                    break
            if not boundary:
                return self._json({"error": "no boundary in Content-Type"}, 400)
            raw = self._raw_body()
            if not raw:
                return self._json({"error": "empty body"}, 400)

            # parse multipart: find the file part
            sep = ("--" + boundary).encode()
            parts = raw.split(sep)
            file_data, filename = None, None
            for p in parts:
                if b"Content-Disposition:" not in p and b"content-disposition:" not in p:
                    continue
                # find headers vs body (split on double CRLF)
                header_end = p.find(b"\r\n\r\n")
                if header_end < 0:
                    continue
                headers_block = p[:header_end].decode("utf-8", errors="replace")
                body_bytes = p[header_end + 4:]
                # strip trailing \r\n before next boundary
                if body_bytes.endswith(b"\r\n"):
                    body_bytes = body_bytes[:-2]
                # parse filename from Content-Disposition
                for line in headers_block.split("\r\n"):
                    low = line.lower()
                    if "content-disposition:" in low and 'filename="' in low:
                        idx = low.index('filename="')
                        rest = line[idx + len('filename="'):]
                        filename = rest.split('"')[0]
                        break
                    if "content-disposition:" in low and "filename=" in low:
                        idx = low.index("filename=")
                        rest = line[idx + len("filename="):]
                        filename = rest.strip().strip('"').split('"')[0]
                        break
                if filename:
                    file_data = body_bytes
                    break

            if not filename or file_data is None:
                return self._json({"error": "no file found in the upload"}, 400)
            if not filename.lower().endswith(".mp3"):
                return self._json({"error": "only .mp3 files are accepted"}, 400)

            # sanitise: keep only safe characters in the filename
            safe = "".join(c if (c.isalnum() or c in "-_. ") else "_" for c in filename).strip()
            if not safe.lower().endswith(".mp3"):
                safe += ".mp3"

            # forward to hub: PUT /hub/score/<name>.mp3
            put_url = "%s/hub/score/%s" % (HUB, urllib.parse.quote(safe))
            try:
                req = urllib.request.Request(put_url, data=file_data, method="PUT")
                req.add_header("Content-Type", "application/octet-stream")
                req.add_header("Content-Length", str(len(file_data)))
                with urllib.request.urlopen(req, timeout=120) as r:
                    r.read()
            except urllib.error.HTTPError as e:
                return self._json({"error": "hub upload failed: %s" % e.code}, 502)
            except (urllib.error.URLError, OSError) as e:
                return self._json({"error": "hub unreachable: %s" % e}, 502)

            # trigger generation: POST /hub/score/<name>.mp3?generate
            gen_url = "%s/hub/score/%s?generate" % (HUB, urllib.parse.quote(safe))
            try:
                req = urllib.request.Request(gen_url, data=b"", method="POST")
                req.add_header("Content-Length", "0")
                with urllib.request.urlopen(req, timeout=30) as r:
                    result = json.load(r)
                job = result.get("job") or {}
                return self._json({
                    "job_id": job.get("id", ""),
                    "name": job.get("name", safe),
                    "status": job.get("status", "queued"),
                })
            except urllib.error.HTTPError as e:
                code = e.code
                try:
                    err_body = e.read().decode()
                except Exception:
                    err_body = ""
                if code == 409:
                    return self._json({"error": "score generation already in progress for this file",
                                       "name": safe}, 409)
                return self._json({"error": "hub generate failed: %s %s" % (code, err_body)}, 502)
            except (urllib.error.URLError, OSError) as e:
                return self._json({"error": "hub unreachable for generation: %s" % e}, 502)

        # ----- routes -----
        def do_GET(self):
            u = urlparse(self.path)
            path = unquote(u.path)
            q = parse_qs(u.query)

            if path == "/" or path == "/index.html":
                return self._file(os.path.join(HERE, "index.html"), "text/html; charset=utf-8")
            for asset, ctype in (("/app.js", "text/javascript"), ("/style.css", "text/css")):
                if path == asset:
                    return self._file(os.path.join(HERE, asset[1:]), ctype + "; charset=utf-8")
            if path == "/protocol/clock.js":
                # The page uses the repo's own AnchoredClock rather than a copy of
                # it, so there is one clock in this repo and not two.
                return self._file(os.path.join(REPO, "protocol", "clock.js"),
                                  "text/javascript; charset=utf-8")

            if path == "/favicon.ico":
                return self._bytes(b"", "image/x-icon")

            if path == "/api/songs":
                try:
                    songs = library.list(refresh=q.get("refresh", ["0"])[0] == "1")
                except (urllib.error.URLError, OSError) as e:
                    return self._json({"error": "the hub at %s is not answering (%s)" % (HUB, e)}, 502)
                return self._json({"hub": HUB, "songs": songs})

            if path == "/api/upload/status":
                job_id = (q.get("job") or [""])[0]
                if not job_id:
                    return self._json({"error": "job id required"}, 400)
                try:
                    data = hub_get("/hub/score/?jobs")
                except (urllib.error.URLError, OSError) as e:
                    return self._json({"error": "hub unreachable: %s" % e}, 502)
                for j in (data.get("jobs") or []):
                    if j.get("id") == job_id:
                        return self._json({
                            "id": j["id"],
                            "name": j.get("name", ""),
                            "status": j.get("status", "unknown"),
                            "error": j.get("error"),
                            "version": j.get("version"),
                        })
                return self._json({"error": "no such job"}, 404)

            if path == "/api/show":
                job = (q.get("job") or [""])[0]
                st = baker.status(job)
                if not st:
                    return self._json({"error": "no such job"}, 404)
                return self._json(st)

            if path.startswith("/api/frames/") and path.endswith(".bin"):
                blob = baker.frames(path[len("/api/frames/"):-len(".bin")])
                if blob is None:
                    return self._json({"error": "frames expired; ask for the show again"}, 404)
                return self._bytes(blob, "application/octet-stream")

            if path == "/api/showfile":
                # A hand-authored show file for one song: states, bindings and
                # gestures, drawn by the timeline. Absent is normal, not an error
                # -- most songs have none and the page falls back to the plan.
                name = os.path.basename((q.get("song") or [""])[0])
                full = os.path.join(SHOWFILES, name + ".show.json")
                if not name or not os.path.isfile(full):
                    return self._json({"showfile": None})
                try:
                    with open(full) as fh:
                        return self._json({"showfile": json.load(fh)})
                except (OSError, ValueError) as e:                  # noqa: BLE001
                    return self._json({"showfile": None, "error": str(e)})

            if path == "/api/effects":
                return self._json({"effects": catalog(LIMITS), "dials": DIALS, "choices": CHOICES,
                                   "base": json.load(open(CATALOG))["effects"],
                                   "withheld": [{"id": e["id"], "why": LIMITS.forbids(e)}
                                                for e in catalog() if LIMITS.forbids(e)]})

            if path == "/api/venues":
                return self._json({"venues": Venues.search((q.get("q") or [""])[0]),
                                   "default": (Venues.default() or {}).get("id"),
                                   "layouts": layouts()})

            if path.startswith("/logos/"):
                fn = os.path.basename(path[len("/logos/"):])
                full = os.path.join(LOGOS, fn)
                if not os.path.isfile(full):
                    return self._json({"error": "no logo"}, 404)
                ct = "image/svg+xml" if fn.endswith(".svg") else \
                     "image/png" if fn.endswith(".png") else "application/octet-stream"
                return self._file(full, ct)

            if path == "/api/layouts":
                return self._json({"layouts": layouts(), "default": DEFAULT_LAYOUT})

            if path == "/api/colours":
                # The palette is the artist's PERSONALITY on the hub, not
                # anything this portal owns. It answers with the allowed names.
                try:
                    name = (q.get("song") or [""])[0]
                    return self._json(hub_get("/hub/score/%s.score?personalities" % urllib.parse.quote(name)))
                except Exception as e:                              # noqa: BLE001
                    return self._json({"error": str(e)}, 502)

            if path == "/api/limits":
                return self._json(LIMITS.summary())

            if path == "/api/rig":
                return self._json(rig.status())

            if path == "/api/shows":
                return self._json({"shows": Shows.list()})

            if path == "/api/market":
                return self._json({"listings": Market.list(), "tiers": Market.TIERS,
                                   "transacting": False,
                                   "note": "This is a surface. Nothing here takes money."})

            if path.startswith("/covers/"):
                # Cache only. Nothing here ever reaches the network at runtime;
                # a missing file is a clean 404 and the page draws its own.
                fn = os.path.basename(path[len("/covers/"):])
                full = os.path.join(COVERS, fn)
                if not fn.endswith(".jpg") or not os.path.isfile(full):
                    return self._json({"error": "no cached cover"}, 404)
                return self._file(full, "image/jpeg")

            if path.startswith("/audio/"):
                return self._proxy_audio(path[len("/audio/"):])

            self._json({"error": "not found"}, 404)

        def do_POST(self):
            path = unquote(urlparse(self.path).path)

            if path == "/api/upload":
                return self._handle_upload()

            body = self._body()

            if path == "/api/show":
                song = body.get("song")
                if not song:
                    return self._json({"error": "which song?"}, 400)
                seed = int(body.get("seed", 1))
                edits = body.get("edits") or []
                appetite = body.get("appetite")
                cueshow = os.path.join(CUESHOWS, song + ".cues.json")
                composed = cueshow if os.path.isfile(cueshow) else os.path.join(WORK, song + ".plan.json")
                if (not edits and body.get("composed") is not False
                        and os.path.isfile(composed)):
                    try:
                        with open(composed) as fh:
                            plan_data = json.load(fh)
                        rig_name = (body.get("layout") or DEFAULT_LAYOUT).replace(".layout.json", "")
                        job = baker.start_v2(song, plan_data, rig_name)
                        return self._json({"job": job, "state": "baking", "song": song,
                                           "rig": rig_name, "source": "composed"})
                    except Exception as e:                          # noqa: BLE001
                        sys.stderr.write("composed plan unusable (%s); arranging instead\n" % e)
                job = baker.start(song, seed, edits,
                                  None if appetite in (None, "") else float(appetite),
                                  body.get("layout"))
                return self._json({"job": job, "state": "baking", "song": song, "seed": seed,
                                   "edits": edits, "appetite": appetite,
                                   "layout": body.get("layout") or DEFAULT_LAYOUT})

            if path == "/api/effects":
                if body.get("delete"):
                    return self._json(delete_custom(body["delete"]))
                out = save_custom(body)
                return self._json(out, 400 if out.get("error") else 200)

            if path == "/api/venue/use":
                # asked before a venue is targeted, so a refusal is one answer
                # and not something the page has to infer
                return self._json(Venues.may_use(body.get("venue_id")))

            if path == "/api/rig/trim":
                rig.trims.set(body)
                rig.note_trim()
                return self._json(rig.status())

            if path == "/api/rig/swap":
                blob = baker.frames(body.get("job") or "")
                st = baker.status(body.get("job") or "") or {}
                show = st.get("show") or {}
                if blob is None or not show:
                    return self._json({"error": "that rebuild is not ready"}, 404)
                out = rig.prepare(body["job"], blob, show["fps"], show["frame_count"],
                                  float(body.get("at", 0)))
                return self._json(out, 409 if out.get("error") else 200)

            if path == "/api/rig":
                if "armed" in body:
                    out = rig.arm(bool(body["armed"]))
                    return self._json(out, 409 if out.get("error") else 200)
                return self._json(rig.status())

            if path == "/api/rig/at":
                job = body.get("job") or ""
                if not rig.at(job, float(body.get("position", 0))):
                    blob = baker.frames(job)
                    st = baker.status(job) or {}
                    show = st.get("show") or {}
                    if blob is None or not show:
                        return self._json({"error": "that show is not loaded"}, 404)
                    rig.load(job, blob, show["fps"], show["frame_count"], body.get("show_id"),
                             Rigmap.of(show))
                    rig.at(job, float(body.get("position", 0)))
                return self._json(rig.status())

            if path == "/api/market":
                out = Market.put(body)
                return self._json(out, 404 if out.get("error") else 200)

            if path == "/api/colours":
                song, who = body.get("song"), (body.get("who") or "venue").strip() or "venue"
                cols = [c for c in (body.get("colours") or []) if isinstance(c, str)]
                try:
                    req = urllib.request.Request(
                        "%s/hub/score/%s.score?personality=%s"
                        % (HUB, urllib.parse.quote(song), urllib.parse.quote(who)),
                        data=json.dumps({"colours": cols}).encode(),
                        headers={"Content-Type": "application/json"}, method="PUT")
                    with urllib.request.urlopen(req, timeout=20) as r:
                        code = r.status
                    return self._json({"ok": code in (200, 204), "code": code,
                                       "song": song, "who": who, "colours": cols})
                except urllib.error.HTTPError as e:
                    return self._json({"error": "hub said %s" % e.code}, e.code)
                except Exception as e:                              # noqa: BLE001
                    return self._json({"error": str(e)}, 502)

            if path == "/api/compose":
                song = body.get("song")
                if not song:
                    return self._json({"error": "which song?"}, 400)
                if body.get("engine", "cue") == "cue":
                    song = os.path.basename(str(song))
                    py = sys.executable
                    venv = os.path.join(REPO, "work", "allin1", "bin", "python")
                    if os.access(venv, os.X_OK):
                        py = venv
                    steps = [
                        ("author", [py, os.path.join(HERE, "cue", "author.py"), song]),
                        ("publish", [py, os.path.join(HERE, "publish.py"), song]),
                    ]
                    log = []
                    for name, cmd in steps:
                        r = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True)
                        log.append("%s: %s" % (name, (r.stdout or r.stderr or "").strip()[-400:]))
                        if r.returncode != 0:
                            return self._json({"error": "%s failed: %s"
                                               % (name, (r.stderr or r.stdout or "").strip()[-600:]),
                                               "log": log}, 500)
                    cues_path = os.path.join(CUESHOWS, song + ".cues.json")
                    try:
                        with open(cues_path) as fh:
                            doc = json.load(fh)
                    except OSError as e:
                        return self._json({"error": "authored but unreadable: %s" % e}, 500)
                    return self._json({"song": song, "engine": "cue",
                                       "cues": len(doc.get("cues") or []),
                                       "states": len(doc.get("states") or []),
                                       "gestures": len(doc.get("gestures") or []),
                                       "saved": cues_path, "log": log})
                try:
                    sys.path.insert(0, HERE)
                    engine = body.get("engine", "claude")
                    if engine == "claude":
                        from claude_composer import compose as compose_fn, DEFAULT_MODEL
                    else:
                        from composer import compose as compose_fn, DEFAULT_MODEL
                    got = compose_fn(song, model=body.get("model", DEFAULT_MODEL))
                    plan, report, overview = got[0], got[1], got[2]
                    # persist the plan so it can be reviewed
                    os.makedirs(WORK, exist_ok=True)
                    ts = time.strftime("%Y%m%d-%H%M%S")
                    plan_path = os.path.join(WORK, "%s-%s.plan.json" % (song, ts))
                    with open(plan_path, "w") as fh:
                        json.dump({"song": song, "plan": plan, "report": report,
                                   "model": body.get("model", DEFAULT_MODEL),
                                   "engine": body.get("engine", "claude"),
                                   "created": ts}, fh, indent=1)
                    sys.stderr.write("composed plan -> %s\n" % plan_path)
                    return self._json({"plan": plan, "report": report, "saved": plan_path})
                except Exception as e:                              # noqa: BLE001
                    import traceback; traceback.print_exc()
                    return self._json({"error": str(e)}, 500)

            if path == "/api/showfile":
                # Write a plan back to the song's show file. The plan the page
                # sends is what editsToPlan() produced, so a file edited on the
                # timeline and saved comes back as the same shape it arrived in.
                song = os.path.basename(str(body.get("song") or ""))
                plan = body.get("plan")
                if not song or not isinstance(plan, dict):
                    return self._json({"error": "need a song and a plan"}, 400)
                os.makedirs(SHOWFILES, exist_ok=True)
                full = os.path.join(SHOWFILES, song + ".show.json")
                doc = {"schema": "limelight.show/1", "song": song, **plan}
                tmp = full + ".partial"
                with open(tmp, "w") as fh:
                    json.dump(doc, fh, indent=1, ensure_ascii=False)
                    fh.write("\n")
                os.replace(tmp, full)
                return self._json({"saved": song, "cues": sum(
                    len(plan.get(k) or []) for k in ("states", "bindings", "gestures"))})

            if path == "/api/recolour":
                song = os.path.basename(str(body.get("song") or ""))
                palette = body.get("palette")
                show_data = body.get("show")
                if not palette or not isinstance(palette, list):
                    return self._json({"error": "need a palette (list of {name, rgb})"}, 400)
                if show_data and isinstance(show_data, dict):
                    show = show_data
                elif song:
                    full = os.path.join(SHOWFILES, song + ".show.json")
                    if not os.path.isfile(full):
                        return self._json({"error": f"no showfile for '{song}'"}, 404)
                    with open(full) as fh:
                        show = json.load(fh)
                else:
                    return self._json({"error": "need a song name or an inline show"}, 400)
                from recolour import recolour
                recoloured, mapping = recolour(show, palette)
                return self._json({"showfile": recoloured, "mapping": mapping})

            if path == "/api/bake-plan":
                song = body.get("song")
                plan_data = body.get("plan")
                rig_name = body.get("rig", "club16-2head")
                if not song or not plan_data:
                    return self._json({"error": "need song and plan"}, 400)
                job = baker.start_v2(song, plan_data, rig_name)
                return self._json({"job": job, "state": "baking", "song": song, "rig": rig_name})

            if path == "/api/entitlement":
                return self._json(entitlement(body.get("show_id"), body.get("tier", "free")))

            if path == "/api/shows":
                if not body.get("song"):
                    return self._json({"error": "which song?"}, 400)
                return self._json(Shows.save(body))

            self._json({"error": "not found"}, 404)

    return Handler


def main(argv=None):
    global HUB, PANEL, LIMITS
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8800)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--hub", default=HUB)
    ap.add_argument("--panel", default=PANEL)
    ap.add_argument("--no-net", action="store_true",
                    help="never open the Art-Net socket; the page will say so rather than pretend")
    ap.add_argument("--gateway", default="2.0.0.100")
    ap.add_argument("--bind", default=None, help="local address the Art-Net socket binds to")
    ap.add_argument("--universe", type=int, default=0)
    ap.add_argument("--limits", default=LIMITS_FILE)
    args = ap.parse_args(argv)
    HUB = args.hub.rstrip("/")
    PANEL = args.panel.rstrip("/")

    mimetypes.add_type("text/javascript", ".js")
    LIMITS = Limits.load(args.limits)
    trims = Trims()
    rig = Rig(not args.no_net, args.gateway, args.universe, LIMITS, trims, args.bind)
    httpd = ThreadingHTTPServer((args.host, args.port),
                                make_handler(Library(), Baker(), rig))
    print("portal   http://%s:%d/   hub %s" % (args.host, args.port, HUB))
    print("limits   %s · par %.2f head %.2f · strobe %s · %d keep-out zone(s)"
          % (os.path.basename(args.limits), LIMITS.par_max, LIMITS.head_max,
             ("max %d" % LIMITS.strobe_max) if LIMITS.strobe_allowed else "OFF", len(LIMITS.keep_out)))
    print("rig      %s" % ("Art-Net %s universe %d (socket open, nothing sent until armed)"
                           % (args.gateway, args.universe) if rig.sender
                           else "NO OUTPUT -- " + str(rig.open_error)))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
