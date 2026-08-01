/*
 * Resume el JSON del inventario en algo legible de un vistazo.
 *
 *   node recon/resumen-inventario.mjs inventario-gla-2026-08-01.json
 *
 * Ordena por lo que importa para decidir qué automatizar: primero las pantallas
 * de lectura con salida de datos, al final las que solo escriben.
 */
import { readFileSync } from 'node:fs';

const ruta = process.argv[2];
if (!ruta) {
  console.error('Uso: node recon/resumen-inventario.mjs <inventario.json>');
  process.exit(1);
}
const d = JSON.parse(readFileSync(ruta, 'utf8'));

// "Cambiar Clave" está en la master page de todas: no distingue nada.
const RUIDO = /cambiar\s*clave/i;
const SALIDA = /descarg|export|pdf|excel|imprim|generar/i;

const filas = d.pantallas.map((p) => {
  const filtros = (p.selects || [])
    .map((s) => `${(s.id || s.name || '?').replace(/^ctl00_ContentPlaceHolder1_/, '')}(${s.nOpciones})`);
  const tablas = (p.tablas || []).filter((t) => t.nFilas > 0);
  const salidas = [...new Set((p.botones || [])
    .filter((b) => b.id && b.clase === 'lectura' && SALIDA.test(b.etiqueta || ''))
    .map((b) => b.etiqueta))];
  const escrituras = [...new Set((p.riesgo?.botonesDeEscritura || []).filter((b) => !RUIDO.test(b)))];
  return { p, filtros, tablas, salidas, escrituras };
});

// Puntaje simple: sirve para extraer si da datos y no obliga a escribir.
const puntaje = (f) => (f.salidas.length ? 2 : 0) + (f.tablas.length ? 1 : 0) - (f.escrituras.length ? 1 : 0);
filas.sort((a, b) => puntaje(b) - puntaje(a) || Number(a.p.id) - Number(b.p.id));

console.log(`\n${d.capturadas}/${d.totalPantallas} pantallas · completa: ${d.completa} · ${d.contextoFinal?.recargas ?? '?'} recargas`);
if (d.errores?.length) console.log(`errores: ${d.errores.length}`);

for (const f of filas) {
  const { p } = f;
  const marca = f.salidas.length ? '▸' : (f.escrituras.length ? '!' : ' ');
  console.log(`\n${marca} [${p.id}] ${p.titulo}   <${p.seccion}>`);
  console.log(`    ${p.pageNum}`);
  if (f.filtros.length) console.log(`    filtros: ${f.filtros.join('  ')}`);
  if (f.tablas.length) {
    console.log(`    tablas:  ${f.tablas.map((t) => `${t.id || 'sin-id'}(${t.nFilas} filas)`).join('  ')}`);
    for (const t of f.tablas) {
      const enc = (t.encabezados || []).filter(Boolean);
      if (enc.length) console.log(`             ${enc.slice(0, 10).join(' | ')}`);
    }
  }
  if (f.salidas.length) console.log(`    SALIDA:  ${f.salidas.join(', ')}`);
  if (f.escrituras.length) console.log(`    escribe: ${f.escrituras.join(', ')}`);
}

// Los selects enormes son el dato más revelador del alcance de la cuenta.
console.log('\n\n--- selects con más de 50 opciones (alcance de la cuenta) ---');
for (const p of d.pantallas) {
  for (const s of p.selects || []) {
    if (s.nOpciones > 50) {
      console.log(`[${p.id}] ${(s.id || s.name).replace(/^ctl00_ContentPlaceHolder1_/, '')}: ${s.nOpciones} opciones — ${p.titulo}`);
    }
  }
}

console.log('\n--- leyenda ---');
console.log('▸ tiene botón de descarga/exportación: candidata a extractor');
console.log('! solo escribe: automatizarla es riesgoso');
