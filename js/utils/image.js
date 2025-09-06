// utils/image.js
export const isHeicFile = (file) => {
  const name=(file?.name||'').toLowerCase();
  const type=(file?.type||'').toLowerCase();
  return name.endsWith('.heic') || name.endsWith('.heif') || type.includes('heic') || type.includes('heif');
};
export const isLikelyJpeg = (file) => {
  const t=(file?.type||'').toLowerCase(); const ext=(file?.name||'').split('.').pop()?.toLowerCase();
  return t?.includes('jpeg')||t?.includes('jpg')||ext==='jpeg'||ext==='jpg';
};
export const heicHelp = () => alert(`This photo is HEIC/HEIF and your browser can't decode it.\n\nOptions:\n• iPhone: Settings → Camera → Formats → Most Compatible\n• Re-share as JPEG/PNG\n• Or use a browser with HEIC support (Safari / newer Chromium).`);

export const objectUrlFor = (file) => URL.createObjectURL(file);
export const revokeUrl     = (url)  => { try{ URL.revokeObjectURL(url); }catch{} };

export const loadIMG = (url) => new Promise((res, rej) => {
  const img = new Image(); img.decoding='async';
  img.onload=()=>res(img); img.onerror=rej; img.src=url;
});

// Minimal JPEG EXIF orientation reader (fast header scan)
export async function readJpegOrientation(file){
  return new Promise(res=>{
    const r=new FileReader();
    r.onload=function(){
      try{
        const v=new DataView(r.result);
        if(v.getUint16(0,false)!==0xFFD8) return res(1);
        let off=2, len=v.byteLength;
        while(off<len){
          const marker=v.getUint16(off,false); off+=2;
          if(marker===0xFFE1){
            const exifLen=v.getUint16(off,false); off+=2;
            if(v.getUint32(off,false)!==0x45786966) break; // "Exif"
            off+=6;
            const tiff=off; const little=v.getUint16(tiff,false)===0x4949;
            const get16=o=>v.getUint16(o,little), get32=o=>v.getUint32(o,little);
            const firstIFD=get32(tiff+4); if(firstIFD<8) return res(1);
            const dir=tiff+firstIFD; const entries=get16(dir);
            for(let i=0;i<entries;i++){
              const e=dir+2+i*12; const tag=get16(e);
              if(tag===0x0112) return res(get16(e+8)||1);
            }
          } else if((marker & 0xFF00)!==0xFF00){ break; } else { off+=v.getUint16(off,false); }
        }
      }catch{}
      res(1);
    };
    r.onerror=()=>res(1);
    r.readAsArrayBuffer(file.slice(0,256*1024));
  });
}
