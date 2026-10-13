// Hooks Node : remplace les imports d'assets (« police.woff?url ») par leur chemin, comme le fait Vite.
export async function resolve(specifier, context, next) {
  return next(specifier.replace(/\?url$/, ''), context);
}
export async function load(url, context, next) {
  if (/\.(woff2?|png|svg|wasm)$/.test(url)) return { format: 'module', source: `export default ${JSON.stringify(url)};`, shortCircuit: true };
  return next(url, context);
}
