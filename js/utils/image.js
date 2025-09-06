export function isHeic(file){
  const n=(file.name||'').toLowerCase(), t=(file.type||'').toLowerCase();
  return n.endsWith('.heic')||n.endsWith('.heif')||t.includes('heic')||t.includes('heif');
}
export function isLikelyJpeg(file){
  const t=(file.type||'').toLowerCase(); const ext=(file.name||'').split('.').pop().toLowerCase();
  return t.includes('jpeg')||t.includes('jpg')||ext==='jpg'||ext==='jpeg';
}
export function blobToDataURL(blob){ return new Promise(res=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.readAsDataURL(blob); }); }
export function base64ToBlob(b64, type='image/png'){ const bin=atob(b64), u8=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i); return new Blob([u8],{type}); }

// Minimal EXIF orientation
export async function readJpegOrientation(file){
  return new Promise((resolve)=>{
    const fr=new FileReader();
    fr.onload=()=>{ try{
      const v=new DataView(fr.result); if(v.getUint16(0,false)!==0xFFD8) return resolve(1);
      let off=2; const len=v.byteLength;
      while(off<len){
        const marker=v.getUint16(off,false); off+=2;
        if(marker===0xFFE1){ const exifLen=v.getUint16(off,false); off+=2;
          if(v.getUint32(off,false)!==0x45786966) break; off+=6;
          const tiff=off; const little=(v.getUint16(tiff,false)===0x4949);
          const get16=o=>v.getUint16(o,little), get32=o=>v.getUint32(o,little);
          const firstIFD=get32(tiff+4); if(firstIFD<8) return resolve(1);
          const dir=tiff+firstIFD, entries=get16(dir);
          for(let i=0;i<entries;i++){ const e=dir+2+i*12; if(get16(e)===0x0112) return resolve(get16(e+8)||1); }
        } else if((marker & 0xFF00)!==0xFF00) break;
        else off+=v.getUint16(off,false);
      }
    }catch{} resolve(1); };
    fr.onerror=()=>resolve(1);
    fr.readAsArrayBuffer(file.slice(0,256*1024));
  });
}

