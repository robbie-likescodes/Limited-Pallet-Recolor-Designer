// Simple IndexedDB for projects + localStorage prefs/palettes
const DB='pm_db_v2', STORE='projects';
function openDB(){ return new Promise((res,rej)=>{ const r=indexedDB.open(DB,2); r.onupgradeneeded=()=>{ const db=r.result; if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE,{keyPath:'id',autoIncrement:true}); }; r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
export async function dbPutProject(rec){ const db=await openDB(); return new Promise((res,rej)=>{ const tx=db.transaction(STORE,'readwrite'); const st=tx.objectStore(STORE); const req=st.put(rec); req.onsuccess=()=>res(req.result); req.onerror=()=>rej(req.error); }); }
export async function dbGetAll(){ const db=await openDB(); return new Promise((res,rej)=>{ const tx=db.transaction(STORE,'readonly'); const st=tx.objectStore(STORE); const req=st.getAll(); req.onsuccess=()=>res(req.result||[]); req.onerror=()=>rej(req.error); }); }
export async function dbGet(id){ const db=await openDB(); return new Promise((res,rej)=>{ const tx=db.transaction(STORE,'readonly'); const st=tx.objectStore(STORE); const req=st.get(id); req.onsuccess=()=>res(req.result||null); req.onerror=()=>rej(req.error); }); }
export async function dbDelete(id){ const db=await openDB(); return new Promise((res,rej)=>{ const tx=db.transaction(STORE,'readwrite'); const st=tx.objectStore(STORE); const req=st.delete(id); req.onsuccess=()=>res(); req.onerror=()=>rej(req.error); }); }

const LS_PREFS='pm_prefs_v2', LS_PAL='pm_saved_palettes_v2';
export function savePrefs(obj){ localStorage.setItem(LS_PREFS, JSON.stringify(obj)); }
export function loadPrefs(){ try{ return JSON.parse(localStorage.getItem(LS_PREFS)||'{}'); }catch{ return {}; } }
export function saveSavedPalettes(arr){ localStorage.setItem(LS_PAL, JSON.stringify(arr)); }
export function loadSavedPalettes(){ try{ return JSON.parse(localStorage.getItem(LS_PAL)||'[]'); }catch{ return []; } }

