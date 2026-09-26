// ==UserScript==
// @name         GLA — Historial de definitivas por periodo
// @namespace    https://github.com/devdiegomt/planilla-v2
// @version      1.0.0
// @description  Recorre ConsCalificaDocentesGen y arma un JSON con la definitiva de cada estudiante por periodo. Solo lectura.
// @author       devdiegomt
// @match        *://webapps3-classroomliveweb.com/*/Seguro/ConsCalificaDocentesGen.aspx
// @include      https://webapps3-classroomliveweb.com:2443/*/Seguro/ConsCalificaDocentesGen.aspx
// @include      /^https?:\/\/[^/]*classroomliveweb\.com(:\d+)?\/.*\/Seguro\/ConsCalificaDocentesGen\.aspx/
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * POR QUÉ EXISTE
 * --------------
 * Es la única pantalla con los periodos anteriores: las planillas (1096, 1099)
 * solo dan el que está en curso. Sin esto no hay forma de saber en cuánto lleva
 * la materia cada estudiante sin recorrer 19 cursos por periodo a mano.
 *
 * Lo que la app NO puede sacar de otro lado es la definitiva de T1 y T2. Eso es
 * lo que trae, y nada más: las cinco categorías, la evaluación bimestral, las
 * fallas y los retardos están en la misma tabla y se ignoran a propósito. La
 * asistencia la app ya la tiene de primera mano, y el desglose por categoría
 * también. Traerlos sería guardar dos veces lo mismo.
 *
 * ESTA PANTALLA NO ESCRIBE
 * ------------------------
 * Es de consulta: no tiene Guardar, ni Importar, ni nada que modifique. Los
 * postbacks que dispara este script son los mismos que dispara elegir en los
 * desplegables, que es lo que harías a mano.
 *
 *   - Nunca toca "Descargar Tabla" (btnDescarga). Teniendo la tabla en el DOM
 *     el archivo no hace falta, y no vale la pena averiguar qué manda.
 *   - Nunca pone lstCurso en "%". Medido: con "< TODOS >" la pantalla deja de
 *     dibujar la tabla, así que además de inútil sería un postback perdido.
 *   - Un postback en vuelo por vez, con espera entre uno y otro.
 *   - No arranca solo: hace falta un clic.
 *
 * POR QUÉ USERSCRIPT Y NO BOOKMARKLET
 * -----------------------------------
 * Los cuatro filtros son AutoPostBack: cada elección recarga la página. Un
 * favorito no se vuelve a inyectar tras una recarga; un userscript sí. Por eso
 * el estado vive en sessionStorage y la corrida continúa sola tras cada carga.
 *
 * CUÁNTO TARDA
 * ------------
 * Un periodo son 19 cursos + 1 para fijar el periodo = 20 postbacks. Con los
 * dos periodos pasados, 40. A ESPERA_MS más lo que tarde la página, entre dos y
 * cuatro minutos. El panel lo dice antes de arrancar.
 */

(() => {
  'use strict';

  // ======================================================================
  // CONFIGURACIÓN
  // ======================================================================

  const CLAVE_ESTADO = 'gla_historial_estado_v1';
  const ESPERA_MS = 1500;   // mínimo entre postbacks
  const MAX_INTENTOS = 3;   // por combinación
  const MAX_CARGAS = 200;   // cortafuegos anti-bucle: 40 postbacks normales

  const P = 'ctl00_ContentPlaceHolder1_';
  const N = 'ctl00$ContentPlaceHolder1$';

  const ID = {
    curso: P + 'lstCurso',
    materia: P + 'lstMateria',
    periodo: P + 'lstPeriodo',
    corte: P + 'lstCorte',
    tabla: P + 'gvDatos',
    profesor: P + 'hfProfesor',
  };
  const NOMBRE = {
    curso: N + 'lstCurso',
    materia: N + 'lstMateria',
    periodo: N + 'lstPeriodo',
    corte: N + 'lstCorte',
  };

  /* El corte ÚNICO es el consolidado del periodo. Los otros tres dan el
     desglose, que la app ya tiene, y multiplicarían los postbacks por cuatro. */
  const CORTE_UNICO = '1';

  /* No son cuatro periodos: son tres y el final. Medido en la pantalla — no
     existe el "04". */
  const PERIODOS = [
    { value: '01', texto: 'Primero', pordefecto: true },
    { value: '02', texto: 'Segundo', pordefecto: true },
    { value: '03', texto: 'Tercero', pordefecto: false },
    { value: '05', texto: 'Final', pordefecto: false },
  ];

  const ES_USERSCRIPT = (typeof GM_info !== 'undefined');

  /*
   * Lo que decide si esta corrida puede completarse no es si hay Tampermonkey:
   * es si ALGUIEN va a volver a inyectar el script tras cada recarga. La
   * extensión lo hace, y el favorito del marco también, sin instalar nada
   * (`recon/marco.js`). Mismo razonamiento y misma marca que en el autofill de
   * asistencia; se pregunta por la marca y no por "¿estoy en un iframe?",
   * porque estar dentro de uno no significa que alguien te vaya a reinyectar.
   */
  const SE_REINYECTA = ES_USERSCRIPT || window.__glaMarco === true;

  // ======================================================================
  // UTILIDADES
  // ======================================================================

  const $$ = window.jQuery;
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  const lim = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const norm = (s) => lim(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const el = (id) => document.getElementById(id);

  /**
   * "95,00" → 95. La plataforma usa coma decimal.
   *
   * Devuelve null y no 0 cuando no se puede leer: un 0 de verdad significa
   * "sin calificar" y es un dato; un null significa "no venía nada", que es
   * otra cosa. Confundirlos haría que un error de lectura se viera como un
   * estudiante con cero.
   */
  function aNumero(texto) {
    const t = lim(texto).replace(/\./g, '').replace(',', '.');
    if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  // ======================================================================
  // ESTADO PERSISTIDO
  // ======================================================================

  const Estado = {
    leer() {
      try { return JSON.parse(sessionStorage.getItem(CLAVE_ESTADO) || 'null'); }
      catch (_) { return null; }
    },
    guardar(e) {
      try { sessionStorage.setItem(CLAVE_ESTADO, JSON.stringify(e)); } catch (_) { /* nada */ }
    },
    limpiar() {
      try { sessionStorage.removeItem(CLAVE_ESTADO); } catch (_) { /* nada */ }
    },
  };

  let estado = Estado.leer();

  function persistir() { Estado.guardar(estado); }

  function anotar(msg, clase) {
    const linea = { t: new Date().toLocaleTimeString('es-CO'), msg: String(msg), clase: clase || null };
    if (estado) { estado.registro.push(linea); persistir(); }
    pintarLinea(linea);
    console.log('[historial]', msg);
  }

  function abortar(motivo) {
    anotar('ABORTADO: ' + motivo, 'err');
    if (estado) { estado.activa = false; estado.paso = 'ABORTADO'; persistir(); }
    refrescarPanel();
  }

  // ======================================================================
  // LECTURA DE LA TABLA
  // ======================================================================

  /**
   * Las columnas se buscan por su encabezado, nunca por posición.
   *
   * La plataforma ya movió columnas antes (ver README-verificador), y una
   * definitiva leída de la columna equivocada no se nota: es un número
   * plausible en el lugar correcto del JSON.
   */
  function mapaColumnas(tabla) {
    const filaEnc = [...tabla.rows].find((f) => f.querySelector('th')) || tabla.rows[0];
    if (!filaEnc) return null;
    const enc = [...filaEnc.cells].map((c) => norm(c.textContent));
    const buscar = (...nombres) => {
      for (const n of nombres) {
        const i = enc.indexOf(n);
        if (i !== -1) return i;
      }
      return -1;
    };
    const mapa = {
      codigo: buscar('codigo'),
      nombre: buscar('nombre'),
      definitiva: buscar('definitiva'),
    };
    return (mapa.codigo === -1 || mapa.definitiva === -1) ? null : mapa;
  }

  function filasDatos(tabla) {
    const cuerpo = tabla.tBodies[0] || tabla;
    return [...cuerpo.rows].filter((f) => !f.querySelector('th'));
  }

  const RE_COD = /^\d{10}$/;

  /**
   * Los estudiantes de la tabla que hay en pantalla.
   *
   * Descarta las filas cuya primera celda no es un código de 10 dígitos: el
   * GridView mete pie de página y paginador, y colarlos dejaría estudiantes
   * fantasma en el JSON.
   */
  function leerTabla() {
    const tabla = el(ID.tabla);
    if (!tabla) return { error: 'no hay tabla en pantalla' };
    const mapa = mapaColumnas(tabla);
    if (!mapa) return { error: 'la tabla no tiene las columnas Código y Definitiva' };

    const estudiantes = [];
    let descartadas = 0;
    for (const f of filasDatos(tabla)) {
      const celda = (i) => (i >= 0 && f.cells[i] ? lim(f.cells[i].textContent) : '');
      const cod = celda(mapa.codigo);
      if (!RE_COD.test(cod)) { descartadas++; continue; }
      estudiantes.push({
        cod_alum: cod,
        nombre: celda(mapa.nombre),
        definitiva: aNumero(celda(mapa.definitiva)),
      });
    }
    return { estudiantes, descartadas };
  }

  // ======================================================================
  // POSTBACKS — uno a la vez, nunca en paralelo
  // ======================================================================

  let postbackEnVuelo = false;

  async function dispararPostback(descripcion, fn) {
    if (postbackEnVuelo) { console.warn('[historial] postback ya en vuelo, ignorado'); return; }
    postbackEnVuelo = true;
    anotar('→ ' + descripcion);
    persistir();
    await dormir(ESPERA_MS);
    if (!estado || !estado.activa) { postbackEnVuelo = false; return; }
    try { fn(); }
    catch (e) { postbackEnVuelo = false; abortar('fallo al disparar el postback: ' + e.message); }
  }

  /* Los selects usan Select2: poner .value a mano no sincroniza el widget ni
     notifica al handler, así que se pasa por jQuery y después se dispara el
     postback explícito. Mismo camino que el autofill. */
  function ponerSelect(idEl, nombreCtrl, valor) {
    const sel = el(idEl);
    if (!sel) throw new Error('no encuentro el control ' + idEl);
    if (valor === '%') throw new Error('nunca se selecciona "< TODOS >"');
    if ($$ && $$.fn) $$(sel).val(valor).trigger('change.select2');
    else sel.value = valor;
    window.__doPostBack(nombreCtrl, '');
  }

  const valorDe = (idEl) => { const s = el(idEl); return s ? lim(s.value) : null; };

  /** La opción cuyo value coincide ignorando el relleno ("801  " es "801"). */
  function opcionPorValorTrim(select, objetivo) {
    if (!select) return null;
    return [...select.options].find((o) => lim(o.value) === lim(objetivo)) || null;
  }

  // ======================================================================
  // PLAN DE RECORRIDO
  // ======================================================================

  /**
   * El plan se arma UNA vez, al arrancar, y queda guardado.
   *
   * Se recorre periodo por fuera y curso por dentro a propósito: cambiar de
   * periodo cuesta un postback y cambiar de curso otro, así que agrupando por
   * periodo se paga el del periodo una vez cada 19 cursos en lugar de una vez
   * por curso. Son 20 postbacks por periodo en vez de 38.
   */
  function armarPlan(periodos) {
    const sel = el(ID.curso);
    const cursos = [...(sel ? sel.options : [])]
      .map((o) => lim(o.value))
      .filter((v) => v && v !== '%');
    const plan = [];
    for (const periodo of periodos) {
      for (const curso of cursos) plan.push({ periodo, curso });
    }
    return { plan, cursos };
  }

  const combosPorPeriodo = (nCursos) => nCursos + 1;   // los cursos, más fijar el periodo

  // ======================================================================
  // MÁQUINA DE ESTADOS
  // ======================================================================

  function intentosDe(clave) { return estado.intentos[clave] || 0; }
  function sumarIntento(clave) { estado.intentos[clave] = intentosDe(clave) + 1; persistir(); }

  function actual() { return estado.plan[estado.i] || null; }
  const claveActual = () => { const a = actual(); return a ? `${a.periodo}/${a.curso}` : '—'; };

  function avanzar() {
    estado.i++;
    persistir();
    refrescarPanel();
  }

  async function continuar() {
    if (!estado || !estado.activa) return;

    if (estado.i >= estado.plan.length) return terminar();

    const paso = actual();
    const clave = claveActual();

    if (intentosDe(clave) > MAX_INTENTOS) {
      estado.errores.push({ ...paso, motivo: `no cargó tras ${MAX_INTENTOS} intentos` });
      anotar(`✗ ${paso.curso} periodo ${paso.periodo}: no cargó. Sigo con el siguiente.`, 'err');
      estado.intentos[clave] = 0;
      avanzar();
      return continuar();
    }

    // --- El corte, una sola vez: la pantalla lo conserva entre postbacks ---
    if (valorDe(ID.corte) !== CORTE_UNICO) {
      sumarIntento(clave);
      return dispararPostback('corte → ÚNICO',
        () => ponerSelect(ID.corte, NOMBRE.corte, CORTE_UNICO));
    }

    // --- Periodo ---
    if (valorDe(ID.periodo) !== paso.periodo) {
      sumarIntento(clave);
      return dispararPostback(`periodo → ${paso.periodo}`,
        () => ponerSelect(ID.periodo, NOMBRE.periodo, paso.periodo));
    }

    // --- Curso ---
    if (lim(valorDe(ID.curso)) !== lim(paso.curso)) {
      const opcion = opcionPorValorTrim(el(ID.curso), paso.curso);
      if (!opcion) {
        estado.errores.push({ ...paso, motivo: 'el curso ya no está en la lista' });
        anotar(`✗ ${paso.curso}: ya no está en la lista. Sigo.`, 'err');
        avanzar();
        return continuar();
      }
      sumarIntento(clave);
      return dispararPostback(`curso → ${paso.curso}`,
        () => ponerSelect(ID.curso, NOMBRE.curso, opcion.value));
    }

    // --- La materia, solo si hace falta ---
    // Con un curso concreto la plataforma suele dejar la materia puesta sola.
    // Solo se toca cuando no hay tabla y hay una materia concreta sin elegir:
    // así no se gasta un postback por curso averiguando algo que ya estaba.
    const selMateria = el(ID.materia);
    const materiasConcretas = [...(selMateria ? selMateria.options : [])]
      .filter((o) => lim(o.value) && lim(o.value) !== '%');

    if (!el(ID.tabla) && materiasConcretas.length && lim(valorDe(ID.materia)) === '%') {
      sumarIntento(clave);
      return dispararPostback(`materia → ${lim(materiasConcretas[0].text)}`,
        () => ponerSelect(ID.materia, NOMBRE.materia, materiasConcretas[0].value));
    }

    // --- Leer ---
    const lectura = leerTabla();
    if (lectura.error) {
      // Sin tabla y sin nada más que tocar: puede ser un curso sin notas en ese
      // periodo, que es normal. Se anota y se sigue, no se aborta la corrida.
      estado.errores.push({ ...paso, motivo: lectura.error });
      anotar(`· ${paso.curso} periodo ${paso.periodo}: ${lectura.error}. Sigo.`, 'avi');
      estado.intentos[clave] = 0;
      avanzar();
      return continuar();
    }

    if (materiasConcretas.length > 1) {
      estado.avisos.push({
        ...paso,
        motivo: `el curso tiene ${materiasConcretas.length} materias y solo se leyó "${lim(el(ID.materia).selectedOptions[0]?.text)}"`,
      });
    }

    estado.resultados.push({
      periodo: paso.periodo,
      curso: paso.curso,
      materia: lim(valorDe(ID.materia)),
      materiaNombre: lim(el(ID.materia)?.selectedOptions[0]?.text || ''),
      estudiantes: lectura.estudiantes,
    });
    anotar(`✔ ${paso.curso} periodo ${paso.periodo}: ${lectura.estudiantes.length} estudiantes.`);
    estado.intentos[clave] = 0;
    avanzar();
    return continuar();
  }

  function terminar() {
    estado.activa = false;
    estado.paso = 'TERMINADO';
    const nEst = estado.resultados.reduce((a, r) => a + r.estudiantes.length, 0);
    anotar(`Listo: ${estado.resultados.length} combinaciones, ${nEst} filas leídas.`, 'ok');
    persistir();
    refrescarPanel();
  }

  // ======================================================================
  // SALIDA
  // ======================================================================

  function construirJSON() {
    return {
      generadoEn: new Date().toISOString(),
      profesor: lim(el(ID.profesor)?.value || ''),
      corte: 'UNICO',
      periodos: [...new Set(estado.resultados.map((r) => r.periodo))],
      // Solo la definitiva: lo único que la app no puede sacar de otro lado.
      campos: ['cod_alum', 'nombre', 'definitiva'],
      cursos: estado.resultados,
      avisos: estado.avisos,
      errores: estado.errores,
    };
  }

  // ======================================================================
  // PANEL
  // ======================================================================

  const panel = document.createElement('div');
  panel.id = 'gla-hist';
  panel.innerHTML = `
<style>
  #gla-hist{position:fixed;right:14px;bottom:14px;width:370px;z-index:99999;
    font:13px/1.45 system-ui,sans-serif;background:#fff;color:#111;
    border:1px solid #cbd5e1;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.18)}
  #gla-hist header{display:flex;align-items:center;gap:8px;padding:9px 12px;
    background:#0f172a;color:#fff;border-radius:9px 9px 0 0}
  #gla-hist .pt{font-weight:600;flex:1}
  #gla-hist .cuerpo{padding:11px 12px;max-height:62vh;overflow:auto}
  #gla-hist label{display:inline-flex;align-items:center;gap:5px;margin:0 10px 6px 0}
  #gla-hist button{font:inherit;padding:.45rem .8rem;border-radius:7px;border:1px solid #cbd5e1;
    background:#f8fafc;cursor:pointer;margin:2px 4px 2px 0}
  #gla-hist button.p{background:#0f172a;color:#fff;border-color:#0f172a}
  #gla-hist button[disabled]{opacity:.5;cursor:not-allowed}
  #gla-hist textarea{width:100%;height:110px;font:11px/1.4 ui-monospace,monospace;
    border:1px solid #cbd5e1;border-radius:6px;padding:6px}
  #gla-hist .log{margin-top:8px;max-height:140px;overflow:auto;font:11px/1.5 ui-monospace,monospace;
    background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:6px}
  #gla-hist .log div{white-space:pre-wrap}
  #gla-hist .err{color:#b91c1c} #gla-hist .ok{color:#15803d} #gla-hist .avi{color:#b45309}
  #gla-hist .nota{color:#475569;font-size:.92em;margin:6px 0}
  #gla-hist .alerta{background:#fff7ed;border:1px solid #fdba74;border-radius:6px;padding:7px;margin-bottom:7px}
</style>
<header><span class="pt">Historial de definitivas</span>
  <button id="gh-min" style="margin:0;padding:.1rem .45rem">—</button></header>
<div class="cuerpo">
  <div id="gh-alerta"></div>
  <div id="gh-periodos"></div>
  <p class="nota" id="gh-costo"></p>
  <button class="p" id="gh-ir">Extraer</button>
  <button id="gh-cancelar">Cancelar</button>
  <button id="gh-copiar" style="display:none">Copiar JSON</button>
  <p class="nota" id="gh-nota">Lee la tabla que ya está en pantalla. No descarga nada ni escribe en la plataforma.</p>
  <textarea id="gh-salida" readonly style="display:none"></textarea>
  <div class="log" id="gh-log"></div>
</div>`;
  document.body.appendChild(panel);

  const $ = (sel) => panel.querySelector(sel);
  const $log = $('#gh-log'), $salida = $('#gh-salida'), $costo = $('#gh-costo');

  function pintarLinea(l) {
    if (!$log) return;
    const d = document.createElement('div');
    if (l.clase) d.className = l.clase;
    d.textContent = `${l.t}  ${l.msg}`;
    $log.appendChild(d);
    $log.scrollTop = $log.scrollHeight;
  }

  $('#gh-periodos').innerHTML = PERIODOS.map((p) =>
    `<label><input type="checkbox" value="${p.value}" ${p.pordefecto ? 'checked' : ''}> ${p.texto}</label>`
  ).join('');

  const periodosElegidos = () =>
    [...panel.querySelectorAll('#gh-periodos input:checked')].map((c) => c.value);

  function nCursosEnPantalla() {
    const sel = el(ID.curso);
    return [...(sel ? sel.options : [])].filter((o) => lim(o.value) && lim(o.value) !== '%').length;
  }

  /* El costo a la vista y actualizado al tocar las casillas: es la decisión
     que importa antes de arrancar, y esconderla obliga a calcularla a mano. */
  function refrescarCosto() {
    const n = periodosElegidos().length;
    const cursos = nCursosEnPantalla();
    if (!n || !cursos) { $costo.textContent = 'Elegí al menos un periodo.'; return; }
    const postbacks = n * combosPorPeriodo(cursos);
    const min = Math.ceil((postbacks * ESPERA_MS) / 60000);
    $costo.textContent =
      `${cursos} cursos × ${n} periodo(s) = ${postbacks} recargas, unos ${min}–${min * 2} min.`;
  }
  panel.querySelectorAll('#gh-periodos input').forEach((c) => { c.onchange = refrescarCosto; });

  function refrescarPanel() {
    const corriendo = !!(estado && estado.activa);
    $('#gh-ir').disabled = corriendo;
    panel.querySelectorAll('#gh-periodos input').forEach((c) => { c.disabled = corriendo; });
    // También con errores y sin un solo resultado: si ningún curso cargó, el
    // JSON es lo único que dice por qué, y esconderlo deja el panel en blanco
    // justo cuando más falta hace.
    const hay = estado && ((estado.resultados || []).length || (estado.errores || []).length);
    $('#gh-copiar').style.display = hay ? '' : 'none';
    $salida.style.display = hay ? '' : 'none';
    if (hay) $salida.value = JSON.stringify(construirJSON(), null, 2);
    if (corriendo) {
      $costo.textContent = `Va en ${estado.i} de ${estado.plan.length} — ${claveActual()}`;
    }
  }

  $('#gh-min').onclick = () => {
    const c = $('.cuerpo');
    c.style.display = c.style.display === 'none' ? '' : 'none';
  };

  $('#gh-ir').onclick = () => {
    const periodos = periodosElegidos();
    if (!periodos.length) { anotar('Elegí al menos un periodo.', 'err'); return; }
    const { plan, cursos } = armarPlan(periodos);
    if (!plan.length) { anotar('No encuentro cursos en el desplegable.', 'err'); return; }
    estado = {
      activa: true, paso: 'RECORRIENDO', plan, i: 0,
      intentos: {}, cargas: 0, registro: [],
      resultados: [], errores: [], avisos: [],
      iniciado: Date.now(),
    };
    persistir();
    $log.innerHTML = '';
    anotar(`Arranco: ${cursos.length} cursos × ${periodos.length} periodo(s) = ${plan.length} combinaciones.`);
    refrescarPanel();
    continuar();
  };

  $('#gh-cancelar').onclick = () => {
    Estado.limpiar();
    estado = null;
    $log.innerHTML = '';
    pintarLinea({ t: new Date().toLocaleTimeString('es-CO'), msg: 'Cancelado. Nada quedó a medias: la pantalla es de consulta.', clase: 'err' });
    refrescarPanel();
  };

  $('#gh-copiar').onclick = async () => {
    const texto = JSON.stringify(construirJSON(), null, 2);
    try {
      await navigator.clipboard.writeText(texto);
      anotar(`JSON copiado (${texto.length} caracteres). Pegalo en la app.`, 'ok');
    } catch (_) {
      $salida.select();
      anotar('No pude copiar solo: seleccioná el texto de abajo y copialo a mano.', 'avi');
    }
  };

  // ======================================================================
  // ARRANQUE
  // ======================================================================

  if (!SE_REINYECTA) {
    $('#gh-alerta').innerHTML =
      '<div class="alerta"><b>Nadie me va a reinyectar</b><br>' +
      'Cada elección de los desplegables recarga la página, y lo que se pega en la consola ' +
      'no sobrevive a una recarga: la corrida quedaría en el primer curso. ' +
      'Usá el favorito «Historial GLA (marco)», que reinyecta solo; o instalalo como ' +
      'userscript.</div>';
  }

  if (estado && estado.registro) estado.registro.forEach(pintarLinea);

  refrescarCosto();

  if (estado && estado.activa) {
    estado.cargas = (estado.cargas || 0) + 1;
    persistir();
    if (estado.cargas > MAX_CARGAS) {
      abortar(`la página se recargó ${estado.cargas} veces en una sola corrida. Corto por seguridad.`);
    } else {
      anotar(`Retomo tras la recarga (#${estado.cargas}).`);
      refrescarPanel();
      continuar();
    }
  } else {
    refrescarPanel();
  }
})();
