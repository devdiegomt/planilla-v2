/*
 * Extrae el parser TAL CUAL está en sonda-v4-xls.js (una sola fuente de verdad)
 * y lo corre contra los .xls BIFF8 generados con xlwt.
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../sonda-v4-xls.js', import.meta.url), 'utf8');

const desde = src.indexOf('const LIBRE = 0xFFFFFFFF');
const hasta = src.indexOf('// PARTE 3');
if (desde < 0 || hasta < 0) throw new Error('No pude recortar el parser');
const codigoParser = src.slice(desde, src.lastIndexOf('// ====', hasta));

const fabrica = new Function(codigoParser + '\n; return { leerCFB, parsearLibro };');
const { leerCFB, parsearLibro } = fabrica();

function analiza(ruta) {
  const buf = readFileSync(ruta);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const cfb = leerCFB(ab);
  const wb = cfb.entradas.find((e) => e.tipo === 2 && /^(Workbook|Book)$/i.test(e.nombre));
  if (!wb) throw new Error('sin stream Workbook');
  return parsearLibro(cfb.leerStream(wb));
}

let fallos = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✔ ' : '  ✗ FALLA ') + msg); if (!cond) fallos++; };

// ---------------------------------------------------------------- caso 1
console.log('\n[caso1_texto.xls] 30 estudiantes, COD_ALUM como texto');
{
  const r = analiza('caso1_texto.xls');
  const m = r.matrices[0];
  console.log('  BIFF', r.versionBIFF, '| hojas', r.nombresHoja, '| SST', JSON.stringify(r.sst));
  console.log('  no manejados:', JSON.stringify(r.tiposNoManejados));
  console.log('  encabezado f3:', JSON.stringify(m[3]));
  console.log('  primera f4:   ', JSON.stringify(m[4]));
  ok(r.sst.truncadas === 0, 'SST completo');
  ok(m.length === 34, 'filas = 34 (leidas ' + m.length + ')');
  ok(m[3][1] === 'COD_ALUM', 'encabezado col1');
  ok(m[4][1] === '1007718000', 'primer codigo como texto');
  ok(m[33][1] === '1007718029', 'ultimo codigo');
  ok(String(m[4][2]).startsWith('MUNOZ PENA'), 'nombre col2');
  ok(typeof m[4][3] === 'number', 'notas numericas');
}

// ---------------------------------------------------------------- caso 2
console.log('\n[caso2_numero.xls] COD_ALUM como numero (RK / NUMBER)');
{
  const r = analiza('caso2_numero.xls');
  const m = r.matrices[0];
  console.log('  primera f4:   ', JSON.stringify(m[4]));
  ok(typeof m[4][1] === 'number', 'codigo llega como number');
  ok(m[4][1] === 1007718000, 'valor exacto 1007718000 (RK sin perdida)');
  ok(m[33][1] === 1007718029, 'ultimo valor exacto');
  ok(/^\d{10}$/.test(String(Math.round(m[4][1]))), '10 digitos tras redondear');
}

// ---------------------------------------------------------------- caso 3
console.log('\n[caso3_continue.xls] 600 filas, SST partido en CONTINUE');
{
  const r = analiza('caso3_continue.xls');
  const m = r.matrices[0];
  console.log('  SST:', JSON.stringify(r.sst), '| registros', r.totalRegistros);
  console.log('  no manejados:', JSON.stringify(r.tiposNoManejados));
  ok(r.sst.truncadas === 0, 'ninguna cadena truncada');
  ok(r.sst.leidas === r.sst.unicasDeclaradas, 'leidas == declaradas (' + r.sst.leidas + ')');
  ok(m.length === 604, 'filas = 604 (leidas ' + m.length + ')');

  // Reconstruyo lo que genera genera.py y comparo cadena por cadena.
  let malos = 0, primerMalo = null;
  for (let i = 0; i < 600; i++) {
    const largo = 90 + (i % 40);
    const base = i % 3 === 0 ? 'MUNOZ PENA ANDRES '
               : i % 3 === 1 ? 'ÑÁÉÍÓÚ MUÑOZ PEÑA '
               : 'ΩΨΧ ΦΥΤΣΡΠ ΟΞΝΜΛΚ ';
    const esperado = base.repeat(10).slice(0, largo) + String(i);
    const obtenido = m[4 + i][2];
    if (obtenido !== esperado) {
      malos++;
      if (!primerMalo) primerMalo = { i, esperado, obtenido };
    }
  }
  ok(malos === 0, 'las 600 cadenas coinciden exactamente (fallaron ' + malos + ')');
  if (primerMalo) console.log('    primer desajuste:', JSON.stringify(primerMalo));

  const codigos = m.slice(4).map((f) => f[1]);
  ok(codigos.every((c) => /^\d{10}$/.test(String(c))), 'los 600 codigos son de 10 digitos');
  ok(new Set(codigos).size === 600, 'sin duplicados ni colisiones');
}

console.log('\n' + (fallos ? '✗ ' + fallos + ' fallas' : '✓ todo verde'));
process.exit(fallos ? 1 : 0);
