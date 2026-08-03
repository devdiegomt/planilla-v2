/*
 * Pruebas del userscript de asistencia, sobre un DOM real (jsdom) que replica
 * AsistenciaAsignaturaAusenciaDia.aspx: mismos ids, mismos name de GridView,
 * mismos encabezados y el mismo grupo de radios por fila.
 *
 * Requiere:  npm install jsdom
 *
 * No hay copia del código: se evalúa asistencia-autofill.user.js tal cual, y
 * "recargar la página" se simula volviéndolo a evaluar sobre la misma ventana,
 * que es exactamente lo que hace el navegador con sessionStorage intacto.
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const FUENTE = readFileSync(new URL('../../asistencia-autofill.user.js', import.meta.url), 'utf8');

let fallos = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✔ ' : '  ✗ FALLA ') + msg); if (!cond) fallos++; };

const ENCABEZADOS = ['', 'Curso', 'Codigo', 'Nombre', 'Retardo Justificado', 'Retardo Injustificado',
  'Ausencia Justificada', 'Ausencia Injustificada', 'Salida Temprano', 'Hora de clases',
  'Compromiso y Acción de mejora', 'Primera Clase', '', '', 'Ausencia Dia', 'Observación',
  'Observación general', 'Falla Ruta AM', 'Monitora'];

// Los cuatro estados en el orden de columna real, con el value que emite el
// servidor. Ojo: checkretardo_J vive bajo "Retardo Injustificado".
const RADIOS_ESTADO = ['checkretardo', 'checkretardo_J', 'checkausenciaj', 'checkausenciaIn'];

const codigoDe = (i) => String(2019034000 + i * 7);

function htmlFila(i, { valoresIntercambiados = false } = {}) {
  const ctl = 'ctl' + String(i + 2).padStart(2, '0');
  const n = `ctl00$ContentPlaceHolder1$gvDatos$${ctl}`;
  // El caso trampa: mismos encabezados pero los values de las dos primeras
  // columnas cambiados de lugar.
  const vals = valoresIntercambiados
    ? ['checkretardo_J', 'checkretardo', 'checkausenciaj', 'checkausenciaIn']
    : RADIOS_ESTADO;
  const radio = (v) => `<input type="radio" name="${n}$radio" value="${v}" id="${v}">`;
  return `<tr>
    <td><a href="javascript:__doPostBack('ctl00$ContentPlaceHolder1$gvDatos','Select$${i}')">Desmarcar</a></td>
    <td>801</td><td>${codigoDe(i)}</td><td>APELLIDO APELLIDO NOMBRE ${i}</td>
    <td>${radio(vals[0])}</td><td>${radio(vals[1])}</td>
    <td>${radio(vals[2])}</td><td>${radio(vals[3])}</td>
    <td><input type="radio" name="${n}$radioq" value="checksalidaT" disabled></td>
    <td><select name="${n}$lstUniformes"><option value="0">&lt;SELECCIONE&gt;</option><option value="3">Tercera Hora</option></select></td>
    <td><input type="text" name="${n}$observacion"></td>
    <td><input type="radio" name="${n}$chkPrimeraClase" value="chkPrimeraClase"></td>
    <td>1</td><td>${630770 + i}</td>
    <td><input type="radio" name="${n}$aus" value="chkAusenciaDia" disabled></td>
    <td><textarea name="${n}$txtjustificacion"></textarea></td>
    <td><textarea name="${n}$txtjustificacion2" readonly></textarea></td>
    <td><input type="radio" name="${n}$checkfalla_ruta_am" value="checkfalla_ruta_am" disabled></td>
    <td></td></tr>`;
}

function htmlTabla(nFilas, opciones) {
  const ths = ENCABEZADOS.map((h) => `<th>${h}</th>`).join('');
  const trs = Array.from({ length: nFilas }, (_, i) => htmlFila(i, opciones)).join('');
  return `<table id="gvDatos" class="table table-bordered"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
}

const CURSOS = ['801  ', '802  ', '901  ', '1001 ', '1101 '];

/* El menu vive en la master page y es lo unico que la portada comparte con la
   pantalla de asistencia. Es de donde el script saca titulo, id y pageNum. */
const MENU = `<ul id="main-menu-navigation"><li><a href="#">Asistencia</a><ul>
  <li><span onclick="SessionEntrar('Asistencia diaria por asignatura','899','AsistenciaAsignaturaAusenciaDia.aspx')">Asistencia diaria por asignatura</span></li>
  </ul></li></ul>`;

function nuevaPagina({ nFilas = 28, fecha = '30/07/2026 12:24:41 p. m.', opcionesFila = {},
  sinTampermonkey = false, enLaPortada = false, sinEnElMenu = false } = {}) {
  const opCursos =['<option value="%">&lt;SELECCIONAR&gt;</option>']
    .concat(CURSOS.map((c) => `<option value="${c}">CURSO ${c.trim()}</option>`)).join('');
  const opHoras = ['0:&lt;SELECCIONE&gt;', '1:Primera Hora', '2:Segunda Hora', '3:Tercera Hora',
    '4:Cuarta Hora', '5:Quinta Hora', '6:Sexta Hora', '9:Séptima Hora']
    .map((s) => { const [v, t] = s.split(':'); return `<option value="${v}">${t}</option>`; }).join('');

  const controlesAsistencia = enLaPortada ? '' : `
      <select id="ctl00_ContentPlaceHolder1_DropDownHora" name="ctl00$ContentPlaceHolder1$DropDownHora">${opHoras}</select>
      <input type="text" id="ctl00_ContentPlaceHolder1_txtFecha" name="ctl00$ContentPlaceHolder1$txtFecha" value="${fecha}">
      <select id="ctl00_ContentPlaceHolder1_lstCursos" name="ctl00$ContentPlaceHolder1$lstCursos">${opCursos}</select>
      <select id="ctl00_ContentPlaceHolder1_lstMateria" name="ctl00$ContentPlaceHolder1$lstMateria">
        <option value="%">&lt;SELECCIONAR&gt;</option></select>
      <input type="checkbox" id="ctl00_ContentPlaceHolder1_chRegis" name="ctl00$ContentPlaceHolder1$chRegis">
      <input type="image" id="ctl00_ContentPlaceHolder1_ImageButton1" name="ctl00$ContentPlaceHolder1$ImageButton1" title="Salir">
      <input type="image" id="ctl00_ContentPlaceHolder1_ImageButton3" name="ctl00$ContentPlaceHolder1$ImageButton3" title="Guardar">
      <div class="table-responsive"><div></div></div>
      <div id="myModal" class="modal fade" aria-hidden="true">
        <div class="modal-body"><span id="ctl00_ContentPlaceHolder1_lblModalBody">Información procesada satisfactoriamente</span></div>
      </div>`;

  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    ${sinEnElMenu ? '' : MENU}
    <form id="aspnetForm" action="./AsistenciaAsignaturaAusenciaDia.aspx" method="post">
      <input type="hidden" name="__EVENTTARGET" id="__EVENTTARGET" value="">
      <input type="hidden" name="__EVENTARGUMENT" id="__EVENTARGUMENT" value="">
      <input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="ZmFrZQ==">
      ${controlesAsistencia}
    </form></body></html>`, { runScripts: 'outside-only', url: 'https://ejemplo.test/x/Seguro/AsistenciaAsignaturaAusenciaDia.aspx' });

  const w = dom.window;
  const postbacks = [];
  const clicks = [];

  // dormir() usa setTimeout; acortarlo mantiene las pruebas en segundos.
  // La espera real entre postbacks se verifica aparte, sobre la constante.
  w.setTimeout = (fn) => { Promise.resolve().then(fn); return 0; };

  // Tampermonkey expone GM_info incluso con @grant none. Sin él, el script
  // asume que lo pegaron en la consola y bloquea el flujo completo.
  if (!sinTampermonkey) w.GM_info = { script: { name: 'prueba', version: '0' } };

  w.__doPostBack = (control, arg) => {
    postbacks.push({ control, arg });
    // El servidor puebla la cascada de asignaturas al fijar el curso.
    if (control.endsWith('lstCursos')) {
      const m = w.document.getElementById('ctl00_ContentPlaceHolder1_lstMateria');
      m.innerHTML = '<option value="%">&lt;SELECCIONAR&gt;</option><option value="2508">Information Technology</option>';
    }
    // Y renderiza la lista de estudiantes al fijar la asignatura.
    if (control.endsWith('lstMateria')) {
      w.document.querySelector('.table-responsive').innerHTML = htmlTabla(nFilas, opcionesFila);
    }
  };
  // En la portada estos botones no existen todavía.
  const vigilarBotones = () => {
    w.document.getElementById('ctl00_ContentPlaceHolder1_ImageButton3')
      ?.addEventListener('click', () => clicks.push('guardar'));
    w.document.getElementById('ctl00_ContentPlaceHolder1_ImageButton1')
      ?.addEventListener('click', () => clicks.push('SALIR'));
  };
  vigilarBotones();

  /* SessionEntrar es la navegación del menú: acá "llegar" significa que la
     página pase a tener los controles de asistencia. */
  const navegaciones = [];
  w.SessionEntrar = (titulo, id, pageNum) => {
    navegaciones.push({ titulo, id, pageNum });
    w.document.querySelector('#aspnetForm').insertAdjacentHTML('beforeend', `
      <select id="ctl00_ContentPlaceHolder1_DropDownHora" name="ctl00$ContentPlaceHolder1$DropDownHora">${opHoras}</select>
      <input type="text" id="ctl00_ContentPlaceHolder1_txtFecha" name="ctl00$ContentPlaceHolder1$txtFecha" value="${fecha}">
      <select id="ctl00_ContentPlaceHolder1_lstCursos" name="ctl00$ContentPlaceHolder1$lstCursos">${opCursos}</select>
      <select id="ctl00_ContentPlaceHolder1_lstMateria" name="ctl00$ContentPlaceHolder1$lstMateria">
        <option value="%">&lt;SELECCIONAR&gt;</option></select>
      <input type="checkbox" id="ctl00_ContentPlaceHolder1_chRegis" name="ctl00$ContentPlaceHolder1$chRegis">
      <input type="image" id="ctl00_ContentPlaceHolder1_ImageButton1" name="ctl00$ContentPlaceHolder1$ImageButton1" title="Salir">
      <input type="image" id="ctl00_ContentPlaceHolder1_ImageButton3" name="ctl00$ContentPlaceHolder1$ImageButton3" title="Guardar">
      <div class="table-responsive"><div></div></div>
      <div id="myModal" class="modal fade" aria-hidden="true">
        <div class="modal-body"><span id="ctl00_ContentPlaceHolder1_lblModalBody">Información procesada satisfactoriamente</span></div>
      </div>`);
    vigilarBotones();
  };

  const evaluar = () => {
    w.document.getElementById('gla-asis')?.remove();  // simula la recarga
    w.eval(FUENTE);
  };
  evaluar();

  const q = (sel) => w.document.querySelector(sel);
  return {
    w, postbacks, clicks, evaluar, q, navegaciones,
    log: () => [...w.document.querySelectorAll('#ga-log div')].map((d) => d.textContent).join('\n'),
    tabla: () => w.document.getElementById('gvDatos'),
    marcados: () => [...w.document.querySelectorAll('#gvDatos input[type=radio]')]
      .filter((r) => r.checked && /\$radio$/.test(r.getAttribute('name'))),
    async preparar(entrada) {
      q('#ga-entrada').value = typeof entrada === 'string' ? entrada : JSON.stringify(entrada);
      await q('#ga-preparar').onclick();
    },
    // Cada postback del script corresponde a una recarga real de la página.
    async avanzar(vueltas = 6) {
      for (let i = 0; i < vueltas; i++) {
        const antes = postbacks.length;
        this.evaluar();
        await new Promise((r) => setImmediate(r));
        if (postbacks.length === antes) break;   // ya no postea: llegó a destino
      }
    },
  };
}

const ENTRADA_OK = {
  fecha: '30/07/2026', hora: 3, curso: '801', asignatura: 'INFORMATION TECHNOLOGY',
  marcas: [
    { cod_alum: codigoDe(0), tipo: 'falla' },
    { cod_alum: codigoDe(5), tipo: 'retardo' },
    { cod_alum: codigoDe(9), tipo: 'ausencia_justificada' },
  ],
};

// ====================================================================== 1
console.log('\n[validación de la entrada]');
{
  const p = nuevaPagina();
  const malos = [
    ['{ no es json', /parsear/i],
    [{ ...ENTRADA_OK, fecha: '2026-07-30' }, /DD\/MM\/AAAA/],
    [{ ...ENTRADA_OK, hora: 8 }, /hora/i],
    [{ ...ENTRADA_OK, curso: '' }, /curso/i],
    [{ ...ENTRADA_OK, asignatura: '' }, /asignatura/i],
    [{ ...ENTRADA_OK, curso: ['801', '802'] }, /un solo curso/i],
    [{ ...ENTRADA_OK, marcas: 'x' }, /lista/i],
    [{ ...ENTRADA_OK, marcas: [{ cod_alum: codigoDe(0), tipo: 'inventado' }] }, /desconocido/i],
    [{ ...ENTRADA_OK, marcas: [{ cod_alum: codigoDe(0), tipo: 'falla' }, { cod_alum: codigoDe(0), tipo: 'retardo' }] }, /dos veces/i],
    [{ ...ENTRADA_OK, marcas: [{ tipo: 'falla' }] }, /cod_alum/i],
  ];
  for (const [entrada, re] of malos) {
    await p.preparar(entrada);
    const texto = p.log();
    ok(re.test(texto) && p.postbacks.length === 0,
      `rechaza ${JSON.stringify(entrada).slice(0, 52)}… → ${re}`);
  }
  ok(p.postbacks.length === 0, 'ninguna entrada inválida disparó un postback');
}

// ====================================================================== 2
console.log('\n[hora 7 = Séptima Hora (value 9)]');
{
  const p = nuevaPagina();
  await p.preparar({ ...ENTRADA_OK, hora: 7, marcas: [] });
  await p.avanzar();
  ok(p.q('#ctl00_ContentPlaceHolder1_DropDownHora').value === '9', 'hora 7 selecciona el value "9"');
}

// ====================================================================== 3
console.log('\n[fecha: conserva la hora y el NBSP]');
{
  const p = nuevaPagina({ fecha: '30/07/2026 12:24:41 p. m.' });
  await p.preparar({ ...ENTRADA_OK, fecha: '15/08/2026', marcas: [] });
  await p.avanzar();
  const v = p.q('#ctl00_ContentPlaceHolder1_txtFecha').value;
  ok(v.startsWith('15/08/2026'), 'reemplaza la parte de fecha');
  ok(v === '15/08/2026 12:24:41 p. m.', 'conserva hora y NBSP intactos: ' + JSON.stringify(v));
  ok(v.charCodeAt(22) === 160, 'el NBSP sigue siendo NBSP (160), no un espacio normal');
}
{
  const p = nuevaPagina({ fecha: '30/07/2026 12:24:41 p. m.' });
  await p.preparar({ ...ENTRADA_OK, marcas: [] });   // misma fecha que ya está
  await p.avanzar();
  const postFecha = p.postbacks.filter((x) => x.control.endsWith('txtFecha'));
  ok(postFecha.length === 0, 'si la fecha ya es la pedida, no postea de más');
}

// ====================================================================== 4
console.log('\n[camino feliz: filtro → marcado → resumen]');
{
  const p = nuevaPagina();
  await p.preparar(ENTRADA_OK);
  await p.avanzar();

  ok(p.q('#ctl00_ContentPlaceHolder1_lstCursos').value === '801  ', 'curso con su padding real "801  "');
  ok(p.q('#ctl00_ContentPlaceHolder1_lstMateria').value === '2508', 'asignatura resuelta por texto, sin importar mayúsculas');
  ok(!!p.tabla(), 'la tabla se renderizó');
  ok(/Paso: CONFIRMAR/.test(p.q('#ga-paso').textContent), 'se detiene en CONFIRMAR (dry-run)');
  ok(p.clicks.length === 0, 'NO tocó Guardar por su cuenta');
  ok(p.q('#ga-guardar').disabled === false, 'habilita "Confirmar y guardar"');

  const m = p.marcados();
  ok(m.length === 3, `marcó exactamente 3 radios (marcó ${m.length})`);

  // Lo importante: que cada tipo caiga en la columna correcta.
  const porCodigo = new Map(m.map((r) => [r.closest('tr').cells[2].textContent.trim(), r]));
  ok(porCodigo.get(codigoDe(0))?.value === 'checkausenciaIn', 'falla → Ausencia Injustificada');
  ok(porCodigo.get(codigoDe(5))?.value === 'checkretardo_J', 'retardo → Retardo Injustificado (el value con _J)');
  ok(porCodigo.get(codigoDe(9))?.value === 'checkausenciaj', 'ausencia_justificada → Ausencia Justificada');

  // Y que la columna donde quedó marcado sea la que dice el encabezado.
  const idxDe = (r) => [...r.closest('tr').cells].findIndex((c) => c.contains(r));
  ok(ENCABEZADOS[idxDe(porCodigo.get(codigoDe(5)))] === 'Retardo Injustificado',
    'el radio de "retardo" está bajo el encabezado Retardo Injustificado');
  ok(ENCABEZADOS[idxDe(porCodigo.get(codigoDe(9)))] === 'Ausencia Justificada',
    'el radio de "ausencia_justificada" está bajo el encabezado Ausencia Justificada');

  ok(/3 × |1 × /.test(p.q('#ga-resumen').textContent), 'el resumen enumera los estados');
  ok(/28 estudiantes/.test(p.q('#ga-resumen').textContent), 'el resumen dice cuántos hay en la lista');
}

// ====================================================================== 5
console.log('\n[explícitos: los cuatro estados]');
{
  const p = nuevaPagina();
  await p.preparar({
    ...ENTRADA_OK,
    marcas: [
      { cod_alum: codigoDe(0), tipo: 'retardo_justificado' },
      { cod_alum: codigoDe(1), tipo: 'retardo_injustificado' },
      { cod_alum: codigoDe(2), tipo: 'ausencia_justificada' },
      { cod_alum: codigoDe(3), tipo: 'ausencia_injustificada' },
    ],
  });
  await p.avanzar();
  const vals = p.marcados()
    .sort((a, b) => a.closest('tr').cells[2].textContent.localeCompare(b.closest('tr').cells[2].textContent))
    .map((r) => r.value);
  ok(JSON.stringify(vals) === JSON.stringify(RADIOS_ESTADO),
    'los 4 tipos explícitos caen en sus 4 columnas: ' + JSON.stringify(vals));
}

// ====================================================================== 6
console.log('\n[guarda: cod_alum inexistente → no marca NADA]');
{
  const p = nuevaPagina();
  await p.preparar({
    ...ENTRADA_OK,
    marcas: [{ cod_alum: codigoDe(0), tipo: 'falla' }, { cod_alum: '9999999999', tipo: 'falla' }],
  });
  await p.avanzar();
  ok(/ABORTADO/.test(p.log()), 'aborta');
  ok(/9999999999/.test(p.log()), 'nombra el código que no encontró');
  ok(p.marcados().length === 0, 'no dejó ni una marca parcial');
  ok(p.clicks.length === 0, 'no guardó');
}

// ====================================================================== 7
console.log('\n[guarda: la hora ya tiene asistencia → no toca nada]');
{
  const p = nuevaPagina();
  await p.preparar(ENTRADA_OK);
  await p.avanzar();
  // Simulo asistencia previa y rehago el marcado desde cero.
  p.marcados().forEach((r) => { r.checked = false; });
  const previo = p.tabla().querySelector('input[value="checkausenciaIn"]');
  previo.checked = true;
  p.w.sessionStorage.setItem('gla_asistencia_estado_v1', JSON.stringify({
    ...JSON.parse(p.w.sessionStorage.getItem('gla_asistencia_estado_v1')),
    paso: 'MARCAR', activa: true, marcasAplicadas: null,
  }));
  p.evaluar();
  await new Promise((r) => setImmediate(r));

  ok(/ABORTADO/.test(p.log()) && /YA tiene/.test(p.log()), 'aborta avisando que ya hay estados registrados');
  ok(p.marcados().length === 1, 'dejó intacto lo que ya estaba (1 marca previa, ninguna nueva)');
  ok(p.clicks.length === 0, 'no guardó');
}

// ====================================================================== 8
console.log('\n[guarda: encabezado y value en desacuerdo → aborta]');
{
  const p = nuevaPagina({ opcionesFila: { valoresIntercambiados: true } });
  await p.preparar(ENTRADA_OK);
  await p.avanzar();
  ok(/ABORTADO/.test(p.log()) && /desajuste/i.test(p.log()),
    'detecta que la columna y el value del radio no coinciden');
  ok(p.marcados().length === 0, 'no marcó nada con el mapeo sospechoso');
}

// ====================================================================== 9
console.log('\n[guardar solo con confirmación explícita]');
{
  const p = nuevaPagina();
  await p.preparar(ENTRADA_OK);
  await p.avanzar();
  ok(p.clicks.length === 0, 'antes de confirmar no hubo clic en Guardar');

  await p.q('#ga-guardar').onclick();
  ok(p.q('#ctl00_ContentPlaceHolder1_chRegis').checked, 'marcó "Registro de asistencia" antes de guardar');
  ok(p.clicks.join() === 'guardar', 'hizo clic en Guardar y en nada más');
  ok(!p.clicks.includes('SALIR'), 'nunca tocó Salir');

  p.evaluar();                                  // recarga posterior al guardado
  await new Promise((r) => setImmediate(r));
  ok(/verificado: 3\/3/.test(p.log()), 'verifica releyendo la tabla, no el texto del modal');
  ok(/Paso: TERMINADO/.test(p.q('#ga-paso').textContent), 'queda en TERMINADO');
}

// ===================================================================== 10
console.log('\n[el modal miente: dice "satisfactoriamente" aunque no se guarde]');
{
  const p = nuevaPagina();
  await p.preparar(ENTRADA_OK);
  await p.avanzar();
  await p.q('#ga-guardar').onclick();

  // El servidor "rechaza": la tabla vuelve sin las marcas. El modal sigue
  // teniendo su texto de éxito pre-renderizado en el HTML.
  p.marcados().forEach((r) => { r.checked = false; });
  ok(/satisfactoriamente/.test(p.q('#ctl00_ContentPlaceHolder1_lblModalBody').textContent),
    'el modal sigue diciendo "satisfactoriamente"');

  p.evaluar();
  await new Promise((r) => setImmediate(r));
  ok(/Verificación incompleta: 0\/3/.test(p.log()), 'NO reporta éxito: dice 0/3 confirmados');
  ok(/Revisá a mano/.test(p.log()), 'pide revisión manual');
}

// ===================================================================== 11
console.log('\n[abortar limpia el estado]');
{
  const p = nuevaPagina();
  await p.preparar(ENTRADA_OK);
  await p.avanzar();
  p.q('#ga-abortar').onclick();
  ok(p.w.sessionStorage.getItem('gla_asistencia_estado_v1') === null, 'sessionStorage queda limpio');
  p.evaluar();
  await new Promise((r) => setImmediate(r));
  ok(p.clicks.length === 0, 'tras abortar y recargar no retoma ni guarda');
}

// ===================================================================== 12
console.log('\n[pegado en la consola: no muere en silencio]');
{
  const p = nuevaPagina({ sinTampermonkey: true });
  ok(/No detecto Tampermonkey/.test(p.q('#ga-alerta').textContent), 'avisa que no está instalado');

  // El flujo completo recarga en cada paso; sin userscript no hay quién retome.
  p.q('#ga-entrada').value = JSON.stringify(ENTRADA_OK);
  await p.q('#ga-preparar').onclick();
  ok(p.postbacks.length === 0, 'el primer clic en flujo completo NO arranca');
  ok(/no parece estar instalado/i.test(p.log()), 'explica por qué');
  ok(/morir/i.test(p.q('#ga-preparar').textContent), 'el botón avisa que insistir lo va a matar');

  await p.q('#ga-preparar').onclick();   // insistir sí arranca
  ok(p.postbacks.length > 0, 'el segundo clic arranca igual: avisa, no prohíbe');
}

console.log('\n[modo "solo marcar": no depende de sobrevivir recargas]');
{
  const p = nuevaPagina({ sinTampermonkey: true });
  // El profesor filtra a mano: eso deja la tabla en pantalla.
  p.w.__doPostBack('ctl00$ContentPlaceHolder1$lstCursos', '');
  p.w.__doPostBack('ctl00$ContentPlaceHolder1$lstMateria', '');
  p.q('#ctl00_ContentPlaceHolder1_DropDownHora').value = '3';
  p.q('#ctl00_ContentPlaceHolder1_lstCursos').value = '801  ';
  p.q('#ctl00_ContentPlaceHolder1_lstMateria').value = '2508';
  const antes = p.postbacks.length;

  p.q('#ga-entrada').value = JSON.stringify(ENTRADA_OK);
  await p.q('#ga-solomarcar').onclick();

  ok(p.postbacks.length === antes, 'no tocó el filtro ni disparó un solo postback');
  ok(p.marcados().length === 3, 'marcó los 3 estados igual');
  ok(/Paso: CONFIRMAR/.test(p.q('#ga-paso').textContent), 'se detiene en CONFIRMAR');
  ok(p.clicks.length === 0, 'no guardó por su cuenta');

  await p.q('#ga-guardar').onclick();
  ok(p.clicks.join() === 'guardar', 'guarda con la confirmación, sin haber recargado nunca');
}

console.log('\n[solo marcar: la pantalla tiene que coincidir con el JSON]');
{
  const p = nuevaPagina({ sinTampermonkey: true });
  p.w.__doPostBack('ctl00$ContentPlaceHolder1$lstCursos', '');
  p.w.__doPostBack('ctl00$ContentPlaceHolder1$lstMateria', '');
  // El profesor dejó el 802 en pantalla pero el JSON habla del 801.
  p.q('#ctl00_ContentPlaceHolder1_DropDownHora').value = '3';
  p.q('#ctl00_ContentPlaceHolder1_lstCursos').value = '802  ';
  p.q('#ctl00_ContentPlaceHolder1_lstMateria').value = '2508';

  p.q('#ga-entrada').value = JSON.stringify(ENTRADA_OK);
  await p.q('#ga-solomarcar').onclick();

  ok(/ABORTADO/.test(p.log()) && /curso en pantalla/.test(p.log()),
    'aborta: no le marca al 802 lo que era del 801');
  ok(p.marcados().length === 0, 'no marcó nada');
}
{
  const p = nuevaPagina({ sinTampermonkey: true });
  p.q('#ga-entrada').value = JSON.stringify(ENTRADA_OK);
  await p.q('#ga-solomarcar').onclick();
  ok(/ABORTADO/.test(p.log()) && /a mano primero/.test(p.log()),
    'sin tabla en pantalla, dice qué hacer en vez de fallar raro');
}

console.log('\n[la recarga se ve en el panel]');
{
  const p = nuevaPagina();
  await p.preparar(ENTRADA_OK);
  await p.avanzar();
  ok(/recarga #\d/.test(p.q('#ga-paso').textContent), 'el panel muestra el número de recarga');
  ok(/Retomo tras la recarga/.test(p.log()), 'cada recarga deja rastro en el log');
}

console.log('\n[la fecha es opcional: por defecto la de la plataforma]');
{
  const p = nuevaPagina({ fecha: '05/08/2026 07:15:00 a.\u00A0m.' });
  const { fecha, ...sinFecha } = ENTRADA_OK;
  await p.preparar(sinFecha);
  await p.avanzar();

  const postFecha = p.postbacks.filter((x) => x.control.endsWith('txtFecha'));
  ok(postFecha.length === 0, 'no postea la fecha');
  ok(p.q('#ctl00_ContentPlaceHolder1_txtFecha').value.startsWith('05/08/2026'),
    'deja intacta la de la plataforma');
  ok(/uso la de la plataforma → 05\/08\/2026/.test(p.log()), 'y lo dice en el log');
  ok(/Paso: CONFIRMAR/.test(p.q('#ga-paso').textContent), 'llega igual al dry-run');

  // La fecha real tiene que verse en el resumen: registrar en el dia
  // equivocado es de los errores mas dificiles de detectar despues.
  const resumen = p.q('#ga-resumen').textContent;
  ok(/05\/08\/2026/.test(resumen), 'el resumen muestra la fecha que va a quedar: ' + resumen.slice(0, 90));
  ok(/la de la plataforma/.test(resumen), 'y aclara de dónde salió');
}
{
  // Si la mandás, se sigue respetando: sirve para poner al día un día pasado.
  const p = nuevaPagina({ fecha: '05/08/2026 07:15:00 a.\u00A0m.' });
  await p.preparar({ ...ENTRADA_OK, fecha: '30/07/2026' });
  await p.avanzar();
  ok(p.q('#ctl00_ContentPlaceHolder1_txtFecha').value.startsWith('30/07/2026'),
    'una fecha explícita sigue fijándose');
  ok(!/la de la plataforma/.test(p.q('#ga-resumen').textContent),
    'y el resumen no dice que venga de la plataforma');
}
{
  const p = nuevaPagina();
  await p.preparar({ ...ENTRADA_OK, fecha: '2026-08-05' });
  ok(/DD\/MM\/AAAA/.test(p.log()) && /Omitila/.test(p.log()),
    'un formato inválido sigue rechazándose, y sugiere omitirla');
}

console.log('\n[cargar el JSON desde un archivo]');
{
  const p = nuevaPagina();
  const contenido = JSON.stringify(ENTRADA_OK);
  // Se simula el FileReader: en jsdom no hay archivos de verdad.
  const w = p.w;
  const original = w.FileReader;
  // Ojo: el mock usa w.setTimeout, no el de Node. El de la ventana está
  // acortado a un microtask, así que la espera de abajo es determinista.
  w.FileReader = class {
    readAsText() { this.result = contenido; w.setTimeout(() => this.onload && this.onload()); }
  };
  const entrada = p.q('#ga-archivo');
  Object.defineProperty(entrada, 'files',
    { value: [{ name: 'marcas.json', size: contenido.length }], configurable: true });
  entrada.onchange();
  await new Promise((r) => setImmediate(r));

  ok(p.q('#ga-entrada').value === contenido, 'el archivo llena el textarea');
  ok(/Cargado marcas\.json/.test(p.log()), 'y lo registra en el log');
  w.FileReader = original;

  // Un archivo no puede saltarse la validacion: es el mismo camino.
  await p.preparar(p.q('#ga-entrada').value);
  await p.avanzar();
  ok(p.marcados().length === 3, 'y de ahí sigue el flujo normal, con dry-run');
}

console.log('\n[arrancar desde la portada: primero llevar, después chequear]');
{
  const p = nuevaPagina({ enLaPortada: true });

  ok(/lanzador/.test(p.q('#gla-asis header .pt').textContent), 'el panel se presenta como lanzador');
  ok(/llevarme a Asistencia/.test(p.q('#ga-preparar').textContent),
    'y el botón lo dice: "' + p.q('#ga-preparar').textContent + '"');
  ok(p.q('#ga-solomarcar').style.display === 'none',
    'oculta "Solo marcar": en la portada no hay tabla que marcar');

  await p.preparar(ENTRADA_OK);
  ok(p.navegaciones.length === 1, 'navega una vez');
  ok(p.navegaciones[0].pageNum === 'AsistenciaAsignaturaAusenciaDia.aspx', 'a la pantalla de asistencia');
  ok(p.navegaciones[0].id === '899', 'con el id que sacó del menú, no uno inventado');
  ok(p.navegaciones[0].titulo === 'Asistencia diaria por asignatura', 'y el título del menú');
  ok(/Primero te llevo/.test(p.log()), 'lo anuncia antes de hacerlo');

  // Y desde ahí sigue el flujo normal, con su dry-run.
  await p.avanzar();
  ok(p.marcados().length === 3, 'al llegar marca los 3 estados');
  ok(/Paso: CONFIRMAR/.test(p.q('#ga-paso').textContent), 'y se detiene en el dry-run');
  ok(p.clicks.length === 0, 'sin guardar por su cuenta');
}

console.log('\n[la pantalla de asistencia sigue igual que antes]');
{
  const p = nuevaPagina();
  ok(!/lanzador/.test(p.q('#gla-asis header .pt').textContent), 'ahí el panel es el de siempre');
  ok(p.q('#ga-solomarcar').style.display !== 'none', 'con "Solo marcar" disponible');
  await p.preparar(ENTRADA_OK);
  ok(p.navegaciones.length === 0, 'y no navega: ya está donde tiene que estar');
}

console.log('\n[si la pantalla no está en el menú, lo dice]');
{
  const p = nuevaPagina({ enLaPortada: true, sinEnElMenu: true });
  await p.preparar(ENTRADA_OK);
  ok(p.navegaciones.length === 0, 'no navega a ciegas');
  ok(/no encuentro .*en tu menú/i.test(p.log()), 'explica por qué: ' +
    (p.log().split('\n').find((l) => /menú/i.test(l)) || ''));
}

console.log('\n[aterrizar en la pantalla equivocada no falla de forma rara]');
{
  // Sin controles de asistencia y con el estado ya avanzado: antes esto
  // terminaba en "no encuentro el campo de fecha", que no dice nada útil.
  const p = nuevaPagina({ enLaPortada: true });
  // Se siembra el estado a mano: si se usara preparar(), la navegación del
  // fixture ya habría puesto los controles y la guarda nunca se activaría.
  p.w.sessionStorage.setItem('gla_asistencia_estado_v1', JSON.stringify({
    activa: true, paso: 'SET_HORA', cfg: { ...ENTRADA_OK, fecha: null },
    intentos: {}, cargas: 0, registro: [], resumen: null,
  }));
  p.evaluar();
  await new Promise((r) => setImmediate(r));
  ok(/esperaba la pantalla de asistencia/.test(p.log()), 'dice qué esperaba y dónde está');
  ok(/Entrá por el menú/.test(p.log()), 'y qué hacer');
}

console.log('\n[reglas del encargo, sobre el código fuente]');
{
  ok(/const ESPERA_MS = (\d+)/.test(FUENTE) && Number(RegExp.$1) >= 1500,
    'la espera entre postbacks es de al menos 1500 ms');
  ok(/MAX_INTENTOS = [1-9]/.test(FUENTE), 'hay tope de reintentos por paso');
  ok(/MAX_CARGAS = \d+/.test(FUENTE), 'hay cortafuegos contra bucles de recarga');
  ok(!/ImageButton1[^\n]*click\(\)/.test(FUENTE), 'no hay ningún click programado sobre Salir');
  ok(/postbackEnVuelo/.test(FUENTE), 'hay guarda contra dos postbacks simultáneos');
}

console.log('\n' + (fallos ? '✗ ' + fallos + ' fallas' : '✓ todo verde'));
process.exit(fallos ? 1 : 0);
