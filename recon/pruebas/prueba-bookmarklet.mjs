/*
 * Pruebas de los bookmarklets generados.
 *
 * Lo que importa verificar de un bookmarklet es aburrido pero es justo lo que
 * lo rompe en silencio: que lo codificado sea el script exacto, que siga siendo
 * JavaScript válido después de decodificarlo, que no lleve caracteres que
 * partan el atributo href, y que termine en `void 0` — sin eso el navegador ve
 * que el script devuelve algo y abandona la página para mostrarlo.
 *
 * También detecta la desincronización: los HTML están generados, así que si se
 * toca un script y no se vuelve a correr `node recon/hacer-bookmarklet.mjs`, el
 * favorito queda con la versión vieja y nadie se entera.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { BOOKMARKLETS, leerNormalizado } from '../hacer-bookmarklet.mjs';

let fallos = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✔ ' : '  ✗ FALLA ') + msg); if (!cond) fallos++; };

console.log('Bookmarklets');

for (const b of BOOKMARKLETS) {
  console.log(`\n[${b.id}]`);
  // Normalizado igual que al generar: si no, en Windows esta prueba falla
  // sola por los CRLF del checkout, sin que nadie haya tocado el script.
  const fuente = leerNormalizado(b.fuente);
  const html = readFileSync(b.salida, 'utf8');

  const m = html.match(/href="javascript:([^"]*)"/);
  ok(!!m, 'el HTML trae un enlace javascript:');
  if (!m) continue;

  const codificado = m[1];
  const decodificado = decodeURIComponent(codificado.replace(/&quot;/g, '"'));

  if (b.marco) {
    /*
     * En modo marco lo codificado no es el script: es el envoltorio que crea
     * el iframe y lo reinyecta en cada carga. Lo que hay que comprobar es más
     * fuerte que "son iguales" — que el script viaja DENTRO, entero y sin
     * tocar. Si alguien lo modificara al envolverlo habría dos versiones del
     * mismo script y ninguna señal de cuál corre.
     */
    const marco = leerNormalizado(new URL('../marco.js', import.meta.url).pathname);
    const esperado = `var FUENTE = ${JSON.stringify(fuente)};\n${marco}\nvoid 0;`;
    ok(decodificado === esperado,
       'lo codificado es el marco con el script dentro (si falla: node recon/hacer-bookmarklet.mjs)');
    const dentro = decodificado.match(/^var FUENTE = ("(?:[^"\\]|\\.)*");/);
    ok(!!dentro && JSON.parse(dentro[1]) === fuente,
       'y el script que viaja dentro es el del repositorio, byte a byte');
  } else {
    ok(decodificado === fuente + '\nvoid 0;',
       'lo codificado es el script exacto (si falla: node recon/hacer-bookmarklet.mjs)');
  }

  ok(decodificado.trimEnd().endsWith('void 0;'),
     'termina en void 0, para que el navegador no abandone la página');

  ok(![...codificado].some(c => c === '"' || c === '<' || c === '>' || c === '\n'),
     'no lleva caracteres que partan el atributo href');

  let parsea = true;
  try {
    execFileSync(process.execPath, ['--check', '-'], { input: decodificado, stdio: 'pipe' });
  } catch { parsea = false; }
  ok(parsea, 'el código decodificado sigue siendo JavaScript válido');

  // Un favorito con 80 KB entra de sobra; uno con 2 MB no.
  ok(codificado.length < 200_000,
     `cabe en un favorito (${(codificado.length / 1024).toFixed(1)} KB)`);
}

// --- La sonda, además, solo lee ---
{
  console.log('\n[seguridad de la sonda]');
  const sonda = readFileSync(BOOKMARKLETS.find(b => b.id === 'sonda-csp').fuente, 'utf8');
  // Sintaxis de LLAMADA y no la simple mención: la cabecera de la sonda
  // documenta que NO llama a __doPostBack, y buscar por substring marcaría ese
  // propio comentario.
  for (const prohibido of ['__doPostBack(', 'btnImportar', '.submit(', '.click(']) {
    ok(!sonda.includes(prohibido), `la sonda no usa ${prohibido}`);
  }
}

// --- El autofill sigue sin depender de Tampermonkey ---
{
  console.log('\n[el autofill sirve como favorito]');
  const auto = readFileSync(
    BOOKMARKLETS.find(b => b.id === 'asistencia-autofill').fuente, 'utf8');

  ok(/@grant\s+none/.test(auto),
     '@grant none: sin APIs de Tampermonkey, así que corre igual como favorito');

  // GM_info solo puede aparecer como detección, nunca como algo de lo que se
  // dependa: un favorito no lo tiene.
  const usosGM = [...auto.matchAll(/GM[_.]\w+/g)].map(x => x[0]);
  ok(usosGM.every(u => u === 'GM_info'),
     `lo único de Tampermonkey que se toca es GM_info (visto: ${[...new Set(usosGM)].join(', ') || 'nada'})`);

  ok(auto.includes('Solo marcar'),
     'el aviso sin userscript manda a "Solo marcar", que es el camino que sí funciona');
  ok(!/instalalo\b/.test(auto),
     'y ya no dice "instalalo", que para quien usa el favorito a propósito es el consejo equivocado');
}

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLARON`);
process.exit(fallos ? 1 : 0);
