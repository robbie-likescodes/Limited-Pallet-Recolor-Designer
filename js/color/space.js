// sRGB ↔ XYZ ↔ Lab + helpers
function srgbToLinear(u){ u/=255; return (u<=0.04045)?u/12.92:Math.pow((u+0.055)/1.055,2.4); }
function linearToSrgb(u){ return (u<=0.0031308)?(12.92*u):(1.055*Math.pow(u,1/2.4)-0.055); }
export function rgb2xyz(r,g,b){ r=srgbToLinear(r); g=srgbToLinear(g); b=srgbToLinear(b);
  return [
    r*0.4124564 + g*0.3575761 + b*0.1804375,
    r*0.2126729 + g*0.7151522 + b*0.0721750,
    r*0.0193339 + g*0.1191920 + b*0.9503041
  ];
}
export function xyz2lab(x,y,z){ const Xn=0.95047,Yn=1,Zn=1.08883; x/=Xn; y/=Yn; z/=Zn;
  const f=t=>(t>0.008856?Math.cbrt(t):(7.787*t+16/116)); const fx=f(x),fy=f(y),fz=f(z);
  return [116*fy-16, 500*(fx-fy), 200*(fy-fz)];
}
export function rgb2lab(r,g,b){ const [x,y,z]=rgb2xyz(r,g,b); return xyz2lab(x,y,z); }
export const hexToRgb = hex => { let h=(hex||'').trim(); if(!h.startsWith('#')) h='#'+h; const m=/^#([0-9a-f]{6})$/i.exec(h); if(!m) return null; const n=parseInt(m[1],16); return {r:(n>>16)&255,g:(n>>8)&255,b:n&255}; };
export const rgbToHex = (r,g,b)=>'#'+[r,g,b].map(v=>Math.max(0,Math.min(255,v))|0).map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();
export function deltaE2Weighted(l1,l2,wL=1,wC=1){ const dL=l1[0]-l2[0], da=l1[1]-l2[1], db=l1[2]-l2[2]; return wL*dL*dL + wC*(da*da+db*db); }
export function luminance(r,g,b){ // 0..100-ish in Lab L*
  return rgb2lab(r,g,b)[0];
}
export function hueSector(r,g,b){ // 0..5 sector
  const mx=Math.max(r,g,b), mn=Math.min(r,g,b); if(mx===mn) return -1;
  let h;
  if(mx===r) h=((g-b)/(mx-mn))%6;
  else if(mx===g) h=(b-r)/(mx-mn)+2;
  else h=(r-g)/(mx-mn)+4;
  if(h<0) h+=6; return Math.floor(h);
}

