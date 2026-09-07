function mkCanvas(W,H){
  const buf=new Float32Array(W*H*3);
  let ADD=false;
  const px=(x,y,r,g,b,a)=>{ if(x<0||y<0||x>=W||y>=H||a<=0) return;
    const k=((y|0)*W+(x|0))*3;
    if(ADD){ buf[k]=Math.min(255,buf[k]+r*a); buf[k+1]=Math.min(255,buf[k+1]+g*a); buf[k+2]=Math.min(255,buf[k+2]+b*a); return }
    buf[k]=buf[k]*(1-a)+r*a; buf[k+1]=buf[k+1]*(1-a)+g*a; buf[k+2]=buf[k+2]*(1-a)+b*a; };
  const parse=c=>{ if(typeof c!=='string') return null;
    let m=/^#([0-9a-f]{6})$/i.exec(c); if(m){const v=parseInt(m[1],16);return[v>>16,(v>>8)&255,v&255,1]}
    m=/^#([0-9a-f]{3})$/i.exec(c); if(m){const v=m[1];return[parseInt(v[0]+v[0],16),parseInt(v[1]+v[1],16),parseInt(v[2]+v[2],16),1]}
    m=/rgba?\(([^)]+)\)/.exec(c); if(m){const p=m[1].split(',').map(Number);return[p[0],p[1],p[2],p.length>3?p[3]:1]}
    return [255,255,255,1]; };
  class Grad{ constructor(kind,a){this.kind=kind;this.a=a;this.stops=[]}
    addColorStop(o,c){this.stops.push([o,parse(c)||[255,255,255,1]])}
    at(f){ if(!this.stops.length) return [0,0,0,0];
      const s=this.stops.slice().sort((x,y)=>x[0]-y[0]);
      if(f<=s[0][0]) return s[0][1]; if(f>=s[s.length-1][0]) return s[s.length-1][1];
      for(let i=1;i<s.length;i++){ if(f<=s[i][0]){ const t=(f-s[i-1][0])/(s[i][0]-s[i-1][0]||1);
        const A=s[i-1][1],B=s[i][1]; return [A[0]+(B[0]-A[0])*t,A[1]+(B[1]-A[1])*t,A[2]+(B[2]-A[2])*t,A[3]+(B[3]-A[3])*t]; } }
      return s[s.length-1][1]; } }
  const ctx={
    set globalCompositeOperation(v){ ADD = (v==='lighter'||v==='screen'||v==='add') },
    get globalCompositeOperation(){ return ADD?'lighter':'source-over' },
    canvas:{width:W,height:H}, fillStyle:'#000', strokeStyle:'#000', lineWidth:1,
    font:'', textAlign:'left', globalAlpha:1, _path:[],
    setTransform(){}, save(){}, restore(){}, translate(){}, rotate(){}, scale(){},
    measureText(){return{width:6}}, fillText(){}, strokeText(){},
    createRadialGradient(x0,y0,r0,x1,y1,r1){return new Grad('r',{x1,y1,r1})},
    createLinearGradient(x0,y0,x1,y1){return new Grad('l',{x0,y0,x1,y1})},
    beginPath(){this._path=[]}, closePath(){}, moveTo(x,y){this._path.push(['m',x,y])},
    lineTo(x,y){this._path.push(['l',x,y])},
    arc(x,y,r,a0,a1){this._path.push(['a',x,y,Math.max(0,r)])},
    ellipse(x,y,rx,ry){this._path.push(['e',x,y,Math.max(0,rx),Math.max(0,ry)])},
    quadraticCurveTo(){}, bezierCurveTo(){}, arcTo(){}, setLineDash(){},
    roundRect(x,y,w,h,r){this._path.push(['r',x,y,Math.max(0,w),Math.max(0,h)])},
    rect(x,y,w,h){this._path.push(['r',x,y,Math.max(0,w),Math.max(0,h)])},
    fillRect(x,y,w,h){ this._paint(['r',x,y,w,h], this.fillStyle) },
    stroke(){}, clip(){},
    fill(){
      const poly=[];
      for(const p of this._path){ if(p[0]==='m'||p[0]==='l') poly.push([p[1],p[2]]) }
      if(poly.length>=3) this._polyFill(poly, this.fillStyle);
      for(const p of this._path) if(p[0]!=='m'&&p[0]!=='l') this._paint(p, this.fillStyle);
    },
    _polyFill(poly, style){
      const g = style instanceof Grad ? style : null;
      const flat = g? null : (parse(style)||[255,255,255,1]);
      let ymin=1e9,ymax=-1e9,xmin=1e9,xmax=-1e9;
      for(const [x,y] of poly){ if(y<ymin)ymin=y; if(y>ymax)ymax=y; if(x<xmin)xmin=x; if(x>xmax)xmax=x }
      ymin=Math.max(0,Math.floor(ymin)); ymax=Math.min(H-1,Math.ceil(ymax));
      for(let y=ymin;y<=ymax;y++){
        const xs=[];
        for(let i=0;i<poly.length;i++){
          const a2=poly[i], b2=poly[(i+1)%poly.length];
          if((a2[1]<=y&&b2[1]>y)||(b2[1]<=y&&a2[1]>y)){
            const t=(y-a2[1])/((b2[1]-a2[1])||1e-9);
            xs.push(a2[0]+t*(b2[0]-a2[0]));
          }
        }
        if(xs.length<2) continue;
        xs.sort((p1,p2)=>p1-p2);
        for(let k=0;k+1<xs.length;k+=2){
          const x0=Math.max(0,Math.floor(xs[k])), x1=Math.min(W-1,Math.ceil(xs[k+1]));
          for(let x=x0;x<=x1;x++){
            let f=0;
            if(g&&g.kind==='l'){ const dx=g.a.x1-g.a.x0, dy=g.a.y1-g.a.y0;
              f=((x-g.a.x0)*dx+(y-g.a.y0)*dy)/((dx*dx+dy*dy)||1) }
            else if(g&&g.kind==='r'){ f=Math.hypot(x-g.a.x1,y-g.a.y1)/(g.a.r1||1) }
            const c = g? g.at(Math.max(0,Math.min(1,f))) : flat;
            px(x,y,c[0],c[1],c[2],(c[3]===undefined?1:c[3])*this.globalAlpha);
          }
        }
      }
    },
    _paint(p, style){
      const g = style instanceof Grad ? style : null;
      const flat = g? null : (parse(style)||[255,255,255,1]);
      const put=(x,y,f)=>{ const c = g? g.at(f) : flat;
        px(x,y,c[0],c[1],c[2],(c[3]===undefined?1:c[3])*this.globalAlpha); };
      if(p[0]==='r'){ const [,x,y,w,h]=p;
        for(let j=Math.max(0,y|0);j<Math.min(H,(y+h)|0);j++)
          for(let i=Math.max(0,x|0);i<Math.min(W,(x+w)|0);i++){
            let f=0; if(g&&g.kind==='r'){ f=Math.hypot(i-g.a.x1,j-g.a.y1)/(g.a.r1||1) }
            else if(g&&g.kind==='l'){ const dx=g.a.x1-g.a.x0, dy=g.a.y1-g.a.y0;
              f=((i-g.a.x0)*dx+(j-g.a.y0)*dy)/((dx*dx+dy*dy)||1) }
            put(i,j,Math.max(0,Math.min(1,f))); } }
      else if(p[0]==='e'){ const [,cx,cy,rx,ry]=p;
        for(let j=Math.max(0,(cy-ry)|0);j<=Math.min(H-1,(cy+ry)|0);j++)
          for(let i=Math.max(0,(cx-rx)|0);i<=Math.min(W-1,(cx+rx)|0);i++){
            const nx=(i-cx)/(rx||1), ny=(j-cy)/(ry||1); const d=Math.hypot(nx,ny);
            if(d>1) continue;
            let f=d; if(g&&g.kind==='r') f=Math.hypot(i-g.a.x1,j-g.a.y1)/(g.a.r1||1);
            put(i,j,Math.max(0,Math.min(1,f))); } }
      else if(p[0]==='a'){ const [,cx,cy,r]=p;
        for(let j=Math.max(0,(cy-r)|0);j<=Math.min(H-1,(cy+r)|0);j++)
          for(let i=Math.max(0,(cx-r)|0);i<=Math.min(W-1,(cx+r)|0);i++){
            const d=Math.hypot(i-cx,j-cy); if(d>r) continue;
            let f=d/(r||1);
            if(g&&g.kind==='r') f=Math.hypot(i-g.a.x1,j-g.a.y1)/(g.a.r1||1);
            put(i,j,Math.max(0,Math.min(1,f))); } }
    },
  };
  return { ctx, buf, W, H,
    clientWidth:W, clientHeight:H, width:W, height:H,
    getContext(){ return ctx } };
}
module.exports={mkCanvas};
