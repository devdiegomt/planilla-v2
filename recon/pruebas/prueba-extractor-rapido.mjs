/*
 * Prueba el userscript COMPLETO en un DOM, sobre la pantalla de planillas por
 * profesor. Las otras pruebas del extractor solo evalúan el bloque de
 * extracción recortado; por eso un `lim is not defined` en la capa de panel
 * llegó a producción sin que nada lo detectara.
 *
 * Requiere: npm install jsdom  y  python3 genera-xls-de-prueba.py
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const FUENTE = readFileSync(new URL('../../codalum-extractor.user.js', import.meta.url), 'utf8');
const XLS = readFileSync(new URL('caso8_multihoja.xls', import.meta.url));

let fallos = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✔ ' : '  ✗ FALLA ') + msg); if (!cond) fallos++; };
const tick = () => new Promise((r) => setImmediate(r));

const BASE = 'https://webapps3-classroomliveweb.com:2443/arrayanes/2026/Seguro/';

// El selector real trae 187 docentes; "-1" es < TODOS >.
const DOCENTES = [
  ['-1', '< TODOS >'],
  ['451', '451 - DIEGO ALEJANDRO MAYORGA TORRES'],
  ['3', '3 - ADRIANA JARAMILLO SOTO'],
];

function nuevaPagina({ profesorSeleccionado = '451', pagina = 'ReporteCalificaMatrizProfesor.aspx' } = {}) {
  const opciones = DOCENTES
    .map(([v, t]) => `<option value="${v}"${v === profesorSeleccionado ? ' selected' : ''}>${t}</option>`).join('');

  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <form id="aspnetForm" action="./${pagina}" method="post">
      <input type="hidden" name="__EVENTTARGET" id="__EVENTTARGET" value="">
      <input type="hidden" name="__EVENTARGUMENT" id="__EVENTARGUMENT" value="">
      <input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="ZmFrZQ==">
      <input type="hidden" name="ctl00$ContentPlaceHolder1$hfProfesor"
             id="ctl00_ContentPlaceHolder1_hfProfesor" value="451">
      <select id="ctl00_ContentPlaceHolder1_lstProfesor"
              name="ctl00$ContentPlaceHolder1$lstProfesor">${opciones}</select>
      <select id="ctl00_ContentPlaceHolder1_lstPeriodo" name="ctl00$ContentPlaceHolder1$lstPeriodo">
        <option value="02" selected>SEGUNDO</option></select>
      <input type="submit" id="ctl00_ContentPlaceHolder1_btnExportar"
             name="ctl00$ContentPlaceHolder1$btnExportar" value="Exportar">
      <input type="submit" id="ctl00_ContentPlaceHolder1_btnImportar"
             name="ctl00$ContentPlaceHolder1$btnImportar" value="Importar">
    </form></body></html>`, { runScripts: 'outside-only', url: BASE + pagina });

  const w = dom.window;
  const peticiones = [];
  let jsonDescargado = null;

  w.setTimeout = (fn) => { Promise.resolve().then(fn); return 0; };
  w.URL.createObjectURL = () => 'blob:prueba';
  w.URL.revokeObjectURL = () => {};
  const BlobReal = w.Blob;
  w.Blob = function (partes, opts) { jsonDescargado = String(partes[0]); return new BlobReal(partes, opts); };
  w.HTMLAnchorElement.prototype.click = function () {};

  // El servidor devuelve el .xls agregado, con sus 4 hojas.
  w.fetch = async (url, opciones) => {
    peticiones.push({ url, cuerpo: String(opciones.body) });
    const ab = XLS.buffer.slice(XLS.byteOffset, XLS.byteOffset + XLS.byteLength);
    return {
      ok: true, status: 200,
      headers: { get: (h) => (/disposition/i.test(h) ? 'attachment; filename=Califica-451-02.xls' : null) },
      arrayBuffer: async () => ab,
    };
  };

  let errorDeArranque = null;
  try { w.eval(FUENTE); } catch (e) { errorDeArranque = e; }

  return {
    w, peticiones, errorDeArranque,
    json: () => JSON.parse(jsonDescargado),
    q: (s) => w.document.querySelector(s),
    log: () => [...w.document.querySelectorAll('#gla-log div')].map((d) => d.textContent).join('\n'),
    async pulsarIniciar() {
      await this.q('#gla-iniciar').onclick();
      await tick();
    },
  };
}

// ====================================================================== 1
console.log('\n[arranque en la pantalla por profesor]');
{
  const p = nuevaPagina();
  ok(!p.errorDeArranque, 'el script arranca sin lanzar: ' + (p.errorDeArranque?.message || 'ok'));
  ok(!!p.q('#gla-panel'), 'pinta el panel');
  ok(/1 petición/.test(p.q('#gla-iniciar').textContent),
    'el botón ofrece el modo rápido: "' + p.q('#gla-iniciar').textContent + '"');
  ok(/DIEGO/.test(p.q('#gla-estado').textContent), 'y dice de quién son las planillas');
  ok(p.peticiones.length === 0, 'no pide nada solo');
}

// ====================================================================== 2
console.log('\n[una sola petición, y las 19 hojas]');
{
  const p = nuevaPagina();
  await p.pulsarIniciar();

  ok(p.peticiones.length === 1, `una sola petición (fueron ${p.peticiones.length})`);
  const cuerpo = p.peticiones[0].cuerpo;
  ok(/btnExportar/.test(cuerpo), 'el cuerpo lleva btnExportar');
  ok(!/btnImportar/.test(cuerpo), 'y NO lleva btnImportar');
  ok(/__VIEWSTATE/.test(cuerpo), 'reenvía el VIEWSTATE que dio el servidor');

  const d = p.json();
  ok(d.cursos.length === 3, 'extrae los 3 cursos con datos del archivo');
  ok(d.cursos.map((c) => c.cod_cur).join() === '801,802,1101', 'cada hoja es un curso');
  ok(d.cursos[0].estudiantes.length === 28, 'con sus estudiantes');
  ok(d.errores.some((e) => /Sheet4/.test(e.detalle)), 'la hoja rota queda en errores[]');
  ok(/Califica-451-02\.xls/.test(p.log()), 'el log nombra el archivo recibido');
}

// ====================================================================== 3
console.log('\n[guarda: < TODOS > no se exporta]');
{
  const p = nuevaPagina({ profesorSeleccionado: '-1' });
  await p.pulsarIniciar();
  ok(p.peticiones.length === 0, 'no hizo ninguna petición');
  ok(/TODOS/.test(p.log()) && /no voy a descargar/i.test(p.log()),
    'y explica por qué se niega');
}

// ====================================================================== 4
console.log('\n[guarda: otro docente exige confirmación aparte]');
{
  const p = nuevaPagina({ profesorSeleccionado: '3' });
  ok(/no está en tu código/.test(p.log()), 'lo avisa ya al cargar');

  await p.pulsarIniciar();
  ok(p.peticiones.length === 0, 'el primer clic NO exporta');
  ok(/Confirmar/.test(p.q('#gla-iniciar').textContent), 'el botón pide confirmación explícita');

  await p.pulsarIniciar();
  ok(p.peticiones.length === 1, 'el segundo clic sí procede: avisa, no prohíbe');
}

// ====================================================================== 5
console.log('\n[en la pantalla individual sigue el modo lento]');
{
  const p = nuevaPagina({ pagina: 'ReporteCalificaMatriz.aspx' });
  ok(!p.errorDeArranque, 'arranca sin lanzar');
  ok(!/1 petición/.test(p.q('#gla-iniciar').textContent),
    'no ofrece el modo rápido: "' + p.q('#gla-iniciar').textContent + '"');
  ok(/19 cursos/.test(p.q('#gla-estado').textContent), 'ofrece el recorrido curso por curso');
}

console.log('\n' + (fallos ? '✗ ' + fallos + ' fallas' : '✓ todo verde'));
process.exit(fallos ? 1 : 0);
