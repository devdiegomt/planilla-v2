/*
 * Pruebas del bookmarklet de la sonda de CSP.
 *
 * Lo que importa verificar de un bookmarklet es aburrido pero es justo lo que
 * lo rompe en silencio: que lo codificado sea la sonda exacta, que siga siendo
 * JavaScript válido después de decodificarlo, que no lleve caracteres que
 * partan el atributo href, y que termine en `void 0` — sin eso el navegador ve
 * que el script devuelve algo y abandona la página para mostrarlo.
 *
 * También detecta la desincronización: el HTML está generado, así que si se
 * toca sonda-csp.js y no se vuelve a correr `node recon/hacer-bookmarklet.mjs`,
 * el favorito queda con la versión vieja y nadie se entera.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

let fallos = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✔ ' : '  ✗ FALLA ') + msg); if (!cond) fallos++; };

const url = (p) => new URL(p, import.meta.url);
const fuente = readFileSync(url('../sonda-csp.js'), 'utf8');
const html = readFileSync(url('../sonda-csp-bookmarklet.html'), 'utf8');

console.log('Bookmarklet de la sonda de CSP');

const m = html.match(/href="javascript:([^"]*)"/);
ok(!!m, 'el HTML trae un enlace javascript:');

const codificado = m ? m[1] : '';
const decodificado = decodeURIComponent(codificado.replace(/&quot;/g, '"'));

ok(decodificado === fuente + '\nvoid 0;',
   'lo codificado es sonda-csp.js exacta (si falla: corre node recon/hacer-bookmarklet.mjs)');

ok(decodificado.trimEnd().endsWith('void 0;'),
   'termina en void 0, para que el navegador no abandone la página');

ok(![...codificado].some(c => c === '"' || c === '<' || c === '>' || c === '\n'),
   'no lleva caracteres que partan el atributo href');

// Que siga siendo JavaScript válido después del viaje de ida y vuelta.
let parsea = true;
try {
  execFileSync(process.execPath, ['--check', '-'], { input: decodificado, stdio: 'pipe' });
} catch { parsea = false; }
ok(parsea, 'el código decodificado sigue siendo JavaScript válido');

// Un favorito con 11 KB entra de sobra; uno con 2 MB no.
ok(codificado.length < 200_000,
   `cabe en un favorito (${(codificado.length / 1024).toFixed(1)} KB)`);

// Y que la sonda siga siendo de solo lectura: ningún escritor a la plataforma.
//
// Se busca sintaxis de LLAMADA y no la simple mención: la cabecera de la sonda
// documenta que no llama a __doPostBack, y una búsqueda por substring marcaría
// ese propio comentario.
for (const prohibido of ['__doPostBack(', 'btnImportar', '.submit(', '.click(']) {
  ok(!fuente.includes(prohibido), `la sonda no usa ${prohibido}`);
}

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLARON`);
process.exit(fallos ? 1 : 0);
