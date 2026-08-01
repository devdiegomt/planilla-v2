#!/usr/bin/env node
/*
 * Compara la planilla que descargaste de la plataforma contra la que generó tu
 * app, y te dice exactamente qué cambia ANTES de que la subas.
 *
 *   node verificar-planilla.mjs original.xls modificado.xls
 *   node verificar-planilla.mjs original.xls modificado.xls --json
 *
 * Sale con código 1 si encuentra algo bloqueante, así tu app puede usarlo como
 * compuerta en su propio pipeline.
 *
 * POR QUÉ EXISTE
 * --------------
 * La app reescribe el archivo entero, no solo las celdas de notas. Eso hace
 * invisible el peor error posible: si el archivo regenerado reordena las filas
 * o pierde un estudiante, las notas terminan en la persona equivocada y no hay
 * forma de notarlo mirando. Por eso acá la identidad —quiénes son, en qué
 * orden, con qué código— se verifica antes que las notas, y cualquier
 * diferencia ahí es bloqueante.
 *
 * No toca la plataforma ni necesita sesión: son dos archivos locales.
 *
 * El parser OLE2/BIFF8 se recorta de codalum-extractor.user.js en tiempo de
 * ejecución, para no tener una tercera copia que se desincronice.
 */
import { readFileSync } from 'node:fs';

// ======================================================================
// Parser y helpers, tomados del userscript
// ======================================================================

const FUENTE = readFileSync(new URL('./codalum-extractor.user.js', import.meta.url), 'utf8');

function recorta(desde, hasta) {
  const a = FUENTE.indexOf(desde);
  const b = FUENTE.indexOf(hasta);
  if (a < 0 || b < 0 || b <= a) throw new Error(`No pude recortar entre "${desde}" y "${hasta}"`);
  return FUENTE.slice(a, b);
}

const { leerCFB, parsearLibro, clave, aTexto, normaliza } = new Function(
  recorta('const LIBRE = 0xFFFFFFFF', '// CAPA DE RED') + '\n' +
  recorta('const normaliza =', '// ESTADO PERSISTIDO') +
  '\n; return { leerCFB, parsearLibro, clave, aTexto, normaliza };'
)();

// ======================================================================
// Lectura de una planilla
// ======================================================================

const leerArchivo = (ruta) => {
  const b = readFileSync(ruta);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

// Las columnas de identidad tienen encabezado conocido; el resto de la fila de
// encabezados son logros.
const COLUMNAS_CONOCIDAS = new Set(['codper', 'codcur', 'codgru', 'codmat', 'nombremateria',
  'codalum', 'nombrealumno']);

function analizarHoja(matriz, nombreHoja) {
  if (!matriz || !matriz.length) return { hoja: nombreHoja, vacia: true };

  let filaEnc = -1, colDe = {};
  for (let f = 0; f < matriz.length; f++) {
    const mapa = {};
    matriz[f].forEach((celda, c) => { const k = clave(celda); if (k) mapa[k] = c; });
    if (mapa.codalum != null) { filaEnc = f; colDe = mapa; break; }
  }
  if (filaEnc < 0) return { hoja: nombreHoja, vacia: true, motivo: 'sin columna COD_ALUM' };

  const colNombre = colDe.nombrealumno ?? colDe.nombrealum ?? colDe.nombre;
  if (colNombre == null) return { hoja: nombreHoja, vacia: true, motivo: 'sin columna de nombre' };

  // Logros: columnas con encabezado que no son de identidad. La descripción
  // vive en la fila de arriba.
  const logros = [];
  matriz[filaEnc].forEach((celda, c) => {
    const k = clave(celda);
    if (!k || COLUMNAS_CONOCIDAS.has(k)) return;
    logros.push({ col: c, codigo: normaliza(celda), descripcion: normaliza(matriz[filaEnc - 1]?.[c]) });
  });

  const filas = matriz.slice(filaEnc + 1).filter((fila) => aTexto(fila[colDe.codalum]) !== '');
  const primera = filas[0] || [];
  const meta = (k) => (colDe[k] != null ? aTexto(primera[colDe[k]]) : '');

  return {
    hoja: nombreHoja,
    vacia: false,
    cod_cur: meta('codcur'), cod_gru: meta('codgru'), cod_mat: meta('codmat'),
    logros,
    estudiantes: filas.map((fila) => ({
      cod_alum: aTexto(fila[colDe.codalum]),
      nombre: aTexto(fila[colNombre]),
      notas: Object.fromEntries(logros.map((l) => [l.codigo, aTexto(fila[l.col])])),
    })),
  };
}

function leerPlanilla(ruta) {
  const cfb = leerCFB(leerArchivo(ruta));
  const wb = cfb.entradas.find((e) => e.tipo === 2 && /^(Workbook|Book)$/i.test(e.nombre));
  if (!wb) throw new Error(`${ruta}: no tiene stream Workbook (¿es un .xls de la plataforma?)`);
  const libro = parsearLibro(cfb.leerStream(wb));
  return libro.matrices
    .map((m, i) => analizarHoja(m, libro.nombresHoja[i] || `Hoja${i + 1}`))
    .filter((h) => !h.vacia);
}

// ======================================================================
// Comparación
// ======================================================================

const BLOQUEA = 'BLOQUEANTE';
const AVISA = 'AVISO';
const CAMBIO = 'CAMBIO';

function compararCurso(antes, despues) {
  const hallazgos = [];
  const cur = antes.cod_cur || antes.hoja;
  const anotar = (nivel, tipo, detalle, extra) =>
    hallazgos.push({ nivel, curso: cur, tipo, detalle, ...extra });

  // --- Identidad del curso
  for (const campo of ['cod_cur', 'cod_gru', 'cod_mat']) {
    if (antes[campo] !== despues[campo]) {
      anotar(BLOQUEA, 'curso_distinto',
        `${campo}: "${antes[campo]}" → "${despues[campo]}"`);
    }
  }

  // --- Identidad de los estudiantes: mismos, en el mismo orden
  const codsA = antes.estudiantes.map((e) => e.cod_alum);
  const codsD = despues.estudiantes.map((e) => e.cod_alum);

  const faltan = codsA.filter((c) => !codsD.includes(c));
  const sobran = codsD.filter((c) => !codsA.includes(c));
  if (faltan.length) anotar(BLOQUEA, 'estudiante_faltante',
    `${faltan.length} estudiante(s) del original no están en el archivo nuevo`, { codigos: faltan });
  if (sobran.length) anotar(BLOQUEA, 'estudiante_agregado',
    `${sobran.length} estudiante(s) aparecen y no estaban`, { codigos: sobran });

  /* El orden importa aunque el conjunto coincida: no sabemos si la plataforma
     actualiza por COD_ALUM o por posición de fila. Si es por posición, un
     archivo reordenado le pone a cada quien la nota del vecino. */
  if (!faltan.length && !sobran.length && codsA.join() !== codsD.join()) {
    const primera = codsA.findIndex((c, i) => c !== codsD[i]);
    anotar(BLOQUEA, 'orden_alterado',
      `las filas cambiaron de orden (primera diferencia en la fila ${primera + 1}: ` +
      `${codsA[primera]} → ${codsD[primera]})`);
  }

  const porCodigo = new Map(despues.estudiantes.map((e) => [e.cod_alum, e]));
  for (const a of antes.estudiantes) {
    const d = porCodigo.get(a.cod_alum);
    if (d && normaliza(a.nombre) !== normaliza(d.nombre)) {
      anotar(BLOQUEA, 'nombre_distinto',
        `${a.cod_alum}: "${a.nombre}" → "${d.nombre}"`);
    }
  }

  // --- Estructura de logros
  const logrosA = antes.logros.map((l) => l.codigo).join('|');
  const logrosD = despues.logros.map((l) => l.codigo).join('|');
  if (logrosA !== logrosD) {
    anotar(BLOQUEA, 'logros_distintos',
      `las columnas de logro cambiaron: [${logrosA}] → [${logrosD}]`);
  }

  // --- Notas
  let iguales = 0;
  for (const a of antes.estudiantes) {
    const d = porCodigo.get(a.cod_alum);
    if (!d) continue;
    for (const l of antes.logros) {
      const va = a.notas[l.codigo] ?? '';
      const vd = d.notas[l.codigo] ?? '';
      if (va === vd) { iguales++; continue; }

      const eraAlgo = va !== '' && va !== '0';
      const quedaNada = vd === '' || vd === '0';
      // Una nota que se cae a cero o a vacío es el sintoma tipico de un fallo
      // de procesamiento, y la que mas duele si pasa inadvertida.
      anotar(eraAlgo && quedaNada ? AVISA : CAMBIO, 'nota',
        `${a.cod_alum} ${a.nombre} · ${l.codigo}: ${va || '(vacío)'} → ${vd || '(vacío)'}`,
        { cod_alum: a.cod_alum, logro: l.codigo, antes: va, despues: vd });
    }
  }
  return { hallazgos, celdasIguales: iguales };
}

function comparar(rutaAntes, rutaDespues) {
  const antes = leerPlanilla(rutaAntes);
  const despues = leerPlanilla(rutaDespues);

  const hallazgos = [];
  let celdasIguales = 0;

  const indice = (hojas) => new Map(hojas.map((h) => [h.cod_cur || h.hoja, h]));
  const iA = indice(antes), iD = indice(despues);

  for (const [cur, hA] of iA) {
    const hD = iD.get(cur);
    if (!hD) {
      hallazgos.push({ nivel: BLOQUEA, curso: cur, tipo: 'curso_faltante',
        detalle: 'el curso está en el original y no en el archivo nuevo' });
      continue;
    }
    const r = compararCurso(hA, hD);
    hallazgos.push(...r.hallazgos);
    celdasIguales += r.celdasIguales;
  }
  for (const [cur] of iD) {
    if (!iA.has(cur)) {
      hallazgos.push({ nivel: BLOQUEA, curso: cur, tipo: 'curso_agregado',
        detalle: 'el curso aparece en el archivo nuevo y no estaba en el original' });
    }
  }

  const porNivel = (n) => hallazgos.filter((h) => h.nivel === n);
  return {
    original: rutaAntes, modificado: rutaDespues,
    cursos: { original: antes.length, modificado: despues.length },
    celdasIguales,
    bloqueantes: porNivel(BLOQUEA),
    avisos: porNivel(AVISA),
    cambios: porNivel(CAMBIO),
    seguro: porNivel(BLOQUEA).length === 0,
  };
}

// ======================================================================
// Salida
// ======================================================================

function imprimir(r) {
  const linea = (h) => `    ${h.detalle}`;

  console.log(`\noriginal:   ${r.original}`);
  console.log(`modificado: ${r.modificado}`);
  console.log(`cursos: ${r.cursos.original} → ${r.cursos.modificado} · ${r.celdasIguales} celdas sin cambios`);

  if (r.bloqueantes.length) {
    console.log(`\n✗ ${r.bloqueantes.length} problema(s) BLOQUEANTE(S) — no subas este archivo:`);
    for (const h of r.bloqueantes) console.log(`  [${h.curso}] ${h.tipo}\n${linea(h)}`);
  }

  if (r.avisos.length) {
    console.log(`\n⚠ ${r.avisos.length} nota(s) que se caen a cero o a vacío — revisá que sea a propósito:`);
    for (const h of r.avisos) console.log(linea(h));
  }

  if (r.cambios.length) {
    console.log(`\n${r.cambios.length} cambio(s) de nota:`);
    const porCurso = {};
    for (const h of r.cambios) (porCurso[h.curso] ||= []).push(h);
    for (const [cur, lista] of Object.entries(porCurso)) {
      console.log(`  [${cur}] ${lista.length} cambio(s)`);
      for (const h of lista.slice(0, 10)) console.log(linea(h));
      if (lista.length > 10) console.log(`    … y ${lista.length - 10} más`);
    }
  }

  if (!r.bloqueantes.length && !r.avisos.length && !r.cambios.length) {
    console.log('\nLos dos archivos son idénticos en identidad y notas.');
  }

  console.log(r.seguro
    ? '\n✓ Sin problemas de identidad. El archivo se puede subir.'
    : '\n✗ NO subir: la identidad de las filas no coincide.');
}

const args = process.argv.slice(2);
const json = args.includes('--json');
const rutas = args.filter((a) => !a.startsWith('--'));

if (rutas.length !== 2) {
  console.error('Uso: node verificar-planilla.mjs <original.xls> <modificado.xls> [--json]');
  process.exit(2);
}

try {
  const r = comparar(rutas[0], rutas[1]);
  if (json) console.log(JSON.stringify(r, null, 2));
  else imprimir(r);
  process.exit(r.seguro ? 0 : 1);
} catch (e) {
  console.error('Error: ' + e.message);
  process.exit(2);
}
