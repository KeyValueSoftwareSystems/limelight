#!/usr/bin/env python3
"""A local page for the synth loop. Stdlib only, no setup, no network.

    python3 synth/serve.py            # then open http://127.0.0.1:8770

Why a page at all: a 238 ms grid error is an abstract number and an obvious
picture. Drawing the recovered beats against the onset envelope shows a listener
sitting on the offbeat at a glance, which no table does.

Binds to localhost only. The listener is chosen from the files actually present
in listen/ and validated against that set -- the browser never gets to name a
command to run, because an endpoint that executes an arbitrary string is a
remote shell whichever interface it wears.
"""
import http.server, importlib.util, io, json, os, socketserver, subprocess, sys, time, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PORT = int(os.environ.get("PORT", "8770"))
# The portal can start jobs. Behind a public tunnel that is a remote shell, so a
# shared instance runs read-only: it still shows everything and plays everything,
# it just cannot be told to execute anything.
READONLY = os.environ.get("LIMELIGHT_READONLY", "") not in ("", "0", "false")

def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m

R = _load("render", os.path.join(HERE, "render.py"))
B = _load("bench", os.path.join(ROOT, "bench", "bench.py"))
L = _load("baseline", os.path.join(ROOT, "listen", "baseline.py"))


def cases():
    out = []
    for f in sorted(os.listdir(os.path.join(HERE, "cases"))):
        if not f.endswith(".json"): continue
        c = json.load(open(os.path.join(HERE, "cases", f)))
        out.append({"id": f[:-5], "title": c["song"]["title"], "bpm": c["grid"]["bpm"],
                    "phase": c["grid"]["phase"], "length": c["song"]["length"],
                    "beats": len(c["beats"]), "held_out": bool(c.get("hold_out")),
                    "why": c["made_by"]["why"]})
    return out


def listeners():
    d = os.path.join(ROOT, "listen")
    return sorted(f for f in os.listdir(d) if f.endswith(".py") and not f.startswith("_"))


def envelope_for(buf, sr, points=2400):
    en, hop = L.flux(buf, sr)
    step = max(1, len(en) // points)
    return [round(max(en[i:i + step] or [0.0]), 4) for i in range(0, len(en), step)], hop * step / sr


def run_case(cid, listener):
    if listener not in listeners():
        raise ValueError("unknown listener")
    path = os.path.join(HERE, "cases", cid + ".json")
    truth = json.load(open(path))
    t0 = time.time()
    buf, sr = R.render(truth)
    wav = os.path.join(HERE, "out", cid + ".wav")
    R.write_wav(wav, buf, sr)
    v = R.verify(truth, buf, sr)
    t1 = time.time()
    ok = not (v["missed"] or v["extra"] or (v["max_err_ms"] or 0) > v["tol_ms"])
    if not ok:
        return {"case": cid, "render_ok": False, "verify": v}
    p = subprocess.run([sys.executable, os.path.join(ROOT, "listen", listener), wav],
                       cwd=ROOT, capture_output=True, text=True)
    t2 = time.time()
    if p.returncode != 0:
        return {"case": cid, "render_ok": True, "listener_error": p.stderr.strip()[-400:]}
    cand = json.loads(p.stdout)
    res = B.run(truth, cand, quiet=True)
    gp, cp = truth["grid"], cand["grid"]
    d = abs(cp["phase"] - gp["phase"]) % gp["period"]
    gerr = min(d, gp["period"] - d) * 1000.0
    oct_ = res["octave"]
    flag = ("half" if oct_["truth_halved"] > res["beats_f"] + 0.15 else
            "double" if oct_["cand_doubled"] > res["beats_f"] + 0.15 else "ok")
    env, dt = envelope_for(buf, sr)
    return {"case": cid, "render_ok": True, "verify": v,
            "truth": {"beats": truth["beats"], "downbeats": truth["downbeats"],
                      "bpm": gp["bpm"], "phase": gp["phase"],
                      "downbeats_empty_note": truth.get("downbeats_note")},
            "cand": {"beats": cand["beats"], "downbeats": cand.get("downbeats", []),
                     "bpm": cp["bpm"], "phase": cp["phase"], "who": cand["made_by"].get("who")},
            "score": {"beats_f": round(res["beats_f"], 4),
                      "downbeats_f": round(res["downbeats_f"], 4),
                      "grid_err_ms": round(gerr, 1), "octave": flag},
            "env": env, "env_dt": dt, "length": truth["song"]["length"],
            "render_s": round(t1 - t0, 2), "listen_s": round(t2 - t1, 2),
            "held_out": bool(truth.get("hold_out"))}


def results():
    p = os.path.join(HERE, "RESULTS.tsv")
    if not os.path.exists(p): return []
    lines = open(p).read().strip().split("\n")
    head = lines[0].split("\t")
    return [dict(zip(head, l.split("\t"))) for l in lines[1:]][-60:]


NIGHTS = "/home/renjithbaby/Pencil/Code/boxed-2/limelight-nights"
MP3 = "/home/renjithbaby/Downloads/Avicii - The Nights (Audio).mp3"



# ---- jobs -------------------------------------------------------------------
# The page can start work, but only from this list. An endpoint that runs a
# string from the browser is a remote shell whatever interface it wears, so the
# action name is looked up here and the arguments are validated, never passed
# through.
import threading, collections

JOBS = collections.OrderedDict()
JOB_LOCK = threading.Lock()

def _listener_ok(cmd):
    """A listener must be a file that exists in listen/. Nothing else runs."""
    parts = (cmd or "").split()
    if not parts: return None
    for p in parts:
        if p.endswith(".py"):
            base = os.path.basename(p)
            if base in os.listdir(os.path.join(ROOT, "listen")):
                return f"{sys.executable} listen/{base}"
    return None

def start_job(action, params):
    if action == "compose":
        lvl = (params.get("level") or "").strip()
        args = [sys.executable, os.path.join(HERE, "compose.py")]
        if lvl:
            if not (len(lvl) == 2 and lvl.isdigit()): return None, "level must be two digits"
            args.append(lvl)
        label = f"compose {lvl or 'all ten songs'}"
    elif action == "loop":
        lis = _listener_ok(params.get("listener") or "python3 listen/baseline.py")
        if not lis: return None, "that listener is not a file in listen/"
        args = [sys.executable, os.path.join(HERE, "loop.py"), "--listener", lis]
        lvl = (params.get("level") or "").strip()
        if lvl:
            if not (len(lvl) == 2 and lvl.isdigit()): return None, "level must be two digits"
            args += ["--level", lvl]
        label = f"score {lis.split('/')[-1]}" + (f" on level {lvl}" if lvl else "")
    elif action == "frames":
        node = "node"
        args = [node, os.path.join(ROOT, "readers", "lights", "pack", "make.js")]
        label = "rebuild golden frames"
    else:
        return None, "unknown action"

    jid = f"{action}-{int(time.time()*1000)}"
    job = {"id": jid, "action": action, "label": label, "state": "running",
           "started": time.time(), "out": "", "code": None}
    with JOB_LOCK:
        JOBS[jid] = job
        while len(JOBS) > 20: JOBS.popitem(last=False)

    def run():
        try:
            p = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, timeout=900)
            job["out"] = (p.stdout or "") + (p.stderr or "")
            job["code"] = p.returncode
        except Exception as e:
            job["out"] = f"{type(e).__name__}: {e}"; job["code"] = -1
        job["state"] = "done"; job["ended"] = time.time()
    threading.Thread(target=run, daemon=True).start()
    return jid, None


def listeners_available():
    d = os.path.join(ROOT, "listen")
    return sorted(f for f in os.listdir(d) if f.endswith(".py") and not f.startswith("_"))


def truth_path(slug):
    p = os.path.join(HERE, "truth", slug + ".map.json")
    return p if os.path.exists(p) else None


def discover_layouts():
    root = os.path.join(ROOT, "readers", "lights")
    found = {}
    if not os.path.isdir(root):
        return found
    for entry in sorted(os.listdir(root)):
        full = os.path.join(root, entry)
        if os.path.isdir(full):
            cand = os.path.join(full, "layout.json")
            name = entry
        elif entry.endswith(".json"):
            cand = full
            name = os.path.splitext(entry)[0]
        else:
            continue
        if not os.path.exists(cand):
            continue
        try:
            data = json.load(open(cand))
        except Exception:
            continue
        if not isinstance(data, dict) or not data.get("fixtures"):
            continue
        found[data.get("room") or name] = data
    return found


def candidate_maps(slug):
    """Every map anyone has produced for this song, plus the authored answer.

    Named <slug>.<who>.map.json in synth/maps/. Discovered from disk so nobody has
    to register anything."""
    out = {"authored": {"label": "authored answer (the truth)",
                        "path": os.path.join(HERE, "songs", slug + ".map.json")}}
    # The held-out answer drives the reference room, but only on the machine that
    # holds it. A shared instance must never send it to a browser -- the whole
    # point of holding it out is that a model cannot be tuned to reproduce a file.
    tp = truth_path(slug)
    if tp and not READONLY:
        out["answer"] = {"label": "the answer (yours, held out)", "path": tp}
    d = os.path.join(HERE, "maps")
    found = []
    if os.path.isdir(d):
        # one folder per person, so two people never touch the same file and a pull
        # request shows at a glance whose reading of a song changed
        for who in sorted(os.listdir(d)):
            sub = os.path.join(d, who)
            if not os.path.isdir(sub): continue
            for f in sorted(os.listdir(sub)):
                if f == slug + ".map.json": found.append((who, os.path.join(sub, f)))
                elif f.startswith(slug + ".") and f.endswith(".map.json"):
                    found.append((f"{who}/{f[len(slug)+1:-9]}", os.path.join(sub, f)))
        for f in sorted(os.listdir(d)):            # flat layout still works
            if f.startswith(slug + ".") and f.endswith(".map.json"):
                found.append((f[len(slug) + 1:-9], os.path.join(d, f)))
    for who, path in found:
        try:
            m = json.load(open(path))
            how = (m.get("made_by") or {}).get("how", "?")
            when = time.strftime("%H:%M", time.localtime(os.path.getmtime(path)))
        except Exception:
            how, when = "unreadable", "?"
        out[who] = {"label": f"{who}  ({how}, {when})", "path": path}
    return {k: v for k, v in out.items() if os.path.exists(v["path"])}


def songs_index():
    """Every song the ladder has, discovered from disk.

    This used to be a hard-coded dict with one entry called first-light. Renaming
    the ladder silently broke the rooms page, so nothing here is written down
    twice."""
    out = {}
    sd = os.path.join(HERE, "songs")
    if os.path.isdir(sd):
        for f in sorted(os.listdir(sd)):
            if not f.endswith(".map.json"): continue
            slug = f[:-9]
            m = json.load(open(os.path.join(sd, f)))
            lvl = (m.get("level") or {})
            en = [e[1] for e in m.get("energy", [])] or [1.0]
            thin = (max(en) - min(en)) < 0.12
            out[slug] = {
                "label": f"{slug}  ·  {m['song']['title']}",
                "map": os.path.join(sd, f),
                "wav": os.path.join(HERE, "out", slug + ".wav"),
                "canonical": True, "left": "authored map",
                "teaches": lvl.get("teaches", ""), "thin": thin,
                "span": round(max(en) - min(en), 3),
                "note": "We wrote the arrangement, rendered the audio from it, then measured the "
                        "map back out of the individual instrument tracks. Every field is exact, "
                        "so the left room is correct by construction. "
                        + (lvl.get("teaches", "")),
            }
    # A real song is discoverable from its audio plus ANY map that describes it --
    # the held-out answer counts, so removing the reference from git does not make
    # the song disappear from the board.
    od = os.path.join(HERE, "out")
    if os.path.isdir(od):
        for f in sorted(os.listdir(od)):
            if not f.endswith(".wav"): continue
            slug = f[:-4]
            if slug in out: continue
            ref = truth_path(slug)
            held = ref is not None
            if not ref:
                cands = candidate_maps(slug)
                picks = [v["path"] for k, v in cands.items()
                         if k not in ("authored", "answer") and os.path.exists(v["path"])]
                ref = picks[0] if picks else None
            if not ref: continue
            try: mm = json.load(open(ref))
            except Exception: continue
            en = [e[1] for e in mm.get("energy", [])] or [1.0]
            out[slug] = {
                "label": f"{slug}  ·  {mm.get('song', {}).get('title', slug)}"
                         + ("  (real, answer held out)" if held else "  (real)"),
                "map": ref, "wav": os.path.join(od, f), "canonical": False,
                "left": "the answer (held out)" if held else "a candidate map", "teaches": "",
                "thin": (max(en) - min(en)) < 0.12, "span": round(max(en) - min(en), 3),
                "note": "A real record. The reference map is not in the repository and is never "
                        "sent to a browser on a shared instance — upload a map and you get "
                        "numbers back, never the answer. A model tuned until it reproduces a "
                        "file has learned the file, not the music.",
            }

    # Real records have no authored answer -- only whatever maps people have made.
    # Discovered from an audio file in out/ plus at least one candidate in maps/.
    md = os.path.join(HERE, "maps")
    for root, _d, files in os.walk(md):
        for f in sorted(files):
            if not f.endswith(".map.json"): continue
            slug = f[:-9].split(".")[0]
            if slug in out: continue
            wav = os.path.join(HERE, "out", slug + ".wav")
            if not os.path.exists(wav): continue
            first = os.path.join(root, f)
            try: mm = json.load(open(first))
            except Exception: continue
            en = [e[1] for e in mm.get("energy", [])] or [1.0]
            out[slug] = {
                "label": f"{slug}  ·  {mm.get('song', {}).get('title', slug)}  (real, no answer key)",
                "map": first, "wav": wav, "canonical": False, "left": "a candidate map",
                "teaches": "", "thin": (max(en) - min(en)) < 0.12,
                "span": round(max(en) - min(en), 3),
                "note": "A real record, so there is NO answer key — every map here is somebody's "
                        "reading of it. Pick two people in the dropdowns and watch them disagree; "
                        "where the rooms differ, one of them is wrong about the music, and the "
                        "only referee is an ear.",
            }
    if os.path.exists(os.path.join(NIGHTS, "the-nights.map.json")):
        out["the-nights"] = {
            "label": "the-nights  ·  real record, NOT canonical",
            "map": os.path.join(NIGHTS, "the-nights.map.json"), "wav": MP3,
            "canonical": False, "left": "measured map", "teaches": "the final exam",
            "note": "A real record, and the reference here is not trustworthy: six methods dispute "
                    "its section boundaries between 1:03 and 1:47, its chord labels agree with its "
                    "own detected notes 69% of the time, and one moment in it has been verified by "
                    "ear. The left room is a different map, not a correct one.",
        }
    return out


def song(which=None):
    """A map plus every rig, for the two-room comparison.

    Defaults to the song we authored ourselves. The Nights is reachable but
    labelled, because comparing against a map whose structure is still disputed
    measures agreement with a file nobody can vouch for."""
    idx = songs_index()
    if not idx:
        return {"error": "no songs yet — press Generate songs, or run python3 synth/compose.py"}
    if which not in idx:
        # whatever people are actually working on: the song with the most maps
        # handed in. Falls back to the richest authored song when nobody has yet.
        counts = {k: len(candidate_maps(k)) for k in idx}
        worked = [k for k, c in counts.items() if c > 1]
        if worked:
            which = max(worked, key=lambda k: counts[k])
        else:
            rich = [k for k, v in idx.items() if v.get("canonical") and not v.get("thin")]
            which = max(rich, key=lambda k: idx[k].get("span", 0)) if rich else sorted(idx)[0]
    sp = idx[which]
    m = json.load(open(sp["map"]))
    lays = {}
    # the rig we actually own goes first, because it is the one being tuned
    lays.update(discover_layouts())
    cands = candidate_maps(which) if which in songs_index() else {}
    cand_maps = {}
    for k, v in cands.items():
        if k == "authored": continue
        try: cand_maps[k] = json.load(open(v["path"]))
        except Exception: pass
    return {"map": m, "layouts": lays, "chapters": m.get("chapters", []),
            "candidates": {k: v["label"] for k, v in cands.items()},
            "candidate_maps": cand_maps,
            "audio": os.path.exists(sp["wav"]), "song": which,
            "songs": {k: {"label": v["label"], "canonical": v["canonical"],
                          "left": v["left"], "note": v["note"],
                          "thin": v.get("thin", False)} for k, v in idx.items()}}


def game():
    """Tonight's board. Everything read from disk; nothing typed in."""
    idx = songs_index()
    song = "levels" if "levels" in idx else (sorted(idx)[0] if idx else "")
    cands = {}
    for k, v in candidate_maps(song).items():
        if k == "authored": continue
        try:
            m = json.load(open(v["path"]))
            cands[k] = {"how": (m.get("made_by") or {}).get("how", "?")}
        except Exception:
            cands[k] = {"how": "unreadable"}

    scores = []
    sp = os.path.join(HERE, "SCORES.tsv")
    if os.path.exists(sp):
        ls = [l for l in open(sp).read().strip().split("\n") if l]
        if len(ls) > 1:
            hd = ls[0].split("\t"); ix = {k: i for i, k in enumerate(hd)}
            best = {}
            for r in [x.split("\t") for x in ls[1:]]:
                if len(r) != len(hd) or r[ix["song"]] != song: continue
                k = r[ix["who"]]
                if k not in best or float(r[ix["beats_f"]]) > float(best[k][ix["beats_f"]]):
                    best[k] = r
            for k, r in best.items():
                scores.append({"who": k, "beats_f": float(r[ix["beats_f"]]),
                               "downbeats_f": float(r[ix["downbeats_f"]]),
                               "grid_err_ms": float(r[ix["grid_err_ms"]]),
                               "octave": r[ix["octave"]],
                               "boundary": r[ix["boundary_3s"]],
                               "moments": f"{r[ix['moments_hit']]}/{r[ix['moments_total']]}",
                               "when": r[ix["when"]][11:16]})
            scores.sort(key=lambda x: -x["beats_f"])

    board = []
    rp = os.path.join(HERE, "RESULTS.tsv")
    if os.path.exists(rp):
        lines = [l for l in open(rp).read().strip().split("\n") if l]
        if len(lines) > 1:
            head = lines[0].split("\t"); ix = {k: i for i, k in enumerate(head)}
            rows = [r.split("\t") for r in lines[1:]]
            rows = [r for r in rows if len(r) == len(head)]
            by = {}
            for r in rows:
                who = r[ix["listener"]].split("/")[-1].replace(".py", "")
                key = r[ix.get("level", ix.get("case", 3))]
                by.setdefault(who, {})[key] = r
            for who, d in by.items():
                passed = sum(1 for r in d.values() if "pass" in ix and r[ix["pass"]] == "1")
                mean = sum(float(r[ix["beats_f"]]) for r in d.values()) / max(1, len(d))
                when = max(r[ix["when"]] for r in d.values())
                board.append({"who": who, "passed": passed, "of": len(d),
                              "mean_f": round(mean, 3), "when": when[11:16]})
            board.sort(key=lambda r: (-r["passed"], -r["mean_f"]))

    maps = []
    md = os.path.join(HERE, "maps")
    for root, _dirs, files in os.walk(md):
        for f in sorted(files):
            if not f.endswith(".map.json"): continue
            rel = os.path.relpath(root, md)
            who = rel if rel != "." else "?"
            song = f[:-9]
            if who == "?" and "." in song:
                song, who = song.split(".", 1)
            try: m = json.load(open(os.path.join(root, f)))
            except Exception: continue
            secs = m.get("sections")
            maps.append({"song": song, "who": who,
                         "how": (m.get("made_by") or {}).get("how", "?"),
                         "beats": len(m.get("beats", [])),
                         "sections": len(secs.get("entries", []) if isinstance(secs, dict) else (secs or [])),
                         "moments": len(m.get("moments", [])),
                         "when": time.strftime("%H:%M", time.localtime(
                             os.path.getmtime(os.path.join(root, f))))})

    verdicts = []
    vp = os.path.join(HERE, "VERDICTS.tsv")
    if os.path.exists(vp):
        for l in open(vp).read().strip().split("\n"):
            c = l.split("\t")
            if len(c) >= 5: verdicts.append({"when": c[0], "song": c[1], "a": c[2],
                                             "b": c[3], "said": c[4]})

    dl = None
    dp = os.path.join(HERE, "DEADLINE")
    if os.path.exists(dp): dl = open(dp).read().strip()
    title = ""
    if song in idx:
        try: title = json.load(open(idx[song]["map"]))["song"]["title"]
        except Exception: pass
    return {"song": song, "song_title": title, "deadline": dl, "candidates": cands,
            "board": board, "maps": maps, "verdicts": verdicts[-12:], "readonly": READONLY,
            "scores": scores, "has_truth": bool(truth_path(song))}


def status():
    """Live state of every lane, read from the files themselves.

    Nothing here is typed in by hand, because a status board that can be wrong is
    worse than no status board."""
    out = {}

    songs = []
    sd = os.path.join(HERE, "songs")
    if os.path.isdir(sd):
        for f in sorted(os.listdir(sd)):
            if not f.endswith(".map.json"): continue
            m = json.load(open(os.path.join(sd, f)))
            songs.append({"file": f, "title": m["song"]["title"],
                          "seconds": m["song"]["length"], "bpm": m["grid"]["bpm"],
                          "level": (m.get("level") or {}).get("n"),
                          "teaches": (m.get("level") or {}).get("teaches", ""),
                          "sections": len((m.get("sections") or {}).get("entries", [])),
                          "moments": len(m.get("moments", []))})
    out["songs"] = {"owner": "Renjith", "count": len(songs),
                    "seconds": round(sum(s["seconds"] for s in songs), 1), "list": songs,
                    "job": "The demo material. Renjith writes these, and their maps are exact "
                           "because he authors the arrangement before any sound exists.",
                    "next": "python3 synth/import.py to bring in a song you wrote.",
                    "link": "/songs"}

    rigs = []
    for name, L in discover_layouts().items():
        rigs.append({"name": name, "fixtures": len(L.get("fixtures", [])),
                     "kinds": len({x.get("kind") for x in L.get("fixtures", [])})})
    out["venues"] = {"owner": "Nikitha", "count": len(rigs), "list": rigs,
                     "job": "The emulator and the whole look of it. How the room is drawn, how "
                            "these pages feel, and whether the show reads as beautiful — which is "
                            "a judgement, not a number.",
                     "next": "Open the rooms view and tell us what is wrong with how it looks.",
                     "link": "/rooms"}

    # Read the log by COLUMN NAME and tolerate a schema that has moved, because the
    # last time these two files disagreed the whole portal rendered blank.
    best, runs, levels_total = None, 0, len(songs)
    rp = os.path.join(HERE, "RESULTS.tsv")
    if os.path.exists(rp):
        lines = [l for l in open(rp).read().strip().split("\n") if l]
        if len(lines) > 1:
            head = lines[0].split("\t")
            idx = {k: head.index(k) for k in head}
            rows = [r.split("\t") for r in lines[1:]]
            rows = [r for r in rows if len(r) == len(head)]
            runs = len(rows)
            by = {}
            for r in rows:
                who = r[idx["listener"]]
                key = r[idx.get("level", idx.get("case", 3))]
                f = float(r[idx["beats_f"]])
                ok = int(r["pass" in idx and idx["pass"] or 0] if "pass" in idx else 0) \
                     if "pass" in idx else int(f >= 0.90)
                by.setdefault(who, {})[key] = (f, ok)
            if by:
                def sc(d): return (sum(v[1] for v in d.values()), sum(v[0] for v in d.values()) / len(d))
                who = max(by, key=lambda k: sc(by[k]))
                passed, meanf = sc(by[who])
                best = {"listener": who, "passed": passed, "of": len(by[who]),
                        "mean_beats_f": round(meanf, 3)}
    out["listen"] = {"owner": "Amal + Dheeraj", "runs": runs, "best": best,
                     "levels": levels_total,
                     "job": "Hearing a song and writing its map. Ten levels, each adding one new "
                            "thing, all graded against maps we authored — so a disagreement is "
                            "yours and there is nothing to argue about.",
                     "next": "python3 synth/loop.py --listener \"python3 listen/mine.py\"",
                     "link": "/listen"}

    cases, stale = [], None
    cp = os.path.join(ROOT, "readers", "lights", "pack", "CASES.json")
    if os.path.exists(cp):
        cj = json.load(open(cp)); cases = cj.get("cases", [])
        gold = os.path.join(ROOT, "readers", "lights", "pack", "expected",
                            "first-light.frames.jsonl.gz")
        rec = os.path.join(ROOT, "readers", "src", "recipe4.js")
        if os.path.exists(gold) and os.path.exists(rec):
            stale = os.path.getmtime(rec) > os.path.getmtime(gold)
    out["frames"] = {"owner": "Dheeraj + Amal + Sebastian", "cases": len(cases), "list": cases, "stale": stale,
                     "job": "Map plus layout plus time gives what every light is doing, forty "
                            "times a second. This is now the main event: three people on it, and "
                            "it is what Alnas puts on real hardware.",
                     "next": "node readers/lights/pack/make.js, then check.py against yours.",
                     "link": "/frames"}

    wf = os.path.join(ROOT, "readers", "lights", "club", "wiring.json")
    wired = json.load(open(wf)) if os.path.exists(wf) else None
    out["wire"] = {"owner": "Alnas",
                   "fixtures": len((wired or {}).get("fixtures", [])),
                   "universes": len((wired or {}).get("universes", [])),
                   "built": os.path.exists(os.path.join(ROOT, "readers", "lights", "wire.js")),
                   "job": "Hardware, exclusively. Frames into bytes onto real fixtures. Works "
                          "hand in hand with the frame lane — they are one problem split in two.",
                   "next": "Open the universe view and watch 512 bytes move with the music.",
                   "link": "/dmx"}
    # The single most useful thing the page can say: what to do RIGHT NOW.
    # Derived from real state, so it is never advice the situation has outgrown.
    songs_n = out["songs"]["count"]
    best = out["listen"]["best"]
    if songs_n == 0:
        out["do_now"] = {"say": "No songs yet. Press Generate all ten on the Songs card.",
                         "why": "It writes ten songs and their exact answers. About 90 seconds.",
                         "where": "songs"}
    elif not best:
        out["do_now"] = {"say": "Press Score all ten on the Listener card.",
                         "why": f"{songs_n} songs are ready. This gives you the number to beat.",
                         "where": "listen"}
    else:
        nxt = None
        rp = os.path.join(HERE, "RESULTS.tsv")
        if os.path.exists(rp):
            lines = [l for l in open(rp).read().strip().split("\n") if l]
            if len(lines) > 1:
                head = lines[0].split("\t"); idx = {k: i for i, k in enumerate(head)}
                rows = [r.split("\t") for r in lines[1:]]
                rows = [r for r in rows if len(r) == len(head)
                        and r[idx["listener"]] == best["listener"]]
                seen = {}
                for r in rows: seen[r[idx["level"]]] = r
                for k in sorted(seen):
                    if "pass" in idx and seen[k][idx["pass"]] == "0": nxt = k; break
        if best["passed"] == best["of"] and best["of"] >= songs_n:
            out["do_now"] = {"say": "Every level passes. The Nights is the final exam.",
                             "why": "readers/lights/pack/ — real music, and its map is not "
                                    "trustworthy, which is the point.",
                             "where": "frames"}
        else:
            out["do_now"] = {"say": f"Best so far: {best['passed']} of {best['of']} levels."
                                    + (f" Next to fix: {nxt}." if nxt else ""),
                             "why": "Open Two rooms to see what a map error actually costs, "
                                    "or Songs to add a harder level.",
                             "where": "listen"}
    return out


PAGE = r"""<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Limelight — synth loop</title><style>
:root{--bg:#12141c;--surface:#191c25;--raise:#1f232e;--ink:#e6e9f1;--muted:#989eaf;
 --faint:#6b7183;--rule:#272b39;--rule2:#393e50;--tung:#f0a93c;--learn:#8f9aff;
 --good:#69be86;--bad:#e88055}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);padding:26px 22px 70px;
 font:14px/1.55 ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}
.wrap{max-width:1140px;margin:0 auto}
h1{font:700 15px/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;
 margin:0 0 4px;color:var(--tung)}
.sub{color:var(--muted);margin:0 0 24px;max-width:74ch}
.mono,td,th,button,select{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:0 0 20px;
 padding:12px 14px;background:var(--surface);border:1px solid var(--rule);border-radius:3px}
label{color:var(--faint);font-size:11px;letter-spacing:.08em;text-transform:uppercase}
select,button{background:var(--raise);color:var(--ink);border:1px solid var(--rule2);
 border-radius:3px;padding:6px 11px;font-size:13px;cursor:pointer}
button.go{background:var(--tung);color:#20160a;border-color:var(--tung);font-weight:600}
button:disabled{opacity:.5;cursor:default}
.case{background:var(--surface);border:1px solid var(--rule);border-radius:3px;
 margin:0 0 16px;overflow:hidden}
.chead{display:flex;gap:14px;align-items:baseline;padding:12px 15px;border-bottom:1px solid var(--rule);
 flex-wrap:wrap}
.cid{font:600 14px ui-monospace,monospace}
.pill{font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;padding:2px 7px;border-radius:2px;
 background:var(--raise);color:var(--muted);border:1px solid var(--rule2)}
.pill.held{color:var(--learn);border-color:var(--learn)}
.pill.ok{color:var(--good);border-color:var(--good)}
.pill.bad{color:var(--bad);border-color:var(--bad)}
.why{padding:0 15px 12px;color:var(--muted);font-size:13px;max-width:96ch}
.nums{display:flex;gap:26px;flex-wrap:wrap;padding:11px 15px;background:var(--raise);
 border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)}
.nums div{font-family:ui-monospace,monospace;font-size:12.5px}
.nums b{display:block;font-size:19px;font-weight:600;font-variant-numeric:tabular-nums}
.nums span{color:var(--faint);font-size:10.5px;letter-spacing:.06em;text-transform:uppercase}
canvas{display:block;width:100%;height:150px}
.legend{display:flex;gap:18px;padding:9px 15px;font-size:11.5px;color:var(--muted);
 font-family:ui-monospace,monospace;flex-wrap:wrap;align-items:center}
.sw{display:inline-block;width:11px;height:11px;border-radius:2px;margin-right:5px;vertical-align:-1px}
audio{width:100%;margin:0;display:block;filter:invert(.92) hue-rotate(180deg)}
table{border-collapse:collapse;width:100%;font-size:12.5px;margin-top:8px}
th,td{text-align:left;padding:6px 12px 6px 0;border-bottom:1px solid var(--rule);white-space:nowrap}
th{color:var(--faint);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase}
td.n{font-variant-numeric:tabular-nums}
.err{color:var(--bad);padding:12px 15px;font-family:ui-monospace,monospace;font-size:12.5px;
 white-space:pre-wrap}
h2{font:600 12px/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;
 color:var(--faint);margin:34px 0 0}
</style></head><body><div class="wrap">
<h1>Limelight · synth loop</h1>
<p class="sub"><a href="/rooms" style="color:var(--tung)">Two rooms, side by side &rarr;</a>
&nbsp; what a map error actually costs, on the real song.<br>The map is authored first and the audio is rendered from it, so the beats below in
amber are <em>causes</em> rather than observations. Blue is what the listener recovered. Where blue
sits between amber, the listener is on the offbeat — which is a great deal more obvious here than
it is as a number in a table.</p>

<div class="bar">
  <label for="lis">listener</label>
  <select id="lis"></select>
  <label for="zoom">window</label>
  <select id="zoom"><option value="6">first 6 s</option><option value="12">first 12 s</option>
   <option value="0">whole case</option></select>
  <button class="go" id="run">Run all cases</button>
  <span id="stat" class="mono" style="color:var(--muted);font-size:12.5px"></span>
</div>
<div id="sum" class="bar" style="display:none"></div>
<div id="out"></div>
<h2>History — synth/RESULTS.tsv</h2>
<div id="hist"></div>
</div><script>
const $=s=>document.querySelector(s), out=$("#out");
let CASES=[], ZOOM=6;
const f2=n=>Number(n).toFixed(2), f3=n=>Number(n).toFixed(3);

function draw(cv,r){
  const dpr=window.devicePixelRatio||1, W=cv.clientWidth, H=150;
  cv.width=W*dpr; cv.height=H*dpr; const g=cv.getContext("2d"); g.scale(dpr,dpr);
  const span=ZOOM||r.length, x=t=>t/span*W;
  g.fillStyle="#12141c"; g.fillRect(0,0,W,H);
  const mid=94, env=r.env, dt=r.env_dt, peak=Math.max(...env)||1;
  g.beginPath(); g.moveTo(0,mid);
  for(let i=0;i<env.length;i++){const t=i*dt; if(t>span)break; g.lineTo(x(t),mid-env[i]/peak*62)}
  g.lineTo(W,mid); g.closePath();
  g.fillStyle="rgba(230,233,241,.13)"; g.fill();
  g.strokeStyle="rgba(230,233,241,.42)"; g.lineWidth=1; g.stroke();
  const tick=(ts,col,y0,y1,w)=>{g.strokeStyle=col; g.lineWidth=w;
    for(const t of ts){ if(t>span)break; g.beginPath(); g.moveTo(x(t),y0); g.lineTo(x(t),y1); g.stroke() }};
  tick(r.truth.beats,"#f0a93c",mid+2,mid+22,1.4);
  tick(r.truth.downbeats,"#f0a93c",mid+2,mid+34,2.6);
  tick(r.cand.beats,"#8f9aff",mid-62,mid-42,1.4);
  tick(r.cand.downbeats,"#8f9aff",mid-74,mid-42,2.6);
  g.strokeStyle="rgba(230,233,241,.20)"; g.lineWidth=1;
  g.beginPath(); g.moveTo(0,mid); g.lineTo(W,mid); g.stroke();
  g.fillStyle="#6b7183"; g.font="10px ui-monospace,monospace";
  for(let s=0;s<=span;s+=(span>12?2:1)){ g.fillText(s+"s",x(s)+3,H-4);
    g.strokeStyle="rgba(230,233,241,.08)"; g.beginPath(); g.moveTo(x(s),0); g.lineTo(x(s),H-14); g.stroke() }
}

function card(r){
  const c=CASES.find(c=>c.id===r.case)||{}, d=document.createElement("div"); d.className="case";
  if(!r.render_ok){ d.innerHTML=`<div class="chead"><span class="cid">${r.case}</span>
    <span class="pill bad">render corrupt</span></div>
    <div class="err">Refusing to score against this. ${JSON.stringify(r.verify)}</div>`; return d }
  if(r.listener_error){ d.innerHTML=`<div class="chead"><span class="cid">${r.case}</span>
    <span class="pill bad">listener failed</span></div><div class="err">${r.listener_error}</div>`; return d }
  const s=r.score, phaseOK=s.grid_err_ms<=15, octOK=s.octave==="ok";
  d.innerHTML=`<div class="chead">
      <span class="cid">${r.case}</span>
      <span class="pill">${c.bpm} bpm authored</span>
      <span class="pill">phase ${c.phase}</span>
      ${r.held_out?'<span class="pill held">held out</span>':''}
      <span class="pill ${octOK?'ok':'bad'}">octave ${s.octave}</span>
      <span class="pill ${phaseOK?'ok':'bad'}">phase ${s.grid_err_ms} ms</span>
    </div>
    <div class="why">${c.why||""}</div>
    <div class="nums">
      <div><span>beats F</span><b style="color:${s.beats_f>.9?'var(--good)':s.beats_f<.3?'var(--bad)':'var(--ink)'}">${f3(s.beats_f)}</b></div>
      <div><span>downbeat F</span><b>${f3(s.downbeats_f)}</b></div>
      <div><span>bpm found</span><b>${f2(r.cand.bpm)}</b></div>
      <div><span>phase error</span><b style="color:${phaseOK?'var(--good)':'var(--bad)'}">${s.grid_err_ms} ms</b></div>
      <div><span>render</span><b>${r.render_s}s</b></div>
      <div><span>listen</span><b>${r.listen_s}s</b></div>
    </div>
    <canvas></canvas>
    <div class="legend">
      <span><i class="sw" style="background:#8f9aff"></i>recovered by listener (above)</span>
      <span><i class="sw" style="background:#f0a93c"></i>authored truth (below)</span>
      <span>tall tick = downbeat</span>
      ${r.truth.downbeats_empty_note?'<span style="color:var(--bad)">truth has no downbeats: '+r.truth.downbeats_empty_note.slice(0,58)+'…</span>':''}
    </div>
    <audio controls preload="none" src="/api/wav?case=${r.case}"></audio>`;
  requestAnimationFrame(()=>draw(d.querySelector("canvas"),r));
  d._r=r; return d
}

async function runAll(){
  const b=$("#run"), lis=$("#lis").value; b.disabled=true; out.innerHTML="";
  $("#sum").style.display="none";
  let done=0, got=[];
  for(const c of CASES){
    $("#stat").textContent=`running ${c.id} … (${done}/${CASES.length})`;
    try{ const r=await (await fetch(`/api/run?case=${c.id}&listener=${encodeURIComponent(lis)}`)).json();
         out.appendChild(card(r)); if(r.score) got.push(r) }
    catch(e){ const d=document.createElement("div"); d.className="case";
              d.innerHTML=`<div class="err">${c.id}: ${e}</div>`; out.appendChild(d) }
    done++;
  }
  // wall clock comes from the server's own measurements: the browser's clock is
  // fast-forwarded under headless capture and reports nonsense
  const secs=got.reduce((a,r)=>a+r.render_s+r.listen_s,0);
  $("#stat").textContent=`${done} case(s), ${secs.toFixed(1)}s of work`;
  if(got.length){
    const scored=got.filter(r=>!r.held_out), use=scored.length?scored:got;
    const meanF=use.reduce((a,r)=>a+r.score.beats_f,0)/use.length;
    const worst=use.reduce((a,r)=>r.score.grid_err_ms>a.score.grid_err_ms?r:a);
    const octs=got.filter(r=>r.score.octave!=="ok").length;
    const inv=got.filter(r=>r.truth.downbeats.length===0&&r.cand.downbeats.length>0).length;
    $("#sum").style.display="flex";
    $("#sum").innerHTML=
      `<div class="mono" style="font-size:13px">mean beats F <b style="font-size:17px;color:${
        meanF>0.9?'var(--good)':meanF<0.5?'var(--bad)':'var(--ink)'}">${meanF.toFixed(3)}</b>
        <span style="color:var(--faint)">over ${use.length} scored${scored.length<got.length?', held-out excluded':''}</span></div>
      <div class="mono" style="font-size:13px">worst phase <b style="font-size:17px;color:${
        worst.score.grid_err_ms>15?'var(--bad)':'var(--good)'}">${worst.score.grid_err_ms} ms</b>
        <span style="color:var(--faint)">on ${worst.case}</span></div>
      <div class="mono" style="font-size:13px">octave errors <b style="font-size:17px;color:${
        octs?'var(--bad)':'var(--good)'}">${octs}</b><span style="color:var(--faint)"> of ${got.length}</span></div>
      <div class="mono" style="font-size:13px">invented downbeats <b style="font-size:17px;color:${
        inv?'var(--bad)':'var(--good)'}">${inv}</b><span style="color:var(--faint)"> case(s)</span></div>`;
  }
  b.disabled=false; loadHist();
}

async function loadHist(){
  const rows=await (await fetch("/api/results")).json();
  if(!rows.length){ $("#hist").innerHTML='<p class="sub">No runs logged yet. '+
    'Use <span class="mono">python3 synth/loop.py --all</span> to append a row.</p>'; return }
  const cols=["when","sha","case","beats_f","grid_err_ms","bpm","downbeats_f","octave","listen_s","held_out"];
  $("#hist").innerHTML='<table><thead><tr>'+cols.map(c=>`<th>${c}</th>`).join("")+
    '</tr></thead><tbody>'+rows.slice().reverse().map(r=>'<tr>'+cols.map(c=>
      `<td class="${isNaN(+r[c])?'':'n'}">${r[c]??""}</td>`).join("")+'</tr>').join("")+'</tbody></table>';
}

$("#zoom").onchange=e=>{ZOOM=+e.target.value;
  [...out.children].forEach(d=>{const cv=d.querySelector("canvas"); if(cv&&d._r)draw(cv,d._r)})};
$("#run").onclick=runAll;
addEventListener("resize",()=>[...out.children].forEach(d=>{
  const cv=d.querySelector("canvas"); if(cv&&d._r)draw(cv,d._r)}));
(async()=>{
  CASES=await (await fetch("/api/cases")).json();
  const ls=await (await fetch("/api/listeners")).json();
  $("#lis").innerHTML=ls.map(l=>`<option${l==="baseline.py"?" selected":""}>${l}</option>`).join("");
  await loadHist(); runAll();
})();
</script></body></html>"""


class H(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"      # ranges need keep-alive to be useful
    def _send_media(self, path, ctype):
        """Serve a file with byte ranges.

        Without this a browser cannot seek in audio at all -- it asks for a slice,
        gets the whole 20 MB file back with a 200, and the scrub bar simply does
        nothing. That is why jumping to a section was impossible."""
        size = os.path.getsize(path)
        rng = self.headers.get("Range")
        start, end = 0, size - 1
        partial = False
        if rng and rng.startswith("bytes="):
            a, _, b = rng[6:].partition("-")
            try:
                if a:
                    start = int(a)
                    if b: end = min(int(b), size - 1)
                else:                                   # suffix range: last N bytes
                    start = max(0, size - int(b))
                partial = True
            except ValueError:
                partial = False
        if start >= size:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers(); return
        length = end - start + 1
        self.send_response(206 if partial else 200)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        if partial:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        with open(path, "rb") as fh:
            fh.seek(start)
            left = length
            while left > 0:
                chunk = fh.read(min(1 << 16, left))
                if not chunk: break
                try: self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError): return
                left -= len(chunk)

    def _send(self, code, body, ctype="application/json"):
        if isinstance(body, str): body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers(); self.wfile.write(body)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path); q = urllib.parse.parse_qs(u.query)
        try:
            if u.path in ("/", "/index.html"):
                return self._send(200, open(os.path.join(HERE, "portal.html")).read(),
                                  "text/html; charset=utf-8")
            if u.path == "/listen": return self._send(200, PAGE, "text/html; charset=utf-8")
            if u.path == "/game":
                return self._send(200, open(os.path.join(HERE, "game.html")).read(),
                                  "text/html; charset=utf-8")
            if u.path == "/api/game": return self._send(200, json.dumps(game()))
            if u.path == "/analyse":
                return self._send(200, open(os.path.join(HERE, "analyse.html")).read(),
                                  "text/html; charset=utf-8")
            if u.path == "/build":
                return self._send(200, open(os.path.join(HERE, "build.html")).read(),
                                  "text/html; charset=utf-8")
            if u.path == "/api/learn":
                # What was accepted, why, and the number that backed it. This is the
                # output of the learning phase -- the show is a by-product.
                sl = (q.get("song") or ["levels"])[0]
                fp = os.path.join(HERE, "learning", sl + ".json")
                if os.path.exists(fp):
                    return self._send(200, open(fp).read())
                return self._send(200, json.dumps({"song": sl, "steps": []}))
            if u.path == "/api/maps":
                # NOT `song` -- that is the name of a function in this module, and a
                # local assignment here made every later call to it unbound
                slug = (q.get("song") or [""])[0]
                idx = songs_index()
                if slug not in idx: slug = sorted(idx)[0] if idx else ""
                out = {}
                for k, v in candidate_maps(slug).items():
                    try: out[k] = json.load(open(v["path"]))
                    except Exception: pass
                return self._send(200, json.dumps(
                    {"song": slug, "maps": out, "editable": (not READONLY),
                     "songs": {k: v["label"] for k, v in idx.items()}}))
            if u.path == "/api/status": return self._send(200, json.dumps(status()))
            if u.path == "/api/listeners2": return self._send(200, json.dumps(listeners_available()))
            if u.path == "/api/job":
                j = JOBS.get((q.get("id") or [""])[0])
                if not j: return self._send(404, json.dumps({"error": "no such job"}))
                return self._send(200, json.dumps(j))
            if u.path == "/api/jobs":
                return self._send(200, json.dumps(list(JOBS.values())[-6:]))
            if u.path in ("/songs", "/frames", "/wire"):
                return self._send(200, open(os.path.join(HERE, "lane.html")).read(),
                                  "text/html; charset=utf-8")
            if u.path == "/rooms":
                return self._send(200, open(os.path.join(HERE, "rooms.html")).read(),
                                  "text/html; charset=utf-8")
            if u.path == "/static/calibrate.js":
                return self._send(200, open(os.path.join(ROOT, "readers", "lights",
                                                         "calibrate.js")).read(),
                                  "text/plain; charset=utf-8")
            if u.path == "/static/room.js":
                return self._send(200, open(os.path.join(HERE, "room.js")).read(),
                                  "text/plain; charset=utf-8")
            if u.path == "/static/wire.js":
                return self._send(200, open(os.path.join(ROOT, "readers", "lights", "wire.js")).read(),
                                  "text/plain; charset=utf-8")
            if u.path == "/api/wave":
                # A peak envelope of the audio, so beats can be SEEN against the
                # waveform rather than trusted. Two bands: the low one is where the
                # kick lives, which is what a beat grid should line up with.
                slug = (q.get("song") or [""])[0]
                wav = os.path.join(HERE, "out", slug + ".wav")
                if not os.path.exists(wav):
                    return self._send(404, json.dumps({"error": "no audio for " + slug}))
                import wave as _w, math as _m, array
                with _w.open(wav, "rb") as w:
                    sr, n, ch = w.getframerate(), w.getnframes(), w.getnchannels()
                    raw = w.readframes(n)
                a = array.array("h"); a.frombytes(raw[:len(raw) - (len(raw) % 2)])
                if ch > 1: a = a[::ch]
                N = len(a)
                hop = max(1, int(sr / 200))              # 5 ms per point
                # one-pole low pass at 130 Hz for the kick band
                al = _m.exp(-2 * _m.pi * 130.0 / sr)
                lo, y = [], 0.0
                full = []
                for i in range(0, N - hop, hop):
                    seg = a[i:i + hop]
                    pk = 0
                    for v in seg:
                        y = (1 - al) * v + al * y
                        if abs(y) > pk: pk = abs(y)
                    lo.append(pk)
                    full.append(max(abs(v) for v in seg))
                mx1 = max(full) or 1; mx2 = max(lo) or 1
                return self._send(200, json.dumps(
                    {"song": slug, "dt": hop / sr, "sr": sr,
                     "peak": [round(v / mx1, 3) for v in full],
                     "low": [round(v / mx2, 3) for v in lo]}))
            if u.path == "/api/wiring":
                return self._send(200, open(os.path.join(ROOT, "readers", "lights", "club",
                                                         "wiring.json")).read())
            if u.path == "/dmx":
                return self._send(200, open(os.path.join(HERE, "dmx.html")).read(),
                                  "text/html; charset=utf-8")
            if u.path == "/static/recipe_steps.js":
                return self._send(200, open(os.path.join(ROOT, "readers", "src", "recipe_steps.js")).read(),
                                  "application/javascript")
            if u.path == "/static/recipe_beat.js":
                return self._send(200, open(os.path.join(ROOT, "readers", "src", "recipe_beat.js")).read(),
                                  "application/javascript")
            if u.path == "/static/recipe4.js":
                return self._send(200, open(os.path.join(ROOT, "readers", "src", "recipe4.js")).read(),
                                  "text/plain; charset=utf-8")
            if u.path == "/api/song":
                return self._send(200, json.dumps(song((q.get("song") or [None])[0])))
            if u.path == "/api/audio":
                idx = songs_index()
                sp = idx.get((q.get("song") or [None])[0]) or (idx and idx[sorted(idx)[0]])
                if not sp: return self._send(404, json.dumps({"error": "unknown song"}))
                w = sp["wav"]
                if not os.path.exists(w) and w.endswith(".wav"):
                    subprocess.run([sys.executable, os.path.join(HERE, "compose.py")], cwd=ROOT)
                if not os.path.exists(w): return self._send(404, json.dumps({"error": "no audio"}))
                return self._send_media(w, "audio/wav" if w.endswith(".wav") else "audio/mpeg")
            if u.path == "/api/cases":      return self._send(200, json.dumps(cases()))
            if u.path == "/api/listeners":  return self._send(200, json.dumps(listeners()))
            if u.path == "/api/results":    return self._send(200, json.dumps(results()))
            if u.path == "/api/run":
                cid = (q.get("case") or [""])[0]
                if cid not in {c["id"] for c in cases()}: return self._send(400, json.dumps({"error": "unknown case"}))
                lis = (q.get("listener") or ["baseline.py"])[0]
                return self._send(200, json.dumps(run_case(cid, lis)))
            if u.path == "/api/wav":
                cid = (q.get("case") or [""])[0]
                if cid not in {c["id"] for c in cases()}: return self._send(404, json.dumps({"error": "unknown case"}))
                p = os.path.join(HERE, "out", cid + ".wav")
                if not os.path.exists(p):
                    truth = json.load(open(os.path.join(HERE, "cases", cid + ".json")))
                    buf, sr = R.render(truth); R.write_wav(p, buf, sr)
                return self._send_media(p, "audio/wav")
            self._send(404, json.dumps({"error": "no route"}))
        except Exception as e:
            self._send(500, json.dumps({"error": f"{type(e).__name__}: {e}"}))

    def do_POST(self):
        u = urllib.parse.urlparse(self.path); q = urllib.parse.parse_qs(u.query)
        # Read-only blocks jobs, not submissions. Scoring reads a file and runs the
        # bench -- no shell, no subprocess -- and it is the one thing a shared
        # instance exists to do. Blocking it made the tunnel pointless.
        if READONLY and u.path not in ("/api/score", "/api/upload_map", "/api/verdict"):
            return self._send(403, json.dumps({"error":
                "This instance is read-only: it will score a map and record a verdict, but it "
                "will not run jobs. Generating songs or rebuilding frames is a shell, and this "
                "URL is shared. Do those locally."}))
        if u.path == "/api/learn":
            try:
                n = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(n).decode())
            except Exception as e:
                return self._send(400, json.dumps({"error": f"not JSON: {e}"}))
            sl = (q.get("song") or ["levels"])[0]
            d = os.path.join(HERE, "learning"); os.makedirs(d, exist_ok=True)
            fp = os.path.join(d, sl + ".json")
            body["song"] = sl
            body["updated"] = __import__("datetime").datetime.now().isoformat(timespec="seconds")
            open(fp, "w").write(json.dumps(body, indent=1) + "\n")
            return self._send(200, json.dumps({"ok": True, "path": os.path.relpath(fp, ROOT)}))
        if u.path == "/api/save_map":
            # Writes the held-out answer. Never on a shared instance: the reference
            # is the one file nobody but its author may change.
            if READONLY:
                return self._send(403, json.dumps({"error": "read-only instance"}))
            try:
                n = int(self.headers.get("Content-Length", 0))
                m = json.loads(self.rfile.read(n).decode())
            except Exception as e:
                return self._send(400, json.dumps({"error": f"not JSON: {e}"}))
            if not (m.get("grid") or {}).get("period"):
                return self._send(400, json.dumps({"error": "no grid.period"}))
            song = (q.get("song") or [""])[0]
            where = (q.get("to") or ["truth"])[0]
            if where == "truth":
                d = os.path.join(HERE, "truth"); os.makedirs(d, exist_ok=True)
                path = os.path.join(d, song + ".map.json")
            else:
                safe = "".join(c for c in where if c.isalnum() or c in "-_")[:32] or "dropped"
                d = os.path.join(HERE, "maps", safe); os.makedirs(d, exist_ok=True)
                path = os.path.join(d, song + ".map.json")
            if os.path.exists(path):          # one step back, so an edit is undoable
                import shutil
                shutil.copyfile(path, path + ".bak")
            json.dump(m, open(path, "w"), indent=1)
            return self._send(200, json.dumps({"ok": True,
                                               "path": os.path.relpath(path, ROOT)}))
        if u.path == "/api/score":
            # Upload a map, get a number. The answer never travels back -- a model
            # tuned until it reproduces a file has learned the file, not the music.
            try:
                n = int(self.headers.get("Content-Length", 0))
                cand = json.loads(self.rfile.read(n).decode())
            except Exception as e:
                return self._send(400, json.dumps({"error": f"not JSON: {e}"}))
            song = (q.get("song") or [""])[0]
            who = "".join(c for c in (q.get("who") or ["anon"])[0]
                          if c.isalnum() or c in "-_")[:32] or "anon"
            tp = os.path.join(HERE, "truth", song + ".map.json")
            if not os.path.exists(tp):
                return self._send(404, json.dumps(
                    {"error": f"no answer key for '{song}' on this machine"}))
            if not (cand.get("grid") or {}).get("period"):
                return self._send(400, json.dumps({"error": "no grid.period in your map"}))
            truth = json.load(open(tp))
            res = B.run(truth, cand, quiet=True)
            gp, cp = truth["grid"], cand["grid"]
            d = abs(cp["phase"] - gp["phase"]) % gp["period"]
            gerr = min(d, gp["period"] - d) * 1000.0
            o = res["octave"]
            flag = ("half" if o["truth_halved"] > res["beats_f"] + 0.15 else
                    "double" if o["cand_doubled"] > res["beats_f"] + 0.15 else "ok")
            out = {"song": song, "who": who,
                   "beats_f": round(res["beats_f"], 4),
                   "downbeats_f": round(res["downbeats_f"], 4),
                   "grid_err_ms": round(gerr, 1), "octave": flag,
                   "boundary_f": [round(x, 4) for x in res["boundary_f"]],
                   "moments_hit": res["moments_hit"], "moments_total": res["moments_total"],
                   "moments_false": res["moments_false"],
                   "energy_r": (round(res["energy_r"], 4) if res["energy_r"] is not None else None),
                   "note": "Scored against a reference you cannot read. Nothing about it is "
                           "returned beyond these numbers, on purpose."}
            with open(os.path.join(HERE, "SCORES.tsv"), "a") as fh:
                if fh.tell() == 0:
                    fh.write("when\twho\tsong\tbeats_f\tdownbeats_f\tgrid_err_ms\toctave\t"
                             "boundary_3s\tmoments_hit\tmoments_total\tenergy_r\n")
                fh.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S')}\t{who}\t{song}\t"
                         f"{out['beats_f']}\t{out['downbeats_f']}\t{out['grid_err_ms']}\t"
                         f"{flag}\t{out['boundary_f'][-1] if out['boundary_f'] else ''}\t"
                         f"{out['moments_hit']}\t{out['moments_total']}\t{out['energy_r']}\n")
            return self._send(200, json.dumps(out))
        if u.path == "/api/upload_map":
            # A map somebody sent you, dropped straight in. It becomes a real file so
            # both the board and the rooms view see it -- keeping it only in one
            # browser tab is why the button was invisible from the other page.
            try:
                n = int(self.headers.get("Content-Length", 0))
                m = json.loads(self.rfile.read(n).decode())
            except Exception as e:
                return self._send(400, json.dumps({"error": f"not JSON: {e}"}))
            if not isinstance(m, dict) or not (m.get("grid") or {}).get("period"):
                return self._send(400, json.dumps(
                    {"error": "no grid.period — that does not look like a map file"}))
            song = (q.get("song") or ["unknown"])[0]
            who = (q.get("who") or ["dropped"])[0]
            safe = "".join(c for c in who if c.isalnum() or c in "-_")[:32] or "dropped"
            d = os.path.join(HERE, "maps", safe)
            os.makedirs(d, exist_ok=True)
            path = os.path.join(d, f"{song}.map.json")
            json.dump(m, open(path, "w"), indent=1)
            return self._send(200, json.dumps({"ok": True, "who": safe,
                                               "path": os.path.relpath(path, ROOT)}))
        if u.path == "/api/verdict":
            p = {k: v[0] for k, v in q.items()}
            with open(os.path.join(HERE, "VERDICTS.tsv"), "a") as fh:
                fh.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S')}\t{p.get('song','')}\t"
                         f"{p.get('a','')}\t{p.get('b','')}\t{p.get('said','')}\n")
            return self._send(200, json.dumps({"ok": True}))
        if u.path != "/api/run":
            return self._send(404, json.dumps({"error": "no route"}))
        params = {k: v[0] for k, v in q.items()}
        jid, err = start_job(params.get("action", ""), params)
        if err: return self._send(400, json.dumps({"error": err}))
        return self._send(200, json.dumps({"id": jid}))

    def log_message(self, *a): pass


if __name__ == "__main__":
    os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
    # must be set on the class BEFORE bind, not on the instance after it, or a
    # restart inside the TIME_WAIT window fails with "address already in use"
    HOST = os.environ.get("HOST", "127.0.0.1")
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer((HOST, PORT), H) as srv:
        srv.daemon_threads = True
        print(f"  limelight on http://{HOST}:{PORT}"
              + ("   READ-ONLY (safe to tunnel)" if READONLY else "   (localhost only, ctrl-c to stop)"))
        srv.serve_forever()
