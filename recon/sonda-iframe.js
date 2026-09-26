/*
 * ¿Se puede manejar la plataforma desde un iframe del mismo origen?
 *
 * Es la pregunta que decide si la asistencia se puede pasar con UN clic.
 *
 * Hoy el favorito de asistencia obliga a poner fecha, hora, curso y asignatura
 * a mano, y por eso marcar en planilla-app no le ahorra tiempo a nadie: es más
 * rápido escribir las fallas directo en la plataforma. El flujo completo del
 * autofill ya sabe recorrer el filtro solo; lo que lo ata a Tampermonkey es
 * que cada paso del filtro recarga la página y un favorito no se vuelve a
 * inyectar tras una recarga.
 *
 * Ya medimos (26/09/2026, `sonda-postback.js`) que ese mismo envío se puede
 * hacer con `fetch` sin recargar. Pero para la asistencia eso no alcanza: hay
 * que ACABAR en una pantalla de verdad, con sus scripts vivos, porque el
 * docente tiene que revisar y pulsar Guardar. Si se reemplaza el DOM con el
 * HTML que vuelve, los scripts no se vuelven a ejecutar y `__doPostBack` queda
 * muerto: la pantalla se ve bien y el Guardar no hace nada.
 *
 * La salida es al revés: el script se queda en la página de ARRIBA y mete la
 * plataforma en un iframe. El iframe navega cuanto quiera —es una página real,
 * con sus scripts y su Guardar funcionando— y el script de arriba nunca se
 * recarga, así que no muere. Al ser los dos del mismo origen, el de arriba
 * puede leer y escribir dentro del iframe sin restricción.
 *
 * Esta sonda mide si eso es posible:
 *
 *   - ¿la plataforma deja que se la meta en un iframe, o lo prohíbe con
 *     `X-Frame-Options` / `Content-Security-Policy: frame-ancestors`?
 *   - ¿el documento de adentro se puede leer desde afuera (mismo origen)?
 *   - ¿adentro están vivos `__doPostBack`, el formulario y el `__VIEWSTATE`?
 *   - ¿una navegación DENTRO del iframe deja al script de arriba intacto y
 *     todavía capaz de leer adentro? Es lo único que de verdad hay que probar:
 *     si eso aguanta, el recorrido entero aguanta.
 *
 * === LO QUE ESTA SONDA NO HACE ===
 *
 *   - No envía nada al cargar la página. Hace falta pulsar el botón del panel.
 *   - No toca el DOM de la página que estás viendo: el iframe se crea, se mide
 *     y se quita.
 *   - No dispara ningún control de escritura. Hay lista negra Y lista blanca,
 *     igual que en `sonda-postback.js`: la navegación de prueba dentro del
 *     iframe es la MÁS CHICA que existe —volver a cargar la misma dirección—,
 *     sin tocar un solo control.
 *   - No toca Guardar, Importar, Actualizar, Editar ni Eliminar, ni por
 *     equivocación: no llama a `__doPostBack` en ningún caso.
 */
(function () {
  'use strict';

  const lim = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  /*
   * Lo que esta sonda no puede disparar ni por equivocación. Va por el nombre
   * del control y no por lo que se crea que hace, así que un control nuevo que
   * se parezca a cualquiera de estos queda fuera solo.
   *
   * Está aunque la sonda NO dispare controles: si algún día alguien le agrega
   * un paso, la lista ya está puesta y la prueba la comprueba.
   */
  const PROHIBIDO = /guardar|save|importar|actualizar|update|editar|edit|eliminar|delete|borrar|insert|nuevo|crear/i;

  /** Y lo único que sí podría dispararse: filtros y consultas, nada más. */
  const PERMITIDO = /^(?:.*\$)?(lst[A-Za-z]*|ddl[A-Za-z]*|btnRefresca|btnConsultar|btnBuscar)$/;

  function sePuedeDisparar(nombre) {
    const n = lim(nombre);
    if (!n) return false;
    if (PROHIBIDO.test(n)) return false;
    return PERMITIDO.test(n);
  }

  /**
   * ¿La respuesta de ESTA misma dirección permite que la enmarquen?
   *
   * Se lee de las cabeceras y no de si el iframe cargó, porque un iframe
   * bloqueado por `X-Frame-Options` a veces se ve como uno que cargó vacío, y
   * confundir las dos cosas llevaría a descartar el camino por el motivo
   * equivocado. Al ser el mismo origen, `fetch` sí deja leer las cabeceras.
   */
  async function cabecerasDeEnmarcado() {
    try {
      const res = await fetch(location.href, { method: 'GET', credentials: 'same-origin' });
      const xfo = res.headers.get('x-frame-options');
      const csp = res.headers.get('content-security-policy');
      const ancestors = csp && /frame-ancestors([^;]*)/i.exec(csp);
      return {
        estado: res.status,
        xFrameOptions: xfo,
        frameAncestors: ancestors ? lim(ancestors[1]) : null,
        // DENY prohíbe siempre; SAMEORIGIN deja justo lo que hace falta acá.
        prohibidoPorCabecera: /deny/i.test(xfo || '')
          || (ancestors ? /'none'/i.test(ancestors[1]) : false),
      };
    } catch (e) {
      return { error: String(e && e.message || e) };
    }
  }

  /** Lo que se puede ver desde afuera del documento de adentro. */
  function medirAdentro(ifr) {
    let doc = null, motivo = null;
    try {
      doc = ifr.contentDocument;
      if (!doc) motivo = 'contentDocument vino vacío';
    } catch (e) {
      motivo = 'el navegador no deja leerlo: ' + String(e && e.message || e);
    }
    if (!doc) return { legible: false, motivo };

    const form = doc.forms && doc.forms[0];
    const vs = doc.getElementById('__VIEWSTATE');
    const win = ifr.contentWindow;
    let tieneDoPostBack = false;
    try { tieneDoPostBack = typeof win.__doPostBack === 'function'; } catch (_) { /* vacío */ }

    // Los controles del filtro que un recorrido tendría que mover, para saber
    // si están donde se espera. Solo se CUENTAN: no se toca ninguno.
    const selects = [...doc.querySelectorAll('select')].map((s) => ({
      id: s.id || null,
      nombre: s.name || null,
      opciones: s.options.length,
      disparable: sePuedeDisparar(s.name || s.id),
    }));

    return {
      legible: true,
      titulo: lim(doc.title),
      url: (function () { try { return ifr.contentWindow.location.href; } catch (_) { return null; } })(),
      tieneFormulario: !!form,
      tieneViewState: !!vs,
      largoViewState: vs ? String(vs.value || '').length : 0,
      tieneDoPostBack,
      selects: selects.length,
      selectsDisparables: selects.filter((s) => s.disparable).length,
      filasDeTabla: doc.querySelectorAll('table tr').length,
    };
  }

  const esperarCarga = (ifr) => new Promise((resolve) => {
    let listo = false;
    const acabar = () => { if (!listo) { listo = true; resolve(true); } };
    ifr.addEventListener('load', acabar, { once: true });
    setTimeout(() => { if (!listo) { listo = true; resolve(false); } }, 20000);
  });

  async function medir() {
    const salida = {
      cuando: new Date().toISOString(),
      pantalla: { url: location.href, titulo: lim(document.title) },
      cabeceras: await cabecerasDeEnmarcado(),
    };

    const ifr = document.createElement('iframe');
    ifr.style.cssText = 'position:fixed;left:-10000px;top:0;width:1024px;height:768px;border:0';
    ifr.src = location.href;
    document.body.appendChild(ifr);

    try {
      salida.primeraCarga = { cargo: await esperarCarga(ifr) };
      Object.assign(salida.primeraCarga, medirAdentro(ifr));

      /*
       * La prueba que de verdad decide: que el iframe NAVEGUE y que el script
       * de aquí arriba siga vivo y siga viendo adentro. La navegación es la
       * más chica que existe —volver a cargar la misma dirección— y no toca
       * ningún control: lo que se mide es si la recarga de adentro mata al de
       * afuera, no qué hace la pantalla.
       */
      const marca = 'testigo-' + Math.random().toString(36).slice(2);
      window.__testigoSonda = marca;
      try { ifr.contentWindow.location.reload(); } catch (e) {
        salida.segundaCarga = { error: 'no se pudo recargar adentro: ' + String(e && e.message || e) };
      }
      if (!salida.segundaCarga) {
        const cargo = await esperarCarga(ifr);
        salida.segundaCarga = Object.assign(
          { cargo, scriptDeArribaVivo: window.__testigoSonda === marca },
          medirAdentro(ifr),
        );
      }
    } finally {
      ifr.remove();
      delete window.__testigoSonda;
    }

    const p = salida.primeraCarga || {};
    const s = salida.segundaCarga || {};
    const sirve = !salida.cabeceras.prohibidoPorCabecera
      && p.legible && p.tieneFormulario && p.tieneDoPostBack
      && s.legible && s.scriptDeArribaVivo && s.tieneDoPostBack;

    salida.veredicto = sirve
      ? 'SE PUEDE: la plataforma se deja enmarcar, se lee desde afuera y una recarga '
        + 'de adentro no mata al script de afuera. El favorito puede hacer el recorrido '
        + 'entero y dejar la pantalla lista para revisar y guardar.'
      : 'NO SE PUEDE con iframe. Mirá abajo cuál de las condiciones falló: si es la '
        + 'cabecera, la plataforma lo prohíbe; si es la lectura, no es el mismo origen; '
        + 'si murió el de arriba, el navegador hizo algo raro.';
    return salida;
  }

  // ---------------------------------------------------------------- panel
  const viejo = document.getElementById('sonda-iframe');
  if (viejo) viejo.remove();

  const caja = document.createElement('div');
  caja.id = 'sonda-iframe';
  caja.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;'
    + 'background:#fff;color:#111;border:1px solid #999;border-radius:10px;padding:12px;'
    + 'font:13px/1.45 system-ui,sans-serif;max-width:420px;box-shadow:0 6px 24px rgba(0,0,0,.25)';
  caja.innerHTML =
    '<strong style="display:block;margin-bottom:6px">¿Sirve un iframe?</strong>'
    + '<p style="margin:0 0 8px;color:#444">Mide si la plataforma se deja manejar desde '
    + 'un iframe. <b>Solo lee:</b> no toca ningún control ni guarda nada.</p>'
    + '<button type="button" id="si-medir">Medir</button> '
    + '<button type="button" id="si-copiar" disabled>Copiar resultado</button> '
    + '<button type="button" id="si-cerrar">Cerrar</button>'
    + '<pre id="si-salida" style="max-height:260px;overflow:auto;background:#f6f6f6;'
    + 'padding:8px;border-radius:6px;margin:8px 0 0;white-space:pre-wrap;word-break:break-word"></pre>';
  document.body.appendChild(caja);

  const salidaEl = caja.querySelector('#si-salida');
  const btnCopiar = caja.querySelector('#si-copiar');
  let ultimo = null;

  caja.querySelector('#si-cerrar').onclick = () => caja.remove();
  caja.querySelector('#si-medir').onclick = async () => {
    salidaEl.textContent = 'Midiendo…';
    try {
      ultimo = await medir();
      salidaEl.textContent = JSON.stringify(ultimo, null, 2);
      btnCopiar.disabled = false;
      console.log('[sonda-iframe]', ultimo);
    } catch (e) {
      salidaEl.textContent = 'Falló: ' + String(e && e.stack || e);
    }
  };
  caja.querySelector('#si-copiar').onclick = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(ultimo, null, 2));
      btnCopiar.textContent = 'Copiado';
      setTimeout(() => { btnCopiar.textContent = 'Copiar resultado'; }, 1500);
    } catch (_) {
      salidaEl.focus();
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PROHIBIDO, PERMITIDO, sePuedeDisparar, medirAdentro };
  }
})();
