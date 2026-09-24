/*
 * Pruebas del extractor de actividades, sobre un jsdom que replica
 * DefActividadDocentePorcMatriz.aspx: mismos ids, mismos encabezados —con las
 * tres columnas SIN nombre incluidas— y el mismo "Editar" por fila.
 *
 * Lo que hay que garantizar, en orden: que NO escriba (la pantalla sí escribe,
 * y es la primera vez que automatizamos una que puede), que lea el porcentaje
 * correcto, y que una columna nueva no corra la lectura.
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
const PCT = { 8: [60, 40], 9: [70, 30], 11: [50, 50] };
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
  w.__doPostBack = (t, a) => postbacks.push(`${t}|${a}`);
  w.HTMLElement.prototype.click = function () { clicks.push(this.id || this.name || this.textContent); };
  w.setTimeout = (fn) => { fn(); return 0; };

  const est = { curso: CURSOS[0] };
  const op = (v, t, s) => `<option value="${v}"${s ? ' selected' : ''}>${t}</option>`;

  function filas() {
    const pct = PCT[gradoDe(est.curso)];
    return pct.map((p, i) => {
      const ctl = 'ctl' + String(i + 2).padStart(2, '0');
      const n = `ctl00$ContentPlaceHolder1$gvActividades$${ctl}`;
      const edit = filaEnEdicion && i === 0;
      // En edición el texto se va al value del input y la celda queda vacía.
      const celdaPct = edit ? `<input name="${n}$ctl05" value="${p}">` : String(p);
      const celdaDesc = edit
        ? `<textarea name="${n}$descripcion">T3 - C${4 + i}. TITULO ${i}</textarea>`
        : `T3 - C${4 + i}. TITULO ${i} <textarea name="${n}$descripcion" readonly>T3 - C${4 + i}. TITULO ${i}</textarea>`;
      return `<tr>
        ${columnaExtra ? '<td>x</td>' : ''}
        <td><a href="javascript:__doPostBack('ctl00$ContentPlaceHolder1$gvActividades','Edit$${i}')">${edit ? 'Actualizar' : 'Editar'}</a></td>
        <td>Comprensión</td><td>Act.${i + 1}</td><td>${celdaDesc}</td>
        <td>298${i}</td><td>1035</td><td>11378${i}</td>
        <td>${celdaPct}</td><td>Act.${i + 1}</td>
        <td><select name="${n}$lstCiclo"${edit ? '' : ' disabled'}><option value="${i + 1}" selected>Ciclo ${i + 1}</option></select></td>
        <td><select name="${n}$lstDestino"${edit ? '' : ' disabled'}><option value="2" selected>Clase</option></select></td>
      </tr>`;
    }).join('');
  }

  function pintar() {
    const ths = (columnaExtra ? ['Nº', ...ENC] : ENC).map((h) => `<th>${h}</th>`).join('');
    w.document.getElementById('aspnetForm').innerHTML = `
      <input type="hidden" id="ctl00_ContentPlaceHolder1_hfProfesor" value="451">
      <select id="ctl00_ContentPlaceHolder1_lstCurso" name="ctl00$ContentPlaceHolder1$lstCurso">
        ${CURSOS.map((c) => op(c, c, c === est.curso)).join('')}${op('%', '< TODOS >', false)}</select>
      <select id="ctl00_ContentPlaceHolder1_lstMateria"><option value="1035" selected>Information Technology</option></select>
      <select id="ctl00_ContentPlaceHolder1_lstPeriodo"><option value="03" selected>TERCERO</option></select>
      <input type="image" id="ctl00_ContentPlaceHolder1_btnDescargaExcel" alt="Descargar a Excel">
      ${sinTabla ? '' : `<table id="ctl00_ContentPlaceHolder1_gvActividades">
        <thead><tr>${ths}</tr></thead><tbody>${filas()}
        <tr><td colspan="11">Total</td></tr></tbody></table>`}`;
  }
  pintar();
  const evaluar = () => { w.document.getElementById('gla-act')?.remove(); w.eval(FUENTE); };
  evaluar();

  return {
    w, postbacks, clicks,
    q: (s) => w.document.querySelector(s),
    salida: () => JSON.parse(w.document.querySelector('#ga-salida').value || '{}'),
    log: () => [...w.document.querySelectorAll('#ga-log div')].map((d) => d.textContent).join('\n'),
    async correr(max = 100) {
      let atendidos = 0;
      for (let v = 0; v < max; v++) {
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setTimeout(r, 0));
        if (postbacks.length === atendidos) break;
        atendidos = postbacks.length;
        est.curso = w.document.getElementById('ctl00_ContentPlaceHolder1_lstCurso').value;
        pintar(); evaluar();
      }
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
  ok(p.postbacks.every((t) => /lstCurso/.test(t)),
     'lo único que dispara es el cambio de curso, igual que elegirlo a mano');
}

console.log('\n[uno por grado, que es lo que hace falta]');
{
  const p = crear();
  ok(/3 curso/.test(p.q('#ga-costo').textContent),
     'por defecto un curso por grado: 3 de los 4, no los 4');
  await p.q('#ga-ir').onclick();
  await p.correr();
  eq(p.salida().cursos.map((c) => c.grado), [8, 9, 11], 'y cubre los tres grados');
  eq(p.postbacks.length, 2, 'con 2 postbacks: el primer curso ya estaba en pantalla');
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

console.log('\n[reglas del encargo, sobre el fuente]');
{
  const sc = FUENTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/\.click\(/.test(sc), 'no pulsa nada por código');
  ok(!/\.submit\(/.test(sc), 'no envía el formulario');
  ok(!/Edit\$|Actualizar'/.test(sc), 'no nombra los disparadores de edición ni para construirlos');
  ok(/ESPERA_MS\s*=\s*\d{4,}/.test(sc), 'espera al menos 1000 ms entre postbacks');
  ok(/MAX_CARGAS/.test(sc) && /MAX_INTENTOS/.test(sc), 'tiene cortafuegos y tope de reintentos');
  ok(/=== '%'/.test(sc), 'y la guarda contra "< TODOS >" está en el código');
}

console.log(fallos === 0 ? '\n✓ todo verde' : `\n${fallos} FALLARON`);
process.exit(fallos ? 1 : 0);
