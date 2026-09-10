#!/usr/bin/env python3
"""Source clips, with the licence recorded next to every one of them.

    python3 assets/fetch.py --n 80 --quality 720 [--category nature ...]
    python3 assets/fetch.py --catalogue-only        # re-list without downloading

WHY THIS EXISTS. The video reader needs footage, and footage the team does not
own is a licence problem before it is an engineering problem. So this never
guesses: every clip lands with its source URL, its licence as the source states
it, a sha256, and the category it came from. If a clip cannot be attributed it
is not downloaded.

WHAT IS AND IS NOT IN GIT. Rule 1 says no media in git, and it applies here for
the same reason it applies to audio -- and, conveniently, for a second reason:
the Mixkit licence permits use but forbids redistributing the assets as stock,
which is exactly what committing them would be. So `CATALOGUE.json` is committed
and the mp4s are not. The catalogue is enough to fetch the identical set again,
the way `synth/compose.py` is enough to render the identical songs again.

QUALITY. 720p by default and not 1080p: the same clip is 4.8 MB against 45 MB,
nothing downstream measures anything finer than a shot boundary and a motion
magnitude, and this machine has 8 GB free. `--quality 1080` is there for a final
render once a set has been chosen.

WHAT THIS IS NOT. It is not a claim that these clips suit any particular brief.
Category names come from the source and are the source's opinion. The asset
index measures the clips; it does not trust the label on the box.
"""
import argparse, json, os, re, sys, hashlib, subprocess, urllib.request, urllib.error, random

HERE = os.path.dirname(os.path.abspath(__file__))
CLIPS = os.path.join(HERE, "stock", "clips")
CATALOGUE = os.path.join(HERE, "stock", "CATALOGUE.json")
UA = "Mozilla/5.0 (X11; Linux x86_64) limelight-assets/1.0"

SOURCE = {
    "name": "Mixkit",
    "listing": "https://mixkit.co/free-stock-video/",
    "asset_host": "https://assets.mixkit.co/videos/",
    "licence": "Mixkit Free License",
    "licence_url": "https://mixkit.co/license/",
    "licence_as_stated": (
        "Free to use in commercial and non-commercial projects, no attribution "
        "required. Redistributing the assets themselves as stock is not "
        "permitted -- which is why the clips are gitignored and only this "
        "catalogue is committed."
    ),
    "licence_read_how": (
        "The licence page is rendered client-side, so these terms are recorded "
        "as the source states them in prose, not parsed from a machine-readable "
        "field. Treated as stated, not measured."
    ),
}


def get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def categories():
    """The source's own category list, from its listing page."""
    html = get(SOURCE["listing"]).decode("utf-8", "replace")
    found = re.findall(r'href="/free-stock-video/([a-z0-9-]+)/"', html)
    seen, out = set(), []
    for c in found:
        if c not in seen:
            seen.add(c)
            out.append(c)
    return out


def clip_ids(category, page=1):
    """Clip ids on one category page.

    The page lazy-loads its grid, so the inline mp4 URLs are only the first few.
    The ids themselves are all present in the markup, and the asset host serves
    <id>/<id>-<quality>.mp4 for every one of them -- verified against six ids
    before this was written, rather than assumed from the four that came with
    inline URLs.
    """
    url = f"{SOURCE['listing']}{category}/" + (f"?page={page}" if page > 1 else "")
    try:
        html = get(url).decode("utf-8", "replace")
    except urllib.error.HTTPError:
        return []
    ids = re.findall(r"assets\.mixkit\.co/videos/(\d+)", html)
    seen, out = set(), []
    for i in ids:
        if i not in seen:
            seen.add(i)
            out.append(i)
    return out


def probe(path):
    """Duration, size and frame rate, straight from the file."""
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height,r_frame_rate,nb_frames", "-show_entries",
         "format=duration", "-of", "json", path],
        capture_output=True, text=True)
    if r.returncode != 0:
        return None
    d = json.loads(r.stdout)
    st = (d.get("streams") or [{}])[0]
    num, _, den = (st.get("r_frame_rate") or "0/1").partition("/")
    try:
        fps = float(num) / float(den or 1)
    except (ValueError, ZeroDivisionError):
        fps = None
    return {
        "duration_s": round(float(d["format"]["duration"]), 3),
        "width": st.get("width"), "height": st.get("height"),
        "fps": round(fps, 3) if fps else None,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=80)
    ap.add_argument("--quality", default="720", choices=["360", "720", "1080"])
    ap.add_argument("--category", action="append", default=[])
    ap.add_argument("--pages", type=int, default=2)
    ap.add_argument("--catalogue-only", action="store_true")
    ap.add_argument("--seed", type=int, default=20260910)
    a = ap.parse_args()

    os.makedirs(CLIPS, exist_ok=True)
    cats = a.category or categories()
    print(f"{len(cats)} categories", file=sys.stderr)

    wanted = []
    for c in cats:
        for p in range(1, a.pages + 1):
            for i in clip_ids(c, p):
                wanted.append((i, c))
        if len({i for i, _ in wanted}) >= a.n * 3:
            break

    # One category per clip, first one wins, then shuffled so the set is not
    # front-loaded with whatever the source happens to list alphabetically.
    by_id = {}
    for i, c in wanted:
        by_id.setdefault(i, c)
    ids = sorted(by_id)
    random.Random(a.seed).shuffle(ids)
    ids = ids[:a.n]
    print(f"{len(ids)} clips selected", file=sys.stderr)

    old = {}
    if os.path.exists(CATALOGUE):
        old = {e["clip_id"]: e for e in json.load(open(CATALOGUE))["clips"]}

    entries, failed = [], 0
    for n, i in enumerate(ids, 1):
        url = f"{SOURCE['asset_host']}{i}/{i}-{a.quality}.mp4"
        dst = os.path.join(CLIPS, f"mixkit-{i}-{a.quality}.mp4")
        if a.catalogue_only:
            if i in old:
                entries.append(old[i])
            continue
        if not os.path.exists(dst):
            try:
                data = get(url, timeout=120)
            except Exception as e:
                print(f"  [{n}/{len(ids)}] {i} FAILED {e}", file=sys.stderr)
                failed += 1
                continue
            with open(dst, "wb") as f:
                f.write(data)
        meta = probe(dst)
        if not meta:
            os.remove(dst)
            failed += 1
            continue
        entries.append({
            "clip_id": f"mixkit-{i}",
            "file": os.path.relpath(dst, HERE),
            "source": SOURCE["name"],
            "source_url": url,
            "source_page": f"{SOURCE['listing']}{by_id[i]}/",
            "source_category": by_id[i],
            "licence": SOURCE["licence"],
            "licence_url": SOURCE["licence_url"],
            "bytes": os.path.getsize(dst),
            "sha256": hashlib.sha256(open(dst, "rb").read()).hexdigest(),
            **meta,
        })
        if n % 10 == 0:
            print(f"  [{n}/{len(ids)}] ok", file=sys.stderr)

    doc = {
        "note": ("Every clip the video reader may use, with its licence. The "
                 "mp4s are gitignored; this file is what makes the set "
                 "reproducible from a fresh clone."),
        "made_by": {"how": "fetched", "who": "assets/fetch.py"},
        "source": SOURCE,
        "quality": a.quality,
        "seed": a.seed,
        "clips": sorted(entries, key=lambda e: e["clip_id"]),
    }
    with open(CATALOGUE, "w") as f:
        json.dump(doc, f, indent=1)
        f.write("\n")
    total = sum(e["bytes"] for e in entries)
    print(f"{len(entries)} clips, {total/1e6:.0f} MB, {failed} failed -> {CATALOGUE}",
          file=sys.stderr)


if __name__ == "__main__":
    main()
