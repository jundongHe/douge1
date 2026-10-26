import {gridDimensions} from './core.js';
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
export function cropPixels(width,height,crop={x:0,y:0,width:1,height:1}){
  gridDimensions(width,height,1,false);
  if(![crop.x,crop.y,crop.width,crop.height].every(Number.isFinite)||crop.x<0||crop.y<0||crop.width<=0||crop.height<=0||crop.x+crop.width>1.000001||crop.y+crop.height>1.000001)throw Error('裁剪范围无效');
  const x=Math.min(width-1,Math.floor(crop.x*width)),y=Math.min(height-1,Math.floor(crop.y*height));
  return {x,y,width:Math.max(1,Math.min(width-x,Math.round(crop.width*width))),height:Math.max(1,Math.min(height-y,Math.round(crop.height*height)))};
}
export function detectBorderColor(rgba,width,height){
  const bins=new Map();let total=0,transparent=0;
  const add=n=>{const o=n*4;total++;if(rgba[o+3]<128){transparent++;return;}const rgb=Array.from(rgba.slice(o,o+3)),key=rgb.map(v=>Math.floor(v/24)).join(',');let b=bins.get(key);if(!b){b={n:0,sum:[0,0,0]};bins.set(key,b);}b.n++;rgb.forEach((v,c)=>b.sum[c]+=v);};
  for(let x=0;x<width;x++){add(x);if(height>1)add((height-1)*width+x);}
  for(let y=1;y<height-1;y++){add(y*width);if(width>1)add(y*width+width-1);}
  const best=[...bins.values()].sort((a,b)=>b.n-a.n)[0];return best&&transparent<total*.5&&best.n>=total*.25?best.sum.map(v=>Math.round(v/best.n)):null;
}
export function processPhoto(rgba,width,height,options={}){
  gridDimensions(width,height,1,false);if(rgba.length!==width*height*4)throw Error('照片像素长度不匹配');
  let pixels=new Uint8ClampedArray(rgba),removedPixels=0;
  if(!options.enabled)return {pixels,removedPixels,backgroundColor:null};
  let backgroundColor=null;
  if(options.backgroundMode==='auto')backgroundColor=detectBorderColor(pixels,width,height);
  else if(options.backgroundMode==='picked'){
    if(!Array.isArray(options.backgroundColor)||options.backgroundColor.length!==3||!options.backgroundColor.every(v=>Number.isFinite(v)&&v>=0&&v<=255))throw Error('请选择有效背景颜色');
    backgroundColor=options.backgroundColor;
  }
  if(backgroundColor){
    const tolerance=Math.max(0,Math.min(160,Number(options.tolerance)||0)),seen=new Uint8Array(width*height),queue=new Int32Array(width*height);let head=0,tail=0;
    const add=n=>{if(seen[n])return;seen[n]=1;const o=n*4;if(pixels[o+3]<128||distance([pixels[o],pixels[o+1],pixels[o+2]],backgroundColor)<=tolerance)queue[tail++]=n;};
    for(let x=0;x<width;x++){add(x);add((height-1)*width+x);}for(let y=0;y<height;y++){add(y*width);add(y*width+width-1);}
    while(head<tail){const n=queue[head++],x=n%width,y=Math.floor(n/width),o=n*4;if(pixels[o+3]>=128)removedPixels++;pixels[o+3]=0;if(x>0)add(n-1);if(x<width-1)add(n+1);if(y>0)add(n-width);if(y<height-1)add(n+width);}
  }
  const strength=Math.max(0,Math.min(100,Number(options.smooth)||0));
  if(strength){
    const threshold=15+strength*1.05,passes=strength>65?2:1;
    for(let pass=0;pass<passes;pass++){
      const next=new Uint8ClampedArray(pixels);
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){
        const n=y*width+x,o=n*4;if(pixels[o+3]<128)continue;let total=0;const sum=[0,0,0],center=[pixels[o],pixels[o+1],pixels[o+2]];
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          const nx=x+dx,ny=y+dy;if(nx<0||nx>=width||ny<0||ny>=height)continue;const a=(ny*width+nx)*4;
          if(pixels[a+3]<128||distance(center,[pixels[a],pixels[a+1],pixels[a+2]])>threshold)continue;
          const weight=dx===0&&dy===0?2:1;total+=weight;for(let c=0;c<3;c++)sum[c]+=pixels[a+c]*weight;
        }
        for(let c=0;c<3;c++)next[o+c]=Math.round(sum[c]/total);
      }pixels=next;
    }
  }
  return {pixels,removedPixels,backgroundColor};
}
export function simplifyPattern(pattern,options={}){
  if(!options.enabled)return pattern;
  let cells=pattern.cells.slice(),palette=pattern.palette.map(p=>({...p,rgb:p.rgb.slice()}));const before=palette.length;let cleanedCells=0;
  const merge=Math.max(0,Math.min(100,Number(options.merge)||0));
  if(merge&&palette.length){
    const quantities=palette.map(()=>0);for(const c of cells)if(c>=0)quantities[c]++;
    const ordered=palette.map((_,i)=>i).sort((a,b)=>quantities[b]-quantities[a]||a-b),representatives=[],map=new Map();
    for(const i of ordered){let target=-1,best=Infinity;for(const j of representatives){const d=distance(palette[i].rgb,palette[j].rgb);if(d<=merge&&d<best){target=j;best=d;}}if(target<0){target=i;representatives.push(i);}map.set(i,target);}
    cells=cells.map(c=>c<0?-1:map.get(c));
  }
  const cleanup=Math.max(0,Math.min(3,Math.round(Number(options.cleanup)||0)));
  if(cleanup){
    const {width:w,height:h}=pattern,original=cells.slice(),seen=new Uint8Array(cells.length),limit=[0,1,2,4][cleanup],queue=[];
    for(let start=0;start<original.length;start++){
      if(seen[start]||original[start]<0)continue;const color=original[start];queue.length=0;queue.push(start);seen[start]=1;let head=0;
      while(head<queue.length){const n=queue[head++],x=n%w,y=Math.floor(n/w);for(const next of [x>0?n-1:-1,x<w-1?n+1:-1,y>0?n-w:-1,y<h-1?n+w:-1])if(next>=0&&!seen[next]&&original[next]===color){seen[next]=1;queue.push(next);}}
      if(queue.length>limit)continue;
      const boundary=new Map();let count=0,touchesEmpty=false;
      for(const n of queue){const x=n%w,y=Math.floor(n/w);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy;if(nx<0||nx>=w||ny<0||ny>=h)continue;const c=original[ny*w+nx];if(c<0){touchesEmpty=true;continue;}if(c===color)continue;boundary.set(c,(boundary.get(c)||0)+1);count++;}}
      if(touchesEmpty||!count)continue;
      const winner=[...boundary].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0];
      if(!winner||winner[1]<Math.max(3,Math.ceil(count*.65)))continue;
      if(options.protectDetails!==false&&distance(palette[color].rgb,palette[winner[0]].rgb)>75)continue;
      for(const n of queue){cells[n]=winner[0];cleanedCells++;}
    }
  }
  const used=[...new Set(cells.filter(c=>c>=0))].sort((a,b)=>a-b),map=new Map(used.map((c,i)=>[c,i]));
  palette=used.map((c,i)=>({...palette[c],id:`C${String(i+1).padStart(2,'0')}`}));cells=cells.map(c=>c<0?-1:map.get(c));
  return {...pattern,palette,cells,photoStats:{mergedColors:before-palette.length,cleanedCells}};
}
