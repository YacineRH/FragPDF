// Rendu de miniatures en file d'attente (une page à la fois pour ne pas saturer le CPU).
import { renderPageToCanvas } from './pdfjs.js';

const queues = new WeakMap();

/** Renvoie un canvas miniature de la page `pageNumber` (1-based) avec la largeur CSS donnée. */
export function renderThumb(pdf, pageNumber, width = 160, { rotation } = {}) {
  const prev = queues.get(pdf) || Promise.resolve();
  const job = prev.then(async () => {
    const page = await pdf.getPage(pageNumber);
    const vp = page.getViewport({ scale: 1, rotation: rotation ?? page.rotate });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const c = await renderPageToCanvas(page, (width / vp.width) * dpr, { rotation });
    c.style.width = `${Math.round(c.width / dpr)}px`;
    c.style.height = `${Math.round(c.height / dpr)}px`;
    page.cleanup();
    return c;
  });
  queues.set(pdf, job.catch(() => {}));
  return job;
}

/** Observe un élément et appelle `load()` quand il devient visible (une seule fois). */
export function lazy(el, load, root = null) {
  if (!('IntersectionObserver' in window)) { load(); return; }
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { io.disconnect(); load(); }
  }, { root, rootMargin: '300px' });
  io.observe(el);
}
