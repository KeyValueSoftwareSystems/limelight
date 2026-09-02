S=/tmp/claude-1001/-home-renjithbaby-Pencil-Code-boxed-2/67068010-4f00-4bc8-8771-2fa1aca19acd/scratchpad
cd /home/renjithbaby/Pencil/Code/boxed-2/limelight-nights
$S/mir/bin/python - <<'PY'
import json, re
full=json.load(open("the-nights.map.json"))
b64=open("/tmp/claude-1001/vec.b64").read()
comp=json.load(open("/tmp/claude-1001/compact2.json"))
comp["observations"]={"notes":full["observations"]["notes"]}
lay={"club":json.load(open("layout.json")),"venue":json.load(open("venue.json")),
     "the-grind":json.load(open("grind.json"))}
s=open("/tmp/claude-1001/app.html").read()
for k,v in (("__MAP__",comp),("__MAPFULL__",full),("__LAYOUTS__",lay)):
    s=s.replace(k,json.dumps(v,separators=(",",":")))
s=s.replace("__VECB64__",b64)
for k,f in (("__RECIPE__","recipe4.js"),("__DRONES__","drones.js"),("__RENDER__","render_gl.js"),
            ("__SKY__","sky.js"),("__SCORELANES__","score_lanes.js"),("__APP__","appglue.js")):
    s=s.replace(k,open("/tmp/claude-1001/"+f).read())
open("limelight.html","w").write(s)
open("/tmp/claude-1001/chk_app.js","w").write(re.search(r'<script>(.*)</script>',s,re.S).group(1))
print("limelight.html", len(s)//1024, "KB")
PY
