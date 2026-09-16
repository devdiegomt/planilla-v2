/*
 * SONDA — ¿deja la plataforma correr un bookmarklet?
 * =================================================
 *
 * Mide si se puede reemplazar Tampermonkey por un bookmarklet (un favorito con
 * código, que se instala arrastrándolo a la barra: sin extensión, sin pegar
 * scripts y sin activar "Permitir user scripts" en chrome://extensions).
 *
 * Solo lee. NO envía formularios, NO llama a __doPostBack, NO toca Guardar ni
 * ningún control de escritura. La única petición que hace sale hacia la propia
 * planilla-app (un ícono estático) y sirve justamente para medir si la CSP deja
 * hablar con ella; no toca el servidor del colegio.
 *
 * LA PREGUNTA NO ES UNA SOLA
 * --------------------------
 * El autofill pesa ~48 KB, así que un bookmarklet no puede llevarlo adentro sin
 * más: tendría que CARGARLO, y eso es lo primero que una CSP corta. Por eso la
 * sonda mide cuatro caminos por separado, de mejor a peor para nosotros:
 *
 *   A. <script> con el código adentro   → basta con inyectar el panel
 *   B. eval / new Function              → sirve un cargador chico + fetch
 *   C. <script src="…planillaapp…">     → el camino más cómodo de mantener
 *   D. fetch a planillaapp              → hace falta para B
 *
 * Con que pase A, ya hay salida: el script iría embebido en el bookmarklet.
 *
 * CÓMO USARLA — dos pasos
 * -----------------------
 * PASO 0 (el que de verdad decide):
 *   Crear un favorito cualquiera, editarlo y poner como dirección:
 *
 *     javascript:alert('Los bookmarklets corren aquí')
 *
 *   Abrir la pantalla de asistencia del colegio y hacer clic en ese favorito.
 *   - Si sale el aviso → los bookmarklets corren. Seguir al paso 1.
 *   - Si no sale nada  → el navegador o la página los bloquea. Igual hacé el
 *     paso 1: dice por qué, y el resultado sirve para la reunión.
 *
 * PASO 1:
 *   En esa misma pantalla, F12 → Console → pegar este archivo → Enter.
 *   Copiar el JSON que imprime y mandármelo.
 *
 * Correrla en la pantalla de asistencia y no en el inicio: la CSP puede
 * cambiar por página, y esa es la que importa.
 */
(async () => {
  // JS de verdad y del mismo origen que la app: si CARGA, el camino cómodo
  // existe. Un SVG no servía — como no es JS, 'error' salta siempre y no
  // distingue "bloqueado" de "cargó pero no es script".
  const PRUEBA_URL = 'https://planillaapp.vercel.app/sw.js';
  const violaciones = [];

  // Una violación de CSP expone la política ENTERA en `originalPolicy`, incluso
  // cuando vino por cabecera (que desde JS no se puede leer). Es la única forma
  // de ver la política real sin acceso al servidor.
  const onViol = (e) => violaciones.push({
    directivaEfectiva: e.effectiveDirective,
    recursoBloqueado: String(e.blockedURI || '').slice(0, 120),
    disposicion: e.disposition,            // 'enforce' o 'report' (solo avisa)
    politicaCompleta: e.originalPolicy || null,
  });
  document.addEventListener('securitypolicyviolation', onViol);
  const esperar = (ms) => new Promise(r => setTimeout(r, ms));

  // --- A. <script> con el código adentro ---
  let A = false;
  try {
    const marca = '__sondaCsp_' + Math.random().toString(36).slice(2);
    const s = document.createElement('script');
    s.textContent = `window[${JSON.stringify(marca)}] = true;`;
    document.documentElement.appendChild(s);
    s.remove();
    A = window[marca] === true;
    delete window[marca];
  } catch (e) { A = false; }

  // --- B. eval y new Function ---
  let Beval = false, Bfunc = false;
  try { Beval = eval('1+1') === 2; } catch (e) { Beval = false; }
  try { Bfunc = new Function('return 1+1')() === 2; } catch (e) { Bfunc = false; }

  // --- C. <script src> externo ---
  const C = await new Promise((resolve) => {
    let listo = false;
    const s = document.createElement('script');
    s.src = PRUEBA_URL;                       // no es JS: solo interesa si CARGA
    const fin = (ok) => { if (!listo) { listo = true; s.remove(); resolve(ok); } };
    // Un SVG no es JS, así que 'load' no dispara; lo que se mide es si el
    // navegador llegó a pedirlo o lo cortó antes por política.
    s.addEventListener('load', () => fin(true));
    s.addEventListener('error', () => fin('error'));
    document.documentElement.appendChild(s);
    setTimeout(() => fin('sin-respuesta'), 3000);
  });

  // --- D. fetch a la app ---
  let D;
  try {
    const r = await fetch(PRUEBA_URL, { method: 'GET', mode: 'cors', cache: 'no-store' });
    D = { ok: r.ok, estado: r.status };
  } catch (e) {
    D = { ok: false, error: String(e && e.message).slice(0, 140) };
  }

  await esperar(400);
  document.removeEventListener('securitypolicyviolation', onViol);

  // La señal fiable es la violación, no el load/error: un fetch puede fallar
  // por CORS (que se arregla) o por CSP (que no). Solo la CSP dispara el evento.
  const bloqueadoPorCsp = (frag) => violaciones.some(
    v => String(v.recursoBloqueado || '').includes(frag));
  const cspCortaLaApp = bloqueadoPorCsp('planillaapp');

  const metas = [...document.querySelectorAll('meta[http-equiv]')]
    .filter(m => /content-security-policy/i.test(m.getAttribute('http-equiv') || ''))
    .map(m => ({ httpEquiv: m.getAttribute('http-equiv'), content: m.content }));

  // Con A o con B ya hay camino; C y D solo dicen cuán cómodo es mantenerlo.
  const hayCamino = A || Beval || Bfunc;

  const salida = {
    sonda: 'csp-bookmarklet',
    url: location.href.split('?')[0],
    navegador: navigator.userAgent,
    fecha: new Date().toISOString(),
    pruebas: {
      A_scriptEnLinea: A,
      B_eval: Beval,
      B_newFunction: Bfunc,
      C_scriptExterno: C,
      D_fetchAppExterna: D,
    },
    cspEnMeta: metas,
    violaciones,
    // Un fallo de C o D SIN violación no es la CSP: es CORS o la red, y eso se
    // arregla del lado de planilla-app. Con violación, no hay vuelta.
    appBloqueadaPorCsp: cspCortaLaApp,
    veredicto: !hayCamino
      ? 'Sin camino por bookmarklet en esta página: la CSP corta la ejecución. Ver violaciones.'
      : C === true
        ? 'Hay camino cómodo: el bookmarklet puede cargar el script desde planilla-app.'
        : cspCortaLaApp
          ? 'Hay camino, pero la CSP no deja traer el script: tendría que ir embebido (~48 KB).'
          : 'Hay camino. El script externo no cargó, pero NO fue la CSP (CORS o red): '
            + 'revisar del lado de planilla-app antes de descartar el camino cómodo.',
  };

  const texto = JSON.stringify(salida, null, 2);
  console.log('%c SONDA CSP ', 'background:#0f172a;color:#fff', salida.veredicto);
  console.log(texto);

  // El portapapeles va con límite de tiempo y sin bloquear el resultado: si el
  // navegador no concede el permiso, `writeText` no rechaza — se queda
  // esperando para siempre, y la sonda no devolvía nunca.
  Promise.race([
    navigator.clipboard?.writeText(texto) ?? Promise.reject(new Error('sin portapapeles')),
    new Promise((_, rej) => setTimeout(() => rej(new Error('tiempo agotado')), 1500)),
  ]).then(
    () => console.log('Copiado al portapapeles.'),
    () => console.log('No pude copiar solo: seleccioná el JSON de arriba y copialo a mano.'),
  );

  return salida;
})();
