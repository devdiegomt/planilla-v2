/*
 * Pruebas de las sondas de reconocimiento.
 *
 * Una sonda se pega en la consola de la plataforma del colegio, así que lo que
 * hay que garantizar es aburrido y no negociable: que NO escriba. Y como
 * `sonda-conscalifica` se declara de solo lectura, acá se comprueba de verdad
 * —corriéndola en un DOM falso— y no leyendo su comentario de cabecera.
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let fallos = 0;
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✗ FALLA ') + m); if (!c) fallos++; };
const eq = (g, w, m) => ok(JSON.stringify(g) === JSON.stringify(w),
  `${m}${JSON.stringify(g) === JSON.stringify(w) ? '' : ` (esperado ${JSON.stringify(w)}, obtenido ${JSON.stringify(g)})`}`);

const SONDA = 'recon/sonda-conscalifica.js';
const codigo = readFileSync(SONDA, 'utf8');

console.log('Sondas — solo lectura');

// --- 1. Nada que escriba, ni red ---
// Las otras sondas sí usan fetch a propósito (la de CSP lo mide, la del .xls
// baja el archivo para mirarlo). Esta se declara de solo lectura sobre el DOM,
// así que en esta el listón es más alto.
for (const prohibido of ['fetch(', 'XMLHttpRequest', '__doPostBack(', '.click(', '.submit(', 'dispatchEvent(']) {
  ok(!codigo.includes(prohibido), `no usa ${prohibido}`);
}

// --- 2. No se lleva datos que no le tocan ---
ok(/MASCARA_NOMBRES\s*=\s*true/.test(codigo), 'los nombres salen enmascarados por defecto');
ok(/VIEWSTATE/.test(codigo) && /omitido/.test(codigo), 'el VIEWSTATE se omite, solo va su tamaño');

// --- 3. Correrla contra una pantalla falsa ---
console.log('\nContra un DOM que imita la pantalla');

const pagina = `<!doctype html><html><body>
<form name="aspnetForm" id="aspnetForm" method="post" action="ConsCalificaDocentesGen.aspx">
  <input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="${'x'.repeat(5000)}">
  <input type="hidden" name="__EVENTTARGET" id="__EVENTTARGET" value="">
  <select name="ddlPeriodo" id="ddlPeriodo" onchange="javascript:__doPostBack('ddlPeriodo','')">
    <option value="01">Periodo 1</option><option value="02" selected>Periodo 2</option>
    <option value="03">Periodo 3</option><option value="04">Final</option>
  </select>
  <select name="ddlCorte" id="ddlCorte">
    <option value="U" selected>Único</option><option value="C1">Corte 1</option>
    <option value="C2">Corte 2</option><option value="EV">Evaluación</option>
  </select>
  <a id="lnkDescargar" href="javascript:__doPostBack('lnkDescargar','')">Descargar Tabla</a>
  <!-- El de la pantalla real: un input type=image, sin href ni onclick. -->
  <input type="image" id="btnDescarga" name="ctl00$ContentPlaceHolder1$btnDescarga" alt="Descargar Tabla">
  <table id="gvNotas">
    <tr><th>COD_ALUM</th><th>NOMBRE ALUMNO</th><th>P1</th><th>P2</th><th>P3</th><th>FINAL</th></tr>
    <tr><td>2019034387</td><td>ALGUIEN DE PRUEBA UNO</td><td>80</td><td>75</td><td>0</td><td>78</td></tr>
    <tr><td>2018044266</td><td>ALGUIEN DE PRUEBA DOS</td><td>90</td><td>85</td><td>0</td><td>88</td></tr>
    <tr><td>2021063533</td><td>ALGUIEN DE PRUEBA TRES</td><td>70</td><td>72</td><td>0</td><td>71</td></tr>
    <tr><td>2017004140</td><td>ALGUIEN DE PRUEBA CUATRO</td><td>95</td><td>91</td><td>0</td><td>93</td></tr>
  </table>
</form></body></html>`;

// `runScripts: 'outside-only'` es lo que hace que la sonda corra como en la
// consola del navegador: sin eso, `dom.window.eval` no le expone `location`,
// `document` ni `NodeFilter` como globales sueltos y la sonda revienta en su
// primera línea. No es 'dangerously' porque la página de prueba no trae
// <script> que haga falta ejecutar: el único código que corre es la sonda.
const dom = new JSDOM(pagina, {
  url: 'https://ejemplo/ConsCalificaDocentesGen.aspx',
  runScripts: 'outside-only',
});
// La sonda imprime; se silencia para que la salida de la prueba se lea.
dom.window.console = { log: () => {} };

// La promesa de la cabecera —"no modifica ni un solo campo"— medida y no
// leída.
//
// El HTML solo no alcanza: escribir `input.value = 'x'` cambia el campo pero
// NO el atributo, así que el `outerHTML` saldría idéntico y la prueba diría
// que todo bien. Por eso la foto lleva también el valor de cada control.
const foto = (w) => JSON.stringify({
  html: w.document.documentElement.outerHTML,
  valores: [...w.document.querySelectorAll('input, select, textarea')].map((e) => e.value),
});

const antes = foto(dom.window);
const r = dom.window.eval(codigo);
const despues = foto(dom.window);

ok(!!r, 'la sonda corre y devuelve algo');
ok(antes === despues, 'la página queda exactamente igual que antes de correrla');
eq(r.veredicto.hayTablaDeDatos, true, 'reconoce la tabla de notas');
eq(r.veredicto.tablaMasProbable.id, 'gvNotas', 'y señala cuál es');
eq(r.veredicto.apareceCodAlum, true, 'encuentra los códigos de 10 dígitos');
eq(r.diezDigitos.hallazgos[0].indiceColumna, 0, 'y dice en qué columna están');

// El botón: saber qué clase de cosa es decide todo lo que sigue.
eq(r.veredicto.quePareceElBotonDeDescarga.map(d => d.clase),
   ['postback de ASP.NET', 'envía el formulario (input type=image: postea name.x y name.y)'],
   'clasifica los dos disparadores, y no deja el input type=image en "desconocido"');

// Los filtros, que son la razón de usar esta pantalla y no las planillas.
const periodos = r.selects.find(s => s.id === 'ddlPeriodo');
eq(periodos.opciones.length, 4, 'lista los cuatro periodos');
eq(periodos.autoPostBack, true, 'y avisa que elegir periodo recarga la página');
eq(r.selects.find(s => s.id === 'ddlCorte').opciones.map(o => o.value), ['U','C1','C2','EV'],
   'y los cuatro cortes con sus valores');

// Privacidad, comprobada sobre la salida real y no sobre el código.
const viewstate = r.ocultos.find(h => h.name === '__VIEWSTATE');
eq(viewstate.largo, 5000, 'del VIEWSTATE reporta el tamaño');
ok(/^<omitido/.test(viewstate.valor), 'pero no su contenido');
const fila = r.tablas.find(t => t.id === 'gvNotas').muestraFilas[0];
ok(!/ALGUIEN/.test(JSON.stringify(r)), 'ningún nombre sale entero');
ok(fila.celdas[0] === '2019034387', 'y los códigos sí salen tal cual, que es lo que hay que ver');

// --- 3b. Corrida en la pantalla equivocada ------------------------------
// Diego la corrió en la portada y la sonda respondió "la tabla no está
// cargada": cierto, pero manda a cargar un curso en una pantalla que ni
// siquiera tiene selector de curso. Y tomó las entradas del menú por botones
// de descarga, porque se llaman "Importar/exportar…".
console.log('\nCorrida en la portada, no en la pantalla');

const portada = `<!doctype html><html><body>
<form name="aspnetForm" id="aspnetForm" method="post" action="./Default.aspx">
  <input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="${'x'.repeat(16772)}">
  <img id="ctl00_FotoMenu" class="IcoFoto" src="../Fotos/1099999999.jpg">
  <a id="1096" href="#">Importar/exportar planilla individual GLA</a>
  <span onclick="SessionEntrar('Importar/exportar planilla individual GLA', '1096', 'ReporteCalificaMatriz.aspx');">Importar/exportar planilla individual GLA</span>
</form></body></html>`;

const domPortada = new JSDOM(portada, {
  url: 'https://ejemplo/arrayanes/2026/Seguro/Default.aspx',
  runScripts: 'outside-only',
});
domPortada.window.console = { log: () => {} };
const rp = domPortada.window.eval(codigo);

eq(rp.pantallaEquivocada, true, 'avisa que esta no es la pantalla');
eq(rp.estoyEn, 'Default.aspx', 'y dice dónde está parada');
ok(/Consultas/.test(rp.comoLlegar || ''), 'dice por dónde entrar, con la sección del menú');
ok(/ConsCalificaDocentesGen/.test(rp.comoLlegar || ''), 'y nombra la pantalla');
ok(rp.veredicto === undefined,
   'y NO inventa un veredicto: mandar a "cargá un curso" en la portada es un consejo imposible');
ok(!('descargas' in rp),
   'ni toma las entradas del menú por botones de descarga');

// --- 3c. El número de la foto no es un COD_ALUM ------------------------
// La plataforma pone la foto del docente en el encabezado de TODAS las
// pantallas, y ese número también tiene 10 dígitos. Sin descartarlo, la sonda
// respondía "sí, hay COD_ALUM" en cualquier lado.
console.log('\nLa foto del encabezado no es un código de estudiante');

const conFoto = pagina.replace('<form ',
  '<img id="ctl00_FotoMenu" class="IcoFoto" src="../Fotos/1099999999.jpg"><form ');
const domFoto = new JSDOM(conFoto, {
  url: 'https://ejemplo/arrayanes/2026/Seguro/ConsCalificaDocentesGen.aspx',
  runScripts: 'outside-only',
});
domFoto.window.console = { log: () => {} };
const rf = domFoto.window.eval(codigo);

ok(!rf.diezDigitos.hallazgos.some(h => h.valor === '1099999999'),
   'el número de la foto no cuenta como código');
eq(rf.diezDigitos.descartados.map(d => d.valor), ['1099999999'],
   'pero queda a la vista, descartado y con el motivo');
ok(/foto/i.test(rf.diezDigitos.descartados[0].motivo), 'que dice por qué');
eq(rf.veredicto.apareceCodAlum, true,
   'y los códigos de verdad, los de la tabla, se siguen encontrando');

// --- 3d. Con "< TODOS >" la pantalla no dibuja nada -----------------------
// Corrida real: eligiendo "< TODOS >" gvDatos desaparece y solo quedan tablas
// de maquetado. El veredicto señalaba una de 6 filas y UNA columna como "la
// tabla de notas" y concluía que faltaba el COD_ALUM — diagnóstico equivocado
// a partir de una tabla que no era.
console.log('\nCon "< TODOS >" no hay tabla que leer');

const todos = `<!doctype html><html><body>
<form name="aspnetForm" id="aspnetForm" method="post" action="./ConsCalificaDocentesGen.aspx">
  <select name="lstCurso" id="ctl00_ContentPlaceHolder1_lstCurso">
    <option value="%" selected>&lt; TODOS &gt;</option>
    <option value="801  ">OCHOCIENTOS UNO</option>
  </select>
  <!-- Maquetado: muchas filas, una sola columna. No es una tabla de datos. -->
  <table><tr><td></td></tr><tr><td></td></tr><tr><td></td></tr>
         <tr><td></td></tr><tr><td></td></tr><tr><td></td></tr></table>
</form></body></html>`;

const domTodos = new JSDOM(todos, {
  url: 'https://ejemplo/arrayanes/2026/Seguro/ConsCalificaDocentesGen.aspx',
  runScripts: 'outside-only',
});
domTodos.window.console = { log: () => {} };
const rt = domTodos.window.eval(codigo);

eq(rt.veredicto.hayTablaDeDatos, false,
   'una tabla de 6 filas y 1 columna no es la tabla de notas');
ok(/TODOS/.test(rt.veredicto.siguiente),
   'y el consejo apunta al "< TODOS >", que es la causa real');
ok(!/emparejar por nombre/.test(rt.veredicto.siguiente),
   'en vez de deducir que falta el COD_ALUM de una tabla que no existe');

// --- 3e. La sonda genérica, en una pantalla que nunca vimos ---------------
// Es la que sirve para las que faltan (831, 803, 853). Lo que hay que
// garantizar es lo mismo: que no escriba, y que lo que informe sea cierto.
console.log('\nLa sonda genérica');

const GENERICA = 'recon/sonda-pantalla.js';
const generica = readFileSync(GENERICA, 'utf8');

for (const prohibido of ['fetch(', 'XMLHttpRequest', '__doPostBack(', '.click(', '.submit(', 'dispatchEvent(']) {
  ok(!generica.includes(prohibido), `no usa ${prohibido}`);
}

// Una pantalla inventada: una matriz de actividades con celdas editables y un
// botón Guardar. Es el caso que MÁS importa reconocer, porque ahí automatizar
// significaría escribir.
const matriz = `<!doctype html><html><body>
<form name="aspnetForm" id="aspnetForm" method="post" action="./DefActividadDocentePorcMatriz.aspx">
  <input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="${'x'.repeat(9000)}">
  <img id="ctl00_FotoMenu" src="../Fotos/1099999999.jpg">
  <select name="lstCurso" id="lstCurso" onchange="javascript:__doPostBack('lstCurso','')">
    <option value="%">&lt; TODOS &gt;</option><option value="801  " selected>801</option>
  </select>
  <input type="text" id="txtFecha" name="txtFecha" value="30/07/2026">
  <input type="submit" id="btnGuardar" name="btnGuardar" value="Guardar">
  <input type="image" id="btnExportar" name="btnExportar" alt="Exportar a Excel">
  <table id="gvActividades">
    <tr><th>Código</th><th>Actividad</th><th>Porcentaje</th><th>Categoría</th></tr>
    <tr><td>2019034387</td><td>QUIZ UNO</td><td><input name="p1" value="20"></td><td>K</td></tr>
    <tr><td>2018044266</td><td>TALLER</td><td><input name="p2" value="30"></td><td>M</td></tr>
    <tr><td>2021063533</td><td>PROYECTO</td><td><input name="p3" value="50"></td><td>U</td></tr>
    <tr><td>2017004140</td><td>EXPOSICION</td><td><input name="p4" value="25"></td><td>C</td></tr>
    <tr><td>2016011111</td><td>EVALUACION</td><td><input name="p5" value="25"></td><td>E</td></tr>
  </table>
</form></body></html>`;

const domMatriz = new JSDOM(matriz, {
  url: 'https://ejemplo/arrayanes/2026/Seguro/DefActividadDocentePorcMatriz.aspx',
  runScripts: 'outside-only',
});
domMatriz.window.console = { log: () => {} };
const fotoMatriz = foto(domMatriz.window);
const rm = domMatriz.window.eval(generica);

ok(fotoMatriz === foto(domMatriz.window), 'la página queda exactamente igual que antes');
eq(rm.pantalla, 'DefActividadDocentePorcMatriz.aspx', 'dice en qué pantalla corrió, sin que se le diga');
eq(rm.veredicto.hayTablaDeDatos, true, 'reconoce la tabla');
eq(rm.veredicto.tablaMasProbable.id, 'gvActividades', 'y cuál es');

// Lo que más importa de esta pantalla.
eq(rm.veredicto.laPantallaEscribe, true, 'AVISA que la pantalla escribe');
ok(rm.veredicto.botonesDeEscritura.includes('Guardar'), 'nombrando el botón');
eq(rm.acciones.find(a => a.id === 'btnExportar').clase,
   'envía el formulario (input type=image: postea name.x y name.y)',
   'y clasifica el input type=image, que sin href ni onclick parecería desconocido');

ok(rm.tablas.find(t => t.id === 'gvActividades').muestraFilas[0].celdas.some(c => /<input/.test(c)),
   'marca las celdas editables: una tabla que se puede escribir no es la misma cosa que una de consulta');
eq(rm.campos.find(c => c.id === 'txtFecha').valor, '30/07/2026',
   'lee los campos de texto, que también son filtros y se olvidan');

// Privacidad, sobre la salida real.
ok(!/QUIZ|TALLER|PROYECTO/.test(JSON.stringify(rm.tablas)),
   'el texto de las celdas sale enmascarado');
ok(rm.ocultos.find(h => h.name === '__VIEWSTATE').valor.startsWith('<omitido'),
   'y el VIEWSTATE no viaja');
eq(rm.diezDigitos.descartados.map(d => d.valor), ['1099999999'],
   'la foto del encabezado sigue sin contar como código');

// Sin tabla, el consejo apunta al filtro sin elegir.
const vacia = matriz
  .replace('<option value="%">&lt; TODOS &gt;</option><option value="801  " selected>801</option>',
           '<option value="%" selected>&lt; TODOS &gt;</option><option value="801  ">801</option>')
  .replace(/<table[\s\S]*<\/table>/, '');
const domVacia = new JSDOM(vacia, {
  url: 'https://ejemplo/arrayanes/2026/Seguro/DefActividadDocentePorcMatriz.aspx',
  runScripts: 'outside-only',
});
domVacia.window.console = { log: () => {} };
const rv = domVacia.window.eval(generica);
eq(rv.veredicto.hayTablaDeDatos, false, 'sin tabla lo dice');
ok(/lstCurso/.test(rv.veredicto.siguiente),
   'y señala el filtro que está sin elegir, en vez de un consejo genérico');

// --- 3f. Lo que enseñaron las corridas reales -----------------------------
// La matriz de actividades (831) y el planeador (803) destaparon tres cosas
// que la sonda hacía mal. Las tres se reproducen acá.
console.log('\nLo que enseñaron la matriz y el planeador');

// Un directorio de 203 docentes, como el lstFilProfesor del planeador.
const docentes = Array.from({ length: 203 }, (_, i) =>
  `<option value="${100 + i}">${100 + i} - NOMBRE APELLIDO ${i}</option>`).join('');

const conMenu = `<!doctype html><html><body>
<form name="aspnetForm" id="aspnetForm" method="post" action="./DefActividadDocentePorcMatriz.aspx">
  <!-- El menú lateral: NO es la pantalla. Oculto hasta que se despliega. -->
  <a id="1096" href="#" style="display:none">Importar/exportar planilla individual GLA</a>
  <span style="display:none" onclick="SessionEntrar('Importar/exportar planilla individual GLA', '1096', 'ReporteCalificaMatriz.aspx');">Importar/exportar planilla individual GLA</span>
  <select id="lstFilProfesor" name="lstFilProfesor">${docentes}</select>
  <select id="lstCurso" name="lstCurso">
    <option value="801  " selected>801 - OCHOCIENTOS UNO</option>
    <option value="802  ">802 - OCHOCIENTOS DOS</option>
  </select>
  <input type="image" id="btnDescargaExcel" name="btnDescargaExcel" alt="Descargar a Excel">
  <input type="submit" id="btnRefresca" name="btnRefresca" value="Consultar">
  <table id="gvActividades">
    <tr><th></th><th>Meta de comprensión</th><th>Descripción</th><th>Porcentaje</th><th>Ciclo</th></tr>
    <tr><td><a href="javascript:__doPostBack('gv','Edit$0')">Editar</a></td><td>Comprensión</td>
        <td>T3 - C4. TITULO DE PRUEBA <textarea name="descripcion" readonly></textarea></td>
        <td>60</td><td><select name="lstCiclo" disabled><option>Ciclo 4</option></select></td></tr>
    <tr><td>Editar</td><td>Comprensión</td><td>T3 - C5. OTRO <textarea name="d2" readonly></textarea></td>
        <td>40</td><td><select name="c2" disabled><option>Ciclo 5</option></select></td></tr>
    <tr><td>Editar</td><td>Comprensión</td><td>Act.3 <textarea name="d3" readonly></textarea></td>
        <td>0</td><td><select name="c3" disabled><option>SELECCIONE</option></select></td></tr>
    <tr><td>Editar</td><td>Comprensión</td><td>Act.4 <textarea name="d4" readonly></textarea></td>
        <td>0</td><td><select name="c4" disabled><option>SELECCIONE</option></select></td></tr>
    <tr><td>Editar</td><td>Comprensión</td><td>Act.5 <textarea name="d5" readonly></textarea></td>
        <td>0</td><td><select name="c5" disabled><option>SELECCIONE</option></select></td></tr>
  </table>
</form></body></html>`;

const domMenu = new JSDOM(conMenu, {
  url: 'https://ejemplo/arrayanes/2026/Seguro/DefActividadDocentePorcMatriz.aspx',
  runScripts: 'outside-only',
});
domMenu.window.console = { log: () => {} };
const fotoMenu = foto(domMenu.window);
const rc = domMenu.window.eval(generica);

ok(fotoMenu === foto(domMenu.window), 'la página queda igual');

// 1) El menú no es la pantalla.
ok(!rc.acciones.some(a => /Importar\/exportar/.test(a.etiqueta)),
   'las entradas del menú ya no se cuentan como acciones de la pantalla');
ok(!rc.veredicto.botonesDeEscritura.some(b => /Importar\/exportar/.test(b || '')),
   'ni hacen decir "esta pantalla escribe" por lo que no es');
ok(rc.acciones.some(a => a.id === 'btnDescargaExcel'),
   'pero los botones que sí son de la pantalla siguen ahí');

// 2) "Editar" es escritura, y se distingue de poder escribir AHORA.
eq(rc.veredicto.laPantallaEscribe, true, 'reconoce que la pantalla escribe');
eq(rc.veredicto.seEscribeAhora, false,
   'pero NO ahora: los campos están trabados hasta que se pulsa Editar');
eq(rc.veredicto.seEditaPorFila, true, 'y dice que se edita fila por fila');
ok(rc.tablas[0].muestraFilas[0].celdas.some(c => /trabado>/.test(c)),
   'marcando los controles trabados, en vez de tomarlos por editables');

// 3) Los nombres de 203 docentes no se vuelcan.
const prof = rc.selects.find(s => s.id === 'lstFilProfesor');
eq(prof.textosEnmascarados, true, 'una lista de 203 personas sale enmascarada');
ok(!/NOMBRE APELLIDO 1\b/.test(JSON.stringify(prof)), 'ningún nombre completo viaja');
ok(prof.opciones.every(o => /^\d+$/.test(o.value)),
   'pero los ids sí, que es lo que hace falta para el filtro y no identifica a nadie');
const cursos = rc.selects.find(s => s.id === 'lstCurso');
eq(cursos.textosEnmascarados, false, 'y una lista corta del oficio sigue en claro');
ok(/OCHOCIENTOS/.test(JSON.stringify(cursos)), 'con el nombre del curso legible');

// 4) No toda pantalla habla de estudiantes.
eq(rc.veredicto.esDeEstudiantes, false, 'sabe que acá no hay estudiantes');
ok(!/emparejar por nombre/.test(rc.veredicto.siguiente),
   'así que no aconseja emparejar por nombre donde no hay a quién emparejar');
ok(/no habla de estudiantes/.test(rc.veredicto.siguiente), 'y lo dice');

// --- 4. Que la prueba de arriba sirva de algo ---------------------------
// Un arnés que nunca falla no prueba nada. Acá se corre a propósito algo que
// SÍ escribe, y lo que se comprueba es que la foto lo delate: tanto el campo
// tocado por propiedad (que el HTML no registra) como la fila agregada.
console.log('\nY que esa comprobación sirva: una sonda que sí escribe');

for (const [queHace, mala] of [
  ['toca un campo', `document.getElementById('__EVENTTARGET').value = 'lnkDescargar';`],
  ['agrega una fila', `document.getElementById('gvNotas').insertRow();`],
]) {
  const sucio = new JSDOM(pagina, { url: 'https://ejemplo/x.aspx', runScripts: 'outside-only' });
  const antesSucio = foto(sucio.window);
  sucio.window.eval(mala);
  ok(antesSucio !== foto(sucio.window), `se nota cuando ${queHace}`);
}

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLARON`);
process.exit(fallos ? 1 : 0);
