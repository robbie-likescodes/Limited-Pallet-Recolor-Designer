// ui/toasts.js
export function toast(msg, ms=2200){
  let host = document.querySelector("#toasts");
  if (!host) {
    host = document.createElement("div");
    host.id = "toasts";
    host.style.cssText = "position:fixed;left:50%;bottom:20px;transform:translateX(-50%);display:grid;gap:8px;z-index:99999";
    document.body.appendChild(host);
  }
  const t = document.createElement("div");
  t.textContent = msg;
  t.style.cssText = "background:#111826cc;border:1px solid #2a3243;color:#e8ecf3;padding:10px 12px;border-radius:10px;backdrop-filter:blur(8px);max-width:min(92vw,560px)";
  host.appendChild(t);
  setTimeout(()=>{ t.style.opacity="0"; t.style.transition="opacity .25s"; setTimeout(()=>host.removeChild(t),250); }, ms);
}
