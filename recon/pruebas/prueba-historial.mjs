/*
 * Pruebas del extractor de historial, sobre un DOM (jsdom) que replica
 * ConsCalificaDocentesGen.aspx: mismos ids, mismos encabezados, mismos values
 * de los desplegables y el mismo AutoPostBack que recarga en cada elección.
 *
 * No hay copia del código: se evalúa historial-extractor.user.js tal cual, y
 * "recargar la página" se simula volviéndolo a evaluar sobre la misma ventana,
 * que es lo que hace el navegador con sessionStorage intacto.
 *
 * Lo que hay que garantizar, en orden: que NO escriba (la pantalla es de
 * consulta, pero el script dispara postbacks y hay que acotar cuáles), que no
 * se le escape una fila ni se invente una, y que el número de recargas sea el
 * prometido — es lo que Diego pidió acotar.
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const FUENTE = readFileSync(new URL('../../historial-extractor.user.js', import.meta.url), 'utf8');

let fallos = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✔ ' : '  ✗ FALLA ') + msg); if (!cond) fallos++; };
const eq = (g, w, m) => {
  const igual = JSON.stringify(g) === JSON.stringify(w);
  ok(igual, `${m}${igual ? '' : ` (esperado ${JSON.stringify(w)}, obtenido ${JSON.stringify(g)})`}`);
};

const CURSOS = ['801  ', '802  ', '1001 ', '1101 '];
const ENCABEZADOS = ['Código', 'Nombre', 'CONOCIMIENTO', 'MÉTODO', 'USO', 'COMUNICACIÓN',
  'EVA. TRIMESTRAL', 'EVA. BIMESTRAL', 'Definitiva', 'fallas', 'retardos'];

// Códigos inventados: nunca los de un estudiante real.
const codigoDe = (curso, i) => String(2010000000 + CURSOS.indexOf(curso) * 1000 + i);

/** La definitiva depende del curso y del periodo: así se detecta si el
 *  recorrido mezcla combinaciones o repite una. */
const defDe = (curso, periodo, i) => 50 + CURSOS.indexOf(curso) * 10 + Number(periodo) + i;

function htmlTabla(curso, periodo, nFilas, columnaExtra) {
  // `columnaExtra` mete una columna NUEVA al principio, como haría la
  // plataforma el día que agregue un "Nº". Si el script leyera por posición,
  // la definitiva saldría de la columna de al lado sin avisar: un número
  // plausible en el lugar correcto del JSON, que es lo peor que puede pasar.
  const ths = (columnaExtra ? ['Nº', ...ENCABEZADOS] : ENCABEZADOS).map((h) => `<th>${h}</th>`).join('');
  const filas = Array.from({ length: nFilas }, (_, i) => {
    const d = defDe(curso, periodo, i).toFixed(2).replace('.', ',');   // coma decimal
    return `<tr>${columnaExtra ? '<td>' + (i + 1) + '</td>' : ''}<td>${codigoDe(curso, i)}</td><td>APELLIDO NOMBRE ${i}</td>
      <td>95,00</td><td>0,00</td><td>95,00</td><td>95,00</td><td>0,00</td><td>0,00</td>
      <td>${d}</td><td>0</td><td>0</td></tr>`;
  }).join('');
  // El GridView mete un pie que NO es un estudiante: si se cuela, sobra una fila.
  const pie = `<tr><td colspan="${columnaExtra ? 12 : 11}">Total de registros: ${nFilas}</td></tr>`;
  return `<table id="ctl00_ContentPlaceHolder1_gvDatos" class="table table-bordered">
    <thead><tr>${ths}</tr></thead><tbody>${filas}${pie}</tbody></table>`;
}

function crearPantalla({ conTabla = true, materias = ['2510'], nFilas = 3, cursos = CURSOS, columnaExtra = false } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><form id="aspnetForm" name="aspnetForm"></form></body></html>',
    { url: 'https://ejemplo/arrayanes/2026/Seguro/ConsCalificaDocentesGen.aspx', runScripts: 'outside-only' });
  const w = dom.window;

  const postbacks = [];
  const clicks = [];
  w.__doPostBack = (target) => { postbacks.push(target); };
  // Cualquier clic sobre un control de la plataforma queda registrado: la
  // prueba de fondo es que el script no pulse NADA, y menos "Descargar Tabla".
  w.HTMLElement.prototype.click = function () { clicks.push(this.id || this.name || this.tagName); };

  const estado = { curso: cursos[0], periodo: '03', corte: '1', materia: materias[0] || '%' };

  const op = (v, t, sel) => `<option value="${v}"${sel ? ' selected' : ''}>${t}</option>`;

  function pintar() {
    const form = w.document.getElementById('aspnetForm');
    form.innerHTML = `
      <input type="hidden" id="ctl00_ContentPlaceHolder1_hfProfesor" name="ctl00$ContentPlaceHolder1$hfProfesor" value="451">
      <select id="ctl00_ContentPlaceHolder1_lstCurso" name="ctl00$ContentPlaceHolder1$lstCurso">
        ${op('%', '< TODOS >', estado.curso === '%')}
        ${cursos.map((c) => op(c, 'CURSO ' + c.trim(), c === estado.curso)).join('')}
      </select>
      <select id="ctl00_ContentPlaceHolder1_lstMateria" name="ctl00$ContentPlaceHolder1$lstMateria">
        ${op('%', '< TODOS >', estado.materia === '%')}
        ${materias.map((m) => op(m, 'Materia ' + m, m === estado.materia)).join('')}
      </select>
      <select id="ctl00_ContentPlaceHolder1_lstPeriodo" name="ctl00$ContentPlaceHolder1$lstPeriodo">
        ${op('%', '< Seleccione >', estado.periodo === '%')}
        ${['01', '02', '03', '05'].map((p) => op(p, 'P' + p, p === estado.periodo)).join('')}
      </select>
      <select id="ctl00_ContentPlaceHolder1_lstCorte" name="ctl00$ContentPlaceHolder1$lstCorte">
        ${['1', '2', '3', '4'].map((c) => op(c, 'Corte ' + c, c === estado.corte)).join('')}
      </select>
      <input type="image" id="ctl00_ContentPlaceHolder1_btnDescarga" name="ctl00$ContentPlaceHolder1$btnDescarga" alt="Descargar Tabla">
      ${(conTabla && estado.curso !== '%' && estado.materia !== '%' && estado.periodo !== '%')
        ? htmlTabla(estado.curso, estado.periodo, nFilas, columnaExtra) : ''}`;
  }
  pintar();

  const evaluar = () => {
    w.document.getElementById('gla-hist')?.remove();   // simula la recarga
    w.eval(FUENTE);
  };
  evaluar();

  return {
    w, postbacks, clicks, estado,
    q: (s) => w.document.querySelector(s),
    log: () => [...w.document.querySelectorAll('#gh-log div')].map((d) => d.textContent).join('\n'),
    salida: () => JSON.parse(w.document.querySelector('#gh-salida').value || '{}'),
    /**
     * Una vuelta del navegador: el script postea, el "servidor" aplica el
     * cambio al select correspondiente, la página se redibuja y el script se
     * vuelve a inyectar.
     */
    async correr(maxVueltas = 400) {
      // Se lleva la cuenta de los postbacks YA atendidos en vez de comparar
      // contra el largo de antes de esperar: el primero se dispara mientras
      // todavía se resuelve el onclick, así que "no cambió desde que empecé a
      // esperar" daba verdadero en la primera vuelta y el recorrido cortaba
      // ahí, con un solo postback hecho.
      let atendidos = 0;
      let vueltas = 0;
      for (; vueltas < maxVueltas; vueltas++) {
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setTimeout(r, 0));
        if (postbacks.length === atendidos) break;   // ya no postea: terminó
        atendidos = postbacks.length;
        // Aplicar lo que el script acaba de elegir, como haría el servidor.
        const leer = (id) => w.document.getElementById(id);
        estado.curso = leer('ctl00_ContentPlaceHolder1_lstCurso').value;
        estado.periodo = leer('ctl00_ContentPlaceHolder1_lstPeriodo').value;
        estado.corte = leer('ctl00_ContentPlaceHolder1_lstCorte').value;
        estado.materia = leer('ctl00_ContentPlaceHolder1_lstMateria').value;
        pintar();
        evaluar();
      }
      return vueltas;
    },
  };
}

// La espera entre postbacks es real (1500 ms). En la prueba se acorta, porque
// lo que se verifica es la secuencia, no el reloj.
const acelerar = (p) => { p.w.setTimeout = (fn) => { fn(); return 0; }; };

console.log('Extractor de historial');

// ---------------------------------------------------------------- 1. Arranque
{
  console.log('\n[no hace nada solo]');
  const p = crearPantalla();
  eq(p.postbacks.length, 0, 'al cargar no dispara ni un postback');
  eq(p.clicks.length, 0, 'ni pulsa ningún control');
  ok(/recargas/.test(p.q('#gh-costo').textContent), 'y dice de antemano cuántas recargas va a costar');
  ok(/4 cursos × 2 periodo/.test(p.q('#gh-costo').textContent),
     'contando los cursos reales del desplegable y los periodos marcados');
}

// ------------------------------------------------- 2. El recorrido completo
{
  console.log('\n[recorre periodo por periodo, curso por curso]');
  const p = crearPantalla();
  acelerar(p);
  await p.q('#gh-ir').onclick();
  await p.correr();

  const s = p.salida();
  eq(s.cursos.length, 8, 'cubre las 8 combinaciones (4 cursos × 2 periodos)');
  eq(s.periodos, ['01', '02'], 'los dos periodos marcados por defecto, y no el actual');
  eq([...new Set(s.cursos.map((c) => c.curso))].sort(), ['1001', '1101', '801', '802'],
     'los cuatro cursos, sin el "%"');

  // El orden importa: agrupado por periodo es lo que ahorra postbacks.
  eq(s.cursos.map((c) => c.periodo), ['01', '01', '01', '01', '02', '02', '02', '02'],
     'agrupa por periodo en vez de alternar, que es lo que evita 19 postbacks de más');

  ok(p.clicks.length === 0, 'no pulsó ningún control de la plataforma');
  ok(!p.postbacks.includes('ctl00$ContentPlaceHolder1$btnDescarga'),
     'y nunca "Descargar Tabla": la tabla ya está en el DOM');
  ok(!p.postbacks.some((t) => /btnDescarga|Importar|Guardar/i.test(t)),
     'ni ningún control de descarga o escritura');
}

// --------------------------------------------------- 3. Lo que trae cada fila
{
  console.log('\n[lee la definitiva, y solo eso]');
  const p = crearPantalla();
  acelerar(p);
  await p.q('#gh-ir').onclick();
  await p.correr();

  const primero = p.salida().cursos[0];
  eq(primero.estudiantes.length, 3, 'tres estudiantes, sin contar el pie del GridView');
  eq(primero.estudiantes[0].cod_alum, codigoDe('801  ', 0), 'el código');
  eq(primero.estudiantes[0].definitiva, defDe('801  ', '01', 0), 'la definitiva, con la coma ya convertida');
  eq(Object.keys(primero.estudiantes[0]).sort(), ['cod_alum', 'definitiva', 'nombre'],
     'y nada más: ni categorías, ni fallas, ni retardos');
  eq(p.salida().campos, ['cod_alum', 'nombre', 'definitiva'], 'el JSON declara qué trae');

  // Cada combinación con su propia definitiva: si el recorrido repitiera una
  // pantalla, saldrían valores iguales donde deberían diferir.
  const porCombo = p.salida().cursos.map((c) => c.estudiantes[0].definitiva);
  eq(new Set(porCombo).size, porCombo.length,
     'cada combinación trae datos propios: no repite una pantalla ni se saltea otra');
}

// ------------------------------------------------ 4. Cuántas recargas cuesta
{
  console.log('[el costo prometido se cumple]');
  const p = crearPantalla();
  acelerar(p);
  await p.q('#gh-ir').onclick();
  await p.correr();
  // 2 periodos × (4 cursos + 1 para fijar el periodo) = 10. El corte ya estaba.
  ok(p.postbacks.length <= 10,
     `no gasta más recargas que las anunciadas (fueron ${p.postbacks.length}, tope 10)`);
  ok(p.postbacks.filter((t) => /lstPeriodo/.test(t)).length === 2,
     'fija el periodo una vez por periodo, no una vez por curso');
}

// ------------------------------------------------------ 5. "< TODOS >" jamás
{
  console.log('\n[nunca selecciona "< TODOS >"]');
  const p = crearPantalla();
  acelerar(p);
  await p.q('#gh-ir').onclick();
  await p.correr();
  const cursoSel = p.w.document.getElementById('ctl00_ContentPlaceHolder1_lstCurso');
  ok(cursoSel.value !== '%', 'el curso nunca queda en "%"');
  ok(!p.salida().cursos.some((c) => c.curso === '%'), 'ni aparece en el resultado');
  ok(!/nunca se selecciona/.test(p.log()), 'y la guarda del código no tuvo que saltar');
}

// --------------------------------------- 6. Un curso sin notas no rompe nada
{
  console.log('\n[un curso sin tabla se anota y sigue]');
  const p = crearPantalla({ conTabla: false });
  acelerar(p);
  await p.q('#gh-ir').onclick();
  await p.correr();
  const s = p.salida();
  eq(s.cursos.length, 0, 'no inventa estudiantes donde no hay tabla');
  ok(s.errores.length > 0, 'lo deja anotado en errores[]');
  ok(/no hay tabla/.test(s.errores[0].motivo), 'diciendo qué pasó');
  ok(/Sigo/.test(p.log()), 'y sigue con la siguiente en vez de abortar la corrida');
}

// ------------------------------------- 7. Las columnas, por nombre no por sitio
{
  console.log('\n[las columnas se buscan por encabezado, no por posición]');
  const normal = crearPantalla();
  acelerar(normal);
  await normal.q('#gh-ir').onclick();
  await normal.correr();
  const esperado = normal.salida().cursos[0].estudiantes;

  // Misma pantalla, con una columna "Nº" agregada al principio.
  const corrida = crearPantalla({ columnaExtra: true });
  acelerar(corrida);
  await corrida.q('#gh-ir').onclick();
  await corrida.correr();
  const obtenido = corrida.salida().cursos[0].estudiantes;

  eq(obtenido, esperado,
     'una columna nueva al principio no corre la lectura: mismos códigos y mismas definitivas');
  eq(obtenido[0].definitiva, defDe('801  ', '01', 0),
     'y la definitiva sigue siendo la de su columna, no la de al lado');
}

// ------------------------------------------------ 8. Reglas sobre el fuente
{
  console.log('\n[reglas del encargo, sobre el código fuente]');
  const sinComentarios = FUENTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(/ESPERA_MS\s*=\s*(\d{4,})/.test(sinComentarios) &&
     Number(/ESPERA_MS\s*=\s*(\d+)/.exec(sinComentarios)[1]) >= 1000,
     'la espera entre postbacks es de al menos 1000 ms');
  ok(/MAX_INTENTOS/.test(sinComentarios), 'hay tope de reintentos por combinación');
  ok(/MAX_CARGAS/.test(sinComentarios), 'hay cortafuegos contra bucles de recarga');
  ok(/postbackEnVuelo/.test(sinComentarios), 'hay guarda contra dos postbacks simultáneos');
  ok(!/btnDescarga[^)]*click|click\(\)/.test(sinComentarios), 'no pulsa nada por código');
  ok(!/\.submit\(/.test(sinComentarios), 'no envía el formulario a mano');
  ok(/valor === '%'/.test(sinComentarios), 'la guarda contra "< TODOS >" está en el código, no solo en la prueba');
}

console.log(fallos === 0 ? '\n✓ todo verde' : `\n${fallos} FALLARON`);
process.exit(fallos ? 1 : 0);
