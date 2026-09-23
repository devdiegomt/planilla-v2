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
// `python3` en Linux/macOS, `python` en Windows. Se prueban los dos en vez de
// exigir uno: el generador es requisito de todo lo demás.
const generador = join('recon', 'pruebas', 'genera-xls-de-prueba.py');
let generado = false;
for (const python of ['python3', 'python']) {
  const r = correr(python, [generador]);
  if (r.error) continue;                       // ese binario no existe: probar el otro
  if (r.status !== 0) {
    console.error(`\n✗ ${python} ${generador} falló (código ${r.status}).`);
    console.error('  Hace falta python con xlwt:  pip install xlwt');
    process.exit(1);
  }
  generado = true;
  break;
}
if (!generado) {
  console.error('\n✗ No encontré python3 ni python. Las pruebas necesitan generar los .xls.');
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
