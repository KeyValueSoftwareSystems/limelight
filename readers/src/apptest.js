/* drive the app's three readers against all three venues, headless */
const fs=require('fs');
const html=fs.readFileSync('limelight.html','utf8');
const src=html.match(/<script>([\s\S]*)<\/script>/)[1];
// stub only what the DOM is needed for; the readers are pure
const el=()=>({style:{},classList:{toggle(){},add(){},contains(){return false},remove(){}},
  innerHTML:'',textContent:'',children:[el0(),el0(),el0()],appendChild(){},
  getBoundingClientRect:()=>({left:0,width:1000,top:0}),
  getContext:()=>ctx(),setAttribute(){},play(){},pause(){},toBlob(){},onclick:null,
  scrollLeft:0,clientWidth:1000,clientHeight:600,src:'',paused:true,files:[]});
function el0(){return {style:{},classList:{toggle(){},add(){},contains(){return false},remove(){}},
  textContent:'',setAttribute(){},innerHTML:''}}
function ctx(){const f=()=>ctx(); return new Proxy({},{get:(t,k)=>{
  if(k==='canvas') return {width:1000,height:600};
  if(k==='createLinearGradient'||k==='createRadialGradient') return ()=>({addColorStop(){}});
  if(k==='createImageData') return (w,h)=>({data:new Uint8ClampedArray(w*h*4)});
  if(k==='measureText') return ()=>({width:10});
  return f}, set:()=>true})}
global.window={innerWidth:1400,innerHeight:800,devicePixelRatio:1,
  addEventListener(){},requestAnimationFrame(){},__haze:0};
const docBase={getElementById:()=>el(),querySelector:()=>el(),
  querySelectorAll:()=>[el0(),el0(),el0(),el0()],createElement:()=>el(),addEventListener(){},
  body:el(),head:el(),documentElement:{requestFullscreen(){}},fullscreenElement:null};
global.document=new Proxy(docBase,{get:(t,k)=>(k in t)?t[k]:(()=>el())});
global.requestAnimationFrame=()=>{};
global.ResizeObserver=class{observe(){}};
global.atob=s=>Buffer.from(s,'base64').toString('binary');
global.navigator={clipboard:{writeText(){return Promise.resolve()}}};
global.Blob=class{constructor(){}}; global.URL={createObjectURL(){return 'x'}};
global.self=global;
let out={};
try{ eval(src+'\nout.frame=frame;out.droneFrame=droneFrame;out.LAYOUTS=LAYOUTS;out.rebuildGeo=rebuildGeo;'
  +'out.setLayout=function(l){LAYOUT=l};out.DUR=DUR;out.BEATS=BEATS;out.LANES=LANES;') }
catch(e){ console.log('EVAL FAILED:',e.message); process.exit(1) }

console.log('app evaluated. score lanes:',out.LANES.length);
for(const name of Object.keys(out.LAYOUTS)){
  out.setLayout(out.LAYOUTS[name]); out.rebuildGeo();
  let bad=0,held=0;
  for(let i=0;i<Math.floor(out.DUR*20);i++){
    const f=out.frame(i/20);
    for(const o of f.fixtures){
      if(o.held_back){held++;continue}
      if('level'in o&&!(o.level>=0&&o.level<=1))bad++;
      if('zoom'in o&&!(o.zoom>=0&&o.zoom<=1))bad++;
      if(o.pixels)for(const q of o.pixels)for(const c of q)if(!(c>=0&&c<=255))bad++}}
  const f=out.frame(70);
  const emit=f.fixtures.filter(o=>!o.held_back&&'level'in o&&o.id.indexOf('fog')<0);
  console.log('  room  '+name.padEnd(10)+(bad?('FAIL '+bad):'ok')+
    '   '+String(f.fixtures.length).padStart(3)+' fixtures, '
    +emit.filter(o=>o.level>0.1).length+'/'+emit.length+' lit at 1:10');
}
let dbad=0;
for(let i=0;i<Math.floor(out.DUR*10);i++){const f=out.droneFrame(i/10);
  for(const d of f.drones){ if(!(d.level>=0&&d.level<=1))dbad++;
    for(const c of [d.r,d.g,d.b]) if(!(c>=0&&c<=255))dbad++ }}
console.log('  sky   120 drones  '+(dbad?('FAIL '+dbad):'ok')+'   '
  +out.droneFrame(70).drones.length+' drones');
let lbad=0;
out.LANES.forEach(L=>{try{L.draw(ctx(),1400,L.h)}catch(e){lbad++;console.log('   lane FAIL',L.name,e.message)}});
console.log('  score '+out.LANES.length+' lanes  '+(lbad?('FAIL '+lbad):'all draw without throwing'));
