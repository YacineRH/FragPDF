// Sauvegarde automatique du travail en cours dans IndexedDB (restauration après rechargement / fermeture).
// Le PDF (volumineux) n'est réécrit que lorsqu'il change ; les annotations (légères) le sont à chaque sauvegarde.
const DB = 'fragpdf';
const STORE = 'autosave';
let savedVersion = -1;
let savedBytes = null;

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
  const meta = {
    name: state.name, annots: JSON.parse(JSON.stringify(state.annots)), assets,
    formValues: [...state.formValues.entries()], savedAt: Date.now(), pages: state.pages.length,
  };
  const writePdf = savedBytes !== state.bytes;
  try {
    await tx('readwrite', (s) => { s.put(meta, 'meta'); if (writePdf) s.put(state.bytes, 'pdf'); });
    savedBytes = state.bytes;
    savedVersion = state.version;
  } catch { /* quota ou navigation privée : ignoré */ }
}

export async function loadSession() {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const t = db.transaction(STORE, 'readonly');
      const m = t.objectStore(STORE).get('meta');
      const p = t.objectStore(STORE).get('pdf');
      t.oncomplete = () => { db.close(); resolve(m.result && p.result ? { ...m.result, bytes: p.result } : null); };
      t.onerror = () => { db.close(); resolve(null); };
    });
  } catch { return null; }
}

export async function clearSession() {
  savedBytes = null; savedVersion = -1;
  try { await tx('readwrite', (s) => { s.delete('meta'); s.delete('pdf'); }); } catch { /* ignoré */ }
}

export const lastSavedVersion = () => savedVersion;
