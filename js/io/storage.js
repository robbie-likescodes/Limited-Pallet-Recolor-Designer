// js/io/storage.js
// Persistence helpers for Palette Mapper
// - LocalStorage: saved palettes + user prefs
// - IndexedDB: projects (image + settings + metadata)
// - Utilities: blobToBase64 / base64ToBlob

// ----------------------------
// LocalStorage (palettes/prefs)
// ----------------------------
const PALETTES_KEY = 'pm_saved_palettes_v1';
const PREFS_KEY    = 'pm_prefs_v1';

function lsGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[storage] localStorage read failed:', e);
    return fallback;
  }
}
function lsSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn('[storage] localStorage write failed:', e);
    return false;
  }
}

export function loadSavedPalettes() {
  return lsGet(PALETTES_KEY, []);
}
export function saveSavedPalettes(palettes) {
  return lsSet(PALETTES_KEY, Array.isArray(palettes) ? palettes : []);
}

export function loadPrefs() {
  // Keep this structure loose; callers can read missing keys as defaults
  return lsGet(PREFS_KEY, {});
}
export function savePrefs(prefs) {
  return lsSet(PREFS_KEY, prefs && typeof prefs === 'object' ? prefs : {});
}

// ----------------------------
// IndexedDB (projects)
// ----------------------------
const DB_NAME    = 'pm_projects_db_v2';
const DB_VERSION = 1;
const STORE      = 'projects';

function idbSupported() {
  try { return !!(window && window.indexedDB); }
  catch { return false; }
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!idbSupported()) {
      reject(new Error('IndexedDB not supported in this browser'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        // simple indexes for listing/sorting
        try { os.createIndex('updatedAt', 'updatedAt'); } catch {}
        try { os.createIndex('name', 'name'); } catch {}
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error || new Error('indexedDB open error'));
  });
}

function tx(db, mode = 'readonly') {
  return db.transaction(STORE, mode);
}

/**
 * Put (create/update) a project record.
 * @param {Object} rec { id?, name, createdAt, updatedAt, settings, imageBlob }
 * @returns {Promise<number>} id
 */
export async function dbPutProject(rec) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    try {
      const t = tx(db, 'readwrite');
      const store = t.objectStore(STORE);

      // Ensure timestamps
      const now = Date.now();
      const toSave = {
        id: rec && rec.id ? rec.id : undefined,
        name: (rec && rec.name) || 'Untitled',
        createdAt: (rec && rec.createdAt) || now,
        updatedAt: now,
        settings: (rec && rec.settings) || {},
        imageBlob: (rec && rec.imageBlob) || null
      };

      const req = toSave.id !== undefined ? store.put(toSave) : store.add(toSave);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error || new Error('dbPutProject error'));
    } catch (e) { reject(e); }
  });
}

/** Get a single project by id */
export async function dbGet(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    try {
      const t = tx(db, 'readonly');
      const store = t.objectStore(STORE);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror   = () => reject(req.error || new Error('dbGet error'));
    } catch (e) { reject(e); }
  });
}

/** Get all projects (unsorted). Callers can sort by updatedAt/name if desired. */
export async function dbGetAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    try {
      const t = tx(db, 'readonly');
      const store = t.objectStore(STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = () => reject(req.error || new Error('dbGetAll error'));
    } catch (e) { reject(e); }
  });
}

/** Delete a project by id */
export async function dbDelete(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    try {
      const t = tx(db, 'readwrite');
      const store = t.objectStore(STORE);
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror   = () => reject(req.error || new Error('dbDelete error'));
    } catch (e) { reject(e); }
  });
}

// ----------------------------
// Binary helpers
// ----------------------------
/** Convert a Blob to a Base64 data URL string */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader();
      reader.onload  = () => resolve(String(reader.result || ''));
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(blob);
    } catch (err) { reject(err); }
  });
}

/**
 * Convert a Base64 data URL (or raw base64) into a Blob.
 * If the input has a data-URL header, its MIME is honored.
 * Otherwise fallbackType is used (default image/png).
 */
export function base64ToBlob(base64, fallbackType = 'image/png') {
  const raw = String(base64 || '');
  const parts = raw.split(',');
  const hasHeader = parts.length > 1 && /^data:/i.test(parts[0]);
  const mime = hasHeader
    ? ((parts[0].match(/^data:([^;]+)/i) || [,''])[1] || fallbackType)
    : fallbackType;
  const b64  = hasHeader ? parts[1] : parts[0];

  // strip whitespace (some sources add newlines/spaces)
  const clean = b64.replace(/\s+/g, '');
  const byteString = atob(clean);

  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mime || fallbackType });
}
