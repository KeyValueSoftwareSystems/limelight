#!/usr/bin/env python3
"""Name the record, and propose identifiers for a human to confirm.

    python3 listen/identify.py [slug ...] [--write] [--propose]

`weight` -- how much a record means to the people who will be in the room --
came out null last round because two crowd sources could not be made to agree on
which record they were describing. Wikipedia resolved "Levels" to a 29-character
disambiguation stub called "Level". The blocker was never the sources. It is
that this file does not say what the record IS: `song.title` was "levels.wav"
and `song.artist` was "?", so every lookup had to guess from a filename.

Two things go in, and they are different kinds of claim.

`title` and `artist` are STATED, from the release file this map was built from.
A filename is evidence a person can check in a second, and it is written with
its source so nobody mistakes it for something measured.

`mbid` and `isrc` stay NULL until a human confirms them. --propose queries
MusicBrainz and prints candidates with the one piece of evidence this repository
actually holds: the length of the recording we measured, against the length
MusicBrainz has. A candidate 0.3 s from our own measurement is a different kind
of match from one three minutes out. It prints; it does not write. Machine
matching on title is exactly what failed, and a proposal a human rubber-stamps
is the same failure with an extra step.
"""
import sys, os, json, re

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mapio import map_path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {"User-Agent": "limelight-map/0.3 (research; amal@trypencil.com)"}

# The release file each map was built from, and what a person reading that
# filename would say the record is. Stated, not measured.
from mapio import RELEASES

NOTE = (
    "an identifier a human confirmed, or null. Everything outside this recording -- how well "
    "known the record is, how it was received, who played it -- has to be keyed on something "
    "unambiguous, and a title is not unambiguous: matching 'Levels' by title returned a "
    "disambiguation stub called 'Level'. listen/identify.py --propose lists candidates with "
    "their length against the length measured here, for a person to confirm. It does not write "
    "them, because a machine match a human rubber-stamps is the same wrong answer with an "
    "extra step."
)


def apply(slug, write=False):
    p = map_path(slug)
    if not p:
        return {"error": "no map"}
    rel = RELEASES.get(slug)
    if not rel:
        return {"error": "no release file recorded for this slug"}
    fname, artist, title = rel
    m = json.load(open(p))
    song = m.setdefault("song", {})
    before = (song.get("title"), song.get("artist"))
    song["title"] = title
    song["artist"] = artist
    song["source_file"] = fname
    song["title_provenance"] = ("stated -- read off the release file named in source_file, "
                                "not measured from the audio")
    song.setdefault("mbid", None)
    song.setdefault("isrc", None)
    song["identifier_note"] = NOTE
    if write:
        json.dump(m, open(p, "w"), indent=1, ensure_ascii=False)
        open(p, "a").write("\n")
    return {"slug": slug, "before": before, "after": (title, artist),
            "mbid": song.get("mbid"), "wrote": write}


def propose(slug):
    """Candidates from MusicBrainz, with length against our own measurement."""
    import urllib.request, urllib.parse
    p = map_path(slug)
    if not p:
        return []
    m = json.load(open(p))
    ours = (m.get("song") or {}).get("length")
    rel = RELEASES.get(slug)
    if not rel:
        return []
    _, artist, title = rel
    base = re.sub(r"\s*[\(\[].*?[\)\]]", "", title).strip()
    q = 'artist:"%s" AND recording:"%s"' % (artist.split(" feat.")[0].split(",")[0], base)
    url = ("https://musicbrainz.org/ws/2/recording?query=%s&fmt=json&limit=8"
           % urllib.parse.quote(q))
    try:
        req = urllib.request.Request(url, headers=UA)
        d = json.load(urllib.request.urlopen(req, timeout=15))
    except Exception as e:
        return [{"error": "%s: %s" % (type(e).__name__, str(e)[:60])}]
    out = []
    for r in (d.get("recordings") or [])[:8]:
        ln = r.get("length")
        secs = (ln / 1000.0) if ln else None
        out.append({
            "mbid": r.get("id"),
            "title": r.get("title"),
            "artist": ", ".join(a.get("name", "")
                                for a in (r.get("artist-credit") or []) if isinstance(a, dict)),
            "length_s": round(secs, 1) if secs else None,
            "delta_s": round(secs - ours, 1) if (secs and ours) else None,
            "score": r.get("score"),
        })
    out.sort(key=lambda c: (abs(c["delta_s"]) if c.get("delta_s") is not None else 9e9))
    return out


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    write = "--write" in sys.argv
    want = "--propose" in sys.argv
    for slug in args or sorted(RELEASES):
        r = apply(slug, write)
        if "error" in r:
            print("  %-16s %s" % (slug, r["error"]))
            continue
        print("  %-16s %s -- %s%s" % (slug, r["after"][1], r["after"][0],
                                      "  -> written" if write else ""))
        if want:
            ours = (json.load(open(map_path(slug))).get("song") or {}).get("length")
            print("     our recording is %.1f s. Candidates, nearest length first:" % ours)
            for c in propose(slug):
                if "error" in c:
                    print("       %s" % c["error"])
                    continue
                print("       %s  %-34s %-28s %s  %s"
                      % (c["mbid"], (c["title"] or "")[:34], (c["artist"] or "")[:28],
                         ("%6.1f s" % c["length_s"]) if c["length_s"] else "   ?   ",
                         ("%+.1f s" % c["delta_s"]) if c["delta_s"] is not None else ""))
            print("     none of these is written. A human confirms one and puts it in "
                  "song.mbid.")
