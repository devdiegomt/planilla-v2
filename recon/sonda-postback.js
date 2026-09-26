/*
 * ¿Se puede hacer un postback SIN que la página se recargue?
 *
 * Es la pregunta que decide si Tampermonkey sigue haciendo falta.
 *
 * Hoy el reparto es: un userscript se reinyecta en cada carga, así que aguanta
 * un recorrido de varios pasos; un favorito no, así que solo sirve para lo de
 * un solo golpe ("Solo marcar" de la asistencia). Por eso el extractor de
 * actividades, el de historial y el autofill de la matriz —que recorren— piden
 * extensión.
 *
 * Pero eso vale mientras el postback NAVEGUE. WebForms manda el formulario
 * entero por POST y devuelve la página entera; si en vez de dejar que el
 * navegador navegue se hace ese mismo POST con `fetch` y se actualiza el DOM
 * con lo que vuelve, la página nunca se recarga y el script no muere. Es, en
 * el fondo, lo que hace un UpdatePanel.
 *
 * Esta sonda NO implementa eso. Solo mide si el servidor colabora:
 *
 *   - ¿acepta el POST desde `fetch`, o exige algo que el navegador pone solo?
 *   - ¿devuelve HTML de la página, o un redirect al login?
 *   - ¿viene un `__VIEWSTATE` nuevo? (sin eso, el segundo POST ya falla)
 *   - ¿viene la tabla de datos que se esperaba?
 *
 * === LO QUE ESTA SONDA NO HACE ===
 *
 *   - No toca el DOM de la página. Lo que vuelve se mide y se tira.
 *   - No dispara ningún control de escritura. Hay una lista negra y, además,
 *     el disparo por defecto va SIN `__EVENTTARGET`: es el postback más chico
 *     que existe, un "vuelve a dibujar la misma página".
 *   - No envía nada al cargar. Hace falta pulsar el botón del panel.
 */
(function () {
  'use strict';

  const lim = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  /*
   * Lo que esta sonda no puede disparar ni por equivocación. Se mira el nombre
   * del control, no lo que se cree que hace: un nombre nuevo que se parezca a
   * cualquiera de estos queda fuera solo.
   */
  const PROHIBIDO = /guardar|save|importar|actualizar|update|editar|edit|eliminar|delete|borrar|insert|nuevo|crear/i;

  /** El formulario de WebForms y todo lo que lleva escondido. */
  function leerFormulario() {
    const form = document.forms['aspnetForm'] || document.querySelector('form');
    if (!form) return { error: 'no hay formulario en esta pantalla' };

    const ocultos = {};
    for (const el of form.querySelectorAll('input[type=hidden][name]')) {
      ocultos[el.name] = el.value;
    }
    return {
      form,
      accion: form.getAttribute('action') || location.pathname + location.search,
      metodo: (form.getAttribute('method') || 'post').toUpperCase(),
      ocultos,
      tieneViewState: '__VIEWSTATE' in ocultos,
      tieneEventValidation: '__EVENTVALIDATION' in ocultos,
      nOcultos: Object.keys(ocultos).length,
    };
  }

  /**
   * El cuerpo del POST, igual que lo armaría el navegador: todos los campos
   * con nombre que no estén deshabilitados, más el evento.
   *
   * Los deshabilitados se omiten a propósito — el navegador tampoco los manda,
   * y mandarlos es la diferencia entre reproducir un postback y inventarse uno.
   */
  function armarCuerpo(form, eventTarget, eventArgument) {
    const datos = new URLSearchParams();
    for (const el of form.querySelectorAll('input[name], select[name], textarea[name]')) {
      if (el.disabled) continue;
      if (el.type === 'checkbox' || el.type === 'radio') {
        if (el.checked) datos.append(el.name, el.value);
        continue;
      }
      if (el.type === 'submit' || el.type === 'image' || el.type === 'button') continue;
      datos.append(el.name, el.value);
    }
    datos.set('__EVENTTARGET', eventTarget || '');
    datos.set('__EVENTARGUMENT', eventArgument || '');
    return datos;
  }

  /** Qué trajo la respuesta, medido sobre el HTML y sin tocar la página. */
  function medirRespuesta(html, viewStateAnterior) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const form = doc.forms['aspnetForm'] || doc.querySelector('form');
    const vs = doc.querySelector('input[name="__VIEWSTATE"]');
    const tablas = [...doc.querySelectorAll('table')]
      .filter((t) => t.rows.length >= 3);

    // Si la sesión se cayó, lo que vuelve es el login y no la pantalla.
    const pareceLogin = /Login|Ingresar|Usuario y contrase/i.test(doc.title || '')
      || !!doc.querySelector('input[type=password]');

    return {
      esHtmlDeLaPlataforma: !!form,
      pareceLogin,
      viewStateNuevo: !!vs,
      viewStateCambio: !!vs && vs.value !== viewStateAnterior,
      titulo: lim(doc.title).slice(0, 80),
      tablasConDatos: tablas.length,
      filasDeLaMayor: tablas.length
        ? Math.max(...tablas.map((t) => t.rows.length)) : 0,
      bytes: html.length,
    };
  }

  // --- Panel ----------------------------------------------------------------

  const panel = document.createElement('div');
  panel.id = 'gla-sonda-postback';
  panel.innerHTML = `
<style>
  #gla-sonda-postback{position:fixed;right:14px;bottom:14px;width:390px;z-index:99999;
    font:13px/1.45 system-ui,sans-serif;background:#fff;color:#111;
    border:1px solid #cbd5e1;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.18)}
  #gla-sonda-postback header{display:flex;gap:8px;padding:9px 12px;background:#1e3a5f;color:#fff;border-radius:9px 9px 0 0}
  #gla-sonda-postback .pt{font-weight:600;flex:1}
  #gla-sonda-postback .cuerpo{padding:11px 12px;max-height:70vh;overflow:auto}
  #gla-sonda-postback button{font:inherit;padding:.45rem .8rem;border-radius:7px;border:1px solid #cbd5e1;
    background:#f8fafc;cursor:pointer;margin:2px 4px 2px 0}
  #gla-sonda-postback button.p{background:#1e3a5f;color:#fff;border-color:#1e3a5f}
  #gla-sonda-postback pre{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;
    padding:6px;font:11px/1.5 ui-monospace,monospace;max-height:280px;overflow:auto;white-space:pre-wrap}
  #gla-sonda-postback .aviso{background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:7px;margin-bottom:8px}
</style>
<header><span class="pt">¿Postback sin recargar?</span><button id="sp-x">×</button></header>
<div class="cuerpo">
  <div class="aviso">
    Esta sonda <strong>solo mide</strong>. Manda UN postback de "vuelve a dibujar
    la misma página", mira qué contesta el servidor y tira la respuesta.
    No toca esta pantalla ni dispara ningún control de guardado.
  </div>
  <div id="sp-estado"></div>
  <div>
    <button id="sp-ir" class="p">Medir</button>
    <button id="sp-copiar">Copiar resultado</button>
  </div>
  <pre id="sp-salida">Pulsá "Medir".</pre>
</div>`;
  document.body.appendChild(panel);
  const $ = (s) => panel.querySelector(s);
  $('#sp-x').onclick = () => panel.remove();

  const info = leerFormulario();
  $('#sp-estado').innerHTML = info.error
    ? `<p style="color:#b91c1c">${info.error}</p>`
    : `<p style="margin:0 0 8px">Formulario: <code>${info.accion}</code> · `
      + `${info.nOcultos} campos ocultos · `
      + `VIEWSTATE ${info.tieneViewState ? '✔' : '✗'} · `
      + `EventValidation ${info.tieneEventValidation ? '✔' : '✗'}</p>`;

  let resultado = null;

  $('#sp-ir').onclick = async () => {
    if (info.error) return;
    $('#sp-ir').disabled = true;
    $('#sp-salida').textContent = 'Midiendo…';

    // Por defecto, SIN __EVENTTARGET: el postback más chico que existe.
    const objetivo = '';
    if (objetivo && PROHIBIDO.test(objetivo)) {
      $('#sp-salida').textContent = 'control no permitido para esta sonda: ' + objetivo;
      return;
    }

    const cuerpo = armarCuerpo(info.form, objetivo, '');
    const t0 = performance.now();
    try {
      const r = await fetch(info.accion, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: cuerpo.toString(),
        redirect: 'follow',
      });
      const html = await r.text();
      resultado = {
        medidoEn: new Date().toISOString(),
        pantalla: location.pathname.split('/').pop(),
        peticion: {
          ok: r.ok, status: r.status, tipo: r.headers.get('content-type'),
          redirigido: r.redirected, urlFinal: r.url.split('/').pop(),
          ms: Math.round(performance.now() - t0),
          camposEnviados: [...cuerpo.keys()].length,
        },
        respuesta: medirRespuesta(html, info.ocultos['__VIEWSTATE']),
      };
      resultado.veredicto = veredicto(resultado);
    } catch (e) {
      resultado = { error: e.message, pista: 'si dice "Failed to fetch", puede ser CORS o la red del colegio' };
    }
    $('#sp-salida').textContent = JSON.stringify(resultado, null, 2);
    $('#sp-ir').disabled = false;
  };

  function veredicto(r) {
    const p = r.peticion, s = r.respuesta;
    if (!p.ok) return `El servidor contestó ${p.status}: el POST desde fetch no pasa.`;
    if (s.pareceLogin) return 'Volvió el login: la sesión no viaja en el fetch.';
    if (!s.esHtmlDeLaPlataforma) return 'Contestó algo que no es la página.';
    if (!s.viewStateNuevo) return 'Sin VIEWSTATE nuevo: el segundo postback ya fallaría.';
    return 'SE PUEDE: contestó la página con VIEWSTATE nuevo. '
      + 'Un favorito podría recorrer el filtro sin recargarse.';
  }

  $('#sp-copiar').onclick = async () => {
    if (!resultado) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(resultado, null, 2));
      $('#sp-copiar').textContent = '✔ Copiado';
      setTimeout(() => { $('#sp-copiar').textContent = 'Copiar resultado'; }, 1500);
    } catch { /* queda el texto para seleccionarlo a mano */ }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { leerFormulario, armarCuerpo, medirRespuesta, PROHIBIDO };
  }
})();
