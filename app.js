import {gridDimensions,counts,csv,svg} from './core.js';
import {cropPixels} from './photo.js';
const $=id=>document.getElementById(id);
let source=null,pattern=null,selected=0,history=[],zoom=0,tab='pattern',timer;
let generationWorker=null;
let crop={x:0,y:0,width:1,height:1},draftCrop={...crop},cropStart=null,pickingBackground=false,classicColors=128,processedReady=false;
const preview=$('preview'),ctx=preview.getContext('2d');
preview.style.touchAction='none';
function notify(message){$('status').textContent=message;$('status').classList.add('visible');clearTimeout(timer);timer=setTimeout(()=>$('status').classList.remove('visible'),4500);}
function makeDemo(){
  const c=document.createElement('canvas');c.width=c.height=240;const x=c.getContext('2d');
  // A code-drawn pixel kitten; transparent surroundings remain empty beads.
  const rows=[
    '....................','....22........22....','....232......232....','....2332....2332....',
    '....233322223332....','...23333333333332...','..2333333333333332..','..2333333333333332..',
    '..2332233333223332..','..2332233333223332..','..2333334433333332..','..2333334433333332..',
    '...23333443333332...','....233333333332....','.....2222222222.....','......23333332......',
    '.....2333333332.....','....233333333332....','....222222222222....','....................'];
  const palette={2:'#554039',3:'#F1BD80',4:'#D67F7E'};
  rows.forEach((row,y)=>[...row].forEach((v,i)=>{if(palette[v]){x.fillStyle=palette[v];x.fillRect(i*12,y*12,12,12);}}));
  source=c;resetImageSettings();setPhotoMode(false,false);$('original').src=c.toDataURL();$('sourceName').textContent='正在使用：小猫示例';generate();
}
function resetImageSettings(){crop={x:0,y:0,width:1,height:1};processedReady=false;pickingBackground=false;$('original').style.cursor='';$('processedImage').removeAttribute('src');$('cropSummary').textContent='当前使用完整图片';}
function photoSettings(){return {enabled:$('photoMode').checked,backgroundMode:$('backgroundMode').value,backgroundColor:$('backgroundColor').value.slice(1).match(/../g).map(v=>parseInt(v,16)),tolerance:+$('backgroundTolerance').value,smooth:+$('detailSmooth').value,merge:+$('colorMerge').value,cleanup:+$('speckleClean').value,protectDetails:$('protectDetails').checked};}
function lineartSettings(){return {threshold:(100-+$('lineartSensitivity').value)*5,thickness:+$('lineartThickness').value};}
function setPhotoMode(enabled,regenerate=true){
  const wasEnabled=$('photoMode').checked;$('photoMode').checked=enabled;$('photoOptions').hidden=!enabled;
  if(enabled&&!wasEnabled){classicColors=+$('colors').value;$('colors').value=24;}else if(!enabled&&wasEnabled)$('colors').value=classicColors;
  $('colorsValue').textContent=$('colors').value+' 色';if(regenerate)generate();
}
function dirtyPhotoSettings(){stopGeneration();$('generationProgress').textContent='设置已更改，点击“生成拼豆图案”应用';}
function stopGeneration(){if(generationWorker){generationWorker.terminate();generationWorker=null;}$('generate').disabled=false;$('generate').textContent='✦ 生成拼豆图案';$('cancelGenerate').hidden=true;}
function syncDimensions(){
  const width=Number($('sizeNumber').value),height=Number($('heightNumber').value);
  $('heightNumber').disabled=$('keepRatio').checked;
  try{const rect=source?cropPixels(source.width,source.height,crop):{width:1,height:1};const d=gridDimensions(width,height,rect.height/rect.width,$('keepRatio').checked);$('heightNumber').value=d.height;$('sizeValue').textContent=`${d.width} × ${d.height}`;
    $('size').max=Math.max(256,2**Math.ceil(Math.log2(Math.max(1,width)*1.25)));$('size').value=width;
    $('sizeDrag').setAttribute('aria-valuenow',width);document.querySelectorAll('[data-size]').forEach(b=>b.classList.toggle('active',+b.dataset.size===width));
    return d;
  }catch(error){$('sizeValue').textContent='请输入正整数';throw error;}
}
function generate(){
  if(!source)return;stopGeneration();
  try{
    const {width:w,height:h}=syncDimensions(),colors=+$('colors').value;
    const rect=cropPixels(source.width,source.height,crop);
    const lineartOn=$('lineartMode').checked;
    // Line-art mode extracts edges at 3x grid resolution (capped by the source),
    // then max-pools down to grid size in the worker, so thin lines survive.
    const cw=lineartOn?Math.min(rect.width,w*3):w;
    const ch=lineartOn?Math.max(1,Math.round(cw*rect.height/rect.width)):h;
    const c=document.createElement('canvas');c.width=cw;c.height=ch;const x=c.getContext('2d',{willReadFrequently:true});
    if(!x||c.width!==cw||c.height!==ch)throw Error('设备无法分配此尺寸画布，请减小尺寸');
    x.imageSmoothingEnabled=true;x.imageSmoothingQuality='high';x.drawImage(source,rect.x,rect.y,rect.width,rect.height,0,0,cw,ch);
    const rgba=x.getImageData(0,0,cw,ch).data;
    const worker=new Worker(new URL('./quantize-worker.js',import.meta.url),{type:'module'});generationWorker=worker;
    $('generate').disabled=true;$('generate').textContent='正在生成…';$('cancelGenerate').hidden=false;$('generationProgress').textContent=`${w} × ${h} · ${(w*h).toLocaleString()} 格 · 准备配色…`;
    worker.onmessage=({data})=>{if(generationWorker!==worker)return;
      if(data.type==='progress'){$('generationProgress').textContent=`${w} × ${h} · ${(w*h).toLocaleString()} 格 · ${data.percent}%`;return;}
      if(data.type==='error'){stopGeneration();$('generationProgress').textContent='生成失败，请调整尺寸后重试';notify(data.message);return;}
      pattern=data.pattern;stopGeneration();
      try{const processed=document.createElement('canvas');processed.width=w;processed.height=h;processed.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data.processed),w,h),0,0);$('processedImage').src=processed.toDataURL();processedReady=true;}catch{processedReady=false;$('processedImage').removeAttribute('src');}
      selected=pattern.palette.length?(lineartOn?-1:0):-1;history=[];zoom=0;setTab('pattern');refresh();const stats=pattern.photoStats||{};$('generationProgress').textContent=lineartOn?`已生成 ${w} × ${h} 格，线稿 ${stats.lineCells||0} 格`:`已生成 ${w} × ${h} 格，${pattern.palette.length} 色`+($('photoMode').checked?` · 去背景 ${stats.removedPixels||0} 格，清理 ${stats.cleanedCells||0} 格`:'');notify(lineartOn?'线稿已生成，已进入擦除模式：按住拖动可擦掉不需要的线条':'图案已生成，选一颗颜色开始微调吧');
    };
    worker.onerror=()=>{if(generationWorker!==worker)return;stopGeneration();$('generationProgress').textContent='生成失败';notify('后台生成失败，可能是设备内存不足，请减小尺寸后重试');};
    worker.postMessage({width:w,height:h,hiWidth:cw,hiHeight:ch,colors,photo:photoSettings(),lineart:lineartOn?lineartSettings():null,buffer:rgba.buffer},[rgba.buffer]);
  }catch(e){stopGeneration();$('generationProgress').textContent='未生成，请检查尺寸';notify('生成失败：'+e.message);}
}
function refresh(){
  $('dimension').textContent=`${pattern.width} × ${pattern.height}`;
  const list=counts(pattern);$('beadCount').textContent=list.reduce((s,p)=>s+p.count,0).toLocaleString();$('colorCount').textContent=list.filter(p=>p.count>0).length;
  $('palette').replaceChildren();
  list.forEach((p,i)=>{const b=document.createElement('button');b.className='color-row'+(selected===i?' selected':'');b.setAttribute('aria-label',`选择 ${p.id} ${p.hex}，${p.count} 颗`);b.setAttribute('aria-pressed',String(selected===i));
    const sw=document.createElement('span');sw.className='swatch';sw.style.background=p.hex;
    const label=document.createElement('span');label.className='color-label';label.textContent=p.id;const small=document.createElement('small');small.textContent=p.hex;label.append(small);
    const qty=document.createElement('span');qty.className='color-qty';qty.textContent=p.count;
    b.append(sw,label,qty);b.onclick=()=>{selected=i;refresh();};$('palette').append(b);
  });
  $('eraser').classList.toggle('active',selected===-1);$('undo').disabled=history.length===0;
  $('editHint').textContent=selected<0?($('lineartMode').checked?'线稿模式：按住拖动擦除不需要的线条':'留空模式：点击网格移除一颗豆'):`当前 ${pattern.palette[selected].id} · 点击网格微调`;
  draw();
}
function cellColor(index){return index<0?null:pattern.palette[index].hex;}
function ink(rgb){return rgb[0]*.299+rgb[1]*.587+rgb[2]*.114>155?'#3a3045':'#ffffff';}
function renderChart(target,cell,{labels=false,grid=true,beads=false,offsetX=0,offsetY=0}={}){
  const g=target.getContext('2d');const {width:w,height:h,cells,palette}=pattern;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=cells[y*w+x],px=offsetX+x*cell,py=offsetY+y*cell;
    g.fillStyle=i<0?((x+y)%2?'#f5f2f8':'#ffffff'):(beads?'#f8f5fb':cellColor(i));g.fillRect(px,py,cell,cell);
    if(i>=0&&beads){g.fillStyle=cellColor(i);g.beginPath();g.arc(px+cell/2,py+cell/2,cell*.43,0,Math.PI*2);g.fill();g.fillStyle='#ffffff85';g.beginPath();g.arc(px+cell/2,py+cell/2,cell*.115,0,Math.PI*2);g.fill();}
    if(labels&&i>=0){g.fillStyle=ink(palette[i].rgb);g.font=`600 ${Math.max(5,cell*.30)}px sans-serif`;g.textAlign='center';g.textBaseline='middle';g.fillText(palette[i].id,px+cell/2,py+cell/2);}
  }
  if(grid){g.lineWidth=.6;for(let x=0;x<=w;x++){g.strokeStyle=x%5===0?'#625a6b70':'#625a6b25';g.beginPath();g.moveTo(offsetX+x*cell,offsetY);g.lineTo(offsetX+x*cell,offsetY+h*cell);g.stroke();}for(let y=0;y<=h;y++){g.strokeStyle=y%5===0?'#625a6b70':'#625a6b25';g.beginPath();g.moveTo(offsetX,offsetY+y*cell);g.lineTo(offsetX+w*cell,offsetY+y*cell);g.stroke();}}
}
function draw(){
  if(!pattern)return;
  const cell=Math.min(20,1600/Math.max(pattern.width,pattern.height));preview.width=Math.ceil(pattern.width*cell);preview.height=Math.ceil(pattern.height*cell);ctx.clearRect(0,0,preview.width,preview.height);
  renderChart(preview,cell,{labels:$('labels').checked&&cell>=10,grid:$('grid').checked&&cell>=3,beads:$('beads').checked&&!$('labels').checked&&cell>=4});
  const area=$('canvasArea'),fit=Math.min((area.clientWidth-64)/preview.width,(Math.min(area.clientHeight||520,650)-64)/preview.height,1);
  const scale=zoom||Math.max(.001,fit);preview.style.width=preview.width*scale+'px';preview.style.height=preview.height*scale+'px';
  $('canvasHolder').style.margin='auto';$('zoomValue').textContent=zoom?Math.round(scale*100)+'%':'适应';
}
function setTab(value){if(value==='processed'&&!processedReady){notify('请先生成图案，再查看处理预览');return;}tab=value;$('patternTab').classList.toggle('active',tab==='pattern');$('processedTab').classList.toggle('active',tab==='processed');$('originalTab').classList.toggle('active',tab==='original');$('canvasHolder').hidden=tab!=='pattern';$('processedImage').hidden=tab!=='processed';$('original').hidden=tab!=='original';}
async function loadFile(file){
  if(!file)return;if(!['image/png','image/jpeg','image/webp'].includes(file.type)){notify('请选择 PNG、JPG 或 WebP 图片');return;}
  if(file.size>15*1024*1024){notify('图片超过 15 MB，请压缩后重试');return;}
  const url=URL.createObjectURL(file),image=new Image();
  try{await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=url;});
    if(!image.naturalWidth||image.naturalWidth*image.naturalHeight>40000000){notify('图片像素过大，请缩小到 4000 万像素以内');return;}
    // Copy into a bounded local canvas; all subsequent operations are browser-local.
    const c=document.createElement('canvas'),ratio=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));c.width=Math.max(1,Math.round(image.naturalWidth*ratio));c.height=Math.max(1,Math.round(image.naturalHeight*ratio));c.getContext('2d').drawImage(image,0,0,c.width,c.height);source=c;resetImageSettings();setPhotoMode(true,false);$('original').src=c.toDataURL('image/png');$('sourceName').textContent='正在使用：'+file.name;generate();
  }catch{notify('这张图片无法读取，请换一张有效图片');}finally{URL.revokeObjectURL(url);$('file').value='';}
}
function download(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function exportPng(){
  if(!pattern){notify('请先等待图案生成完成');return;}
  try{
  const cell=26,pad=42,list=counts(pattern).filter(p=>p.count),chartWidth=pattern.width*cell,chartHeight=pattern.height*cell;
  const c=document.createElement('canvas');c.width=Math.max(640,chartWidth+pad*2);const cols=Math.max(2,Math.floor((c.width-pad*2)/170));const legendRows=Math.ceil(list.length/cols);c.height=chartHeight+190+legendRows*38;const g=c.getContext('2d');g.fillStyle='white';g.fillRect(0,0,c.width,c.height);
  g.fillStyle='#292737';g.font='bold 23px sans-serif';g.fillText('豆格 DOUGE · 拼豆图纸',pad,37);g.font='13px sans-serif';g.fillStyle='#82778f';g.fillText(`${pattern.width} × ${pattern.height} 格 · ${list.reduce((s,p)=>s+p.count,0)} 颗 · ${list.length} 色`,pad,65);
  const ox=Math.floor((c.width-chartWidth)/2),oy=100;renderChart(c,cell,{labels:true,grid:true,offsetX:ox,offsetY:oy});
  g.font='9px sans-serif';g.fillStyle='#918899';g.textAlign='center';g.textBaseline='middle';for(let x=0;x<pattern.width;x++)if((x+1)%5===0||x===0)g.fillText(x+1,ox+(x+.5)*cell,oy-12);for(let y=0;y<pattern.height;y++)if((y+1)%5===0||y===0)g.fillText(y+1,ox-18,oy+(y+.5)*cell);
  list.forEach((p,i)=>{const x=pad+(i%cols)*170,y=oy+chartHeight+30+Math.floor(i/cols)*38;g.fillStyle=p.hex;g.fillRect(x,y,22,22);g.strokeStyle='#ded6e7';g.strokeRect(x,y,22,22);g.fillStyle='#55495f';g.font='12px sans-serif';g.textAlign='left';g.textBaseline='middle';g.fillText(`${p.id} ${p.hex} · ${p.count}颗`,x+29,y+11);});
  g.fillStyle='#95889f';g.font='11px sans-serif';g.textAlign='left';g.fillText('通用 RGB 配色 · 非品牌色号 · 透明格不计用豆 · 请按实物色卡选豆',pad,c.height-24);
  c.toBlob(blob=>{if(blob){download(blob,`douge-${pattern.width}x${pattern.height}.png`);notify('编号图纸已导出，包含颜色用量清单');}else notify('此图超出设备 PNG 能力，请使用大图矢量图纸 SVG');},'image/png');
  }catch{notify('此图超出设备 PNG 能力，请使用大图矢量图纸 SVG');}
}
$('file').onchange=e=>loadFile(e.target.files[0]);
$('dropzone').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('file').click();}};
for(const event of ['dragenter','dragover'])$('dropzone').addEventListener(event,e=>{e.preventDefault();$('dropzone').classList.add('drag');});
for(const event of ['dragleave','drop'])$('dropzone').addEventListener(event,e=>{e.preventDefault();$('dropzone').classList.remove('drag');if(event==='drop')loadFile(e.dataTransfer.files[0]);});
$('generate').onclick=generate;$('demo').onclick=makeDemo;
$('colors').oninput=()=>{$('colorsValue').textContent=$('colors').value+' 色';};
for(const id of ['sizeNumber','heightNumber'])$(id).oninput=()=>{try{syncDimensions();}catch{}};
$('keepRatio').onchange=()=>{try{syncDimensions();}catch{}};
$('size').oninput=()=>{$('sizeNumber').value=$('size').value;try{const rect=source?cropPixels(source.width,source.height,crop):{width:1,height:1};const width=+$('sizeNumber').value,height=$('keepRatio').checked?Math.max(1,Math.round(width*rect.height/rect.width)):+$('heightNumber').value;$('heightNumber').value=height;$('sizeValue').textContent=`${width} × ${height}`;$('sizeDrag').setAttribute('aria-valuenow',width);document.querySelectorAll('[data-size]').forEach(b=>b.classList.toggle('active',+b.dataset.size===width));}catch{}};
$('size').onchange=()=>{try{syncDimensions();}catch{}};
document.querySelectorAll('[data-size]').forEach(b=>b.onclick=()=>{$('sizeNumber').value=b.dataset.size;generate();});
let dragStart=null;
$('sizeDrag').onpointerdown=e=>{dragStart={x:e.clientX,value:Number($('sizeNumber').value)||1};$('sizeDrag').setPointerCapture(e.pointerId);};
$('sizeDrag').onpointermove=e=>{if(!dragStart)return;$('sizeNumber').value=Math.max(1,dragStart.value+Math.round((e.clientX-dragStart.x)/3)*(e.shiftKey?10:1));try{syncDimensions();}catch{}};
for(const event of ['pointerup','pointercancel','lostpointercapture'])$('sizeDrag').addEventListener(event,()=>{dragStart=null;});
$('sizeDrag').onkeydown=e=>{if(['ArrowLeft','ArrowDown','ArrowRight','ArrowUp'].includes(e.key)){e.preventDefault();$('sizeNumber').value=Math.max(1,(+$('sizeNumber').value||1)+(['ArrowLeft','ArrowDown'].includes(e.key)?-1:1)*(e.shiftKey?10:1));try{syncDimensions();}catch{}}};
$('cancelGenerate').onclick=()=>{stopGeneration();$('generationProgress').textContent='已取消；修改数值后可重新生成';};
for(const id of ['grid','labels','beads'])$(id).onchange=draw;
$('patternTab').onclick=()=>setTab('pattern');$('processedTab').onclick=()=>setTab('processed');$('originalTab').onclick=()=>{pickingBackground=false;$('original').style.cursor='';setTab('original');};
$('eraser').onclick=()=>{selected=-1;refresh();};$('undo').onclick=()=>{const prev=history.pop();if(prev){for(const cell of prev)pattern.cells[cell.index]=cell.old;refresh();}};
let stroke=null;
function cellFromEvent(e){const r=preview.getBoundingClientRect(),x=Math.floor((e.clientX-r.left)/r.width*pattern.width),y=Math.floor((e.clientY-r.top)/r.height*pattern.height);if(x<0||x>=pattern.width||y<0||y>=pattern.height)return -1;return y*pattern.width+x;}
function applyCell(index){if(index<0)return;const old=pattern.cells[index];if(old===selected)return;stroke.push({index,old});pattern.cells[index]=selected;}
preview.onpointerdown=e=>{if(!pattern)return;preview.setPointerCapture(e.pointerId);stroke=[];applyCell(cellFromEvent(e));if(stroke.length)refresh();};
preview.onpointermove=e=>{if(!stroke)return;const before=stroke.length;applyCell(cellFromEvent(e));if(stroke.length>before)refresh();};
function endStroke(){if(stroke&&stroke.length){history.push(stroke);if(history.length>200)history.shift();}stroke=null;$('undo').disabled=history.length===0;}
for(const event of ['pointerup','pointercancel','lostpointercapture'])preview.addEventListener(event,endStroke);
preview.addEventListener('wheel',e=>{if(!pattern)return;e.preventDefault();const base=zoom||parseFloat(preview.style.width)/preview.width;zoom=e.deltaY<0?Math.min(3,base*1.15):Math.max(.1,base/1.15);draw();},{passive:false});
$('zoomIn').onclick=()=>{zoom=Math.min(3,(zoom||parseFloat(preview.style.width)/preview.width)*1.3);draw();};$('zoomOut').onclick=()=>{zoom=Math.max(.1,(zoom||parseFloat(preview.style.width)/preview.width)/1.3);draw();};$('fit').onclick=()=>{zoom=0;draw();};
$('exportPng').onclick=exportPng;$('exportCsv').onclick=()=>{if(!pattern){notify('请等待图案生成完成');return;}download(new Blob([csv(pattern)],{type:'text/csv;charset=utf-8'}),'douge-colors.csv');notify('用豆清单已导出');};
$('exportSvg').onclick=()=>{if(!pattern){notify('请等待图案生成完成');return;}try{download(new Blob([svg(pattern)],{type:'image/svg+xml;charset=utf-8'}),`douge-${pattern.width}x${pattern.height}.svg`);notify('矢量图纸已导出，可放大或打印');}catch{notify('设备内存不足，无法导出此图，请减小尺寸');}};
$('photoMode').onchange=()=>{const enabled=$('photoMode').checked;$('photoMode').checked=!enabled;setPhotoMode(enabled);};
$('lineartMode').onchange=()=>{$('lineartOptions').hidden=!$('lineartMode').checked;generate();};
for(const [id,output] of [['lineartSensitivity','lineartSensitivityValue'],['lineartThickness','lineartThicknessValue']])$(id).oninput=()=>{$(output).textContent=$(id).value;dirtyPhotoSettings();};
for(const [id,output] of [['backgroundTolerance','backgroundToleranceValue'],['detailSmooth','detailSmoothValue'],['colorMerge','colorMergeValue'],['speckleClean','speckleCleanValue']])$(id).oninput=()=>{$(output).textContent=id==='speckleClean'?['关闭','轻度','中度','较强'][+$(id).value]:$(id).value;dirtyPhotoSettings();};
for(const id of ['backgroundMode','backgroundColor','protectDetails'])$(id).onchange=dirtyPhotoSettings;
$('pickBackground').onclick=()=>{pickingBackground=true;setTab('original');$('original').style.cursor='crosshair';notify('在原始图片上点一下要去除的背景颜色');};
$('original').onclick=e=>{if(!pickingBackground||!source)return;const r=$('original').getBoundingClientRect(),x=Math.max(0,Math.min(source.width-1,Math.floor((e.clientX-r.left)/r.width*source.width))),y=Math.max(0,Math.min(source.height-1,Math.floor((e.clientY-r.top)/r.height*source.height)));const rgb=source.getContext('2d').getImageData(x,y,1,1).data;$('backgroundColor').value='#'+Array.from(rgb.slice(0,3),v=>v.toString(16).padStart(2,'0')).join('');$('backgroundMode').value='picked';pickingBackground=false;$('original').style.cursor='';generate();};
function drawCrop(){
  if(!source)return;const c=$('cropCanvas'),scale=Math.min(600/source.width,420/source.height,1);c.width=Math.max(1,Math.round(source.width*scale));c.height=Math.max(1,Math.round(source.height*scale));const g=c.getContext('2d');g.drawImage(source,0,0,c.width,c.height);g.fillStyle='#21172d99';g.beginPath();g.rect(0,0,c.width,c.height);g.rect(draftCrop.x*c.width,draftCrop.y*c.height,draftCrop.width*c.width,draftCrop.height*c.height);g.fill('evenodd');g.strokeStyle='#b5a2ff';g.lineWidth=2;g.strokeRect(draftCrop.x*c.width,draftCrop.y*c.height,draftCrop.width*c.width,draftCrop.height*c.height);
}
function syncCropInputs(){for(const [id,key] of [['cropX','x'],['cropY','y'],['cropWidth','width'],['cropHeight','height']])$(id).value=+(draftCrop[key]*100).toFixed(2);$('cropError').textContent='';drawCrop();}
$('openCrop').onclick=()=>{if(!source)return;draftCrop={...crop};syncCropInputs();$('cropDialog').showModal();};
for(const [id,key] of [['cropX','x'],['cropY','y'],['cropWidth','width'],['cropHeight','height']])$(id).oninput=()=>{const next={...draftCrop,[key]:+$(id).value/100};try{cropPixels(source.width,source.height,next);draftCrop=next;$('cropError').textContent='';drawCrop();}catch{$('cropError').textContent='左侧 + 宽度、顶部 + 高度须不超过100%，宽高须大于0。';}};
function cropPoint(e){const r=$('cropCanvas').getBoundingClientRect();return {x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};}
$('cropCanvas').onpointerdown=e=>{cropStart=cropPoint(e);$('cropCanvas').setPointerCapture(e.pointerId);};
$('cropCanvas').onpointermove=e=>{if(!cropStart)return;const p=cropPoint(e);draftCrop={x:Math.min(cropStart.x,p.x),y:Math.min(cropStart.y,p.y),width:Math.abs(p.x-cropStart.x),height:Math.abs(p.y-cropStart.y)};syncCropInputs();};
for(const event of ['pointerup','pointercancel','lostpointercapture'])$('cropCanvas').addEventListener(event,()=>{cropStart=null;});
$('resetCrop').onclick=()=>{draftCrop={x:0,y:0,width:1,height:1};syncCropInputs();};
$('applyCrop').onclick=()=>{try{const next={x:+$('cropX').value/100,y:+$('cropY').value/100,width:+$('cropWidth').value/100,height:+$('cropHeight').value/100};const rect=cropPixels(source.width,source.height,next);crop=next;$('cropSummary').textContent=`裁剪后 ${rect.width} × ${rect.height} 像素，可重新裁剪恢复`;$('cropDialog').close();generate();}catch{$('cropError').textContent='裁剪范围无效，请检查四项百分比，或重新拖动框选。';}};
window.addEventListener('resize',()=>{if(!zoom)draw();});makeDemo();
