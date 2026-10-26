export const hex = rgb => '#' + rgb.map(n => Math.round(n).toString(16).padStart(2,'0')).join('').toUpperCase();
export function gridDimensions(width, height, ratio, keepRatio=true) {
  if (!Number.isSafeInteger(width)||width<1) throw Error('横向豆数须为正整数');
  const h=keepRatio?Math.max(1,Math.round(width*ratio)):height;
  if (!Number.isSafeInteger(h)||h<1||!Number.isSafeInteger(width*h)) throw Error('网格尺寸过大或不是正整数，请调整数值');
  return {width,height:h};
}
export function quantize(rgba, width, height, maxColors, progress=()=>{}) {
  gridDimensions(width,height,1,false);
  if (!Number.isInteger(maxColors)||maxColors<1||maxColors>128) throw Error('颜色数量须在 1–128 之间');
  if (rgba.length!==width*height*4) throw Error('像素数据长度不匹配');
  const points=[], histogram=new Map();
  for(let i=0;i<width*height;i++) {
    if(rgba[i*4+3]<128){points.push(null);continue;}
    const rgb=Array.from(rgba.slice(i*4,i*4+3));points.push(rgb);
    const key=rgb.join(',');const v=histogram.get(key);if(v)v.n++;else histogram.set(key,{rgb,n:1});
  }
  const allSamples=[...histogram.values()].sort((a,b)=>b.n-a.n || a.rgb.join(',').localeCompare(b.rgb.join(',')));
  if(allSamples.length<=maxColors){
    const lookup=new Map(allSamples.map((p,i)=>[p.rgb.join(','),i]));
    const palette=allSamples.map((p,i)=>({id:`C${String(i+1).padStart(2,'0')}`,rgb:p.rgb,hex:hex(p.rgb)}));
    progress(100);return {width,height,palette,cells:points.map(p=>p?lookup.get(p.join(',')):-1)};
  }
  // Train on at most 4096 weighted buckets. Pixel assignment still uses every cell.
  let samples=allSamples;
  if(samples.length>4096){
    const sorted=samples.slice().sort((a,b)=>(a.rgb[0]*65536+a.rgb[1]*256+a.rgb[2])-(b.rgb[0]*65536+b.rgb[1]*256+b.rgb[2]));
    const group=Math.ceil(sorted.length/4096),reduced=[];
    for(let start=0;start<sorted.length;start+=group){const sum=[0,0,0];let n=0;for(let j=start;j<Math.min(start+group,sorted.length);j++){const p=sorted[j];n+=p.n;for(let c=0;c<3;c++)sum[c]+=p.rgb[c]*p.n;}reduced.push({rgb:sum.map(v=>v/n),n});}samples=reduced;
  }
  progress(10);
  if(!samples.length)return {width,height,palette:[],cells:Array(width*height).fill(-1)};
  const distance=(a,b)=>(a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2;
  let centers=[samples[0].rgb.slice()];
  const k=Math.min(maxColors,samples.length);
  const nearest=samples.map(p=>distance(p.rgb,centers[0]));
  while(centers.length<k){
    let best=null,score=-1;
    for(let i=0;i<samples.length;i++){const p=samples[i],s=nearest[i]*Math.sqrt(p.n);if(s>score){score=s;best=p.rgb;}}
    centers.push(best.slice());
    samples.forEach((p,i)=>{nearest[i]=Math.min(nearest[i],distance(p.rgb,best));});
  }
  for(let step=0;step<12;step++){
    progress(15+Math.round(step/12*55));
    const sums=centers.map(()=>[0,0,0,0]);
    for(const p of samples){let idx=0,best=Infinity;centers.forEach((c,i)=>{const d=distance(c,p.rgb);if(d<best){best=d;idx=i;}});p.rgb.forEach((v,i)=>sums[idx][i]+=v*p.n);sums[idx][3]+=p.n;}
    const next=sums.map((s,i)=>s[3]?s.slice(0,3).map(v=>Math.round(v/s[3])):centers[i]);
    if(JSON.stringify(next)===JSON.stringify(centers))break;centers=next;
  }
  // Merge rounded duplicate centers and remove unused colors before numbering.
  centers=[...new Map(centers.map(c=>[hex(c),c])).values()];
  progress(75);
  let cells=points.map(p=>{if(!p)return -1;let idx=0,best=Infinity;centers.forEach((c,i)=>{const d=distance(c,p);if(d<best){best=d;idx=i;}});return idx;});
  const used=[...new Set(cells.filter(i=>i>=0))].sort((a,b)=>a-b);
  const remap=new Map(used.map((v,i)=>[v,i]));cells=cells.map(v=>v<0?-1:remap.get(v));
  const palette=used.map((old,i)=>({id:`C${String(i+1).padStart(2,'0')}`,rgb:centers[old],hex:hex(centers[old])}));
  progress(100);
  return {width,height,palette,cells};
}
export function counts(pattern){const result=pattern.palette.map(p=>({...p,count:0}));for(const i of pattern.cells)if(i>=0&&result[i])result[i].count++;return result;}
export function csv(pattern){return '\uFEFF编号,HEX颜色,颗数\r\n'+counts(pattern).filter(p=>p.count).map(p=>`${p.id},${p.hex},${p.count}`).join('\r\n');}
export function svg(pattern){
  const cell=26,pad=42,w=Math.max(640,pattern.width*cell+pad*2),list=counts(pattern).filter(p=>p.count),cols=Math.max(2,Math.floor((w-pad*2)/210));
  const h=pattern.height*cell+190+Math.ceil(list.length/cols)*38,parts=[`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="white"/><style>text{font-family:Arial,sans-serif}</style><defs>`];
  pattern.palette.forEach((p,i)=>{const light=p.rgb[0]*.299+p.rgb[1]*.587+p.rgb[2]*.114>155;parts.push(`<g id="c${i}"><rect width="26" height="26" fill="${p.hex}" stroke="#888" stroke-width=".4"/><text x="13" y="16" font-size="7" text-anchor="middle" fill="${light?'#332b40':'white'}">${p.id}</text></g>`);});
  parts.push(`<pattern id="empty" width="26" height="26" patternUnits="userSpaceOnUse"><rect width="26" height="26" fill="#f6f3f8" stroke="#bbb" stroke-width=".4"/></pattern></defs><text x="42" y="36" font-size="23">DOUGE · 拼豆图纸</text><text x="42" y="64" font-size="14">${pattern.width} × ${pattern.height} 格 · ${list.reduce((s,p)=>s+p.count,0)} 颗 · ${list.length} 色</text><g transform="translate(42,100)"><rect width="${pattern.width*cell}" height="${pattern.height*cell}" fill="url(#empty)"/>`);
  pattern.cells.forEach((i,n)=>{if(i>=0)parts.push(`<use href="#c${i}" x="${n%pattern.width*cell}" y="${Math.floor(n/pattern.width)*cell}"/>`);});parts.push('</g>');
  list.forEach((p,i)=>{const x=pad+i%cols*210,y=pattern.height*cell+130+Math.floor(i/cols)*38;parts.push(`<rect x="${x}" y="${y}" width="22" height="22" fill="${p.hex}" stroke="#bbb"/><text x="${x+30}" y="${y+16}" font-size="13">${p.id} ${p.hex} · ${p.count}颗</text>`);});
  parts.push(`<text x="42" y="${h-24}" font-size="12" fill="#81748e">通用 RGB 配色 · 非品牌色号 · 透明格不计用豆</text></svg>`);return parts.join('');
}
