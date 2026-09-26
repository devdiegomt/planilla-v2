/*
 * Pruebas del marco: el favorito que reinyecta el script en cada carga.
 *
 * Lo que tiene que quedar comprobado, porque es lo que lo vuelve seguro:
 *
 *   1. No toca ningún control de la plataforma. Ni `__doPostBack`, ni enviar
 *      un formulario, ni pulsar nada. Solo crea el iframe e inyecta.
 *   2. No enmarca otra cosa que la dirección que ya está abierta.
 *   3. Reinyecta en CADA carga de adentro — una sola vez no sirve de nada, que
 *      es justo el fallo que tiene el favorito suelto.
 *   4. Pone la marca ANTES de inyectar: si el script corre sin ella, cree que
 *      nadie lo va a reinyectar y se niega al recorrido.
 *   5. Si el marco es de otro origen, se detiene y lo dice en vez de fallar
 *      más adelante por un motivo que no se entiende.
 *   6. El script que inyecta es el del repositorio, byte a byte.
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let fallos = 0;
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✗ FALLA ') + m); if (!c) fallos++; };

const MARCO = readFileSync(new URL('../marco.js', import.meta.url), 'utf8');
const SCRIPT = readFileSync(new URL('../../asistencia-autofill.user.js', import.meta.url), 'utf8');

console.log('Marco (favorito que reinyecta)');

console.log('\n[no toca la plataforma]');
{
  ok(!/__doPostBack\s*\(/.test(MARCO), 'no llama a __doPostBack');
  ok(!/\.submit\s*\(\)/.test(MARCO), 'no envía formularios');
  ok(!/\.click\s*\(\)/.test(MARCO), 'no pulsa nada');
  const fetches = MARCO.match(/\bfetch\s*\(/g) || [];
  ok(fetches.length === 0, `no hace peticiones por su cuenta (hay ${fetches.length})`);
  const srcs = [...MARCO.matchAll(/ifr\.src\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
  ok(srcs.length === 1 && srcs[0] === 'location.href',
     'el marco apunta a location.href y nada más');
}

console.log('\n[corriendo, con la plataforma simulada]');
{
  /*
   * jsdom no navega dentro de un iframe, así que la recarga se simula: se
   * reemplaza el documento de adentro y se dispara `load`, que es exactamente
   * lo que hace el navegador tras un postback.
   */
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://ejemplo.gla.edu.co/Seguro/AsistenciaAsignaturaAusenciaDia.aspx',
    runScripts: 'outside-only',
  });
  const { window } = dom;

  const inyecciones = [];
  let ventanaDeAdentro = null;

  // Un iframe de mentira, porque jsdom no carga nada por la red.
  const realCreate = window.document.createElement.bind(window.document);
  window.document.createElement = (tag) => {
    const e = realCreate(tag);
    if (tag === 'iframe') {
      const docAdentro = new JSDOM('<!doctype html><html><head></head><body></body></html>').window.document;
      ventanaDeAdentro = {};
      Object.defineProperty(e, 'contentDocument', { get: () => docAdentro });
      Object.defineProperty(e, 'contentWindow', { get: () => ventanaDeAdentro });
      // Cada `appendChild` de un <script> en ese documento es una inyección.
      const realHeadAppend = docAdentro.head.appendChild.bind(docAdentro.head);
      docAdentro.head.appendChild = (n) => {
        if (n.tagName === 'SCRIPT') {
          inyecciones.push({ texto: n.textContent, marca: ventanaDeAdentro.__glaMarco });
        }
        return realHeadAppend(n);
      };
    }
    return e;
  };

  window.eval(`var FUENTE = ${JSON.stringify(SCRIPT)};\n${MARCO}`);

  const caja = window.document.getElementById('gla-marco');
  ok(!!caja, 'pinta el marco');
  const ifr = caja.querySelector('iframe');
  ok(!!ifr, 'con un iframe adentro');
  // Se mira la propiedad y no el texto del atributo: el navegador (y jsdom)
  // normalizan `cssText`, así que buscar 'flex:1' fallaba por el espacio.
  ok(ifr.style.flexGrow === '1' && ifr.style.width === '100%',
     `el iframe ocupa el espacio disponible (flex-grow ${ifr.style.flexGrow}, ancho ${ifr.style.width})`);
  ok(inyecciones.length === 0, 'no inyecta nada hasta que el iframe carga');

  // Primera carga
  ifr.dispatchEvent(new window.Event('load'));
  ok(inyecciones.length === 1, `inyecta en la primera carga (${inyecciones.length})`);

  // Y en cada recarga siguiente: es lo que el favorito suelto NO hace.
  ifr.dispatchEvent(new window.Event('load'));
  ifr.dispatchEvent(new window.Event('load'));
  ok(inyecciones.length === 3,
     `reinyecta en CADA carga de adentro (${inyecciones.length} de 3)`);

  ok(inyecciones.every((i) => i.marca === true),
     'la marca ya está puesta cuando el script entra');
  ok(inyecciones.every((i) => i.texto === SCRIPT),
     'lo inyectado es el script del repositorio, byte a byte');

  // Pulsarlo otra vez lo cierra, en vez de apilar marcos.
  window.eval(`var FUENTE = ${JSON.stringify(SCRIPT)};\n${MARCO}`);
  ok(!window.document.getElementById('gla-marco'), 'pulsarlo de nuevo lo cierra');
}

console.log('\n[marco de otro origen: se detiene y lo dice]');
{
  const dom = new JSDOM('<!doctype html><html><body></body></html>',
    { url: 'https://ejemplo.gla.edu.co/x.aspx', runScripts: 'outside-only' });
  const { window } = dom;
  /*
   * La señal de que el marco se detuvo no es "no inyectó" a secas: con el
   * documento inaccesible no hay dónde inyectar aunque quisiera, así que esa
   * aserción se cumple sola y no prueba nada — me pasó, y la mutación que
   * quitaba la guarda salió verde. La señal real es la MARCA: se pone justo
   * después de acceder al documento, así que si el marco respeta el bloqueo
   * nunca llega a ponerla.
   */
  const ventana = {};
  const realCreate = window.document.createElement.bind(window.document);
  window.document.createElement = (tag) => {
    const e = realCreate(tag);
    if (tag === 'iframe') {
      // Lo que hace el navegador con un iframe de otro origen.
      Object.defineProperty(e, 'contentDocument', {
        get() { throw new Error('Blocked a frame with origin … from accessing a cross-origin frame.'); },
      });
      Object.defineProperty(e, 'contentWindow', { get: () => ventana });
    }
    return e;
  };
  window.eval(`var FUENTE = ${JSON.stringify(SCRIPT)};\n${MARCO}`);
  const ifr = window.document.querySelector('#gla-marco iframe');
  ifr.dispatchEvent(new window.Event('load'));
  ok(ventana.__glaMarco === undefined,
     `ni siquiera llega a poner la marca (quedó ${String(ventana.__glaMarco)})`);
  const barra = window.document.querySelector('#gla-marco div');
  ok(/otro origen/i.test(barra.textContent), 'y lo dice en la barra, en vez de callarse');
}

console.log('\n[el script se anima al recorrido solo con la marca]');
{
  const linea = SCRIPT.match(/const SE_REINYECTA = .*/)[0];
  ok(/__glaMarco/.test(linea), 'el script mira la marca del marco');
  ok(/GM_info/.test(linea) || /ES_USERSCRIPT/.test(linea),
     'y sigue aceptando Tampermonkey, para no romper el camino de antes');
  ok(!/window\.self\s*!==\s*window\.top/.test(SCRIPT),
     'el script no se niega a correr dentro de un iframe');
}

console.log(fallos === 0 ? '\nTodo bien.' : `\n${fallos} fallo(s).`);
process.exit(fallos ? 1 : 0);
