// Petit « bus » pour transmettre un document d'une vue à l'autre (accueil → éditeur, outil → éditeur).
let pending = null;
export function setPending(doc) { pending = doc; }
export function takePending() { const p = pending; pending = null; return p; }

export const prefs = {
  get(k, d) { try { const v = localStorage.getItem('fragpdf.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('fragpdf.' + k, JSON.stringify(v)); } catch { /* ignoré */ } },
};
