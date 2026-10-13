// Extrait toutes les chaînes françaises passées à t() ou déclarées dans les registres (titres, descriptions…).
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function walk(d, out = []) { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p, out) : out.push(p); } return out; }
const files = walk('src').filter((f) => f.endsWith('.js') && !f.endsWith('i18n-en.js'));
const found = new Set();
const re = /\bt\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(re)) found.add(m[2].replace(/\\'/g, "'").replace(/\\n/g, '\n'));
}
// registres : title/desc/label/preset hors t()
const reg = readFileSync('src/tools/registry.js', 'utf8');
for (const m of reg.matchAll(/(?:title|desc|label|badge): '((?:\\.|[^'\\])*)'/g)) found.add(m[1].replace(/\\'/g, "'"));
const props = readFileSync('src/editor/props.js', 'utf8');
for (const m of props.matchAll(/^\s+\w+: '((?:\\.|[^'\\])*)',?/gm)) found.add(m[1].replace(/\\'/g, "'"));
for (const m of props.matchAll(/'((?:[A-ZÀ-Ý][^'\\]|\\.){6,}[^'\\]*)'/g)) found.add(m[1].replace(/\\'/g, "'"));
const list = [...found].filter((s) => s.length > 1 && /[a-zA-Zàéèêçù]/.test(s)).sort();
writeFileSync('/tmp/i18n-strings.json', JSON.stringify(list, null, 1));
console.log(list.length, 'chaînes');
