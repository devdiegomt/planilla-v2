/*
 * Pruebas del verificador de importación.
 *
 * Cada variante cambia UNA sola cosa respecto del original, para que cada
 * aserción verifique exactamente lo que dice verificar. Lo que más importa es
 * que los cambios de identidad —orden, faltantes, sobrantes, nombres— salgan
 * como bloqueantes y con código de salida distinto de cero: ese es el único
 * error de esta herramienta que terminaría en notas asignadas a la persona
 * equivocada.
 *
 * Requiere: python3 genera-xls-de-prueba.py
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERRAMIENTA = fileURLToPath(new URL('../../verificar-planilla.mjs', import.meta.url));
const AQUI = fileURLToPath(new URL('.', import.meta.url));

let fallos = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✔ ' : '  ✗ FALLA ') + msg); if (!cond) fallos++; };

/* Devuelve el informe y el código de salida. El código importa: es lo que
   permite usar esto como compuerta en un pipeline. */
function verificar(original, modificado) {
  try {
    const salida = execFileSync('node', [HERRAMIENTA, original, modificado, '--json'],
      { cwd: AQUI, encoding: 'utf8' });
    return { r: JSON.parse(salida), codigo: 0 };
  } catch (e) {
    if (e.status === 2) throw new Error('la herramienta falló: ' + e.stderr);
    return { r: JSON.parse(e.stdout), codigo: e.status };
  }
}

const tipos = (lista) => lista.map((h) => h.tipo).join(',');

// ====================================================================== 1
console.log('\n[archivos idénticos]');
{
  const { r, codigo } = verificar('v_original.xls', 'v_igual.xls');
  ok(codigo === 0, 'código de salida 0');
  ok(r.seguro === true, 'lo declara seguro');
  ok(r.bloqueantes.length === 0 && r.avisos.length === 0 && r.cambios.length === 0,
    'sin hallazgos de ningún nivel');
  ok(r.celdasIguales === 18, 'contó las 18 celdas de notas sin cambios');
}

// ====================================================================== 2
console.log('\n[solo cambian notas: es lo esperado]');
{
  const { r, codigo } = verificar('v_original.xls', 'v_notas.xls');
  ok(codigo === 0, 'código de salida 0: se puede subir');
  ok(r.seguro === true, 'seguro');
  ok(r.cambios.length === 2, 'reporta los 2 cambios de nota');
  ok(r.cambios.every((c) => c.antes !== undefined && c.despues !== undefined),
    'con el valor anterior y el nuevo');
  ok(/2019034000/.test(r.cambios[0].detalle) && /0 → 95/.test(r.cambios[0].detalle),
    'identificando estudiante y logro: ' + r.cambios[0].detalle);
}

// ====================================================================== 3
console.log('\n[una nota que se cae a cero: aviso, no bloqueo]');
{
  const { r, codigo } = verificar('v_original.xls', 'v_nota_a_cero.xls');
  ok(r.avisos.length === 1, 'la marca como aviso');
  ok(/→ \(vacío\)|→ 0/.test(r.avisos[0].detalle), 'mostrando el valor: ' + r.avisos[0].detalle);
  ok(r.bloqueantes.length === 0, 'pero no bloquea: puede ser a propósito');
  ok(codigo === 0, 'código 0');
}

// ====================================================================== 4
console.log('\n[orden alterado: BLOQUEANTE]');
{
  // El caso peligroso de verdad. Mismos estudiantes, mismas notas, otro orden:
  // si la plataforma actualiza por posición de fila, cada quien recibe la nota
  // del vecino y no hay forma de notarlo mirando el archivo.
  const { r, codigo } = verificar('v_original.xls', 'v_reordenado.xls');
  ok(codigo === 1, 'código de salida 1: la compuerta se cierra');
  ok(r.seguro === false, 'no lo declara seguro');
  ok(tipos(r.bloqueantes) === 'orden_alterado', 'un bloqueante, y es el orden');
  ok(/fila 3/.test(r.bloqueantes[0].detalle), 'dice en qué fila empieza: ' + r.bloqueantes[0].detalle);
}

// ====================================================================== 5
console.log('\n[estudiante faltante o sobrante: BLOQUEANTE]');
{
  const a = verificar('v_original.xls', 'v_falta_uno.xls');
  ok(a.codigo === 1, 'faltante → código 1');
  ok(tipos(a.r.bloqueantes).includes('estudiante_faltante'), 'lo tipifica');
  ok(a.r.bloqueantes[0].codigos.includes('2019034004'), 'y nombra el código que falta');

  const b = verificar('v_original.xls', 'v_sobra_uno.xls');
  ok(b.codigo === 1, 'sobrante → código 1');
  ok(tipos(b.r.bloqueantes).includes('estudiante_agregado'), 'lo tipifica');
}

// ====================================================================== 6
console.log('\n[nombre cambiado para el mismo código: BLOQUEANTE]');
{
  const { r, codigo } = verificar('v_original.xls', 'v_renombrado.xls');
  ok(codigo === 1, 'código 1');
  ok(tipos(r.bloqueantes).includes('nombre_distinto'),
    'un código que cambia de dueño es motivo suficiente para no subir');
}

// ====================================================================== 7
console.log('\n[columnas de logro distintas: BLOQUEANTE]');
{
  const { r, codigo } = verificar('v_original.xls', 'v_sin_logro.xls');
  ok(codigo === 1, 'código 1');
  ok(tipos(r.bloqueantes).includes('logros_distintos'), 'detecta que falta una columna');
}

// ====================================================================== 8
console.log('\n[el archivo es de otro curso: BLOQUEANTE]');
{
  const { r, codigo } = verificar('v_original.xls', 'v_otro_curso.xls');
  ok(codigo === 1, 'código 1');
  ok(r.bloqueantes.some((h) => /curso_faltante|curso_agregado|curso_distinto/.test(h.tipo)),
    'subir el 802 sobre el 801 no pasa: ' + tipos(r.bloqueantes));
}

// ====================================================================== 9
console.log('\n[archivo multihoja: compara curso por curso]');
{
  const { r, codigo } = verificar('caso8_multihoja.xls', 'caso8_multihoja.xls');
  ok(codigo === 0, 'un archivo contra sí mismo es seguro');
  ok(r.cursos.original === 3 && r.cursos.modificado === 3, 've los 3 cursos con datos');
}

// ===================================================================== 10
console.log('\n[entrada inválida]');
{
  let codigo = 0, err = '';
  try { execFileSync('node', [HERRAMIENTA, 'v_original.xls'], { cwd: AQUI, encoding: 'utf8' }); }
  catch (e) { codigo = e.status; err = e.stderr; }
  ok(codigo === 2, 'sin dos archivos sale con código 2, distinto del 1 de "no subir"');
  ok(/Uso:/.test(err), 'y explica cómo se usa');
}

console.log('\n' + (fallos ? '✗ ' + fallos + ' fallas' : '✓ todo verde'));
process.exit(fallos ? 1 : 0);
