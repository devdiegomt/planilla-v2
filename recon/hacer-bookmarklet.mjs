/*
 * Convierte `sonda-csp.js` en un bookmarklet listo para arrastrar.
 *
 *   node recon/hacer-bookmarklet.mjs
 *
 * Escribe `recon/sonda-csp-bookmarklet.html`: se abre en el navegador y se
 * arrastra el enlace a la barra de favoritos.
 *
 * Con esto el paso 0 y el paso 1 de la sonda se vuelven uno solo: si el
 * favorito corre, ya está respondida la primera pregunta (los bookmarklets
 * corren acá) y encima devuelve el diagnóstico completo. Si no pasa nada al
 * pulsarlo, eso ya es la respuesta — y queda el camino de pegar el .js en la
 * consola para ver por qué.
 *
 * No se minifica a propósito. Un `javascript:` admite el archivo entero una vez
 * codificado, y minificar con expresiones regulares es justo la clase de atajo
 * que rompe un script sin avisar.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aquí = dirname(fileURLToPath(import.meta.url));
const fuente = readFileSync(join(aquí, 'sonda-csp.js'), 'utf8');

// `void 0` al final: sin eso el navegador ve que el script devuelve algo (la
// promesa del IIFE) y abandona la página para mostrar ese valor.
const url = 'javascript:' + encodeURIComponent(fuente + '\nvoid 0;');

const kb = (url.length / 1024).toFixed(1);
const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>Sonda CSP — bookmarklet</title>
<style>
  body{font:15px/1.6 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#1a1a1a}
  code{background:#f2f2f2;padding:.1em .35em;border-radius:3px}
  .b{display:inline-block;background:#0f172a;color:#fff;padding:.6rem 1.1rem;
     border-radius:8px;text-decoration:none;font-weight:600;cursor:grab}
  ol{padding-left:1.2rem} li{margin:.5rem 0}
  .nota{color:#555;font-size:.9em}
</style></head><body>
<h1>¿Deja la plataforma correr un bookmarklet?</h1>

<p><strong>Arrastra este botón a tu barra de favoritos:</strong></p>
<p><a class="b" href="${url.replace(/"/g, '&quot;')}">Sonda CSP</a></p>
<p class="nota">Pesa ${kb} KB. No lo pulses desde aquí: no dice nada útil en esta página.</p>

<ol>
  <li>Abre en Classroom Live la pantalla de <strong>asistencia diaria por
      asignatura</strong> y deja cargada la lista de estudiantes.</li>
  <li>Pulsa el favorito <strong>Sonda CSP</strong>.</li>
  <li>Abre la consola (<code>F12</code>) y copia el JSON que imprime. Si lo dejó
      en el portapapeles, ya lo tienes.</li>
</ol>

<p><strong>Si al pulsarlo no pasa nada</strong>, eso ya es una respuesta: esa
página no deja correr bookmarklets. Para saber por qué, abre la consola, pega
el contenido de <code>recon/sonda-csp.js</code> y pulsa Enter — la consola no
pasa por la política de la página.</p>

<p class="nota">La sonda solo lee. No envía formularios, no llama a
<code>__doPostBack</code> y no toca ningún control de guardado. La única
petición que hace sale hacia planilla-app y existe para medir si la política
deja hablar con ella.</p>
</body></html>`;

const salida = join(aquí, 'sonda-csp-bookmarklet.html');
writeFileSync(salida, html);
console.log(`Escrito ${salida} (${kb} KB de bookmarklet)`);
