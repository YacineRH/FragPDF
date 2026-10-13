// Sauvegarde automatique du travail en cours dans IndexedDB (restauration après rechargement / fermeture).
const DB = 'fragpdf';
const STORE = 'autosave';
const KEY = 'current';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(r?.result); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}

export async function saveSession(state) {
  if (!state.bytes) return;
  const assets = [...state.assets.values()].map(({ id, bytes, mime, w, h }) => ({ id, bytes, mime, w, h }));
  const data = {
    name: state.name, bytes: state.bytes, annots: JSON.parse(JSON.stringify(state.annots)), assets,
    formValues: [...state.formValues.entries()], savedAt: Date.now(), pages: state.pages.length,
  };
  try { await tx('readwrite', (s) => s.put(data, KEY)); } catch { /* quota ou mode privé : ignoré */ }
}

export async function loadSession() {
  try { return (await tx('readonly', (s) => s.get(KEY))) || null; } catch { return null; }
}

export async function clearSession() {
  try { await tx('readwrite', (s) => s.delete(KEY)); } catch { /* ignoré */ }
}
