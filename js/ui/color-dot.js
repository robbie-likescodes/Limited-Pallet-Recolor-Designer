// js/ui/color-dot.js
// Lightweight, dependency-free editable color swatch with popover

// Tiny color utils
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const hexToRgb = (hx) => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hx?.trim() || '');
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
};
const rgbToHex = (r, g, b) =>
  '#' + [r, g, b].map(v => clamp(v|0,0,255).toString(16).padStart(2,'0')).join('');

function rgbToHsl(r, g, b) {
  r/=255; g/=255; b/=255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b);
  let h,s,l=(max+min)/2;
  if(max===min){ h=s=0; }
  else{
    const d=max-min;
    s=l>0.5 ? d/(2-max-min) : d/(max+min);
    switch(max){
      case r: h=(g-b)/d+(g<b?6:0); break;
      case g: h=(b-r)/d+2; break;
      case b: h=(r-g)/d+4; break;
    }
    h/=6;
  }
  return { h: Math.round(h*360), s: Math.round(s*100), l: Math.round(l*100) };
}
function hslToRgb(h, s, l){
  h/=360; s/=100; l/=100;
  const hue2rgb=(p,q,t)=>{ if(t<0) t+=1; if(t>1) t-=1;
    if(t<1/6) return p+(q-p)*6*t;
    if(t<1/2) return q;
    if(t<2/3) return p+(q-p)*(2/3-t)*6;
    return p;
  };
  let r,g,b;
  if(s===0){ r=g=b=l; }
  else{
    const q=l<0.5? l*(1+s) : l+s-l*s;
    const p=2*l-q;
    r=hue2rgb(p,q,h+1/3);
    g=hue2rgb(p,q,h);
    b=hue2rgb(p,q,h-1/3);
  }
  return { r: Math.round(r*255), g: Math.round(g*255), b: Math.round(b*255) };
}

export function createColorDot(opts={}){
  const { hex='#ffffff', size=18, ariaLabel='Edit color', onChange } = opts;
  let current = hexToRgb(hex) || { r:255,g:255,b:255 };
  let isOpen = false;

  // Host
  const host = document.createElement('span');
  host.className = 'cd-host';
  host.style.setProperty('--cd-size', size+'px');

  // Button (the dot)
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cd-dot';
  btn.style.backgroundColor = rgbToHex(current.r,current.g,current.b);
  btn.setAttribute('aria-label', ariaLabel);
  btn.setAttribute('title', ariaLabel);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle(true, btn);
  });
  host.appendChild(btn);

  // Popover
  const pop = document.createElement('div');
  pop.className = 'cd-popover';
  pop.tabIndex = -1;
  pop.hidden = true;

  pop.innerHTML = `
    <div class="cd-row">
      <label class="cd-l">HEX</label>
      <input class="cd-hex" type="text" maxlength="7" pattern="#[0-9a-fA-F]{6}">
      <input class="cd-native" type="color">
    </div>
    <div class="cd-row">
      <label class="cd-l">R</label><input class="cd-r" type="range" min="0" max="255">
      <span class="cd-val cd-rv"></span>
    </div>
    <div class="cd-row">
      <label class="cd-l">G</label><input class="cd-g" type="range" min="0" max="255">
      <span class="cd-val cd-gv"></span>
    </div>
    <div class="cd-row">
      <label class="cd-l">B</label><input class="cd-b" type="range" min="0" max="255">
      <span class="cd-val cd-bv"></span>
    </div>
    <div class="cd-row">
      <label class="cd-l">H</label><input class="cd-h" type="range" min="0" max="360">
      <span class="cd-val cd-hv"></span>
    </div>
    <div class="cd-row">
      <label class="cd-l">S</label><input class="cd-s" type="range" min="0" max="100">
      <span class="cd-val cd-sv"></span>
    </div>
    <div class="cd-row">
      <label class="cd-l">L</label><input class="cd-lt" type="range" min="0" max="100">
      <span class="cd-val cd-ltv"></span>
    </div>
    <div class="cd-actions">
      <button class="cd-close" type="button">Close</button>
    </div>
  `;
  host.appendChild(pop);

  // Wire up fields
  const q = (s)=>pop.querySelector(s);
  const iHex = q('.cd-hex');
  const iNative = q('.cd-native');
  const iR = q('.cd-r'), iG = q('.cd-g'), iB = q('.cd-b');
  const vR = q('.cd-rv'), vG = q('.cd-gv'), vB = q('.cd-bv');
  const iH = q('.cd-h'), iS = q('.cd-s'), iL = q('.cd-lt');
  const vH = q('.cd-hv'), vS = q('.cd-sv'), vL = q('.cd-ltv');

  function refreshUI(from='rgb'){
    const hex = rgbToHex(current.r,current.g,current.b);
    btn.style.backgroundColor = hex;
    iHex.value = hex;
    iNative.value = hex;

    const hsl = rgbToHsl(current.r,current.g,current.b);
    if (from !== 'hsl') {
      iH.value = hsl.h; iS.value = hsl.s; iL.value = hsl.l;
      vH.textContent = hsl.h; vS.textContent = hsl.s + '%'; vL.textContent = hsl.l + '%';
    }
    if (from !== 'rgb') {
      iR.value = current.r; iG.value = current.g; iB.value = current.b;
      vR.textContent = current.r; vG.textContent = current.g; vB.textContent = current.b;
    }
  }

  function emitChange(){
    const hex = rgbToHex(current.r,current.g,current.b);
    host.dispatchEvent(new CustomEvent('colorchange', { detail:{ hex }, bubbles:true }));
    if (typeof onChange === 'function') onChange(hex);
  }

  // Listeners
  [iR,iG,iB].forEach((el)=>{
    el.addEventListener('input', ()=>{
      current.r = clamp(+iR.value|0,0,255);
      current.g = clamp(+iG.value|0,0,255);
      current.b = clamp(+iB.value|0,0,255);
      refreshUI('rgb'); emitChange();
    });
  });
  [iH,iS,iL].forEach((el)=>{
    el.addEventListener('input', ()=>{
      const rgb = hslToRgb(+iH.value|0, +iS.value|0, +iL.value|0);
      current = rgb;
      refreshUI('hsl'); emitChange();
    });
  });
  iHex.addEventListener('change', ()=>{
    const rgb = hexToRgb(iHex.value);
    if (rgb){ current = rgb; refreshUI(); emitChange(); }
  });
  iNative.addEventListener('input', ()=>{
    const rgb = hexToRgb(iNative.value);
    if (rgb){ current = rgb; refreshUI(); emitChange(); }
  });

  q('.cd-close').addEventListener('click', ()=> toggle(false));
  document.addEventListener('click', (e)=>{
    if (!isOpen) return;
    if (!pop.contains(e.target) && e.target !== btn) toggle(false);
  });
  pop.addEventListener('keydown',(e)=>{
    if (e.key === 'Escape') toggle(false);
  });

  function toggle(open, anchorEl=btn){
    if (open === isOpen) return;
    isOpen = !!open;
    pop.hidden = !isOpen;
    if (isOpen){
      // Simple anchor positioning
      const r = anchorEl.getBoundingClientRect();
      pop.style.left = Math.round(r.left + window.scrollX) + 'px';
      pop.style.top  = Math.round(r.bottom + 6 + window.scrollY) + 'px';
      pop.focus();
    }
  }

  // Init
  refreshUI();

  // Public helpers
  host.setColor = (hexStr)=>{
    const rgb = hexToRgb(hexStr);
    if (rgb){ current = rgb; refreshUI(); }
  };
  host.getHex = ()=> rgbToHex(current.r,current.g,current.b);

  return host;
}
