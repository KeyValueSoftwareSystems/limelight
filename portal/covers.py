#!/usr/bin/env python3
"""Fill the cover cache. RUN ONCE, BY HAND -- the page never reaches the network.

  python3 portal/covers.py [--only levels] [--force]

Covers are fetched here, compressed here, and written to portal/covers/. The
page reads only those files; a cold cache falls back silently to the cover the
portal draws from the score itself, so a venue with bad wifi sees a full grid
either way.

Matching is recorded, not assumed. Only five of the playable mp3s carry ID3
artist and title; the rest are searched on their filename, which will miss for
anything outside the iTunes catalogue. A weak match is REJECTED rather than
shown -- presenting another artist's album as this song's is worse than showing
no photograph at all -- and every decision is written to covers/index.json with
the term used and what came back, so a wrong one can be spotted and corrected.

Cover art is copyrighted. This cache is a local demo convenience; it is kept in
its own directory so it is one `rm -rf` to remove, and it is not settled for
anything public.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
AUDIO = os.path.join(REPO, "audio")
OUT = os.path.join(HERE, "covers")
INDEX = os.path.join(OUT, "index.json")
HUB = os.environ.get("HUB_URL", "http://127.0.0.1:8770")
SEARCH = "https://itunes.apple.com/search"
UA = {"User-Agent": "limelight-portal/1 (local demo cover cache)"}


# ---- ID3v2, just the four frames we want, no dependency ---------------------
def id3(path):
    try:
        with open(path, "rb") as fh:
            head = fh.read(10)
            if head[:3] != b"ID3":
                return {}
            size = 0
            for b in head[6:10]:
                size = (size << 7) | (b & 0x7F)          # synchsafe
            body = fh.read(size)
    except OSError:
        return {}
    want = {b"TIT2": "title", b"TPE1": "artist", b"TALB": "album", b"TBPM": "bpm"}
    out, i, major = {}, 0, head[3]
    while i + 10 <= len(body):
        fid = body[i:i + 4]
        if not fid.strip(b"\x00"):
            break
        if major >= 4:
            n = 0
            for b in body[i + 4:i + 8]:
                n = (n << 7) | (b & 0x7F)
        else:
            n = int.from_bytes(body[i + 4:i + 8], "big")
        data = body[i + 10:i + 10 + n]
        i += 10 + n
        if fid in want and data:
            enc, raw = data[0], data[1:]
            try:
                if enc == 0:
                    txt = raw.decode("latin-1")
                elif enc == 1:
                    txt = raw.decode("utf-16")
                elif enc == 2:
                    txt = raw.decode("utf-16-be")
                else:
                    txt = raw.decode("utf-8")
            except (UnicodeDecodeError, LookupError):
                continue
            out[want[fid]] = txt.strip("\x00").strip()
    return out


def pretty(name):
    return re.sub(r"[-_]+", " ", name).strip()


TOKEN = re.compile(r"[a-z0-9]+")
def tokens(s):
    return {t for t in TOKEN.findall((s or "").lower()) if len(t) > 2}


def confidence(term, tags, hit):
    """How much we believe this is the same song. ID3 artist agreeing with the
    result's artist is the strong signal; otherwise it is title overlap, and a
    filename-only search has to clear a higher bar."""
    ht, ha = tokens(hit.get("trackName")), tokens(hit.get("artistName"))
    if tags.get("artist") and tokens(tags["artist"]) & ha:
        title = tokens(tags.get("title") or "")
        if not title or (title & ht):
            return 0.95, "ID3 artist and title both agree"
        return 0.7, "ID3 artist agrees, title does not"
    want = tokens(term)
    if not want:
        return 0.0, "nothing to match on"
    overlap = len(want & (ht | ha)) / len(want)
    if tags.get("artist"):
        return (0.6 if overlap >= 0.5 else 0.2), "ID3 artist disagrees; %.0f%% title overlap" % (overlap * 100)
    return (0.65 if overlap >= 0.75 else 0.25 if overlap >= 0.4 else 0.05), \
           "filename search, %.0f%% of its words came back" % (overlap * 100)


ACCEPT = 0.6


def fetch(term):
    url = SEARCH + "?" + urllib.parse.urlencode({"term": term, "entity": "song", "limit": 1})
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=8) as r:
        return json.load(r)


def compress(src_bytes, dest):
    """320 px square, quality 75, with whatever this machine already has."""
    tmp = dest + ".orig"
    with open(tmp, "wb") as fh:
        fh.write(src_bytes)
    try:
        r = subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", tmp,
                            "-vf", "scale=320:320", "-q:v", "6", dest],
                           capture_output=True, timeout=30)
        if r.returncode == 0 and os.path.getsize(dest) > 0:
            return True
    except (OSError, subprocess.TimeoutExpired):
        pass
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    return False


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--delay", type=float, default=1.2, help="seconds between requests")
    args = ap.parse_args()

    os.makedirs(OUT, exist_ok=True)
    try:
        with open(INDEX) as fh:
            index = json.load(fh)
    except (OSError, ValueError):
        index = {}

    with urllib.request.urlopen(HUB + "/hub/score/?json", timeout=20) as r:
        paths = json.load(r).get("paths", [])
    names = [p["name"][:-len(".score")] for p in paths if p["name"].endswith(".score")]
    if args.only:
        names = [n for n in names if n == args.only]

    for name in names:
        if name in index and not args.force and index[name].get("state") != "error":
            print("  keep   %-32s %s" % (name, index[name].get("state")))
            continue
        mp3 = os.path.join(AUDIO, name + ".mp3")
        tags = id3(mp3) if os.path.isfile(mp3) else {}
        term = ("%s %s" % (tags.get("artist", ""), tags.get("title", ""))).strip() or pretty(name)
        rec = {"term": term, "from_id3": bool(tags.get("artist")), "tags": tags,
               "checked": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        try:
            res = fetch(term)
        except Exception as e:                                   # noqa: BLE001
            rec.update(state="error", why=str(e)[:120])
            index[name] = rec
            print("  ERROR  %-32s %s" % (name, rec["why"]))
            time.sleep(args.delay)
            continue
        hits = res.get("results") or []
        if not hits:
            rec.update(state="none", why="iTunes returned nothing for that term")
            index[name] = rec
            print("  none   %-32s %s" % (name, term))
            time.sleep(args.delay)
            continue
        hit = hits[0]
        conf, why = confidence(term, tags, hit)
        rec.update(matched={"track": hit.get("trackName"), "artist": hit.get("artistName"),
                            "album": hit.get("collectionName")},
                   confidence=round(conf, 2), why=why)
        if conf < ACCEPT:
            rec.update(state="rejected")
            index[name] = rec
            print("  reject %-32s %.2f  %s  (got %s — %s)" % (name, conf, why,
                  hit.get("artistName"), hit.get("trackName")))
            time.sleep(args.delay)
            continue
        art = (hit.get("artworkUrl100") or "").replace("100x100bb", "600x600bb")
        try:
            with urllib.request.urlopen(urllib.request.Request(art, headers=UA), timeout=12) as r:
                blob = r.read()
        except Exception as e:                                   # noqa: BLE001
            rec.update(state="error", why="artwork: " + str(e)[:100])
            index[name] = rec
            print("  ERROR  %-32s %s" % (name, rec["why"]))
            time.sleep(args.delay)
            continue
        dest = os.path.join(OUT, name + ".jpg")
        if compress(blob, dest):
            rec.update(state="cached", file=name + ".jpg", bytes=os.path.getsize(dest))
            print("  ok     %-32s %.2f  %s — %s  (%d kB)" % (name, conf, hit.get("artistName"),
                  hit.get("trackName"), rec["bytes"] // 1024))
        else:
            rec.update(state="error", why="could not compress (is ffmpeg here?)")
            print("  ERROR  %-32s %s" % (name, rec["why"]))
        index[name] = rec
        time.sleep(args.delay)

    with open(INDEX, "w") as fh:
        json.dump(index, fh, indent=1)
    got = sum(1 for v in index.values() if v.get("state") == "cached")
    print("\n%d cached, %d of %d songs; the rest fall back to the generated cover."
          % (got, got, len(index)))


if __name__ == "__main__":
    main()
