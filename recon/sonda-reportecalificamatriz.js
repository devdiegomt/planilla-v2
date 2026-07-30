/*
 * SONDA DE RECONOCIMIENTO — ReporteCalificaMatriz.aspx (Classroom Live Web)
 * =========================================================================
 *
 * Qué hace:  inspecciona el DOM de la página YA CARGADA con un curso visible y
 *            devuelve un JSON con los ids/names reales de los controles.
 * Qué NO hace: no envía nada, no dispara postbacks, no toca la Session, no
 *            modifica ni un solo campo. Es 100% lectura sobre el DOM local.
 *
 * Privacidad: NO copia el __VIEWSTATE (solo su tamaño). Los nombres de los
 *            estudiantes salen enmascarados (MASCARA_NOMBRES = true). Los
 *            códigos numéricos sí salen tal cual, porque son justamente lo que
 *            hay que verificar.
 *
 * Cómo usarlo:
 *   1. Abrir ReporteCalificaMatriz.aspx y cargar un curso (ej. 801).
 *   2. F12 → pestaña Console.
 *   3. Pegar TODO este archivo y Enter.
 *   4. Se copia solo al portapapeles; si el navegador lo bloquea, aparece
 *      impreso en la consola para copiar a mano.
 */
(() => {
  'use strict';

  const MASCARA_NOMBRES = true; // ponlo en false si prefieres mandarme los nombres reales

  // --- utilidades -----------------------------------------------------------

  const limpiar = (s) => (s || '').replace(/\s+/g, ' ').trim();

  // Enmascara letras pero conserva la forma: dígitos, longitud y separadores.
  const enmascarar = (s) => {
    const t = limpiar(s);
    if (!MASCARA_NOMBRES) return t.slice(0, 120);
    return t.replace(/\p{L}{2,}/gu, (p) => p[0] + '·'.repeat(Math.min(p.length - 1, 6))).slice(0, 120);
  };

  const resumirElemento = (el) => el && ({
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    name: el.getAttribute('name') || null,
    clase: el.className || null,
  });

  // Cadena de ancestros con id, de adentro hacia afuera. Sirve para saber si el
  // control vive dentro de un UpdatePanel y bajo qué ContentPlaceHolder.
  const ancestrosConId = (el, max = 8) => {
    const cadena = [];
    let n = el.parentElement;
    while (n && cadena.length < max) {
      if (n.id) cadena.push({ tag: n.tagName.toLowerCase(), id: n.id });
      n = n.parentElement;
    }
    return cadena;
  };

  const salida = { url: location.pathname + location.search, titulo: document.title };

  // --- 1. Formulario y campos ocultos ---------------------------------------

  const form = document.forms.aspnetForm || document.forms[0];
  salida.form = {
    id: form ? form.id : null,
    action: form ? form.getAttribute('action') : null,
    method: form ? form.method : null,
  };

  // Solo nombre + longitud de los ocultos grandes; valor completo solo si es corto
  // y no es un token de seguridad.
  const OCULTO_SENSIBLE = /VIEWSTATE|EVENTVALIDATION|VIEWSTATEENCRYPTED|REQUESTDIGEST/i;
  salida.ocultos = [...document.querySelectorAll('input[type=hidden]')].map((h) => {
    const v = h.value || '';
    const sensible = OCULTO_SENSIBLE.test(h.name || h.id || '');
    return {
      id: h.id || null,
      name: h.name || null,
      largo: v.length,
      valor: sensible ? `<omitido ${v.length} chars>` : v.slice(0, 60),
    };
  });

  // --- 2. Infraestructura AJAX (¿postback parcial o completo?) --------------

  let prm = null;
  try { prm = window.Sys?.WebForms?.PageRequestManager?.getInstance?.() ?? null; } catch (_) { /* ignorar */ }

  salida.ajax = {
    haySys: typeof window.Sys !== 'undefined',
    hayPageRequestManager: !!prm,
    // Estos arrays son internos de ASP.NET AJAX; si existen dicen mucho.
    controlesAsync: prm?._asyncPostBackControlIDs ?? null,
    controlesPostbackCompleto: prm?._postBackControlIDs ?? null,
    updatePanelsRegistrados: prm?._updatePanelIDs ?? prm?._updatePanelClientIDs ?? null,
    // Heurística por convención de nombres, por si los internos no están expuestos.
    idsQueParecenUpdatePanel: [...document.querySelectorAll('[id]')]
      .map((e) => e.id)
      .filter((id) => /updatepanel|upnl|updpnl|_upd/i.test(id))
      .slice(0, 20),
    hayScriptResource: [...document.scripts].some((s) => /ScriptResource\.axd/i.test(s.src || '')),
  };

  // --- 3. Selectores de curso / grupo / materia -----------------------------

  salida.selects = [...document.querySelectorAll('select')].map((s) => {
    const onchange = s.getAttribute('onchange');
    return {
      id: s.id || null,
      name: s.getAttribute('name') || null,
      onchange,
      // AutoPostBack real: el onchange que emite ASP.NET llama a __doPostBack.
      autoPostBack: /__doPostBack/i.test(onchange || ''),
      // Si el onchange va por el WebForm_ pipeline con validación
      usaWebFormPostback: /WebForm_DoPostBackWithOptions|setTimeout/i.test(onchange || ''),
      deshabilitado: s.disabled,
      nOpciones: s.options.length,
      seleccionado: { value: s.value, texto: limpiar(s.selectedOptions[0]?.text) },
      // Primeras opciones: aquí es donde se ve si el value es "801" o un id interno.
      primerasOpciones: [...s.options].slice(0, 8).map((o) => ({ value: o.value, texto: limpiar(o.text) })),
      ancestros: ancestrosConId(s),
    };
  });

  // --- 4. Botones y disparadores de postback --------------------------------

  const ES_BOTON = 'input[type=submit], input[type=button], input[type=image], button, a[href*="__doPostBack"], a[onclick*="__doPostBack"]';
  salida.botones = [...document.querySelectorAll(ES_BOTON)].map((b) => ({
    tag: b.tagName.toLowerCase(),
    tipo: b.getAttribute('type') || null,
    id: b.id || null,
    name: b.getAttribute('name') || null,
    etiqueta: limpiar(b.value || b.textContent || b.getAttribute('alt') || b.title),
    href: b.getAttribute('href') || null,
    onclick: limpiar(b.getAttribute('onclick')).slice(0, 160) || null,
    visible: !!(b.offsetParent || b.getClientRects().length),
    ancestros: ancestrosConId(b, 4),
  })).filter((b) => b.id !== 'ctl00_btnsession'); // el del menú ya lo conocemos

  // --- 5. Tablas: cuál es la de estudiantes ---------------------------------

  salida.tablas = [...document.querySelectorAll('table')]
    .map((t) => {
      const filas = [...t.rows];
      return { t, filas };
    })
    .filter(({ filas }) => filas.length >= 2)     // descartar tablas de layout triviales
    .map(({ t, filas }) => {
      const encabezado = filas.find((f) => f.querySelector('th')) || filas[0];
      const datos = filas.filter((f) => f !== encabezado).slice(0, 3);
      return {
        id: t.id || null,
        clase: t.className || null,
        nFilas: filas.length,
        nColumnas: encabezado ? encabezado.cells.length : 0,
        encabezados: encabezado ? [...encabezado.cells].map((c) => limpiar(c.textContent)) : [],
        // Muestra de filas reales, con nombres enmascarados y números intactos.
        muestraFilas: datos.map((f) => ({
          idFila: f.id || null,
          claseFila: f.className || null,
          // Atributos propios de la fila: a veces el COD_ALUM viaja aquí.
          atributos: [...f.attributes]
            .filter((a) => !['class', 'style'].includes(a.name))
            .map((a) => `${a.name}=${limpiar(a.value).slice(0, 80)}`),
          celdas: [...f.cells].map((c) => {
            const input = c.querySelector('input, select, textarea');
            return {
              texto: enmascarar(c.textContent),
              // Los inputs de la matriz de notas: su name/id suele codificar la fila.
              control: input ? { tag: input.tagName.toLowerCase(), tipo: input.type || null, id: input.id || null, name: input.getAttribute('name') || null, valor: /^\d+$/.test(input.value || '') ? input.value : '<texto>' } : null,
              atributos: [...c.attributes]
                .filter((a) => !['class', 'style', 'align', 'width'].includes(a.name))
                .map((a) => `${a.name}=${limpiar(a.value).slice(0, 80)}`),
            };
          }),
        })),
        ancestros: ancestrosConId(t, 5),
      };
    })
    .slice(0, 12);

  // --- 6. ¿Dónde vive un número de 10 dígitos? ------------------------------
  // Esta es LA pregunta: si el COD_ALUM se ve en el DOM, aquí aparece y con él
  // la ruta exacta para leerlo.

  const RE_10 = /\b\d{10}\b/;
  const hallazgos = [];

  // 6a. En nodos de texto
  const caminador = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = caminador.nextNode(); n && hallazgos.length < 25; n = caminador.nextNode()) {
    const m = RE_10.exec(n.nodeValue || '');
    if (!m) continue;
    const padre = n.parentElement;
    const celda = padre?.closest('td, th');
    const fila = padre?.closest('tr');
    hallazgos.push({
      donde: 'texto',
      valor: m[0],
      contenedor: resumirElemento(padre),
      indiceColumna: celda ? [...(fila?.cells || [])].indexOf(celda) : null,
      tablaId: padre?.closest('table')?.id || null,
      textoFila: fila ? enmascarar(fila.textContent) : null,
    });
  }

  // 6b. En atributos (value, data-*, onclick, title...)
  for (const el of document.querySelectorAll('*')) {
    if (hallazgos.length >= 45) break;
    for (const a of el.attributes) {
      if (OCULTO_SENSIBLE.test(el.getAttribute('name') || '')) continue;
      if (a.value.length > 300) continue; // saltar blobs
      const m = RE_10.exec(a.value);
      if (!m) continue;
      hallazgos.push({
        donde: `atributo:${a.name}`,
        valor: m[0],
        contenedor: resumirElemento(el),
        fragmento: limpiar(a.value).slice(0, 120),
        tablaId: el.closest('table')?.id || null,
      });
      break;
    }
  }

  salida.diezDigitos = {
    total: hallazgos.length,
    hallazgos,
  };

  // --- 7. Variables y funciones globales de la página -----------------------
  // Por si la página deja los datos en un JS embebido (pasa a menudo en Web Forms
  // con matrices de notas).

  salida.globalesInteresantes = Object.keys(window)
    .filter((k) => /alum|curso|grupo|materia|matriz|calific|planilla|grid/i.test(k))
    .slice(0, 30);

  salida.scriptsEnLinea = [...document.scripts]
    .filter((s) => !s.src && /alum|COD_|curso|grupo|materia/i.test(s.textContent || ''))
    .map((s) => limpiar(s.textContent).slice(0, 300))
    .slice(0, 6);

  // --- 8. Entrega ------------------------------------------------------------

  const json = JSON.stringify(salida, null, 2);
  console.log('%c=== SONDA ReporteCalificaMatriz ===', 'font-weight:bold;font-size:14px');
  console.log(salida);
  try {
    copy(json); // disponible en la consola de Chrome/Edge/Firefox
    console.log('%c✔ JSON copiado al portapapeles (' + json.length + ' chars)', 'color:green;font-weight:bold');
  } catch (_) {
    console.log('%c⚠ No se pudo copiar solo. Copia el texto de abajo:', 'color:orange;font-weight:bold');
    console.log(json);
  }
  return salida;
})();
