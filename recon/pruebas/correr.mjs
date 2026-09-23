/*
 * Corre todas las pruebas, en Windows y en Linux por igual.
 *
 * Antes esto era una cadena de `&&` dentro de package.json, y traía dos
 * problemas que se muerden entre sí:
 *
 *   1. No corría en Windows. `python3` y `>/dev/null` no existen ahí, así que
 *      hacía falta reescribir el script a mano en la copia local.
 *   2. Esa copia local se quedaba vieja. Como la cadena nombraba cada archivo,
 *      toda prueba nueva quedaba fuera — y el `npm test` seguía diciendo "todo
 *      verde" sin haberlas corrido. Pasó: las pruebas del bookmarklet y de las
 *      sondas estuvieron sin correr, que son justamente las que comprueban que
 *      los scripts no escriban en la plataforma.
 *
 * Por eso acá no hay lista: se corre TODO `prueba-*.mjs` de esta carpeta. Una
 * prueba nueva entra sola por existir, que es la única forma de que no se
 * olvide.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..');

const correr = (cmd, args) =>
  spawnSync(cmd, args, { cwd: RAIZ, stdio: 'inherit', shell: false });

// --- 1. Los .xls de prueba ---
// Se prueban varios nombres en vez de exigir uno: el generador es requisito de
// todo lo demás, y cada sistema llama a python distinto.
//
// Ojo con Windows: ahí `python3` normalmente EXISTE, pero como alias del
// Microsoft Store que no es Python. Se lanza sin error, imprime "no se
// encontró Python" y sale con 9009. Por eso no alcanza con mirar si el binario
// existe, ni con el código de salida: ese 9009 en Linux se trunca a 49 (los
// códigos POSIX son de 8 bits), así que un número mágico no sirve en los dos
// sistemas.
//
// La forma portátil de saber si algo es Python es preguntárselo. `--version`
// es inofensivo y no escribe nada: un Python de verdad responde 0, el alias
// del Store no.
const generador = join('recon', 'pruebas', 'genera-xls-de-prueba.py');
const CANDIDATOS = ['python3', 'python', 'py'];

const esPython = (cmd) => {
  const r = spawnSync(cmd, ['--version'], { stdio: 'ignore', shell: false });
  return !r.error && r.status === 0;
};

const python = CANDIDATOS.find(esPython);

if (!python) {
  console.error(`\n✗ No encontré Python (probé: ${CANDIDATOS.join(', ')}).`);
  console.error('  Las pruebas necesitan generar los .xls. Instalá Python y:  pip install xlwt');
  console.error('  En Windows, "python3" suele ser solo el alias del Microsoft Store y no sirve.');
  process.exit(1);
}

const gen = correr(python, [generador]);
if (gen.status !== 0) {
  console.error(`\n✗ ${python} ${generador} falló (código ${gen.status}).`);
  console.error(`  Casi seguro falta xlwt:  ${python} -m pip install xlwt`);
  process.exit(1);
}

// --- 2. Todas las pruebas, sin lista que mantener ---
const pruebas = readdirSync(AQUI)
  .filter((f) => f.startsWith('prueba-') && f.endsWith('.mjs'))
  .sort();

if (pruebas.length === 0) {
  console.error('\n✗ No encontré ninguna prueba-*.mjs. Algo está mal en la carpeta.');
  process.exit(1);
}

for (const prueba of pruebas) {
  const r = correr(process.execPath, [join('recon', 'pruebas', prueba)]);
  if (r.status !== 0) {
    console.error(`\n✗ ${prueba} falló (código ${r.status}). Paro acá.`);
    process.exit(r.status ?? 1);
  }
}

console.log(`\n✓ ${pruebas.length} pruebas, todas en verde: ${pruebas.map((p) => p.replace(/^prueba-|\.mjs$/g, '')).join(', ')}`);
