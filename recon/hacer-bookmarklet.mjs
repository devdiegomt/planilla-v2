/*
 * Convierte un script de este repo en un bookmarklet listo para arrastrar.
 *
 *   node recon/hacer-bookmarklet.mjs                    # todos los configurados
 *   node recon/hacer-bookmarklet.mjs sonda-csp          # uno solo
 *
 * Escribe un HTML por script: se abre en el navegador y se arrastra el enlace
 * a la barra de favoritos.
 *
 * Por qué importa: instalar Tampermonkey, pegar un script y activar "Permitir
 * user scripts" en chrome://extensions es el muro más alto para que otro
 * docente use esto, y muchos colegios bloquean extensiones. Un favorito se
 * instala arrastrándolo.
 *
 * Confirmado el 16/09/2026 con `sonda-csp.js` en la pantalla de asistencia: esa
 * página NO tiene CSP (cero violaciones, sin meta) y el bookmarklet corrió.
 *
 * No se minifica a propósito. Un `javascript:` admite el archivo entero una vez
 * codificado, y minificar con expresiones regulares es justo la clase de atajo
 * que rompe un script sin avisar.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aquí = dirname(fileURLToPath(import.meta.url));
const raíz = join(aquí, '..');

/** Los scripts que tiene sentido usar como favorito, y qué decir de cada uno. */
const BOOKMARKLETS = [
  {
    id: 'sonda-csp',
    fuente: join(aquí, 'sonda-csp.js'),
    salida: join(aquí, 'sonda-csp-bookmarklet.html'),
    titulo: '¿Deja la plataforma correr un bookmarklet?',
    boton: 'Sonda CSP',
    pasos: [
      'Abre en Classroom Live la pantalla de <strong>asistencia diaria por asignatura</strong> y deja cargada la lista de estudiantes.',
      'Pulsa el favorito <strong>Sonda CSP</strong>.',
      'Abre la consola (<code>F12</code>) y copia el JSON que imprime. Si lo dejó en el portapapeles, ya lo tienes.',
    ],
    notas: [
      'Si al pulsarlo no pasa nada, eso ya es una respuesta: esa página no deja correr bookmarklets. Para saber por qué, abre la consola, pega el contenido de <code>recon/sonda-csp.js</code> y pulsa Enter — la consola no pasa por la política de la página.',
      'La sonda solo lee. No envía formularios, no llama a <code>__doPostBack</code> y no toca ningún control de guardado.',
    ],
  },
  {
    id: 'asistencia-autofill',
    fuente: join(raíz, 'asistencia-autofill.user.js'),
    salida: join(aquí, 'asistencia-autofill-bookmarklet.html'),
    titulo: 'Asistencia — autofill, sin instalar nada',
    boton: 'Asistencia GLA',
    pasos: [
      'En Classroom Live, abre <strong>asistencia diaria por asignatura</strong> y elige a mano la hora, el curso y la asignatura, hasta que salga la lista de estudiantes.',
      'Pulsa el favorito <strong>Asistencia GLA</strong>: aparece el panel.',
      'Pega el JSON que copiaste desde planilla-app y pulsa <strong>Solo marcar</strong>.',
      'Revisa lo que marcó en pantalla y, si está bien, pulsa <strong>Guardar</strong> en la plataforma.',
    ],
    notas: [
      '<strong>Usa "Solo marcar", no "Flujo completo".</strong> El flujo completo recorre el filtro solo, y cada paso recarga la página: un favorito no se vuelve a inyectar tras una recarga y la corrida quedaría a medias. "Solo marcar" no navega, así que funciona igual. Por eso el paso 1 es elegir el filtro a mano.',
      'Nada se guarda sin que pulses Guardar. El panel marca en pantalla y se detiene.',
    ],
  },
];

function generar(b) {
  const fuente = readFileSync(b.fuente, 'utf8');
  // `void 0` al final: sin eso el navegador ve que el script devuelve algo y
  // abandona la página para mostrar ese valor.
  const url = 'javascript:' + encodeURIComponent(fuente + '\nvoid 0;');
  const kb = (url.length / 1024).toFixed(1);

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>${b.titulo}</title>
<style>
  body{font:15px/1.6 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#1a1a1a}
  code{background:#f2f2f2;padding:.1em .35em;border-radius:3px}
  .b{display:inline-block;background:#0f172a;color:#fff;padding:.6rem 1.1rem;
     border-radius:8px;text-decoration:none;font-weight:600;cursor:grab}
  ol{padding-left:1.2rem} li{margin:.5rem 0}
  .nota{color:#555;font-size:.92em;border-left:3px solid #ddd;padding-left:.8rem;margin:.8rem 0}
</style></head><body>
<h1>${b.titulo}</h1>

<p><strong>Arrastra este botón a tu barra de favoritos:</strong></p>
<p><a class="b" href="${url.replace(/"/g, '&quot;')}">${b.boton}</a></p>
<p class="nota">Pesa ${kb} KB. No lo pulses desde aquí: solo funciona en la plataforma.</p>

<ol>${b.pasos.map(p => `\n  <li>${p}</li>`).join('')}
</ol>
${b.notas.map(n => `<p class="nota">${n}</p>`).join('\n')}
</body></html>`;

  writeFileSync(b.salida, html);
  console.log(`  ${b.id}: ${kb} KB → ${b.salida}`);
}

/*
 * Solo genera cuando se ejecuta directo. Al importarlo —lo hacen las pruebas,
 * que necesitan la lista— no debe escribir nada: si regenerara, la prueba que
 * detecta un HTML desincronizado de su script nunca podría fallar.
 */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const pedido = process.argv[2];
  const lista = pedido ? BOOKMARKLETS.filter(b => b.id === pedido) : BOOKMARKLETS;
  if (lista.length === 0) {
    console.error(`No conozco "${pedido}". Hay: ${BOOKMARKLETS.map(b => b.id).join(', ')}`);
    process.exit(1);
  }
  console.log('Bookmarklets generados:');
  for (const b of lista) generar(b);
}

export { BOOKMARKLETS };
