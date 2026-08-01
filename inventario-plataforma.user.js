// ==UserScript==
// @name         GLA — Inventario de la plataforma (solo lectura)
// @namespace    https://github.com/devdiegomt/planilla-v2
// @version      1.2.0
// @description  Recorre las pantallas del menú y captura la estructura de cada una. No hace click en ningún control salvo navegar. Salida: un JSON con el mapa de la plataforma.
// @author       devdiegomt
// @match        *://webapps3-classroomliveweb.com/*/Seguro/*.aspx
// @include      /^https?:\/\/[^/]*classroomliveweb\.com(:\d+)?\/.*\/Seguro\/.*\.aspx/
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * QUÉ HACE
 * --------
 * Lee el menú, y para cada pantalla que ofrece: entra, captura su estructura
 * (filtros, tablas, botones, ocultos, validadores) y pasa a la siguiente. Al
 * final descarga un JSON con el mapa.
 *
 * SOLO LECTURA, POR CONSTRUCCIÓN
 * ------------------------------
 * Esta plataforma tiene botones que escriben: Guardar, Importar, Desmarcar,
 * Cambiar Clave, Salida Segura. Un recorrido que hiciera click en todo te
 * cerraría la sesión y modificaría datos sin dejar rastro de qué tocó.
 *
 * Por eso el inventario NO hace click en ningún control. La única acción es
 * navegar, y para eso llama a la propia función del menú:
 *
 *     window.SessionEntrar(titulo, id, pageNum)
 *
 * En todo este archivo no hay un solo `.click()` ni `.submit()` propio, ni se
 * cambia el valor de ningún select, input o checkbox de la página. Los botones
 * se CLASIFICAN (navegación / lectura / escritura) para que el mapa te diga
 * dónde está el peligro, pero no se tocan.
 *
 * CONSECUENCIA
 * ------------
 * Muchas pantallas van a salir sin datos, porque no muestran nada hasta elegir
 * filtros. Eso es lo esperado: esto mapea DÓNDE vive cada cosa y qué filtro la
 * gatea. Extraer los datos es un trabajo aparte, pantalla por pantalla.
 *
 * REQUIERE TAMPERMONKEY: cada navegación recarga la página. Pegado en la
 * consola muere en la primera.
 */

(() => {
  'use strict';

  const CLAVE = 'gla_inventario_v1';
  const ESPERA_MS = 2000;       // entre navegaciones
  const ESPERA_SIN_NAVEGAR_MS = 8000; // si tras navegar no hay recarga, algo falló
  const MAX_INTENTOS = 2;       // por pantalla
  const MAX_CARGAS = 200;       // cortafuegos anti-bucle
  const MAX_VUELTAS_INICIO = 3; // reintentos para recuperar el menú
  const MASCARA_NOMBRES = true;

  const ES_USERSCRIPT = (typeof GM_info !== 'undefined');

  // ======================================================================
  // CLASIFICACIÓN DE BOTONES — el corazón de la seguridad del mapa
  // ======================================================================

  /*
   * Ninguno de estos se toca. Se clasifican para que el JSON diga, por
   * pantalla, cuáles son caminos de escritura. Ante la duda, "desconocido"
   * cuenta como peligroso: nunca se asume que algo es inofensivo.
   */
  const PATRONES = [
    // Ojo con los límites de palabra: sin \b, "cargar" matchea dentro de
    // "Descargar" y un botón de descarga —que es lectura pura— quedaba
    // marcado como escritura.
    ['escritura', /guardar|grabar|importar|elimin|borrar|actualiz|crear|nuevo|adicionar|agregar|enviar|aprobar|anular|rechaz|desmarcar|cambiar\s*clave|\bsubir\b|\bcargar\b/i],
    ['sesion', /salir|salida|cerrar\s*sesi|logout|inicio|home/i],
    ['lectura', /exportar|descargar|consultar|buscar|filtrar|generar|imprimir|\bver\b|detalle|reporte/i],
  ];

  function clasificarBoton(b) {
    // Ordenar una columna de GridView es un postback de solo lectura.
    const destino = b.getAttribute('href') || b.getAttribute('onclick') || '';
    if (/Sort\$/.test(destino)) return 'lectura';

    const texto = [b.getAttribute('title'), b.value, b.textContent, b.getAttribute('alt'),
      b.id, b.getAttribute('name')].map((s) => String(s || '')).join(' ');
    for (const [clase, re] of PATRONES) if (re.test(texto)) return clase;
    return 'desconocido';
  }

  // ======================================================================
  // UTILIDADES
  // ======================================================================

  const lim = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const mask = (s) => {
    const t = lim(s);
    if (!MASCARA_NOMBRES) return t.slice(0, 120);
    return t.replace(/\p{L}{2,}/gu, (p) => p[0] + '·'.repeat(Math.min(p.length - 1, 6))).slice(0, 120);
  };
  const forma = (s) => String(s ?? '').replace(/\d+/g, 'N');
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  const el = (id) => document.getElementById(id);

  const Estado = {
    leer() { try { return JSON.parse(sessionStorage.getItem(CLAVE) || 'null'); } catch (_) { return null; } },
    guardar(e) { try { sessionStorage.setItem(CLAVE, JSON.stringify(e)); } catch (_) { /* nada */ } },
    limpiar() { try { sessionStorage.removeItem(CLAVE); } catch (_) { /* nada */ } },
  };
  let estado = Estado.leer();

  // ======================================================================
  // INVENTARIO DEL MENÚ — presente en todas las páginas (está en la master)
  // ======================================================================

  const RE_LLAMADA = /SessionEntrar\s*\(\s*(['"])([\s\S]*?)\1\s*,\s*(['"]?)([^,'"]*?)\3\s*,\s*(['"]?)([^)'"]*?)\5\s*\)/g;

  function pantallasDelMenu() {
    const porId = new Map();
    const raiz = el('main-menu-navigation');

    for (const elemento of document.querySelectorAll('[onclick], [href]')) {
      const fuente = (elemento.getAttribute('onclick') || '') + ' ' + (elemento.getAttribute('href') || '');
      if (!/SessionEntrar/.test(fuente)) continue;
      RE_LLAMADA.lastIndex = 0;
      const m = RE_LLAMADA.exec(fuente);
      if (!m) continue;

      // Sección = rama de primer nivel del menú.
      let seccion = null;
      if (raiz) {
        let n = elemento;
        while (n && n.parentElement && n.parentElement !== raiz) n = n.parentElement;
        if (n && n.parentElement === raiz) {
          seccion = lim(n.querySelector(':scope > a, :scope > span')?.textContent).slice(0, 60) || null;
        }
      }
      const id = lim(m[4]);
      if (id && !porId.has(id)) porId.set(id, { id, titulo: lim(m[2]), pageNum: lim(m[6]), seccion });
    }
    return [...porId.values()].sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
  }

  // ======================================================================
  // CAPTURA DE UNA PANTALLA — todo lectura
  // ======================================================================

  const OCULTO_SENSIBLE = /VIEWSTATE|EVENTVALIDATION/i;

  // El panel del propio inventario no forma parte de la plataforma: si no se
  // excluye, el mapa termina reportando sus botones como si fueran de la
  // pantalla capturada.
  const PANEL_ID = 'gla-inv';
  const todos = (sel) => [...document.querySelectorAll(sel)].filter((e) => !e.closest('#' + PANEL_ID));

  function capturarPantalla() {
    const cap = {
      url: location.pathname,
      // No se llama "titulo" para no pisar el del menú al fusionar los objetos.
      tituloDocumento: document.title,
      capturadoEn: new Date().toISOString(),
    };

    // --- Filtros y campos de entrada
    cap.selects = todos('select').map((s) => ({
      id: s.id || null,
      name: s.getAttribute('name') || null,
      autoPostBack: /__doPostBack/.test(s.getAttribute('onchange') || ''),
      nOpciones: s.options.length,
      seleccionado: s.value,
      muestra: [...s.options].slice(0, 6).map((o) => ({ v: o.value, t: lim(o.text).slice(0, 50) })),
    })).slice(0, 30);

    cap.entradas = todos('input[type=text], input[type=date], textarea')
      .filter((i) => i.offsetParent || i.getClientRects().length)
      .map((i) => ({
        id: i.id || null, name: i.getAttribute('name') || null,
        tag: i.tagName.toLowerCase(),
        soloLectura: i.readOnly === true,
        autoPostBack: /__doPostBack/.test((i.getAttribute('onchange') || '') + (i.getAttribute('onblur') || '')),
        valorEjemplo: mask(i.value).slice(0, 40),
      })).slice(0, 30);

    // --- Botones: clasificados, jamás tocados
    const botones = todos(
      'input[type=submit], input[type=button], input[type=image], button, a[href*="__doPostBack"]');
    cap.botones = botones.map((b) => ({
      id: b.id || null,
      name: b.getAttribute('name') || null,
      etiqueta: lim(b.title || b.value || b.textContent || b.getAttribute('alt')).slice(0, 50),
      clase: clasificarBoton(b),
      visible: !!(b.offsetParent || b.getClientRects().length),
    })).slice(0, 40);

    const cuenta = {};
    for (const b of cap.botones) cuenta[b.clase] = (cuenta[b.clase] || 0) + 1;
    cap.riesgo = {
      cuentaBotones: cuenta,
      // Lo que hace útil el mapa: qué pantallas pueden modificar datos.
      escribe: (cuenta.escritura || 0) > 0,
      botonesDeEscritura: cap.botones.filter((b) => b.clase === 'escritura').map((b) => b.etiqueta || b.id),
    };

    // --- Tablas
    cap.tablas = todos('table')
      .filter((t) => t.rows.length >= 2)
      .map((t) => {
        const enc = [...t.rows].find((f) => f.querySelector('th')) || t.rows[0];
        const datos = [...t.rows].filter((f) => f !== enc);
        return {
          id: t.id || null,
          nFilas: datos.length,
          encabezados: enc ? [...enc.cells].map((c) => lim(c.textContent).slice(0, 40)) : [],
          // Una fila de muestra, enmascarada: sirve para ver la forma, no los datos.
          muestra: datos[0] ? [...datos[0].cells].map((c) => mask(c.textContent).slice(0, 40)) : [],
          // Convención de names de los controles por fila (índices normalizados).
          controlesPorForma: [...new Set([...t.querySelectorAll('input, select, textarea')]
            .map((e) => forma(e.getAttribute('name') || e.id || e.tagName)))].slice(0, 15),
        };
      }).slice(0, 8);

    cap.tieneDatos = cap.tablas.some((t) => t.nFilas > 0);

    // --- Infraestructura
    cap.ocultos = todos('input[type=hidden]')
      .map((h) => ({
        name: h.getAttribute('name') || h.id,
        largo: (h.value || '').length,
        valor: OCULTO_SENSIBLE.test(h.name || h.id || '') ? null : lim(h.value).slice(0, 40),
      })).slice(0, 40);

    cap.validadores = (window.Page_Validators || []).map((v) => ({
      control: v.controltovalidate, mensaje: lim(v.errormessage).slice(0, 60),
    })).slice(0, 15);

    cap.ajax = !!(window.Sys?.WebForms?.PageRequestManager?.getInstance?.());
    cap.iframes = todos('iframe').map((f) => lim(f.getAttribute('src')).slice(0, 80));
    cap.nAnchors = document.querySelectorAll('a').length;

    return cap;
  }

  // ======================================================================
  // NAVEGACIÓN — la ÚNICA acción que este script ejecuta sobre la página
  // ======================================================================

  /*
   * Se delega en la función del propio menú. Este archivo no llama a .click()
   * ni a .submit() por su cuenta en ninguna parte: si SessionEntrar no existe,
   * aborta en vez de improvisar una navegación.
   */
  function navegarA(pantalla) {
    if (typeof window.SessionEntrar !== 'function') {
      throw new Error('SessionEntrar no está definida en esta página; no improviso otra forma de navegar.');
    }
    window.SessionEntrar(pantalla.titulo, pantalla.id, pantalla.pageNum);
  }

  const hayMenu = () => typeof window.SessionEntrar === 'function';

  /*
   * No todas las pantallas comparten master page: ConsCalificaDocentesGen.aspx,
   * por ejemplo, se titula "Mi Classroom - Principal", trae otro menú (btnMenu
   * "MÓDULOS") y NO define SessionEntrar. Aterrizar ahí dejaba el recorrido sin
   * forma de seguir.
   *
   * La salida es volver al inicio con una navegación GET normal —lo mismo que
   * escribir la URL en la barra—, no pulsando el botón "Inicio" de la página.
   * Un GET a la portada no envía el formulario ni puede escribir nada.
   */
  const PAGINA_INICIO = 'Default.aspx';
  function irAlInicio() {
    location.href = new URL(PAGINA_INICIO, location.href).href;
  }

  // ======================================================================
  // MÁQUINA DE ESTADOS
  // ======================================================================

  function anotar(msg, clase) {
    const linea = { t: new Date().toLocaleTimeString('es-CO'), msg: String(msg), clase: clase || null };
    if (estado) { estado.registro = estado.registro || []; estado.registro.push(linea); Estado.guardar(estado); }
    pintarLinea(linea);
    console.log('[inventario]', msg);
  }

  /*
   * `motivo` explica POR QUÉ terminó, y va dentro del JSON. Sin esto, una
   * corrida cortada por una guarda se entregaba con errores:[] y no había forma
   * de saber qué pasó sin mirar el log en pantalla.
   */
  function terminar(motivo, incompleta) {
    anotar(motivo, incompleta ? 'err' : 'ok');
    if (!estado) return;

    const faltantes = estado.pantallas.slice(estado.indice);
    if (incompleta && faltantes.length) {
      estado.errores.push({
        id: faltantes[0].id, titulo: faltantes[0].titulo,
        motivo: 'corrida interrumpida acá: ' + motivo,
        sinVisitar: faltantes.map((p) => p.id),
      });
    }

    const salida = {
      generado: new Date().toISOString(),
      completa: !incompleta && estado.indice >= estado.pantallas.length,
      motivoFin: motivo,
      // Contexto del final, para diagnosticar sin tener que pedir el log.
      contextoFinal: {
        url: location.pathname,
        menuDisponible: hayMenu(),
        recargas: estado.cargas || 0,
        indice: estado.indice,
        enPopup: !!window.opener,
        enIframe: window.top !== window.self,
      },
      usuario: { tipo: el('ctl00_hfTipUsu')?.value ?? null },
      totalPantallas: estado.pantallas.length,
      capturadas: estado.capturas.length,
      sinVisitar: faltantes.map((p) => ({ id: p.id, titulo: p.titulo, pageNum: p.pageNum })),
      resumen: estado.capturas.map((c) => ({
        id: c.id, titulo: c.titulo, seccion: c.seccion, url: c.url,
        escribe: c.riesgo?.escribe ?? null,
        tieneDatos: c.tieneDatos ?? null,
        nTablas: (c.tablas || []).length,
      })),
      pantallas: estado.capturas,
      errores: estado.errores,
      registro: estado.registro || [],
    };
    descargar(salida);
    estado.activa = false;
    estado.paso = 'TERMINADO';
    Estado.guardar(estado);
    refrescarPanel();
  }

  function descargar(datos) {
    const blob = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventario-gla-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();                       // descarga local; no toca la página
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function continuar() {
    if (!estado || !estado.activa) return;

    estado.cargas = (estado.cargas || 0) + 1;
    if (estado.cargas > MAX_CARGAS) {
      return terminar(`Demasiadas recargas (${estado.cargas}); corto por seguridad.`, true);
    }

    const objetivo = estado.pantallas[estado.indice];
    if (!objetivo) return terminar(`Listo: ${estado.capturas.length} pantallas capturadas.`);

    // Una línea por carga: dónde estamos, si hay menú y qué se busca. Queda en
    // el registro que ahora viaja dentro del JSON.
    anotar(`carga #${estado.cargas} · ${location.pathname} · menú: ${hayMenu() ? 'sí' : 'NO'} · busco ${objetivo.id}`);

    // ¿Llegamos a donde queríamos? El menú da el nombre del .aspx esperado.
    const esperado = (objetivo.pageNum || '').toLowerCase();
    const aqui = location.pathname.toLowerCase();
    const llegamos = esperado && aqui.endsWith(esperado);

    if (llegamos) {
      try {
        const cap = capturarPantalla();
        estado.capturas.push({ ...objetivo, ...cap });
        anotar(`✔ ${objetivo.id} ${objetivo.titulo}` +
          (cap.riesgo.escribe ? ` — escribe (${cap.riesgo.botonesDeEscritura.join(', ')})` : '') +
          (cap.tieneDatos ? ' — con datos' : ''), 'ok');
      } catch (e) {
        estado.errores.push({ id: objetivo.id, titulo: objetivo.titulo, motivo: 'captura: ' + e.message });
        anotar(`✗ ${objetivo.id}: ${e.message}`, 'err');
      }
      estado.indice++;
      estado.intentos = 0;
      Estado.guardar(estado);
      return continuar();
    }

    /* ¿Esta pantalla expone el menú? Si no, volver al inicio antes de intentar
       navegar. No consume un intento de la pantalla objetivo: no es que ella
       falle, es que estamos parados en un sitio del que no se puede salir.

       Hay al menos dos pantallas así, y no son iguales:
         - ConsCalificaDocentesGen.aspx usa otra master page pero sigue siendo
           una página normal del sitio.
         - CalendarioN2.aspx no tiene ni un control ctl00_: sus hidden son
           `hfUser`/`hfAlumno` pelados y trae un "CERRAR AGENDA". Parece pensada
           para abrirse aparte.
       Por eso se reintenta varias veces antes de rendirse, y al rendirse se
       deja constancia de DÓNDE quedó. */
    if (!hayMenu()) {
      estado.vueltasAlInicio = (estado.vueltasAlInicio || 0) + 1;
      Estado.guardar(estado);
      if (estado.vueltasAlInicio > MAX_VUELTAS_INICIO) {
        return terminar(
          `Quedé en ${location.pathname}, que no expone el menú, y ${MAX_VUELTAS_INICIO} intentos ` +
          `de volver a ${PAGINA_INICIO} no lo recuperaron. Abrí la portada a mano y dale Iniciar de nuevo.`, true);
      }
      anotar(`${location.pathname} no expone el menú; vuelvo al inicio (intento ${estado.vueltasAlInicio}).`);
      await dormir(ESPERA_MS);
      return irAlInicio();
    }
    if (estado.vueltasAlInicio) { estado.vueltasAlInicio = 0; Estado.guardar(estado); }

    // Todavía no estamos ahí: navegar (o rendirse con esta y seguir).
    if ((estado.intentos || 0) >= MAX_INTENTOS) {
      estado.errores.push({
        id: objetivo.id, titulo: objetivo.titulo,
        motivo: `no llegué a ${objetivo.pageNum}; quedé en ${location.pathname}`,
      });
      anotar(`✗ ${objetivo.id} ${objetivo.titulo}: no abrió. Sigo con la siguiente.`, 'err');
      estado.indice++;
      estado.intentos = 0;
      Estado.guardar(estado);
      return continuar();
    }

    estado.intentos = (estado.intentos || 0) + 1;
    Estado.guardar(estado);
    refrescarPanel();
    anotar(`→ ${objetivo.id} ${objetivo.titulo} (${objetivo.pageNum})`);
    await dormir(ESPERA_MS);
    if (!estado || !estado.activa) return;
    try {
      navegarA(objetivo);
      /* Si la navegación ocurre, la página se recarga y este temporizador muere
         con ella. Si NO ocurre —el servidor ignoró la petición, la pantalla no
         está disponible— el temporizador sobrevive, y es la única señal de que
         el recorrido se quedó esperando algo que no va a pasar. Sin esto, el
         script se colgaba en silencio. */
      setTimeout(() => {
        if (estado && estado.activa) {
          anotar(`${objetivo.id}: la navegación no ocurrió (sigo en ${location.pathname}).`, 'err');
          continuar();
        }
      }, ESPERA_SIN_NAVEGAR_MS);
    } catch (e) {
      anotar('no pude navegar: ' + e.message, 'err');
      estado.errores.push({ id: objetivo.id, titulo: objetivo.titulo, motivo: e.message });
      estado.indice++;
      estado.intentos = 0;
      Estado.guardar(estado);
      return continuar();
    }
  }

  // ======================================================================
  // PANEL
  // ======================================================================

  const CSS = `
    #gla-inv{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:340px;
      font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1a2330;background:#fff;
      border:1px solid #c3d3c9;border-radius:10px;box-shadow:0 8px 28px rgba(16,48,32,.22);overflow:hidden}
    #gla-inv header{display:flex;gap:8px;padding:9px 12px;background:#1f5f3a;color:#fff;font-weight:600;font-size:12.5px}
    #gla-inv header .pt{flex:1}
    #gla-inv .cuerpo{padding:12px}
    #gla-inv .barra{height:6px;background:#e6f0e9;border-radius:3px;overflow:hidden;margin:9px 0}
    #gla-inv .barra i{display:block;height:100%;width:0;background:#2f9161;transition:width .25s}
    #gla-inv .acciones{display:flex;gap:8px;margin-top:9px}
    #gla-inv button{flex:1;padding:7px 10px;border-radius:6px;border:1px solid transparent;font:inherit;font-weight:600;cursor:pointer}
    #gla-inv button:disabled{opacity:.45;cursor:not-allowed}
    #gla-inv .prim{background:#2f9161;color:#fff}
    #gla-inv .sec{background:#fff;color:#7a2230;border-color:#d9b3ba}
    #gla-inv .log{margin-top:9px;max-height:180px;overflow:auto;font-size:11.5px;background:#f6faf8;
      border:1px solid #dfeae4;border-radius:6px;padding:7px}
    #gla-inv .log div{padding:1px 0;word-break:break-word}
    #gla-inv .log .err{color:#a3253c}
    #gla-inv .log .ok{color:#1d6b3f}
    #gla-inv .nota{margin-top:8px;font-size:11px;color:#5b6981}
    #gla-inv .alerta{margin-bottom:9px;padding:8px;border-radius:6px;background:#fdecec;
      border:1px solid #e2a1a1;color:#7a2230;font-size:11.5px}
  `;

  const panel = document.createElement('div');
  panel.id = 'gla-inv';
  panel.innerHTML = `
    <header><span class="pt">Inventario de la plataforma</span><span id="gi-min" style="cursor:pointer">—</span></header>
    <div class="cuerpo">
      <div id="gi-alerta"></div>
      <div id="gi-estado">Listo.</div>
      <div class="barra"><i id="gi-barra"></i></div>
      <div class="acciones">
        <button class="prim" id="gi-iniciar">Iniciar recorrido</button>
        <button class="sec" id="gi-abortar" disabled>Abortar</button>
      </div>
      <div class="log" id="gi-log"></div>
      <div class="nota">Solo lectura: navega y observa. No pulsa ningún control de las pantallas.</div>
    </div>`;

  const estilo = document.createElement('style');
  estilo.textContent = CSS;
  document.head.appendChild(estilo);
  document.body.appendChild(panel);

  const $estado = panel.querySelector('#gi-estado');
  const $barra = panel.querySelector('#gi-barra');
  const $log = panel.querySelector('#gi-log');
  const $iniciar = panel.querySelector('#gi-iniciar');
  const $abortar = panel.querySelector('#gi-abortar');
  const $cuerpo = panel.querySelector('.cuerpo');

  panel.querySelector('#gi-min').onclick = () => {
    $cuerpo.style.display = $cuerpo.style.display === 'none' ? '' : 'none';
  };

  function pintarLinea(linea) {
    const d = document.createElement('div');
    if (linea.clase) d.className = linea.clase;
    d.textContent = `${linea.t}  ${linea.msg}`;
    $log.appendChild(d);
    $log.scrollTop = $log.scrollHeight;
  }

  function refrescarPanel() {
    const activa = !!(estado && estado.activa);
    const total = estado ? estado.pantallas.length : 0;
    const hechas = estado ? estado.indice : 0;
    $barra.style.width = total ? (hechas / total * 100).toFixed(1) + '%' : '0';
    $estado.textContent = estado
      ? (activa ? `Pantalla ${Math.min(hechas + 1, total)} de ${total}` : `${estado.capturas.length} de ${total} capturadas.`)
      : 'Listo.';
    $iniciar.disabled = activa;
    $abortar.disabled = !activa;
  }

  $iniciar.onclick = async () => {
    const pantallas = pantallasDelMenu();
    if (!pantallas.length) {
      pintarLinea({ t: '', msg: 'No encuentro pantallas en el menú. ¿Estás dentro de la plataforma?', clase: 'err' });
      return;
    }
    $log.innerHTML = '';
    estado = {
      activa: true, indice: 0, intentos: 0, cargas: 0,
      pantallas, capturas: [], errores: [], registro: [],
    };
    Estado.guardar(estado);
    anotar(`${pantallas.length} pantallas en el menú. Empiezo.`);
    refrescarPanel();
    await continuar();
  };

  $abortar.onclick = () => {
    if (estado) { estado.activa = false; Estado.guardar(estado); }
    anotar('Abortado. El parcial queda en sessionStorage por si querés reanudar recargando.', 'err');
    Estado.limpiar();
    estado = null;
    refrescarPanel();
  };

  // ======================================================================
  // ARRANQUE
  // ======================================================================

  if (!ES_USERSCRIPT) {
    panel.querySelector('#gi-alerta').innerHTML =
      '<div class="alerta"><b>No detecto Tampermonkey.</b> Cada pantalla es una recarga; ' +
      'pegado en la consola esto muere en la primera.</div>';
  }

  if (estado && estado.registro) estado.registro.slice(-40).forEach(pintarLinea);
  refrescarPanel();

  if (estado && estado.activa) {
    continuar();
  }
})();
