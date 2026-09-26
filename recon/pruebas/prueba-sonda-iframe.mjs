/*
 * Pruebas de la sonda que mide si la plataforma se deja manejar desde un iframe.
 *
 * Esta sonda es más estricta que la de postback: aquella manda un POST porque
 * es lo que viene a medir; esta NO dispara ningún control, ni siquiera de
 * lectura. Lo único que hace en la red es pedir la misma dirección que ya
 * estás viendo, dos veces: una para leer las cabeceras y otra dentro del
 * iframe. Así que el listón es:
 *
 *   1. No hace nada al cargar. Hace falta pulsar el botón.
 *   2. No llama a `__doPostBack` en ningún caso.
 *   3. No deja el iframe puesto: lo quita pase lo que pase.
 *   4. Las listas de control están, y sirven, por si alguien le agrega un paso.
 *   5. Lee las cabeceras en vez de deducir el bloqueo de que el iframe se vea
 *      vacío, que es lo que llevaría a descartar el camino por el motivo
 *      equivocado.
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let fallos = 0;
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✗ FALLA ') + m); if (!c) fallos++; };

const FUENTE = readFileSync(new URL('../sonda-iframe.js', import.meta.url), 'utf8');

console.log('Sonda de iframe');

console.log('\n[no escribe en la plataforma]');
{
  // La comprobación más importante y la más simple: esta sonda no dispara
  // postbacks, así que la llamada no puede aparecer en ninguna parte.
  const llamadas = FUENTE.match(/__doPostBack\s*\(/g) || [];
  ok(llamadas.length === 0, 'no llama a __doPostBack en ninguna parte');

  const envios = FUENTE.match(/\.submit\s*\(\)/g) || [];
  ok(envios.length === 0, 'no envía ningún formulario');

  // Solo puede pedir la dirección que ya estás viendo. Un `fetch` a otra cosa
  // sería un camino nuevo, y los caminos nuevos se deciden aparte.
  const fetches = [...FUENTE.matchAll(/fetch\s*\(([^,)]*)/g)].map((m) => m[1].trim());
  ok(fetches.length === 1, `hay un solo fetch (hay ${fetches.length})`);
  ok(fetches.every((f) => f === 'location.href'),
     `ese fetch pide location.href y nada más (pide ${JSON.stringify(fetches)})`);

  const srcs = [...FUENTE.matchAll(/ifr\.src\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
  ok(srcs.length === 1 && srcs[0] === 'location.href',
     'el iframe apunta a location.href y nada más');
}

console.log('\n[las listas de control existen y sirven]');
{
  ok(/PROHIBIDO\s*=\s*\//.test(FUENTE), 'hay lista negra');
  ok(/PERMITIDO\s*=\s*\//.test(FUENTE), 'hay lista blanca');
  const negra = FUENTE.match(/PROHIBIDO\s*=\s*\/([^/]+)\//)[1];
  for (const p of ['guardar', 'importar', 'actualizar', 'editar', 'eliminar']) {
    ok(new RegExp(p, 'i').test(negra), `la lista negra cubre "${p}"`);
  }
}

console.log('\n[la sonda, corriendo]');
{
  const dom = new JSDOM(
    '<!doctype html><html><head><title>Asistencia</title></head><body>'
    + '<form><input id="__VIEWSTATE" value="xxxx"><select name="lstCurso"><option>1</option></select>'
    + '<select name="btnGuardar"><option>1</option></select></form>'
    + '</body></html>',
    { url: 'https://ejemplo.gla.edu.co/Asistencia.aspx', runScripts: 'outside-only' },
  );
  const { window } = dom;
  let peticiones = 0;
  window.fetch = () => { peticiones++; return Promise.resolve({
    status: 200, headers: { get: () => null },
  }); };

  window.eval(FUENTE);

  const panel = window.document.getElementById('sonda-iframe');
  ok(!!panel, 'pinta su panel');
  ok(peticiones === 0, `no pide nada al cargar (pidió ${peticiones})`);
  ok(window.document.querySelectorAll('iframe').length === 0,
     'no crea ningún iframe hasta que se pulsa Medir');

  // Las listas, ejercitadas de verdad y no solo comprobadas de existencia:
  // que estén en el archivo no dice que alguien las use.
  const m = window.module && window.module.exports;
  const mod = m || (() => {
    // La sonda solo exporta si hay `module`; se lo damos y la corremos otra vez.
    window.module = { exports: {} };
    window.eval(FUENTE);
    return window.module.exports;
  })();
  ok(typeof mod.sePuedeDisparar === 'function', 'expone sePuedeDisparar para poder probarla');
  ok(mod.sePuedeDisparar('ctl00$lstCurso') === true, 'un filtro sí se podría disparar');
  ok(mod.sePuedeDisparar('ctl00$btnGuardar') === false, 'Guardar NO');
  ok(mod.sePuedeDisparar('ctl00$btnImportar') === false, 'Importar NO');
  ok(mod.sePuedeDisparar('ctl00$btnLoQueSea') === false,
     'un control desconocido tampoco: la lista blanca manda');
}

console.log('\n[el iframe no se queda puesto]');
{
  // `finally` es lo que garantiza que se quite aunque la medición reviente.
  const cuerpo = FUENTE.slice(FUENTE.indexOf('async function medir'));
  ok(/finally\s*\{[^}]*ifr\.remove\(\)/s.test(cuerpo),
     'el iframe se quita en un finally, así falle la medición');
}

console.log(fallos === 0 ? '\nTodo bien.' : `\n${fallos} fallo(s).`);
process.exit(fallos ? 1 : 0);
