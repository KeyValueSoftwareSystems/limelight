const fs=require('fs');
eval(fs.readFileSync('/tmp/claude-1001/canvas.js','utf8'));
const song=process.argv[2], times=process.argv.slice(3).map(Number);
const M=JSON.parse(fs.readFileSync('/tmp/claude-1001/cmp_'+song+'.json','utf8'));
const L=JSON.parse(fs.readFileSync('readers/lights/'+(process.env.RIG||'festival')+'/layout.json','utf8'));
global.MAP=M;global.LAYOUT=L;global.ENERGY='medium';global.STOP_REAL=true;global.ANT=true;global.HAZE=0.28;global.DRIFT=true;
global.PER=M.period;global.PH=M.phase;global.DUR=M.dur;global.DBP=M.bar_phase;global.BAR=4*M.period;global.BEATS=[];
for(let t=M.phase;t<M.dur;t+=M.period)BEATS.push(+t.toFixed(4));
global.CH=M.chapters.map(c=>c.slice());
global.SP=M.spans.map(s=>({kind:s[0],from:s[1],to:s[2],rise:s[3]}));
global.MO=M.moments.map(m=>({at:m[0],kind:m[1],v:m[2]}));
global.EN=M.energy;
global.window={devicePixelRatio:1};
(0,eval)(fs.readFileSync('readers/src/recipe4.js','utf8')+';global.frame=frame;global.PL=primaryLook;');
(0,eval)(";(function(){"+fs.readFileSync('synth/room.js','utf8')+"\n})();");
const RM=global.window.LimelightRoom;
const W=380,H=214;
const cols=times.length, out=Buffer.alloc(W*cols*H*3);
times.forEach((t,ti)=>{
  const C=mkCanvas(W,H); C.clientWidth=W; C.clientHeight=H;
  RM.drawRoom(C, frame(t), L);
  const buf=C.pixels?C.pixels():C.buf;
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    const s=(y*W+x)*3, d=((y*(W*cols))+(ti*W+x))*3;
    out[d]=Math.max(0,Math.min(255,buf[s]|0));
    out[d+1]=Math.max(0,Math.min(255,buf[s+1]|0));
    out[d+2]=Math.max(0,Math.min(255,buf[s+2]|0));
  }
});
fs.writeFileSync('/tmp/claude-1001/strip.raw', out);
console.log(JSON.stringify({w:W*cols,h:H,times,looks:times.map(t=>PL(t))}));
