/*
 * Prueba la capa de EXTRACCIÓN del userscript: dado un .xls con el layout real
 * del reporte, ¿ubica bien las columnas y saca los COD_ALUM?
 *
 * Igual que prueba-parser.mjs, no tiene copia del código: lo recorta de
 * codalum-extractor.user.js en tiempo de ejecución.
 */
import { readFileSync } from 'node:fs';

const ruta = new URL('../../codalum-extractor.user.js', import.meta.url);
const src = readFileSync(ruta, 'utf8');

// Dos regiones disjuntas: el parser, y la extracción. Lo que va en medio es la
// capa de red, que toca `document` y no se puede evaluar fuera del navegador.
function recorta(desde, hasta) {
  const a = src.indexOf(desde);
  const b = src.indexOf(hasta);
  if (a < 0 || b < 0 || b <= a) throw new Error(`No pude recortar entre "${desde}" y "${hasta}"`);
  return src.slice(a, b);
}

const bloqueParser = recorta('const LIBRE = 0xFFFFFFFF', '// CAPA DE RED');
const bloqueExtraccion = recorta('const normaliza =', '// ESTADO PERSISTIDO');

const fabrica = new Function(
  bloqueParser.replace(/\/\/ =+\s*$/, '') +
  '\n' + bloqueExtraccion.replace(/\/\/ =+\s*$/, '') +
  '\n; return { extraerDelLibro, extraerHojas, clave, aTexto };'
);
const { extraerDelLibro, extraerHojas, clave, aTexto } = fabrica();

const leer = (n) => {
  const b = readFileSync(new URL(n, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

let fallos = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✔ ' : '  ✗ FALLA ') + msg); if (!cond) fallos++; };

// ------------------------------------------------ helpers puros
console.log('\n[helpers]');
{
  ok(clave('COD_ALUM') === 'codalum', 'clave normaliza COD_ALUM');
  ok(clave('Nombre Alumno') === 'nombrealumno', 'clave normaliza Nombre Alumno');
  ok(clave('  Cód_Álum ') === 'codalum', 'clave ignora tildes y espacios');
  ok(aTexto(2019034387) === '2019034387', 'aTexto de un entero no usa notacion exponencial');
  ok(aTexto(' 2019034387 ') === '2019034387', 'aTexto recorta');
  ok(aTexto(null) === '', 'aTexto de null es cadena vacia');
}

// ------------------------------------------------ layout real
console.log('\n[caso4_layout_real.xls] encabezados en la fila 12, COD_ALUM en la col 6');
{
  const r = extraerDelLibro(leer('caso4_layout_real.xls'));
  console.log('  meta:', JSON.stringify({ cur: r.cod_cur, gru: r.cod_gru, mat: r.cod_mat }));
  console.log('  primero:', JSON.stringify(r.estudiantes[0]));
  ok(r.cod_cur === '801', 'cod_cur');
  ok(r.cod_gru === '08', 'cod_gru');
  ok(r.cod_mat === '2508', 'cod_mat');
  ok(r.estudiantes.length === 28, 'los 28 estudiantes (obtuve ' + r.estudiantes.length + ')');
  ok(r.estudiantes.every((e) => /^\d{10}$/.test(e.cod_alum)), 'todos los codigos son de 10 digitos');
  ok(r.estudiantes[0].cod_alum === '2019034000', 'primer codigo');
  ok(r.estudiantes[27].cod_alum === '2019034189', 'ultimo codigo');
  ok(r.estudiantes[1].nombre === 'ÁLVAREZ SUÁREZ ISABEL SOFÍA 1', 'nombre con tildes intacto');
  ok(r.estudiantes[2].nombre === 'MUÑOZ PEÑA ANDRÉS 2', 'nombre con ñ intacto');
  // Ni el membrete ni la fila de logros deben colarse como estudiantes.
  ok(!r.estudiantes.some((e) => /Curso:|Año Lectivo|log_/.test(e.nombre)), 'no se cuela el membrete');
}

// ------------------------------------------------ códigos como número
console.log('\n[caso5_cod_numerico.xls] el servidor escribe COD_ALUM como numero');
{
  const r = extraerDelLibro(leer('caso5_cod_numerico.xls'));
  console.log('  primero:', JSON.stringify(r.estudiantes[0]));
  ok(r.estudiantes.length === 28, '28 estudiantes');
  ok(r.estudiantes.every((e) => /^\d{10}$/.test(e.cod_alum)), 'siguen siendo 10 digitos, sin decimales');
  ok(r.estudiantes[0].cod_alum === '2019034000', 'valor exacto pese a venir como double');
  ok(r.estudiantes[27].cod_alum === '2019034189', 'ultimo valor exacto');
}

// ------------------------------------------------ membrete corrido
console.log('\n[caso6_membrete_corrido.xls] encabezados 5 filas mas abajo');
{
  const r = extraerDelLibro(leer('caso6_membrete_corrido.xls'));
  ok(r.estudiantes.length === 28, 'encuentra los 28 igual (no asume fila fija)');
  ok(r.cod_cur === '801', 'cod_cur pese al corrimiento');
  ok(r.estudiantes[0].cod_alum === '2019034000', 'primer codigo pese al corrimiento');
}

// ------------------------------------------------ guarda contra archivo ajeno
console.log('\n[negativos]');
{
  let lanzo = false;
  try { extraerDelLibro(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]).buffer); }
  catch (_) { lanzo = true; }
  ok(lanzo, 'un archivo que no es OLE2 lanza error en vez de devolver basura');

  // Sin columna COD_ALUM: debe fallar limpio, no inventar datos.
  let msg2 = '';
  try { extraerDelLibro(leer('caso7_sin_codalum.xls')); }
  catch (e) { msg2 = e.message; }
  ok(/COD_ALUM/.test(msg2), 'una hoja sin COD_ALUM lanza error explicito');

  // Con COD_ALUM pero sin columna de nombre: tambien debe fallar, no dejar
  // nombres vacios silenciosamente.
  let msg3 = '';
  try { extraerDelLibro(leer('caso1_texto.xls')); }
  catch (e) { msg3 = e.message; }
  ok(/nombre/i.test(msg3), 'una hoja sin columna de nombre lanza error explicito');
}

// ------------------------------------------------ guarda contra desincronizacion
console.log('\n[un archivo con varias hojas: el export por profesor]');
{
  // Califica-451-02.xls trae 19 hojas, una por curso, en una sola descarga.
  const r = extraerHojas(leer('caso8_multihoja.xls'));
  console.log('  cursos:', r.cursos.map((c) => `${c.cod_cur}(${c.estudiantes.length})`).join(' '));

  ok(r.nHojas === 4, 've las 4 hojas del archivo');
  ok(r.cursos.length === 3, 'extrae los 3 cursos con datos');
  // extraerHojas respeta el orden del archivo; reordenar es tarea de la corrida.
  ok(r.cursos.map((c) => c.cod_cur).join() === '801,1101,802', 'cada hoja es un curso distinto');
  const porCur = Object.fromEntries(r.cursos.map((c) => [c.cod_cur, c]));
  ok(porCur['801'].estudiantes.length === 28 && porCur['1101'].estudiantes.length === 31,
    'con su propio conteo de estudiantes');
  ok(porCur['1101'].cod_gru === '11', 'y su propio cod_gru');
  ok(r.cursos.every((c) => c.estudiantes.every((e) => /^\d{10}$/.test(e.cod_alum))),
    'todos los codigos son de 10 digitos');

  // Una hoja rota no puede tumbar las demas.
  ok(r.errores.length === 1, 'la hoja rota va a errores[] (' + r.errores.length + ')');
  ok(/COD_ALUM/.test(r.errores[0].detalle), 'y dice por que: ' + r.errores[0].detalle);
  ok(/Sheet4/.test(r.errores[0].detalle), 'nombrando la hoja');

  // Sin duplicados entre hojas.
  const todos = r.cursos.flatMap((c) => c.estudiantes.map((e) => e.cod_alum));
  ok(new Set(todos).size === todos.length, 'sin codigos repetidos entre cursos');
}

console.log('\n[copias del parser]');
{
  const sonda = readFileSync(new URL('../sonda-v4-xls.js', import.meta.url), 'utf8');
  const rec = (t) => {
    const a = t.indexOf('const LIBRE = 0xFFFFFFFF');
    const b = t.indexOf('function parsearLibro');
    return t.slice(a, b).split('\n').map((l) => l.trim()).join('\n');
  };
  ok(rec(sonda) === rec(src), 'el parser del userscript y el de la sonda son el mismo codigo');
}

console.log('\n' + (fallos ? '✗ ' + fallos + ' fallas' : '✓ todo verde'));
process.exit(fallos ? 1 : 0);
