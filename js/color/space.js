// color/space.js
import { clamp } from '../utils/canvas.js';

export const hexToRgb = (hex) => {
  let h=(hex||'').trim(); if(!h.startsWith('#')) h='#'+h;
  const m=/^#([0-9a-f]{6})$/i.exec(h); if(!m) return null;
  const n=parseInt(m[1],16); return { r:(n>>16)&255, g:(n>>8)&255, b:n&255 };
};
export const rgbToHex = (r,g,b) =>
  '#' + [r,g,b].map(v=>clamp(v,0,255).toString(16).padStart(2,'0')).join('').toUpperCase();

function srgbToLinear(u){ u/=255; return (u<=0.04045)? u/12.92 : Math.pow((u+0.055)/1.055,2.4); }
function rgbToXyz(r,g,b){
  r=srgbToLinear(r); g=srgbToLinear(g); b=srgbToLinear(b);
  return [
    r*0.4124564 + g*0.3575761 + b*0.1804375,
    r*0.2126729 + g*0.7151522 + b*0.0721750,
    r*0.0193339 + g*0.1191920 + b*0.9503041
  ];
}
function xyzToLab(x,y,z){
  const Xn=0.95047,Yn=1.0,Zn=1.08883; x/=Xn; y/=Yn; z/=Zn;
  const f=t=>(t>0.008856)?Math.cbrt(t):(7.787*t+16/116);
  const fx=f(x),fy=f(y),fz=f(z); return [116*fy-16, 500*(fx-fy), 200*(fy-fz)];
}
export const rgbToLab = (r,g,b)=> {
  const [x,y,z]=rgbToXyz(r,g,b); return xyzToLab(x,y,z);
};
export const deltaE2Weighted = (l1,l2,wL,wC)=>{
  const dL=l1[0]-l2[0], da=l1[1]-l2[1], db=l1[2]-l2[2];
  return wL*dL*dL + wC*(da*da+db*db);
};
