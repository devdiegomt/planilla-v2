/*
 * Pruebas del extractor de actividades.
 *
 * El recorrido ya no navega: pide las páginas con `fetch`, así que el arnés
 * **contesta como el servidor** en vez de simular postbacks. Reproduce la
 * máquina de estados que se midió contra la plataforma el 26/09/2026:
 *
 *   curso    → 200, sin tabla (el cambio de curso deja la materia sin elegir)
 *   materia  → 200, sin tabla (elegir no alcanza)
 *   consultar→ 200, CON tabla
 *
 * Lo que hay que garantizar, en orden: que NO escriba (la pantalla sí escribe,
 * y es la primera que automatizamos que puede), que no toque el DOM de la
 * pantalla abierta, que lea el porcentaje correcto, y que una columna nueva no
 * corra la lectura.
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const FUENTE = readFileSync(new URL('../../actividades-extractor.user.js', import.meta.url), 'utf8');

let fallos = 0;
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✗ FALLA ') + m); if (!c) fallos++; };
const eq = (g, w, m) => { const i = JSON.stringify(g) === JSON.stringify(w);
  ok(i, `${m}${i ? '' : ` (esperado ${JSON.stringify(w)}, obtenido ${JSON.stringify(g)})`}`); };

const CURSOS = ['801  ', '802  ', '901  ', '1101 '];
// Porcentajes distintos por grado: si el recorrido repitiera una pantalla o se
// saltara un grado, saldrían iguales donde deberían diferir.
// El 0 es una casilla sin usar: la pantalla trae ocho por categoría, usadas o no.
// El 0 del medio es una casilla sin usar: la pantalla trae ocho por categoría,
// usadas o no. Va en el medio a propósito, para que la posición de la que sigue
// solo salga bien si se cuentan también las vacías.
const PCT = { 8: [60, 0, 40], 9: [70, 0, 30], 11: [50, 0, 50] };
const gradoDe = (c) => (c.trim().length >= 4 ? Number(c.trim().slice(0, 2)) : Number(c.trim()[0]));

// Los tres encabezados vacíos son los de los ids internos, tal cual la pantalla.
const ENC = ['', 'Meta de comprensión', 'Descripción General', 'Descripción',
             '', '', '', 'Porcentaje', '', 'Ciclo', 'Destino'];

function crear({ columnaExtra = false, filaEnEdicion = false, sinTabla = false } = {}) {
  const dom = new JSDOM('<!doctype html><body><form id="aspnetForm" name="aspnetForm"></form></body>',
    { url: 'https://x/arrayanes/2026/Seguro/DefActividadDocentePorcMatriz.aspx', runScripts: 'outside-only' });
  const w = dom.window;
  const postbacks = [];
  const clicks = [];
  const enviados = [];
  // Si el script llamara a alguno de estos, es un fallo: ya no debe hacerlo.
  w.__doPostBack = (t, a) => postbacks.push(`${t}|${a}`);
  w.HTMLElement.prototype.click = function () { clicks.push(this.id || this.name || this.textContent); };
  w.setTimeout = (fn) => { fn(); return 0; };
  w.module = { exports: {} };

  const op = (v, t, s) => `<option value="${v}"${s ? ' selected' : ''}>${t}</option>`;

  /** El HTML de la pantalla en un estado dado. */
  function pagina({ curso, materia, consultado }) {
    const pct = PCT[gradoDe(curso)] || PCT[8];
    const filas = pct.map((p, i) => {
      const ctl = 'ctl' + String(i + 2).padStart(2, '0');
      const n = `ctl00$ContentPlaceHolder1$gvActividades$${ctl}`;
      const edit = filaEnEdicion && i === 0;
      const celdaPct = edit ? `<input name="${n}$ctl05" value="${p}">` : String(p);
      // Una casilla sin usar va en 0 % y SIN columna.
      const texto = p === 0 ? `ACT.${i + 1}` : `T3 - C${4 + i}. TITULO ${i}`;
      const celdaDesc = edit
        ? `<textarea name="${n}$descripcion">${texto}</textarea>`
        : `${texto} <textarea name="${n}$descripcion" readonly>${texto}</textarea>`;
      return `<tr>
        ${columnaExtra ? '<td>x</td>' : ''}
        <td><a href="javascript:__doPostBack('ctl00$ContentPlaceHolder1$gvActividades','Edit$${i}')">${edit ? 'Actualizar' : 'Editar'}</a></td>
        <td>Comprensión</td><td>Act.${i + 1}</td><td>${celdaDesc}</td>
        <td>298${i}</td><td>1035</td><td>11378${i}</td>
        <td>${celdaPct}</td><td>Act.${i + 1}</td>
        <td><select name="${n}$lstCiclo"><option value="${i + 1}" selected>Ciclo ${i + 1}</option></select></td>
        <td><select name="${n}$lstDestino"><option value="2" selected>Clase</option></select></td>
      </tr>`;
    }).join('');
    const ths = (columnaExtra ? ['Nº', ...ENC] : ENC).map((h) => `<th>${h}</th>`).join('');
    const hayTabla = !sinTabla && materia !== '0' && consultado;
    return `<!doctype html><html><body><form id="aspnetForm" name="aspnetForm" action="Matriz.aspx">
      <input type="hidden" name="__VIEWSTATE" value="VS-${curso}-${materia}-${consultado}">
      <input type="hidden" name="__EVENTTARGET" value="">
      <input type="hidden" name="__EVENTARGUMENT" value="">
      <input type="hidden" id="ctl00_ContentPlaceHolder1_hfProfesor" name="hfProfesor" value="451">
      <select id="ctl00_ContentPlaceHolder1_lstCurso" name="ctl00$ContentPlaceHolder1$lstCurso">
        ${CURSOS.map((c) => op(c, c, c === curso)).join('')}${op('%', '< TODOS >', false)}</select>
      <select id="ctl00_ContentPlaceHolder1_lstMateria" name="ctl00$ContentPlaceHolder1$lstMateria">
        ${op('0', '<TODOS>', materia === '0')}${op('1035', 'Information Technology', materia === '1035')}</select>
      <select id="ctl00_ContentPlaceHolder1_lstPeriodo" name="ctl00$ContentPlaceHolder1$lstPeriodo">
        <option value="03" selected>TERCERO</option></select>
      <input type="image" id="ctl00_ContentPlaceHolder1_btnDescargaExcel" name="ctl00$ContentPlaceHolder1$btnDescargaExcel">
      <input type="submit" id="ctl00_ContentPlaceHolder1_btnRefresca" name="ctl00$ContentPlaceHolder1$btnRefresca" value="Consultar">
      ${hayTabla ? `<table id="ctl00_ContentPlaceHolder1_gvActividades">
        <thead><tr>${ths}</tr></thead><tbody>${filas}
        <tr><td colspan="11">Total</td></tr></tbody></table>` : ''}
    </form></body></html>`;
  }

  /*
   * El servidor, con la máquina de estados medida contra la plataforma:
   * cambiar de curso deja la materia sin elegir y sin tabla; elegir materia
   * tampoco la trae; solo "Consultar" la devuelve.
   */
  w.fetch = (url, opciones) => {
    const campos = new URLSearchParams(opciones.body);
    enviados.push({ url, campos });
    const objetivo = campos.get('__EVENTTARGET') || '';
    let curso = campos.get('ctl00$ContentPlaceHolder1$lstCurso') || CURSOS[0];
    let materia = campos.get('ctl00$ContentPlaceHolder1$lstMateria') || '0';
    let consultado = false;
    if (/lstCurso$/.test(objetivo)) materia = '0';
    else if (/lstMateria$/.test(objetivo)) consultado = false;
    else if (campos.has('ctl00$ContentPlaceHolder1$btnRefresca')) consultado = true;
    return Promise.resolve({
      ok: true, status: 200,
      text: () => Promise.resolve(pagina({ curso, materia, consultado })),
    });
  };

  // La pantalla que el docente tiene abierta: de acá sale el plan.
  w.document.body.innerHTML = pagina({ curso: CURSOS[0], materia: '1035', consultado: true })
    .replace(/^[\s\S]*<body>/, '').replace(/<\/body>[\s\S]*$/, '');
  w.eval(FUENTE);

  const $ = (s) => w.document.querySelector(s);
  return {
    w, postbacks, clicks, enviados, q: $,
    salida: () => JSON.parse($('#ga-salida').value || '{}'),
    log: () => [...w.document.querySelectorAll('#ga-log div')].map((d) => d.textContent).join('\n'),
    async correr(max = 200) {
      for (let i = 0; i < max; i++) await new Promise((r) => setImmediate(r));
    },
  };
}

console.log('Extractor de actividades');

console.log('\n[no escribe, que es lo primero]');
{
  const p = crear();
  eq(p.postbacks.length, 0, 'al cargar no dispara nada');
  eq(p.clicks.length, 0, 'ni pulsa ningún control');
  await p.q('#ga-ir').onclick();
  await p.correr();
  eq(p.clicks.length, 0, 'durante toda la corrida tampoco');
  ok(!p.postbacks.some((t) => /Edit\$/.test(t)),
     'NUNCA pulsa "Editar": es lo único que destraba los campos, y no hay nada que escribir');
  ok(!p.postbacks.some((t) => /ctl0\d\$ctl00/.test(t)),
     'ni "Actualizar", que es el que guardaría');
  ok(p.postbacks.every((t) => /lstCurso|lstMateria|btnRefresca/.test(t)),
     'solo dispara curso, materia y Consultar: las tres son consultas');
  ok(!p.postbacks.some((t) => /btnDescargaExcel/.test(t)),
     'ni siquiera el de descargar, que no hace falta');
}

console.log('\n[uno por grado, que es lo que hace falta]');
{
  const p = crear();
  ok(/3 curso/.test(p.q('#ga-costo').textContent),
     'por defecto un curso por grado: 3 de los 4, no los 4');
  await p.q('#ga-ir').onclick();
  await p.correr();
  eq(p.salida().cursos.map((c) => c.grado), [8, 9, 11], 'y cubre los tres grados');
  // Tres envíos por curso: curso, materia y consultar. Ya no se ahorra el
  // primero, porque el recorrido no parte de lo que hay en pantalla sino de
  // su propio estado — y eso es lo que lo vuelve repetible.
  eq(p.enviados.length, 9, 'nueve envíos: tres por cada uno de los tres cursos');
  eq(p.postbacks.length, 0, 'y CERO postbacks: ya no navega, la página no se recarga');
}
{
  const p = crear();
  p.q('#ga-todos').checked = true;
  p.q('#ga-todos').onchange();
  ok(/4 curso/.test(p.q('#ga-costo').textContent), 'y marcando la casilla, los cuatro');
}

console.log('\n[el porcentaje]');
{
  const p = crear();
  await p.q('#ga-ir').onclick();
  await p.correr();
  const s = p.salida();
  eq(s.cursos[0].actividades.map((a) => a.porcentaje), [60, 40], 'lee los porcentajes del 8°');
  eq(s.cursos[2].actividades.map((a) => a.porcentaje), [50, 50], 'y los del 11°, que son otros');
  eq(s.cursos[0].actividades[0].descripcion, 'T3 - C4. TITULO 0',
     'con la descripción, que es la que dice a qué columna pertenece');
  eq(s.cursos[0].actividades[0].ciclo, 'Ciclo 1', 'el ciclo');
  eq(s.cursos[0].actividades[0].destino, 'Clase', 'y el destino');
  eq(s.cursos[0].actividades.length, 2, 'sin contar el pie del GridView');
  eq(s.cursos[0].casillasSinUsar.map((v) => v.posicion), [2],
     'y la casilla sin usar no entra, pero queda con su posición: es la que el formulario puede ofrecer para estrenar una actividad');
  eq(s.cursos[0].casillasSinUsar.length, 1,
     'se cuenta: si una actividad real quedara en 0% hay que poder notarlo');
  eq(s.cursos[0].actividades.map((a) => a.posicion), [1, 3],
     'la posición cuenta también las vacías: es el número de fila en la pantalla, que es como se empareja al escribir');
}

console.log('\n[una columna nueva no corre la lectura]');
{
  const normal = crear();
  await normal.q('#ga-ir').onclick();
  await normal.correr();
  const extra = crear({ columnaExtra: true });
  await extra.q('#ga-ir').onclick();
  await extra.correr();
  eq(extra.salida().cursos[0].actividades, normal.salida().cursos[0].actividades,
     'con una columna de más el resultado es idéntico: se lee por encabezado');
}

console.log('\n[una fila que quedó abierta no se pierde]');
{
  const p = crear({ filaEnEdicion: true });
  await p.q('#ga-ir').onclick();
  await p.correr();
  eq(p.salida().cursos[0].actividades.map((a) => a.porcentaje), [60, 40],
     'en edición el texto se va al input y la celda queda vacía: se lee el input');
}

console.log('\n[sin tabla lo dice y sigue]');
{
  const p = crear({ sinTabla: true });
  await p.q('#ga-ir').onclick();
  await p.correr();
  const s = p.salida();
  eq(s.cursos.length, 0, 'no inventa actividades');
  ok(s.errores.length > 0, 'lo anota en errores[]');
  ok(/Sigo/.test(p.log()), 'y sigue con el siguiente curso');
}

console.log('\n[la materia y el Consultar, que es lo que faltaba]');
{
  const p = crear();
  await p.q('#ga-ir').onclick();
  await p.correr();
  const s = p.salida();
  eq(s.cursos.length, 3, 'los tres grados traen tabla');
  eq(s.errores, [], 'sin un solo "no hay tabla en pantalla"');
  // El orden importa: elegir la materia antes de consultar.
  const tres = p.enviados.slice(0, 3);
  ok(/lstCurso$/.test(tres[0].campos.get('__EVENTTARGET')), 'el primer envío elige curso');
  ok(/lstMateria$/.test(tres[1].campos.get('__EVENTTARGET')), 'el segundo, materia');
  ok(tres[2].campos.has('ctl00$ContentPlaceHolder1$btnRefresca'),
     'y el tercero manda Consultar como campo, porque es un submit');

  // Encadenar: cada envío parte del VIEWSTATE que devolvió el anterior.
  const vs = p.enviados.map((e) => e.campos.get('__VIEWSTATE'));
  ok(new Set(vs.slice(0, 3)).size === 3,
     'cada envío lleva un VIEWSTATE distinto: usa el que devolvió el anterior');

  // Y el valor del curso viaja SIN recortar.
  ok(/ $/.test(tres[0].campos.get('ctl00$ContentPlaceHolder1$lstCurso')),
     'el curso va con sus espacios: recortarlo manda un curso que el servidor no reconoce');
}

console.log('\n[la lista blanca de controles]');
{
  const p = crear();
  // Se le pide al script que dispare algo que NO está permitido.
  const fn = p.w.eval('(function(n){ try { ' +
    'const PERM = new Set(["ctl00$ContentPlaceHolder1$lstCurso"]); ' +
    'if (!PERM.has(n)) throw new Error("control no permitido"); return "pasó"; } ' +
    'catch (e) { return e.message; } })');
  eq(fn('ctl00$ContentPlaceHolder1$gvActividades$ctl04$ctl00'), 'control no permitido',
     '(la forma de la guarda: lo que no está en la lista lanza)');
  const sc = FUENTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(/PERMITIDOS/.test(sc) && /no permitido/.test(sc),
     'la lista blanca está en el código, no solo en la prueba');
  // Antes se comprobaba que hubiera UNA sola llamada a __doPostBack. Ahora no
  // hay ninguna: el recorrido no navega. Lo que se verifica es lo equivalente
  // —un solo lugar que toca la red— y está más arriba.
  ok(!/__doPostBack/.test(sc), 'no queda ninguna llamada a __doPostBack');
  ok(/PERMITIDOS\.has/.test(sc), 'y la lista blanca se comprueba antes de enviar');
}

console.log('\n[la lista blanca, ejercida]');
{
  // Que esté en el código no basta: tiene que estar EN el camino del envío.
  const p = crear();
  const mod = p.w.module.exports;
  ok(!!mod, 'el script exporta sus partes para poder probarlas');
  const antes = p.enviados.length;
  let msg = '';
  await mod.enviar(new p.w.URLSearchParams(), 'ctl00$ContentPlaceHolder1$gvActividades')
    .catch((e) => { msg = e.message; });
  ok(/no permitido/.test(msg), 'disparar la tabla —que es lo que edita— revienta');
  eq(p.enviados.length, antes, 'y no sale ninguna petición');

  msg = '';
  await mod.enviar(new p.w.URLSearchParams(), null,
                   { 'ctl00$ContentPlaceHolder1$btnDescargaExcel': 'x' })
    .catch((e) => { msg = e.message; });
  ok(/no permitido/.test(msg), 'y meterlo como campo extra tampoco pasa');
  eq(p.enviados.length, antes, 'sigue sin salir ninguna petición');
}

console.log('\n[reglas del encargo, sobre el fuente]');
{
  const sc = FUENTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/\.click\(/.test(sc), 'no pulsa nada por código');
  ok(!/\.submit\(/.test(sc), 'no envía el formulario');
  ok(!/Edit\$|Actualizar'/.test(sc), 'no nombra los disparadores de edición ni para construirlos');
  ok(/ESPERA_MS\s*=\s*\d{4,}/.test(sc), 'espera al menos 1000 ms entre cursos');
  ok(!/sessionStorage/.test(sc),
     'no deja estado en el navegador: sin recargas no hay nada que persistir');
  const fetches = (sc.match(/\bfetch\s*\(/g) || []).length;
  ok(fetches === 1, 'hay UNA sola llamada a fetch, con la lista blanca adentro');
  ok(!/__doPostBack/.test(sc), 'y ya no llama a __doPostBack: no navega');
  ok(/!== '%'/.test(sc) && /!== '0'/.test(sc),
     'la guarda contra "< TODOS >" está en el código, para el curso y para la materia');
}

console.log(fallos === 0 ? '\n✓ todo verde' : `\n${fallos} FALLARON`);
process.exit(fallos ? 1 : 0);
