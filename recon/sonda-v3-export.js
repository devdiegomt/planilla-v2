/*
 * SONDA v3 — ¿Qué devuelve el botón Exportar?
 * ===========================================
 *
 * Contexto: ReporteCalificaMatriz.aspx NO renderiza tabla de estudiantes
 * (confirmado con la v2: `tablas: []` con el 801 cargado). El COD_ALUM solo
 * puede estar dentro del archivo que genera Exportar. Esta sonda averigua en
 * qué formato viene, para decidir cómo parsearlo sin dependencias.
 *
 * ⚠ OJO — ESTA SONDA SÍ GOLPEA EL SERVIDOR.
 * Las v1/v2 eran lectura pura del DOM. Esta hace UN POST: exactamente el mismo
 * que dispara el botón "Exportar" al hacerle click. Es de lectura (genera un
 * archivo, no modifica nada) y NUNCA toca Importar. Pero conviene saberlo.
 *
 * Además:
 *   - NO guarda el archivo en disco: lo lee en memoria y lo descarta.
 *   - NO cambia de curso: exporta el que ya tengas cargado.
 *   - Tras correrla, RECARGA la página (F5) para refrescar el __VIEWSTATE.
 *
 * Cómo usarla:
 *   1. ReporteCalificaMatriz.aspx con el 801 cargado (no "< TODOS >").
 *   2. F12 → Console → pegar todo → Enter.
 *   3. Esperar el "✔ listo" y pegarme el JSON.
 */
(async () => {
  'use strict';

  const MASCARA_NOMBRES = true; // false si prefieres mandarme los nombres reales

  const lim = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const mask = (s) => {
    const t = lim(s);
    if (!MASCARA_NOMBRES) return t.slice(0, 160);
    // Conserva dígitos y forma; sustituye solo las letras.
    return t.replace(/\p{L}{2,}/gu, (p) => p[0] + '·'.repeat(Math.min(p.length - 1, 6))).slice(0, 160);
  };

  const salida = { corridaEn: new Date().toISOString() };

  // --- 1. Serializar el formulario tal cual lo haría el navegador -----------

  const form = document.forms.aspnetForm;
  if (!form) { console.error('No encuentro #aspnetForm'); return; }

  const cursoActual = document.getElementById('ctl00_ContentPlaceHolder1_lstCurso');
  salida.cursoExportado = cursoActual
    ? { value: JSON.stringify(cursoActual.value), texto: lim(cursoActual.selectedOptions[0]?.text) }
    : null;

  if (cursoActual && cursoActual.value.trim() === '%') {
    console.warn('⚠ Tienes "< TODOS >" seleccionado. Carga el 801 y vuelve a correr esto.');
    return;
  }

  // Construyo los campos a mano en vez de con FormData(form): así controlo
  // exactamente qué se envía y me aseguro de excluir botones que no quiero.
  const OMITIR_TIPOS = new Set(['submit', 'button', 'reset', 'image', 'file']);
  const params = new URLSearchParams();

  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    const tipo = (el.type || '').toLowerCase();
    if (OMITIR_TIPOS.has(tipo)) continue;                       // fuera Importar, Exportar, Salir, iconos
    if ((tipo === 'checkbox' || tipo === 'radio') && !el.checked) continue;
    if (el.tagName === 'SELECT' && el.multiple) {
      for (const o of el.selectedOptions) params.append(el.name, o.value);
      continue;
    }
    params.append(el.name, el.value);
  }

  // Un botón <input type=submit> viaja como par name=value, y el postback va
  // por ese par (no por __EVENTTARGET, que es para los controles con
  // __doPostBack). Esto replica el click en Exportar.
  params.set('__EVENTTARGET', '');
  params.set('__EVENTARGUMENT', '');
  params.set('ctl00$ContentPlaceHolder1$btnExportar', 'Exportar');

  salida.camposEnviados = {
    total: [...params.keys()].length,
    nombres: [...params.keys()],
    // Confirmación de que NO va Importar en el POST.
    incluyeImportar: params.has('ctl00$ContentPlaceHolder1$btnImportar'),
  };

  // --- 2. Disparar el POST --------------------------------------------------

  console.log('→ POST Exportar…');
  let r;
  try {
    r = await fetch(form.action, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
  } catch (e) {
    console.error('Falló el fetch:', e);
    salida.error = String(e);
    console.log(JSON.stringify(salida, null, 2));
    return;
  }

  const buf = await r.arrayBuffer();
  const bytes = new Uint8Array(buf);

  salida.respuesta = {
    status: r.status,
    urlFinal: r.url,                                    // delata un redirect a .xls
    redirigido: r.redirected,
    contentType: r.headers.get('content-type'),
    contentDisposition: r.headers.get('content-disposition'), // el nombre de archivo
    contentLength: r.headers.get('content-length'),
    bytes: bytes.length,
  };

  // --- 3. Identificar el formato por firma de bytes -------------------------

  const hex = (n) => [...bytes.slice(0, n)].map((b) => b.toString(16).padStart(2, '0')).join(' ');
  salida.primerosBytesHex = hex(32);

  const empiezaCon = (...sig) => sig.every((b, i) => bytes[i] === b);
  let formato;
  if (empiezaCon(0x50, 0x4b, 0x03, 0x04)) formato = 'ZIP → XLSX real (necesita inflate)';
  else if (empiezaCon(0xd0, 0xcf, 0x11, 0xe0)) formato = 'OLE2 → XLS binario antiguo';
  else if (empiezaCon(0x25, 0x50, 0x44, 0x46)) formato = 'PDF';
  else formato = 'texto (CSV / TSV / HTML / XML) — ver preview';
  salida.formatoDetectado = formato;

  // --- 4. Si es texto, mirarlo por dentro -----------------------------------

  const esBinario = /ZIP|OLE2|PDF/.test(formato);
  let texto = '';

  if (!esBinario) {
    // Los exports de Web Forms suelen venir en windows-1252; pruebo ambos.
    const utf8 = new TextDecoder('utf-8').decode(buf);
    const w1252 = new TextDecoder('windows-1252').decode(buf);
    const rotosUtf8 = (utf8.match(/�/g) || []).length;
    texto = rotosUtf8 > 0 ? w1252 : utf8;
    salida.codificacion = { caracteresRotosEnUtf8: rotosUtf8, elegida: rotosUtf8 > 0 ? 'windows-1252' : 'utf-8' };

    salida.preview = mask(texto.slice(0, 600));

    // ¿Es en realidad la misma página HTML devuelta (export que no disparó)?
    salida.pareceLaPaginaDeVuelta = /__VIEWSTATE|aspnetForm/.test(texto.slice(0, 4000));

    // ¿Es un .xls que en realidad es HTML? Ese es el caso bueno: DOMParser y listo.
    const pareceHtml = /<table|<html|<tr[\s>]/i.test(texto.slice(0, 4000));
    salida.pareceHtmlConTablas = pareceHtml;

    if (pareceHtml) {
      const doc = new DOMParser().parseFromString(texto, 'text/html');
      salida.tablasEnElArchivo = [...doc.querySelectorAll('table')].slice(0, 5).map((t) => ({
        filas: t.rows.length,
        columnas: t.rows[0]?.cells.length ?? 0,
        encabezados: t.rows[0] ? [...t.rows[0].cells].map((c) => lim(c.textContent)).slice(0, 20) : [],
        fila1: t.rows[1] ? [...t.rows[1].cells].map((c) => mask(c.textContent)).slice(0, 20) : [],
        fila2: t.rows[2] ? [...t.rows[2].cells].map((c) => mask(c.textContent)).slice(0, 20) : [],
      }));
    } else {
      // CSV/TSV: mostrar las primeras líneas y el separador probable.
      const lineas = texto.split(/\r?\n/).slice(0, 6);
      const sep = [',', ';', '\t', '|']
        .map((s) => ({ s, n: (lineas[0] || '').split(s).length }))
        .sort((a, b) => b.n - a.n)[0];
      salida.separadorProbable = { caracter: JSON.stringify(sep.s), columnas: sep.n };
      salida.primerasLineas = lineas.map(mask);
    }

    // --- 5. LA pregunta: ¿hay COD_ALUM de 10 dígitos? -----------------------
    const diez = texto.match(/\b\d{10}\b/g) || [];
    const unicos = [...new Set(diez)];
    salida.codAlum = {
      totalCoincidencias: diez.length,
      unicos: unicos.length,
      // Los primeros 3, para que verifiques contra tu Califica del 801.
      muestra: unicos.slice(0, 3),
      // Si no hay de 10, ver qué largos de número aparecen.
      otrosLargos: [...new Set((texto.match(/\b\d{5,14}\b/g) || []).map((n) => n.length))].sort((a, b) => a - b),
    };

    // Contexto de la primera coincidencia: qué la rodea en el archivo.
    if (unicos.length) {
      const i = texto.indexOf(unicos[0]);
      salida.codAlum.contexto = mask(texto.slice(Math.max(0, i - 120), i + 120));
    }
  } else {
    salida.nota = 'Binario: no puedo inspeccionarlo aquí. El formato detectado decide el plan.';
  }

  // --- 6. Entrega -----------------------------------------------------------

  const json = JSON.stringify(salida, null, 2);
  console.log('%c=== SONDA v3 — Exportar ===', 'font-weight:bold;font-size:14px');
  console.log(salida);
  try {
    copy(json);
    console.log('%c✔ listo — JSON copiado al portapapeles (' + json.length + ' chars)', 'color:green;font-weight:bold');
  } catch (_) {
    console.log('%c⚠ Copia manual del texto de abajo:', 'color:orange;font-weight:bold');
    console.log(json);
  }
  console.log('%c↻ Recarga la página (F5) antes de seguir usándola.', 'color:#0aa;font-weight:bold');
  return salida;
})();
