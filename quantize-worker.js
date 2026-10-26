import {quantize} from './core.js';
import {processPhoto,simplifyPattern} from './photo.js';
import {extractLineArt,downsampleLineMask} from './lineart.js';
self.onmessage=({data})=>{
  try {
    if(data.lineart){
      // Line-art mode: edges are extracted at the high-res buffer, then
      // max-pooled down to grid size so thin lines survive as beads.
      // Photo settings do not apply in this mode.
      const hi=new Uint8ClampedArray(data.buffer);
      const art=extractLineArt(hi,data.hiWidth,data.hiHeight,data.lineart);
      self.postMessage({type:'progress',percent:50});
      const grid=downsampleLineMask(art.mask,data.hiWidth,data.hiHeight,data.width,data.height);
      const cells=[];
      for(let i=0;i<data.width*data.height;i++)cells.push(grid.pixels[i*4+3]>=128?0:-1);
      const pattern={width:data.width,height:data.height,palette:grid.lineCells?[{id:'C01',rgb:[35,30,40],hex:'#231E28'}]:[],cells,photoStats:{lineCells:grid.lineCells}};
      self.postMessage({type:'result',pattern,processed:grid.pixels.buffer},[grid.pixels.buffer]);
      return;
    }
    const photo=processPhoto(new Uint8ClampedArray(data.buffer),data.width,data.height,data.photo);
    self.postMessage({type:'progress',percent:15});
    const quantized=quantize(photo.pixels,data.width,data.height,data.colors,percent=>self.postMessage({type:'progress',percent:15+Math.round(percent*.8)}));
    const pattern=simplifyPattern(quantized,data.photo);pattern.photoStats={...pattern.photoStats,removedPixels:photo.removedPixels};
    self.postMessage({type:'result',pattern,processed:photo.pixels.buffer},[photo.pixels.buffer]);
  } catch(error) {self.postMessage({type:'error',message:error.message});}
};
