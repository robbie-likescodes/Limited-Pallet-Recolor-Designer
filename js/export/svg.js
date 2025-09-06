// Vectorization pipeline using ImageTracer (lazy loaded)
// Expects a mapped canvas (full-res) or ImageData
export async function exportSVGFromImageData(imgData, filename='mapped_vector.svg'){
  // Ensure ImageTracer is available
  if(!window.ImageTracer){
    await new Promise((res,rej)=>{
      const s=document.createElement('script'); s.src='./lib/imagetracer_v1.2.6.js';
      s.onload=()=>res(); s.onerror=()=>rej(new Error('ImageTracer load failed')); document.head.appendChild(s);
    });
  }
  const cn=document.createElement('canvas'); cn.width=imgData.width; cn.height=imgData.height;
  const ctx=cn.getContext('2d'); ctx.putImageData(imgData,0,0);

  const opts={
    // tuned for posterized palette
    ltres:1, qtres:1, pathomit:0, rightangleenhance:true, linefilter:true,
    numberofcolors: 0, // use true colors
    desc:'Palette Mapper'
  };
  const svgstr = ImageTracer.imagedataToSVG(ctx.getImageData(0,0,cn.width,cn.height), opts);
  const blob=new Blob([svgstr],{type:'image/svg+xml'});
  const a=document.createElement('a'); a.download=filename; a.href=URL.createObjectURL(blob); a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1500);
}

