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
            out[slug] = {
                "label": f"{slug}  ·  {m['song']['title']}",
                "map": os.path.join(sd, f),
                "wav": os.path.join(HERE, "out", slug + ".wav"),
                "canonical": True, "left": "authored map",
                "teaches": lvl.get("teaches", ""),
                "note": "We wrote the arrangement, rendered the audio from it, then measured the "
                        "map back out of the individual instrument tracks. Every field is exact, "
                        "so the left room is correct by construction. "
                        + (lvl.get("teaches", "")),
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
    if which not in idx: which = sorted(idx)[0]
    sp = idx[which]
    m = json.load(open(sp["map"]))
    lays = {}
    for name, f in (("club", "layout.json"), ("venue", "venue.json"), ("the-grind", "grind.json")):
        p = os.path.join(NIGHTS, f)
        if os.path.exists(p): lays[name] = json.load(open(p))
    return {"map": m, "layouts": lays, "chapters": m.get("chapters", []),
            "audio": os.path.exists(sp["wav"]), "song": which,
            "songs": {k: {"label": v["label"], "canonical": v["canonical"],
                          "left": v["left"], "note": v["note"]} for k, v in idx.items()}}


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
    out["songs"] = {"owner": "Muzammil", "count": len(songs),
                    "seconds": round(sum(s["seconds"] for s in songs), 1), "list": songs,
                    "job": "Ten levels exist. Add harder ones, and songs that sound less like a "
                           "machine — every song is both a level and a training example.",
                    "next": "Add an entry to SONGS in synth/compose.py, then run it.",
                    "link": "/songs"}

    rigs = []
    for name, f in (("club", "layout.json"), ("venue", "venue.json"), ("the-grind", "grind.json")):
        p2 = os.path.join(NIGHTS, f)
        if os.path.exists(p2):
            L = json.load(open(p2))
            rigs.append({"name": name, "fixtures": len(L.get("fixtures", [])),
                         "kinds": len({x.get("kind") for x in L.get("fixtures", [])})})
    out["venues"] = {"owner": "Nikitha", "count": len(rigs), "list": rigs,
                     "job": "Build the room we actually demo in, and say whether the show looks "
                            "right in it. That judgement is not a number.",
                     "next": "Copy a layout, move the fixtures, watch the show in your room.",
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
    out["listen"] = {"owner": "Amal + Sebastian", "runs": runs, "best": best,
                     "levels": levels_total,
                     "job": "Turn audio into a map. Ten levels, each adding one new thing, all "
                            "graded against maps we authored — so a disagreement is yours.",
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
    out["frames"] = {"owner": "Dheeraj", "cases": len(cases), "list": cases, "stale": stale,
                     "job": "One function: map plus layout plus time gives what every light is "
                            "doing. FRAME.md is the contract between us.",
                     "next": "node readers/lights/pack/make.js, then check.py against yours.",
                     "link": "/frames"}

    wf = os.path.join(ROOT, "readers", "lights", "club", "wiring.json")
    wired = json.load(open(wf)) if os.path.exists(wf) else None
    out["wire"] = {"owner": "Alnas",
                   "fixtures": len((wired or {}).get("fixtures", [])),
                   "universes": len((wired or {}).get("universes", [])),
                   "built": False,
                   "job": "Turn a frame into bytes on a wire. The hub comes last and does not "
                          "block you: build it against a printed universe now.",
                   "next": "Write wire(frame, wiring) and print a universe to screen.",
                   "link": "/wire"}
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
                return self._send(200, open(w, "rb").read(),
                                  "audio/wav" if w.endswith(".wav") else "audio/mpeg")
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
                return self._send(200, open(p, "rb").read(), "audio/wav")
            self._send(404, json.dumps({"error": "no route"}))
        except Exception as e:
            self._send(500, json.dumps({"error": f"{type(e).__name__}: {e}"}))

    def do_POST(self):
        u = urllib.parse.urlparse(self.path); q = urllib.parse.parse_qs(u.query)
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
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("127.0.0.1", PORT), H) as srv:
        srv.daemon_threads = True
        print(f"  synth loop on http://127.0.0.1:{PORT}   (localhost only, ctrl-c to stop)")
        srv.serve_forever()
