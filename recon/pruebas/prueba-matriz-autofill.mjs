/*
 * Pruebas del ayudante que LLENA la matriz (831).
 *
 * Este es el segundo camino de escritura del repo, después de la asistencia,
 * así que lo primero que hay que garantizar no es que escriba bien: es que NO
 * escriba donde no debe. En orden:
 *
 *   1. Al cargar no dispara nada, ni con un plan pegado.
 *   2. Si la pantalla no dice lo que el plan cree, esa fila no se toca.
 *   3. Solo puede disparar Edit$N y Update$N de la tabla, nada más.
 *   4. El porcentaje se escribe en su casilla o no se escribe: se comprueba
 *      contra lo que el plan dice que hay, porque la casilla es posicional.
 *   5. Los tres ids internos de la fila quedan intactos.
 *
 * El arnés reproduce la pantalla de verdad: la fila se abre con "Editar" (un
 * postback), y recién ahí aparecen los cinco inputs sin id y se destraban los
 * selects.
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const FUENTE = readFileSync(new URL('../../actividades-autofill.user.js', import.meta.url), 'utf8');

let fallos = 0;
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✗ FALLA ') + m); if (!c) fallos++; };
const eq = (g, w, m) => { const i = JSON.stringify(g) === JSON.stringify(w);
  ok(i, `${m}${i ? '' : ` (esperado ${JSON.stringify(w)}, obtenido ${JSON.stringify(g)})`}`); };

const ENC = ['', 'Meta de comprensión', 'Descripción General', 'Descripción',
             '', '', '', 'Porcentaje', '', 'Ciclo', 'Destino'];

const CICLOS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
const DESTINOS = [['1', 'Casa'], ['2', 'Clase'], ['3', 'Casa-Clase']];

/** La matriz como la trae la plataforma: dos metas, con una casilla sin usar. */
const filasIniciales = () => ([
  { meta: 'CONOCIMIENTO', desc: 'T3 - C4. ALGORITMOS', pct: 60, ciclo: '1', destino: 'Clase' },
  { meta: 'CONOCIMIENTO', desc: 'ACT.2',               pct: 0,  ciclo: '',  destino: '' },
  { meta: 'CONOCIMIENTO', desc: 'T3 - C5. VARIABLES',  pct: 40, ciclo: '2', destino: 'Casa' },
  { meta: 'EVA. TRIMESTRAL', desc: 'T3 – C7. EVALUACION', pct: 100, ciclo: '3', destino: 'Clase' },
]);

function crear({ curso = '801  ', idsDeMenos = false, pctCorrido = false } = {}) {
  const dom = new JSDOM('<!doctype html><body><form id="aspnetForm" name="aspnetForm"></form></body>',
    { url: 'https://x/arrayanes/2026/Seguro/DefActividadDocentePorcMatriz.aspx', runScripts: 'outside-only' });
  const w = dom.window;
  const postbacks = [];
  w.__doPostBack = (t, a) => postbacks.push(`${t}|${a}`);
  w.setTimeout = (fn) => { fn(); return 0; };
  w.navigator.clipboard = { writeText: async () => {} };

  const est = { filas: filasIniciales(), editando: null };
  const op = (v, t, s) => `<option value="${v}"${s ? ' selected' : ''}>${t}</option>`;

  function fila(f, i) {
    const n = `ctl00$ContentPlaceHolder1$gvActividades$ctl${String(i + 2).padStart(2, '0')}`;
    const edit = est.editando === i;
    // Los cinco inputs sin id, en el orden de la plataforma: id de actividad,
    // cod_mat, id del logro, PORCENTAJE y rótulo.
    const sueltos = edit
      ? (idsDeMenos
          // Una plantilla con menos casillas: el porcentaje ya no es el cuarto.
          ? `<td><input type="text" name="${n}$ctl02" value="298${i}"></td><td>1035</td><td>1137${i}</td>`
          : `<td><input type="text" name="${n}$ctl02" value="298${i}"></td>
             <td><input type="text" name="${n}$ctl03" value="1035"></td>
             <td><input type="text" name="${n}$ctl04" value="1137${i}"></td>`)
      : `<td>298${i}</td><td>1035</td><td>1137${i}</td>`;
    const celdaPct = edit
      // Con una columna de más, el cuarto input deja de ser el porcentaje.
      ? `<input type="text" name="${n}$ctl05" value="${pctCorrido ? '99999' : f.pct}">`
      : String(f.pct);
    const celdaDesc = edit
      ? `<textarea name="${n}$descripcion">${f.desc}</textarea>`
      : `${f.desc} <textarea name="${n}$descripcion" readonly>${f.desc}</textarea>`;
    const rotulo = edit ? `<input type="text" name="${n}$ctl06" value="ACT.${i + 1}">` : `Act.${i + 1}`;
    const sel = (sufijo, opciones, valor) =>
      `<select name="${n}$${sufijo}"${edit ? '' : ' disabled'}>` +
      `<option value="">—</option>` +
      opciones.map(([v, t]) => op(v, t, t === valor)).join('') + '</select>';
    return `<tr>
      <td><a href="javascript:__doPostBack('ctl00$ContentPlaceHolder1$gvActividades','${edit ? 'Update' : 'Edit'}$${i}')">${edit ? 'Actualizar' : 'Editar'}</a></td>
      <td>${f.meta}</td><td>Act.${i + 1}</td><td>${celdaDesc}</td>
      ${sueltos}
      <td>${celdaPct}</td><td>${rotulo}</td>
      <td>${sel('lstCiclo', CICLOS.map((c) => [c, c]), f.ciclo)}</td>
      <td>${sel('lstDestino', DESTINOS, f.destino)}</td>
    </tr>`;
  }

  function pintar() {
    w.document.getElementById('aspnetForm').innerHTML = `
      <select id="ctl00_ContentPlaceHolder1_lstCurso" name="ctl00$ContentPlaceHolder1$lstCurso">
        ${op(curso, curso, true)}</select>
      <select id="ctl00_ContentPlaceHolder1_lstMateria" name="ctl00$ContentPlaceHolder1$lstMateria">
        ${op('1035', 'Information Technology', true)}</select>
      <select id="ctl00_ContentPlaceHolder1_lstPeriodo"><option value="03" selected>TERCERO</option></select>
      <table id="ctl00_ContentPlaceHolder1_gvActividades">
        <thead><tr>${ENC.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${est.filas.map(fila).join('')}
        <tr><td colspan="11">Total</td></tr></tbody></table>`;
  }
  pintar();
  const evaluar = () => { w.document.getElementById('gla-matriz')?.remove(); w.eval(FUENTE); };
  evaluar();

  const $ = (s) => w.document.querySelector(s);

  return {
    w, postbacks, est, $,
    pegar(plan) { $('#gm-plan').value = JSON.stringify(plan); },
    revisar() { $('#gm-revisar').click(); },
    aplicar() { $('#gm-aplicar').click(); },
    detalle: () => $('#gm-detalle').textContent,
    log: () => [...w.document.querySelectorAll('#gm-log div')].map((d) => d.textContent).join('\n'),
    /** Atiende UN postback, para poder mirar la fila mientras está abierta. */
    async paso() { await this.correr(1); },
    /** Atiende los postbacks como lo haría la plataforma. */
    async correr(max = 60) {
      let atendidos = 0;
      for (let v = 0; v < max; v++) {
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setTimeout(r, 0));
        if (postbacks.length === atendidos) break;
        atendidos = postbacks.length;
        const ultimo = postbacks[postbacks.length - 1];
        const m = /\|(Edit|Update)\$(\d+)$/.exec(ultimo);
        if (!m) break;
        const i = Number(m[2]);
        if (m[1] === 'Edit') {
          est.editando = i;
        } else {
          // Guardar: la plataforma se queda con lo que traen los controles.
          const tr = w.document.querySelectorAll('#ctl00_ContentPlaceHolder1_gvActividades tbody tr')[i];
          const val = (sel) => { const e = tr.querySelector(sel); return e ? e.value : ''; };
          const texto = (sel) => {
            const e = tr.querySelector(sel);
            return e && e.selectedOptions[0] ? e.selectedOptions[0].text : '';
          };
          est.filas[i] = {
            meta: est.filas[i].meta,
            desc: val('textarea'),
            pct: Number(val('input[name$="$ctl05"]')),
            ciclo: texto('select[name$="lstCiclo"]'),
            destino: texto('select[name$="lstDestino"]'),
          };
          est.editando = null;
        }
        pintar(); evaluar();
      }
    },
  };
}

// Un plan como el que arma la app.
const plan = (cambios) => ({
  generadoEn: 'X', trimestre: 3,
  grados: [{ grado: 8, cursos: ['801'], cambios }],
});
const cambio = (meta, posicion, antes, despues) => ({
  meta, posicion,
  antes: { descripcion: antes[0], porcentaje: antes[1], ciclo: antes[2], destino: antes[3] },
  despues: { descripcion: despues[0], porcentaje: despues[1], ciclo: despues[2], destino: despues[3] },
  campos: ['título'],
});

console.log('Ayudante de la matriz de actividades');

console.log('\n[la guarda estructural, en el código]');
{
  /*
   * Estas dos no se ven corriendo el script: son la red para el día en que
   * alguien agregue un paso y se equivoque de control. Si el postback saliera
   * de varios lugares, o si la lista blanca desapareciera, no habría nada que
   * impidiera disparar "Descargar Tabla" o el selector de curso.
   */
  const llamadas = (FUENTE.match(/__doPostBack\s*\(/g) || []).length;
  eq(llamadas, 1, 'hay UNA sola llamada a __doPostBack en todo el script: la que verifica');
  ok(/PERMITIDOS\.has\(nombreCtrl\)/.test(FUENTE), 'la lista blanca de controles está en el código');
  ok(/COMANDO\.test\(comando\)/.test(FUENTE), 'y la de comandos también: solo Edit$N y Update$N');
  ok(/PERMITIDOS = new Set\(\[TABLA\]\)/.test(FUENTE),
     'y lo único permitido es la tabla: ni Consultar, ni el curso, ni Descargar');
}

console.log('\n[no escribe solo, que es lo primero]');
{
  const p = crear();
  eq(p.postbacks.length, 0, 'al cargar no dispara nada');
  p.pegar(plan([cambio('CONOCIMIENTO', 1, ['T3 - C4. ALGORITMOS', 60, '1', 'Clase'],
                                          ['T3 - C4. OTRO', 60, '1', 'Clase'])]));
  await new Promise((r) => setImmediate(r));
  eq(p.postbacks.length, 0, 'con el plan pegado tampoco: hace falta Revisar');
  p.revisar();
  await p.correr();
  eq(p.postbacks.length, 0, 'y Revisar no escribe: solo mira');
  ok(/1 fila\(s\) a cambiar/.test(p.detalle()), 'pero dice qué haría');
}

console.log('\n[si la pantalla no coincide, no se toca]');
{
  const p = crear();
  p.pegar(plan([
    // la app cree que hay 50%, la pantalla tiene 60%
    cambio('CONOCIMIENTO', 1, ['T3 - C4. ALGORITMOS', 50, '1', 'Clase'],
                              ['T3 - C4. OTRO', 50, '1', 'Clase']),
    // esta sí coincide
    cambio('CONOCIMIENTO', 3, ['T3 - C5. VARIABLES', 40, '2', 'Casa'],
                              ['T3 - C5. VARIABLES', 40, '2', 'Clase']),
  ]));
  p.revisar();
  ok(/1 sin tocar/.test(p.detalle()), 'la fila que no coincide queda fuera');
  ok(/la pantalla dice/.test(p.detalle()), 'y se dice qué encontró en su lugar');
  p.aplicar();
  await p.correr();
  eq(p.est.filas[0].desc, 'T3 - C4. ALGORITMOS', 'la fila que no coincidía quedó intacta');
  eq(p.est.filas[0].pct, 60, 'con su porcentaje de antes');
  eq(p.est.filas[2].destino, 'Clase', 'y la que sí coincidía se escribió');
}

console.log('\n[una fila que el plan nombra y no está]');
{
  const p = crear();
  p.pegar(plan([cambio('CONOCIMIENTO', 9, ['X', 10, '1', 'Casa'], ['Y', 10, '1', 'Casa'])]));
  p.revisar();
  ok(/no está en la pantalla/.test(p.detalle()), 'se dice, no se inventa');
  eq(p.$('#gm-aplicar').disabled, true, 'y no hay nada que aplicar');
}

console.log('\n[escribir de verdad]');
{
  const p = crear();
  p.pegar(plan([
    cambio('CONOCIMIENTO', 1, ['T3 - C4. ALGORITMOS', 60, '1', 'Clase'],
                              ['T3 - C4. CONDICIONALES', 70, '4', 'Casa-Clase']),
    cambio('CONOCIMIENTO', 3, ['T3 - C5. VARIABLES', 40, '2', 'Casa'],
                              ['T3 - C5. VARIABLES', 30, '2', 'Casa']),
  ]));
  p.revisar();
  p.aplicar();
  await p.correr();
  eq(p.est.filas[0], { meta: 'CONOCIMIENTO', desc: 'T3 - C4. CONDICIONALES', pct: 70,
                       ciclo: '4', destino: 'Casa-Clase' }, 'la primera fila quedó con los cuatro campos');
  eq(p.est.filas[2].pct, 30, 'y la otra con su porcentaje nuevo');
  eq(p.est.filas[1].desc, 'ACT.2', 'la casilla sin usar del medio no se tocó');
  eq(p.est.filas[3].pct, 100, 'ni la evaluación trimestral, que no estaba en el plan');
  ok(/Listo: 2 fila/.test(p.log()), 'y lo dice al terminar');

  const comandos = p.postbacks.map((s) => s.split('|')[1]);
  eq(comandos, ['Edit$0', 'Update$0', 'Edit$2', 'Update$2'],
     'abre y guarda cada fila, una por vez y en orden');
  ok(p.postbacks.every((s) => s.startsWith('ctl00$ContentPlaceHolder1$gvActividades|')),
     'y nunca dispara otro control: ni Consultar, ni el curso, ni Descargar');
}

console.log('\n[estrenar una casilla sin usar]');
{
  const p = crear();
  p.pegar(plan([cambio('CONOCIMIENTO', 2, ['', 0, '', ''],
                                          ['T3 - C6. NUEVA', 0, '5', 'Casa'])]));
  p.revisar();
  ok(/1 fila\(s\) a cambiar/.test(p.detalle()),
     'una casilla sin estrenar se empareja con el "antes" vacío');
  p.aplicar();
  await p.correr();
  eq(p.est.filas[1].desc, 'T3 - C6. NUEVA', 'y se llena');
  eq(p.est.filas[1].ciclo, '5', 'con su ciclo');
}

console.log('\n[lo que ya está como el plan lo quiere]');
{
  const p = crear();
  p.pegar(plan([cambio('CONOCIMIENTO', 1, ['T3 - C4. ALGORITMOS', 60, '1', 'Clase'],
                                          ['T3 - C4. ALGORITMOS', 60, '1', 'Clase'])]));
  p.revisar();
  ok(/1 ya están así/.test(p.detalle()), 'se reconoce y no se reescribe');
  eq(p.$('#gm-aplicar').disabled, true, 'no hay nada que aplicar');
}

console.log('\n[los ids internos de la fila quedan intactos]');
{
  const p = crear();
  p.pegar(plan([cambio('CONOCIMIENTO', 1, ['T3 - C4. ALGORITMOS', 60, '1', 'Clase'],
                                          ['T3 - C4. OTRO', 70, '1', 'Clase'])]));
  p.revisar(); p.aplicar();
  // Un solo paso: la plataforma atiende el "Editar" y deja la fila abierta.
  // El ayudante la llena en el acto, así que acá se ve tal como la va a guardar.
  await p.paso();
  const tr = p.w.document.querySelectorAll('#ctl00_ContentPlaceHolder1_gvActividades tbody tr')[0];
  const ids = [...tr.querySelectorAll('input[type=text]')].slice(0, 3).map((i) => i.value);
  eq(ids, ['2980', '1035', '11370'],
     'los tres identificadores de la fila siguen como los puso la plataforma');
  eq(tr.querySelector('textarea').value, 'T3 - C4. OTRO',
     'el título ya está escrito, así que la fila SÍ se llenó: los ids quedaron por decisión, no por casualidad');
  await p.correr();
  const tr2 = p.w.document.querySelectorAll('#ctl00_ContentPlaceHolder1_gvActividades tbody tr')[0];
  ok(/2980/.test(tr2.textContent) && /11370/.test(tr2.textContent),
     'y después de guardar también: la app nunca los inventa ni los pisa');
}

console.log('\n[la casilla del porcentaje es posicional, así que se comprueba]');
{
  // La plataforma cambia la plantilla y el porcentaje deja de ser el cuarto
  // input. Antes de escribir un porcentaje encima de un id, el ayudante para.
  const p = crear({ pctCorrido: true });
  p.pegar(plan([cambio('CONOCIMIENTO', 1, ['T3 - C4. ALGORITMOS', 60, '1', 'Clase'],
                                          ['T3 - C4. OTRO', 70, '1', 'Clase'])]));
  p.revisar(); p.aplicar();
  await p.correr();
  ok(/no escribo a ciegas/.test(p.log()), 'lo dice en vez de escribir');
  eq(p.est.filas[0].desc, 'T3 - C4. ALGORITMOS', 'y la fila queda intacta');
  eq(p.postbacks.map((s) => s.split('|')[1]), ['Edit$0'],
     'abrió la fila pero NUNCA disparó el Actualizar');

  const q = crear({ idsDeMenos: true });
  q.pegar(plan([cambio('CONOCIMIENTO', 1, ['T3 - C4. ALGORITMOS', 60, '1', 'Clase'],
                                          ['T3 - C4. OTRO', 70, '1', 'Clase'])]));
  q.revisar(); q.aplicar();
  await q.correr();
  eq(q.est.filas[0].pct, 60, 'con menos casillas de las esperadas tampoco escribe');
  ok(/esperaba al menos 4 casillas/.test(q.log()),
     'y dice por qué, en vez de reventar con un error de programación');
}

console.log('\n[un destino que la fila no ofrece]');
{
  const p = crear();
  p.pegar(plan([cambio('CONOCIMIENTO', 1, ['T3 - C4. ALGORITMOS', 60, '1', 'Clase'],
                                          ['T3 - C4. OTRO', 60, '1', 'Patio'])]));
  p.revisar(); p.aplicar();
  await p.correr();
  ok(/no es una opción/.test(p.log()), 'no se inventa una opción que no está');
  eq(p.est.filas[0].destino, 'Clase', 'y la fila queda como estaba');
}

console.log(fallos ? `\n✗ ${fallos} fallaron` : '\n✓ todo en verde');
process.exit(fallos ? 1 : 0);
