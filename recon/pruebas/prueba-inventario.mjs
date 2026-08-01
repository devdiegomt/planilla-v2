/*
 * Pruebas del inventario de la plataforma.
 *
 * Lo que más importa acá no es que capture bien, sino que NO TOQUE NADA. Por
 * eso hay dos capas: pruebas estructurales sobre el fuente (que no exista un
 * click sobre controles de la página) y pruebas de comportamiento en jsdom con
 * escuchas de click en todos los botones.
 *
 * Requiere: npm install jsdom
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const FUENTE = readFileSync(new URL('../../inventario-plataforma.user.js', import.meta.url), 'utf8');

/* Los chequeos estructurales tienen que mirar CÓDIGO, no comentarios: la
   cabecera de ese archivo habla de `.click()` y `.submit()` justamente para
   explicar que no los usa, y una versión anterior de estas pruebas se daba por
   satisfecha leyendo esa prosa. */
const CODIGO = FUENTE
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

let fallos = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✔ ' : '  ✗ FALLA ') + msg); if (!cond) fallos++; };
const tick = () => new Promise((r) => setImmediate(r));

const BASE = 'https://webapps3-classroomliveweb.com:2443/arrayanes/2026/Seguro/';

const PANTALLAS = [
  { id: '899', titulo: 'Asistencia diaria por asignatura', pageNum: 'AsistenciaAsignaturaAusenciaDia.aspx', seccion: 'Asistencia' },
  { id: '1096', titulo: 'Importar/exportar planilla individual GLA', pageNum: 'ReporteCalificaMatriz.aspx', seccion: 'Evaluación' },
  { id: '24', titulo: 'Notas parciales por meta', pageNum: 'ConsCalificaDocentesGen.aspx', seccion: 'Consultas' },
];

// El menú va en todas las páginas porque vive en la master page.
function htmlMenu() {
  const rama = (seccion, items) => `<li><a href="#">${seccion}</a><ul>` +
    items.map((p) => `<li><span onclick="SessionEntrar('${p.titulo}','${p.id}','${p.pageNum}')">${p.titulo}</span></li>`).join('') +
    `</ul></li>`;
  const porSeccion = {};
  for (const p of PANTALLAS) (porSeccion[p.seccion] ||= []).push(p);
  return `<ul id="main-menu-navigation">` +
    Object.entries(porSeccion).map(([s, items]) => rama(s, items)).join('') + `</ul>`;
}

// Contenido propio de cada pantalla. La de asistencia trae los botones reales.
function htmlPantalla(pageNum) {
  if (/Asistencia/i.test(pageNum)) {
    return `
      <select id="ctl00_ContentPlaceHolder1_lstCursos" name="ctl00$ContentPlaceHolder1$lstCursos">
        <option value="%">&lt;SELECCIONAR&gt;</option><option value="801  ">OCHOCIENTOS UNO</option></select>
      <input type="image" id="ctl00_ContentPlaceHolder1_ImageButton3" title="Guardar">
      <input type="image" id="ctl00_ContentPlaceHolder1_ImageButton1" title="Salir">
      <input type="image" id="ctl00_imgClave" title="Cambiar Clave">
      <a href="javascript:__doPostBack('ctl00$ContentPlaceHolder1$gvDatos','Select$0')">Desmarcar</a>
      <table id="gvDatos"><thead><tr><th>Codigo</th><th>Nombre</th></tr></thead>
        <tbody><tr><td>2019034387</td><td>APELLIDO NOMBRE</td></tr></tbody></table>`;
  }
  if (/ReporteCalifica/i.test(pageNum)) {
    return `
      <input type="submit" id="ctl00_ContentPlaceHolder1_btnExportar" value="Exportar">
      <input type="submit" id="ctl00_ContentPlaceHolder1_btnImportar" value="Importar">`;
  }
  return `<input type="submit" id="btnConsultar" value="Consultar">
          <table><thead><tr><th>Meta</th></tr></thead><tbody><tr><td>x</td></tr></tbody></table>`;
}

function nuevaSesion({ sinTampermonkey = false } = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><head></head><body>${htmlMenu()}
      <input type="hidden" id="ctl00_hfTipUsu" value="2">
      <div id="contenido"></div></body></html>`,
    { runScripts: 'outside-only', url: BASE + 'Default.aspx' });

  const w = dom.window;
  const navegaciones = [];
  const clicksEnPagina = [];
  let pendienteRecarga = false;
  let blobDescargado = null;

  /* Las esperas cortas (dormir entre navegaciones) se resuelven ya. La larga
     —el vigía de "navegué y no pasó nada"— se guarda aparte para dispararla a
     mano: en el navegador solo llega a ejecutarse si la página NO se recargó. */
  const temporizadoresLargos = [];
  w.setTimeout = (fn, ms) => {
    if ((ms || 0) >= 5000) { temporizadoresLargos.push(fn); return 0; }
    Promise.resolve().then(fn);
    return 0;
  };
  if (!sinTampermonkey) w.GM_info = { script: { name: 'prueba' } };
  w.URL.createObjectURL = () => 'blob:prueba';
  w.URL.revokeObjectURL = () => {};
  // El Blob de jsdom no expone .text(), así que se captura el contenido al
  // construirlo. De paso confirma que la descarga se arma con JSON.
  const BlobReal = w.Blob;
  w.Blob = function (partes, opts) { blobDescargado = String(partes[0]); return new BlobReal(partes, opts); };
  // jsdom no implementa navegación: el <a> de la descarga la intentaría y
  // ensuciaría la salida. El contenido ya quedó capturado arriba.
  w.HTMLAnchorElement.prototype.click = function () {};

  // Espía: cualquier click sobre un control de la página queda registrado.
  const vigilarBotones = () => {
    for (const b of w.document.querySelectorAll('input, button, a, select')) {
      if (b.dataset.vigilado) continue;
      b.dataset.vigilado = '1';
      b.addEventListener('click', () => clicksEnPagina.push(b.id || b.getAttribute('title') || b.textContent));
    }
  };

  w.SessionEntrar = (titulo, id, pageNum) => {
    navegaciones.push({ titulo, id, pageNum });
    dom.reconfigure({ url: BASE + pageNum });
    w.document.body.innerHTML = htmlMenu() +
      '<input type="hidden" id="ctl00_hfTipUsu" value="2">' + htmlPantalla(pageNum);
    pendienteRecarga = true;
  };

  const evaluar = () => {
    w.document.getElementById('gla-inv')?.remove();
    vigilarBotones();
    w.eval(FUENTE);
  };
  evaluar();

  return {
    w, navegaciones, clicksEnPagina,
    blob: () => blobDescargado,
    datos: () => JSON.parse(blobDescargado),
    q: (s) => w.document.querySelector(s),
    log: () => [...w.document.querySelectorAll('#gi-log div')].map((d) => d.textContent).join('\n'),
    async correr() {
      await this.q('#gi-iniciar').onclick();
      for (let i = 0; i < 60; i++) {
        await tick();
        if (pendienteRecarga) {
          // La recarga se lleva por delante cualquier temporizador pendiente.
          pendienteRecarga = false;
          temporizadoresLargos.length = 0;
          evaluar();
          continue;
        }
        // No hubo recarga: es el escenario que el vigía tiene que detectar.
        if (temporizadoresLargos.length) {
          temporizadoresLargos.splice(0).forEach((fn) => fn());
          continue;
        }
        break;
      }
      await tick();
    },
  };
}

// ====================================================================== 1
console.log('\n[estructural: el fuente no puede tocar la página]');
{
  // El único .click() permitido es el del <a> sintético de la descarga.
  const clicks = [...CODIGO.matchAll(/(\S+)\.click\s*\(/g)].map((m) => m[1]);
  ok(clicks.length === 1 && clicks[0] === 'a',
    'el único .click() del código es el de la descarga: ' + JSON.stringify(clicks));
  ok(!/\.submit\s*\(/.test(CODIGO), 'no hay ningún .submit()');
  ok(!/\.checked\s*=/.test(CODIGO), 'nunca asigna .checked');
  ok(!/theForm/.test(CODIGO), 'no manipula theForm');
  ok(!/__doPostBack\s*\(/.test(CODIGO), 'no dispara __doPostBack por su cuenta');
  // Navegar se delega en la función del propio menú.
  ok(/window\.SessionEntrar\s*\(/.test(CODIGO), 'navega llamando a SessionEntrar de la plataforma');
  // Y no escribe en los hidden de navegación a mano.
  ok(!/hfTitulo|hfidpag|hftitpag/.test(CODIGO), 'no escribe los hidden de navegación por su cuenta');
  // El chequeo anterior sería trivial si el fuente no mencionara nada; que la
  // prosa sí los mencione confirma que estamos filtrando comentarios de verdad.
  ok(/\.click\(\)/.test(FUENTE.slice(0, FUENTE.indexOf('(() => {'))),
    'la cabecera sí habla de .click(), así que el filtro de comentarios está actuando');
}

// ====================================================================== 2
console.log('\n[clasificación de botones: ante la duda, peligroso]');
{
  const s = nuevaSesion();
  await s.correr();
  const texto = s.log();
  ok(/1096.*escribe/i.test(texto) || /escribe.*Importar/i.test(texto),
    'marca como escritura la pantalla con Importar');

  const datos = s.datos();
  const porId = Object.fromEntries(datos.pantallas.map((p) => [p.id, p]));

  ok(porId['1096'].riesgo.escribe === true, '1096 (Importar/exportar) marcada como escritura');
  ok(porId['1096'].riesgo.botonesDeEscritura.some((b) => /Importar/i.test(b)), 'nombra el botón Importar');
  ok(porId['899'].riesgo.escribe === true, '899 (Asistencia) marcada como escritura');
  ok(porId['899'].riesgo.botonesDeEscritura.some((b) => /Guardar|Desmarcar/i.test(b)), 'nombra Guardar/Desmarcar');

  const clases899 = Object.fromEntries(porId['899'].botones.map((b) => [b.id || b.etiqueta, b.clase]));
  ok(clases899['ctl00_ContentPlaceHolder1_ImageButton1'] === 'sesion', 'Salir queda como sesión, no como inocuo');
  ok(clases899['ctl00_imgClave'] === 'escritura', 'Cambiar Clave queda como escritura');

  const exportar = porId['1096'].botones.find((b) => /btnExportar/.test(b.id));
  ok(exportar.clase === 'lectura', 'Exportar queda como lectura');
  const consultar = porId['24'].botones.find((b) => /btnConsultar/.test(b.id));
  ok(consultar.clase === 'lectura', 'Consultar queda como lectura');
}

// ====================================================================== 3
console.log('\n[comportamiento: recorre todo sin pulsar nada]');
{
  const s = nuevaSesion();
  await s.correr();

  ok(s.navegaciones.length === PANTALLAS.length,
    `navegó a las ${PANTALLAS.length} pantallas (fueron ${s.navegaciones.length})`);
  ok(s.navegaciones.map((n) => n.id).join() === '24,899,1096',
    'en orden de id: ' + s.navegaciones.map((n) => n.id).join());
  ok(s.clicksEnPagina.length === 0,
    'NO pulsó ni un control de las pantallas (registrados: ' + JSON.stringify(s.clicksEnPagina) + ')');

  const datos = s.datos();
  ok(datos.capturadas === PANTALLAS.length, 'capturó las 3');
  ok(datos.errores.length === 0, 'sin errores');
  ok(datos.resumen.length === PANTALLAS.length, 'el resumen tiene una línea por pantalla');
  ok(datos.resumen.every((r) => 'escribe' in r && 'tieneDatos' in r),
    'el resumen dice, por pantalla, si escribe y si trae datos');
}

// ====================================================================== 4
console.log('\n[la sección sale de la rama del menú, no del hermano anterior]');
{
  const s = nuevaSesion();
  await s.correr();
  const datos = s.datos();
  const porId = Object.fromEntries(datos.pantallas.map((p) => [p.id, p]));
  ok(porId['899'].seccion === 'Asistencia', '899 → Asistencia');
  ok(porId['1096'].seccion === 'Evaluación', '1096 → Evaluación');
  ok(porId['24'].seccion === 'Consultas', '24 → Consultas');
}

// ====================================================================== 5
console.log('\n[datos de estudiantes enmascarados en el mapa]');
{
  const s = nuevaSesion();
  await s.correr();
  const crudo = s.blob();
  ok(!/APELLIDO NOMBRE/.test(crudo), 'el nombre del estudiante no viaja en claro');
  ok(/A·+/.test(crudo), 'sí queda la forma, para saber qué columna es');
  ok(!/__VIEWSTATE"[^}]*valor":"[A-Za-z0-9+/]{20}/.test(crudo), 'no vuelca el VIEWSTATE');
}

// ====================================================================== 6
console.log('\n[si una pantalla no abre, sigue con la siguiente]');
{
  // Caso A: falla una vez y el reintento la salva.
  {
    const s = nuevaSesion();
    let n = 0;
    const original = s.w.SessionEntrar;
    s.w.SessionEntrar = (t, id, p) => { if (++n === 2) return; return original(t, id, p); };
    await s.correr();
    const datos = s.datos();
    ok(datos.capturadas === PANTALLAS.length, 'un fallo aislado se recupera con el reintento');
    ok(/no ocurrió/.test(s.log()), 'igual deja constancia del intento fallido');
  }

  // Caso B: una pantalla que nunca abre. Tras los reintentos, error y seguir.
  {
    const s = nuevaSesion();
    const original = s.w.SessionEntrar;
    s.w.SessionEntrar = (t, id, p) => { if (String(id) === '899') return; return original(t, id, p); };
    await s.correr();
    const datos = s.datos();
    ok(datos.errores.length === 1, 'registra exactamente el fallo en errores[]');
    ok(datos.errores[0].id === '899', 'identifica cuál falló');
    ok(datos.capturadas === PANTALLAS.length - 1, 'captura las otras dos igual');
    ok(/no abrió/.test(s.log()), 'lo dice en el log');
  }
}

// ====================================================================== 7
console.log('\n[consola sin Tampermonkey: avisa]');
{
  const s = nuevaSesion({ sinTampermonkey: true });
  ok(/No detecto Tampermonkey/.test(s.q('#gi-alerta').textContent), 'muestra el aviso');
}

console.log('\n' + (fallos ? '✗ ' + fallos + ' fallas' : '✓ todo verde'));
process.exit(fallos ? 1 : 0);
