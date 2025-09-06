// io/storage.js
const DB_NAME='pm_projects_db_v2', DB_STORE='projects';
const LS_KEYS = { PALETTES:'pm_saved_palettes_v2', PREFS:'pm_prefs_v2' };

export const loadSavedPalettes = () => { try { return JSON.parse(localStorage.getItem(LS_KEYS.PALETTES)||'[]'); } catch { return []; } };
export const saveSavedPalettes = (arr) => localStorage.setItem(LS_KEYS.PALETTES, JSON.stringify(arr));

export const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(LS_KEYS.PREFS)||'{}'); } catch { return {}; } };
export const savePrefs = (obj) => localStorage.setItem(LS_KEYS.PREFS, JSON.stringify(obj));

function openDB(){ return new Promise((res,rej)=>{ const r=indexedDB.open(DB_NAME,1);
  r.onupgradeneeded=()=>{ const db=r.result; if(!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE,{keyPath:'id',autoIncrement:true}); };
  r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);
});}
export async function dbPutProject(rec){ const db=await openDB(); return new Promise((res,rej)=>{ const tx=db.transaction(DB_STORE,'readwrite'); const st=tx.objectStore(DB_STORE); const r=st.put(rec); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });}
export async function dbGetAll(){ const db=await openDB(); return new Promise((res,rej)=>{ const tx=db.transaction(DB_STORE,'readonly'); const st=tx.objectStore(DB_STORE); const r=st.getAll(); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });}
export async function dbGet(id){ const db=await openDB(); return new Promise((res,rej)=>{ const tx=db.transaction(DB_STORE,'readonly'); const st=tx.objectStore(DB_STORE); const r=st.get(id); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });}
export async function dbDelete(id){ const db=await openDB(); return new Promise((res,rej)=>{ const tx=db.transaction(DB_STORE,'readwrite'); const st=tx.objectStore(DB_STORE); const r=st.delete(id); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });}
