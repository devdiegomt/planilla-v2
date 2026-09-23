/*
 * SONDA DE RECONOCIMIENTO — ConsCalificaDocentesGen.aspx (24)
 * ==========================================================
 *
 * Por qué existe: es la ÚNICA pantalla de la plataforma que ofrece los cuatro
 * periodos. Las planillas (1096, 1099) solo dan el periodo en curso, así que
 * sin esta no hay historial del año. El catálogo la tiene en "por verificar":
 * se sabe que existe y que tiene "Descargar Tabla", pero nadie ha visto qué
 * entrega ni con qué columnas. Escribir el extractor antes de saberlo sería
 * inventar un formato.
 *
 * Qué hace:  lee el DOM de la página YA CARGADA y devuelve un JSON.
 * Qué NO hace: no envía nada, no dispara postbacks, no pulsa "Descargar
 *            Tabla", no toca la Session ni modifica un solo campo. Es
 *            100 % lectura sobre el DOM local.
 *
 * Privacidad: NO copia el __VIEWSTATE (solo su tamaño). Los nombres salen
 *            enmascarados (MASCARA_NOMBRES = true). Los códigos numéricos sí
 *            salen tal cual: son justamente lo que hay que verificar.
 *
 * Cómo usarla:
 *   1. Abrí ConsCalificaDocentesGen.aspx y cargá un curso con notas a la vista.
 *   2. F12 → pestaña Console.
 *   3. Pegá TODO este archivo y Enter.
 *   4. Se copia sola al portapapeles; si el navegador lo bloquea, queda
 *      impresa en la consola para copiar a mano.
 *
 * Lo que hay que responder, en orden de importancia:
 *   1. ¿Las notas ya están en el DOM? Si están, no hace falta el archivo.
 *   2. ¿"Descargar Tabla" es un enlace, un postback o un export del navegador?
 *   3. ¿Las filas traen COD_ALUM? Sin él no hay cómo emparejar con la app.
 *   4. ¿El selector de periodo trae de verdad los cuatro?
 */
(() => {
  'use strict';

  const MASCARA_NOMBRES = true;   // ponelo en false si preferís mandar los nombres reales

  const limpiar = (s) => (s || '').replace(/\s+/g, ' ').trim();

  // Enmascara letras pero conserva la forma: dígitos, longitud y separadores.
  const enmascarar = (s) => {
    const t = limpiar(s);
    if (!MASCARA_NOMBRES) return t.slice(0, 120);
    return t.replace(/\p{L}{2,}/gu, (p) => p[0] + '·'.repeat(Math.min(p.length - 1, 6))).slice(0, 120);
  };

  const resumir = (el) => el && ({
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    name: el.getAttribute('name') || null,
    clase: el.className || null,
  });

  const salida = {
    url: location.pathname + location.search,
    titulo: document.title,
    cuando: new Date().toISOString(),
  };

  // --- 1. Formulario y ocultos ---------------------------------------------
  // Esta pantalla usa OTRA master page que el resto (ver README-inventario),
  // así que no se puede dar por hecho que el form se llame igual.

  const form = document.forms.aspnetForm || document.forms[0];
  salida.form = form && {
    id: form.id || null,
    nombre: form.getAttribute('name') || null,
    action: form.getAttribute('action'),
    method: form.method,
  };

  const SENSIBLE = /VIEWSTATE|EVENTVALIDATION|VIEWSTATEENCRYPTED|REQUESTDIGEST/i;
  salida.ocultos = [...document.querySelectorAll('input[type=hidden]')].map((h) => {
    const v = h.value || '';
    return {
      id: h.id || null,
      name: h.name || null,
      largo: v.length,
      valor: SENSIBLE.test(h.name || h.id || '') ? `<omitido ${v.length} chars>` : v.slice(0, 60),
    };
  });

  // --- 2. Los filtros: periodo, corte, curso, materia ------------------------
  // Acá se confirma si de verdad están los cuatro periodos y los cuatro cortes.

  salida.selects = [...document.querySelectorAll('select')].map((s) => {
    const onchange = s.getAttribute('onchange');
    return {
      id: s.id || null,
      name: s.getAttribute('name') || null,
      // AutoPostBack: si recarga la página al elegir, un favorito no sobrevive
      // y el recorrido tiene que ser a mano (lo mismo que pasó con asistencia).
      autoPostBack: /__doPostBack/i.test(onchange || ''),
      deshabilitado: s.disabled,
      nOpciones: s.options.length,
      seleccionado: { value: s.value, texto: limpiar(s.selectedOptions[0]?.text) },
      // TODAS las opciones, no una muestra: son listas cortas (periodos,
      // cortes) y es justo lo que hay que conocer para armar el filtro.
      opciones: [...s.options].slice(0, 40).map((o) => ({ value: o.value, texto: limpiar(o.text) })),
    };
  });

  // --- 3. "Descargar Tabla": LA pregunta ------------------------------------
  // Qué es determina todo lo que sigue. Un enlace a un archivo se resuelve con
  // un fetch; un postback obliga a reproducir el formulario; un export hecho
  // en el navegador significa que los datos YA están en el DOM y el archivo
  // sobra.
  //
  // Solo se INSPECCIONA. No se pulsa.

  const ES_DISPARADOR =
    'a, button, input[type=submit], input[type=button], input[type=image], [onclick]';
  const PARECE_DESCARGA = /descargar|exportar|excel|xls|csv|tabla|imprimir|pdf/i;

  salida.descargas = [...document.querySelectorAll(ES_DISPARADOR)]
    .map((b) => ({
      etiqueta: limpiar(b.value || b.textContent || b.getAttribute('alt') || b.title),
      tag: b.tagName.toLowerCase(),
      tipo: b.getAttribute('type') || null,
      id: b.id || null,
      name: b.getAttribute('name') || null,
      href: b.getAttribute('href') || null,
      onclick: limpiar(b.getAttribute('onclick')).slice(0, 240) || null,
      target: b.getAttribute('target') || null,
      download: b.getAttribute('download') || null,
      visible: !!(b.offsetParent || b.getClientRects().length),
    }))
    .filter((b) => PARECE_DESCARGA.test(`${b.etiqueta} ${b.id} ${b.href} ${b.onclick}`))
    .slice(0, 20);

  // Y una lectura de qué clase de cosa es cada una, para no tener que deducirlo
  // a ojo desde el JSON.
  salida.descargasInterpretadas = salida.descargas.map((b) => {
    const txt = `${b.href || ''} ${b.onclick || ''}`;
    let clase = 'desconocido';
    if (/^https?:|^\/|\.aspx|\.xls|\.csv|\.pdf/i.test(b.href || '')) clase = 'enlace a archivo o página';
    else if (/__doPostBack/i.test(txt)) clase = 'postback de ASP.NET';
    else if (/window\.open/i.test(txt)) clase = 'abre otra ventana';
    else if (/blob:|createObjectURL|msSaveBlob|new Blob/i.test(txt)) clase = 'lo arma el navegador (los datos ya están en el DOM)';
    else if (b.tipo === 'submit') clase = 'envía el formulario';
    return { etiqueta: b.etiqueta, id: b.id, clase };
  });

  // --- 4. La tabla de notas -------------------------------------------------
  // Si ya está acá con todo, el archivo descargado sobra: se lee el DOM, que
  // es lo que hace el extractor de códigos.

  salida.tablas = [...document.querySelectorAll('table')]
    .map((t) => ({ t, filas: [...t.rows] }))
    .filter(({ filas }) => filas.length >= 2)
    .map(({ t, filas }) => {
      const encabezado = filas.find((f) => f.querySelector('th')) || filas[0];
      const datos = filas.filter((f) => f !== encabezado).slice(0, 3);
      return {
        id: t.id || null,
        clase: t.className || null,
        nFilas: filas.length,
        nColumnas: encabezado ? encabezado.cells.length : 0,
        encabezados: encabezado ? [...encabezado.cells].map((c) => limpiar(c.textContent)) : [],
        muestraFilas: datos.map((f) => ({
          idFila: f.id || null,
          // A veces el COD_ALUM viaja en un atributo de la fila, no en una celda.
          atributos: [...f.attributes]
            .filter((a) => !['class', 'style'].includes(a.name))
            .map((a) => `${a.name}=${limpiar(a.value).slice(0, 80)}`),
          celdas: [...f.cells].map((c) => enmascarar(c.textContent)),
        })),
      };
    })
    .slice(0, 12);

  // --- 5. ¿Aparece el COD_ALUM? --------------------------------------------
  // Diez dígitos que empiezan por el año de matrícula. Sin él no hay forma de
  // emparejar estas notas con las de la app: el nombre no aguanta un apellido
  // corregido.

  const RE_10 = /\b\d{10}\b/;
  const hallazgos = [];

  const caminador = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = caminador.nextNode(); n && hallazgos.length < 20; n = caminador.nextNode()) {
    const m = RE_10.exec(n.nodeValue || '');
    if (!m) continue;
    const padre = n.parentElement;
    const celda = padre?.closest('td, th');
    const fila = padre?.closest('tr');
    hallazgos.push({
      donde: 'texto',
      valor: m[0],
      contenedor: resumir(padre),
      indiceColumna: celda ? [...(fila?.cells || [])].indexOf(celda) : null,
      tablaId: padre?.closest('table')?.id || null,
    });
  }

  for (const el of document.querySelectorAll('*')) {
    if (hallazgos.length >= 35) break;
    for (const a of el.attributes) {
      if (SENSIBLE.test(el.getAttribute('name') || '')) continue;
      if (a.value.length > 300) continue;
      const m = RE_10.exec(a.value);
      if (!m) continue;
      hallazgos.push({
        donde: `atributo:${a.name}`,
        valor: m[0],
        contenedor: resumir(el),
        fragmento: limpiar(a.value).slice(0, 120),
      });
      break;
    }
  }

  salida.diezDigitos = { total: hallazgos.length, hallazgos };

  // --- 6. Veredicto ---------------------------------------------------------
  // Para no tener que leer 300 líneas de JSON antes de saber qué sigue.

  const conCodigo = hallazgos.length > 0;
  const tablaGrande = salida.tablas.find((t) => t.nFilas >= 5) || null;
  const enNavegador = salida.descargasInterpretadas
    .some((d) => /navegador/.test(d.clase));

  salida.veredicto = {
    hayTablaDeDatos: !!tablaGrande,
    tablaMasProbable: tablaGrande ? { id: tablaGrande.id, filas: tablaGrande.nFilas, columnas: tablaGrande.nColumnas } : null,
    apareceCodAlum: conCodigo,
    quePareceElBotonDeDescarga: salida.descargasInterpretadas,
    siguiente: !tablaGrande
      ? 'La tabla no está cargada. Elegí curso/periodo hasta que se vean las notas y volvé a correr la sonda.'
      : enNavegador
        ? 'Los datos ya están en el DOM: se puede leer de ahí, sin archivo.'
        : conCodigo
          ? 'Hay tabla y hay códigos: se puede leer del DOM. Falta ver qué entrega el botón, por si trae más columnas.'
          : 'Hay tabla pero NO se ve el COD_ALUM: habría que emparejar por nombre, o buscarlo en el archivo que baja el botón.',
  };

  // --- 7. Entrega -----------------------------------------------------------

  const json = JSON.stringify(salida, null, 2);
  console.log('%c=== SONDA ConsCalificaDocentesGen (24) ===', 'font-weight:bold;font-size:14px');
  console.log(salida);
  console.log('%c→ ' + salida.veredicto.siguiente, 'color:#0369a1;font-weight:bold');
  try {
    copy(json);
    console.log('%c✔ JSON copiado al portapapeles (' + json.length + ' chars)', 'color:green;font-weight:bold');
  } catch (_) {
    console.log('%c⚠ No se pudo copiar sola. Copiá el texto de abajo:', 'color:orange;font-weight:bold');
    console.log(json);
  }
  return salida;
})();
