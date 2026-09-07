/* A contact sheet: every half second of the show, in order, on one page.

   Single frames hide flow. A beam that pops in and out inside a tenth of a
   second looks fine in a still and terrible in motion, and the only way to see
   that without watching video is to lay the frames out side by side and read
   them like a strip of film. */
const fs=require('fs'), path=require('path'), cp=require('child_process');
eval(fs.readFileSync('/tmp/claude-1001/canvas.js','utf8'));
const ROOT=path.resolve(__dirname,'..');
const song=process.argv[2], t0=Number(process.argv[3]||0), t1=Number(process.argv[4]||30),
      step=Number(process.argv[5]||0.5), COLS=Number(process.argv[6]||10);
const mapPath=(()=>{const f=path.join(ROOT,'maps/model/'+song+'.full.map.json');
  return fs.existsSync(f)?f:path.join(ROOT,'maps/model/'+song+'.map.json')})();
const M=JSON.parse(cp.execFileSync('python3',['-c',
  'import sys,json;sys.path.insert(0,sys.argv[1]);from compact import compact;'+
  'print(json.dumps(compact(json.load(open(sys.argv[2])))))',
  path.join(ROOT,'readers/src'), mapPath],{maxBuffer:1<<28}).toString());
const L=JSON.parse(fs.readFileSync(path.join(ROOT,'readers/lights/'+(process.env.RIG||'festival')+'/layout.json'),'utf8'));
global.MAP=M;global.LAYOUT=L;global.ENERGY='medium';global.STOP_REAL=true;global.ANT=true;global.HAZE=0.28;global.DRIFT=true;
global.PER=M.period;global.PH=M.phase;global.DUR=M.dur;global.DBP=M.bar_phase;global.BAR=4*M.period;global.BEATS=[];
for(let t=M.phase;t<M.dur;t+=M.period)BEATS.push(+t.toFixed(4));
global.CH=M.chapters.map(c=>c.slice());
global.SP=M.spans.map(s=>({kind:s[0],from:s[1],to:s[2],rise:s[3]}));
global.MO=M.moments.map(m=>({at:m[0],kind:m[1],v:m[2]}));
global.EN=M.energy;
global.window={devicePixelRatio:1};
(0,eval)(fs.readFileSync(path.join(ROOT,'readers/src/recipe4.js'),'utf8')+';global.frame=frame;global.PL=primaryLook;');
(0,eval)(";(function(){"+fs.readFileSync(path.join(ROOT,'synth/room.js'),'utf8')+"\n})();");
const RM=global.window.LimelightRoom;
const W=228,H=128;
const times=[]; for(let t=t0;t<t1-1e-9;t+=step) times.push(+t.toFixed(3));
const ROWS=Math.ceil(times.length/COLS);
const TW=W*COLS, TH=H*ROWS;
const out=Buffer.alloc(TW*TH*3);
const looks=[];
times.forEach((t,i)=>{
  const C=mkCanvas(W,H); C.clientWidth=W; C.clientHeight=H;
  RM.drawRoom(C, global.frame(t), L);
  const buf=C.pixels?C.pixels():C.buf;
  const cx=(i%COLS)*W, cy=Math.floor(i/COLS)*H;
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    const s=(y*W+x)*3, d=(((cy+y)*TW)+(cx+x))*3;
    out[d]=Math.max(0,Math.min(255,buf[s]|0));
    out[d+1]=Math.max(0,Math.min(255,buf[s+1]|0));
    out[d+2]=Math.max(0,Math.min(255,buf[s+2]|0));
  }
  looks.push(global.PL(t));
});
fs.writeFileSync('/tmp/claude-1001/contact.raw', out);
console.log(JSON.stringify({w:TW,h:TH,cols:COLS,rows:ROWS,n:times.length,
  from:t0,to:t1,step:step,looks:looks.join(',')}));
