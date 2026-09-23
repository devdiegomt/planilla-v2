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
eq(r.veredicto.quePareceElBotonDeDescarga.map(d => d.clase), ['postback de ASP.NET'],
   'clasifica "Descargar Tabla" como postback, no como enlace a un archivo');

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
