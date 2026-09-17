"use strict";
const http = require("http");
const URL_ = process.argv[2];
const WANT = parseInt(process.argv[3] || "110", 10);
const j = (p) => new Promise((res, rej) => {
  http.get({ host: "127.0.0.1", port: 9222, path: p }, (r) => {
    let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => { try { res(JSON.parse(b)); } catch (e) { res(b); } });
  }).on("error", rej);
});
const PROBE = [
  "(()=>{",
  " const cs=[...document.querySelectorAll('canvas')].map(c=>({c,a:c.width*c.height}));",
  " if(!cs.length) return null;",
  " cs.sort((x,y)=>y.a-x.a); const cv=cs[0].c;",
  " const o=document.createElement('canvas'); o.width=cv.width; o.height=cv.height;",
  " const g=o.getContext('2d'); g.drawImage(cv,0,0);",
  " const d=g.getImageData(0,0,o.width,o.height).data;",
  " const cols=new Array(o.width).fill(0);",
  " for(let x=0;x<o.width;x++){let s=0;",
  "  for(let y=0;y<o.height;y++){const i=(y*o.width+x)*4;s+=Math.max(d[i],d[i+1],d[i+2]);}",
  "  cols[x]=s;}",
  " let secs=null; const mm=document.body.innerText.match(/(\\d+):(\\d\\d\\.\\d{3})\\s*\\//);",
  " if(mm) secs=(+mm[1])*60+(+mm[2]);",
  " return {w:o.width,h:o.height,cols:cols,t:secs};",
  "})()"
].join("\n");
(async () => {
  const tabs = await j("/json/list");
  const tab = tabs.find((t) => t.type === "page");
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let id = 0; const waits = new Map();
  const send = (m, p) => new Promise((r) => { const k = ++id; waits.set(k, r); ws.send(JSON.stringify({ id: k, method: m, params: p })); });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waits.has(m.id)) { waits.get(m.id)(m.result); waits.delete(m.id); } };
  await new Promise((r) => (ws.onopen = r));
  await send("Page.enable", {}); await send("Runtime.enable", {});
  await send("Page.navigate", { url: URL_ });
  await new Promise((r) => setTimeout(r, 10000));
  const ev = async (x) => { const r = await send("Runtime.evaluate", { expression: x, returnByValue: true }); return r && r.result ? r.result.value : null; };
  const plot = await ev("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim().toLowerCase()==='plot');if(b){b.click();return 'plot';}return 'no-plot';})()");
  await new Promise((r) => setTimeout(r, 800));
  const rect = await ev("(()=>{const b=[...document.querySelectorAll('button')].find(x=>/play/i.test(x.textContent||''));if(!b)return null;const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,txt:b.textContent.trim()};})()");
  let play = "no-play";
  if (rect) {
    for (const type of ["mousePressed", "mouseReleased"]) {
      await send("Input.dispatchMouseEvent", { type, x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    }
    play = "input:" + rect.txt;
  }
  await new Promise((r) => setTimeout(r, 800));
  const out = [];
  for (let k = 0; k < WANT; k++) {
    const p = await ev(PROBE);
    if (p) out.push(p);
    await new Promise((r) => setTimeout(r, 110));
  }
  console.log(JSON.stringify({ plot, play, n: out.length, samples: out }));
  ws.close();
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
