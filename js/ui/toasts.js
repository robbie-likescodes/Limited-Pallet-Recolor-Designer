let host=null;
export function toast(msg, ms=1800){
  if(!host){ host=document.createElement('div'); host.id='toasts'; host.style.cssText='position:fixed;left:50%;transform:translateX(-50%);bottom:16px;display:grid;gap:8px;z-index:99999'; document.body.appendChild(host); }
  const t=document.createElement('div');
  t.textContent=msg;
  t.style.cssText='background:#0b1225cc;border:1px solid #293245;color:#e9eef7;padding:8px 10px;border-radius:10px;backdrop-filter:blur(8px)';
  host.appendChild(t);
  setTimeout(()=>{ t.style.opacity='0'; t.style.transition='opacity .2s'; setTimeout(()=>host.removeChild(t),200); },ms);
}
export function helpOnce(key, msg){
  if(localStorage.getItem('help_'+key)) return;
  toast(msg, 2600); localStorage.setItem('help_'+key,'1');
}

