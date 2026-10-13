// Chiffrement / déchiffrement / réparation via QPDF compilé en WebAssembly.
import createQpdf from '@neslinesli93/qpdf-wasm';

const wasmUrl = () => new URL((import.meta.env.BASE_URL || './') + 'qpdf/qpdf.wasm', document.baseURI).href;

async function run(args, input, { allowWarnings = true } = {}) {
  const logs = [];
  const qpdf = await createQpdf({
    locateFile: wasmUrl,
    print: (t) => logs.push(t),
    printErr: (t) => logs.push(t),
    noInitialRun: true,
  });
  qpdf.FS.writeFile('/in.pdf', input);
  let code;
  try { code = qpdf.callMain(args); } catch (e) { code = typeof e?.status === 'number' ? e.status : 2; }
  let out = null;
  try { out = qpdf.FS.readFile('/out.pdf'); } catch { /* pas de sortie */ }
  if (!out || (code !== 0 && !(allowWarnings && code === 3))) {
    const msg = logs.join('\n');
    const err = new Error(/invalid password/i.test(msg) ? 'Mot de passe incorrect.' : (msg || 'QPDF a échoué.'));
    err.code = code;
    throw err;
  }
  return out;
}

/** perms: {print:'full'|'low'|'none', copy:bool, modify:bool, annotate:bool} */
export function encryptPdf(bytes, userPassword, ownerPassword, perms = {}) {
  const owner = ownerPassword || Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, '0')).join('');
  const args = [
    '--encrypt', userPassword, owner, '256',
    `--print=${perms.print ?? 'full'}`,
    `--extract=${perms.copy === false ? 'n' : 'y'}`,
    `--modify=${perms.modify === false ? 'none' : 'all'}`,
    `--annotate=${perms.annotate === false ? 'n' : 'y'}`,
    '--', '/in.pdf', '/out.pdf',
  ];
  return run(args, bytes);
}

export function decryptPdf(bytes, password) {
  return run([`--password=${password || ''}`, '--decrypt', '/in.pdf', '/out.pdf'], bytes);
}

export function repairPdf(bytes) {
  return run(['/in.pdf', '/out.pdf'], bytes);
}

export function linearizePdf(bytes) {
  return run(['--linearize', '/in.pdf', '/out.pdf'], bytes);
}
