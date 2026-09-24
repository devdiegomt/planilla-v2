// ==UserScript==
// @name         GLA — Actividades y porcentajes
// @namespace    https://github.com/devdiegomt/planilla-v2
// @version      1.0.0
// @description  Saca de la matriz de actividades el porcentaje de cada logro, por grado. Solo lectura.
// @author       devdiegomt
// @match        *://webapps3-classroomliveweb.com/*/Seguro/DefActividadDocentePorcMatriz.aspx
// @include      https://webapps3-classroomliveweb.com:2443/*/Seguro/DefActividadDocentePorcMatriz.aspx
// @include      /^https?:\/\/[^/]*classroomliveweb\.com(:\d+)?\/.*\/Seguro\/DefActividadDocentePorcMatriz\.aspx/
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * POR QUÉ EXISTE
 * --------------
 * En planilla-app los pesos de cada logro están fijos en `SLOTS_8_10` y
 * `SLOTS_11`. Es lo último que ata la app a la materia de UN docente: otro
 * profesor con otro reparto de porcentajes calcularía mal la definitiva y no
 * se daría cuenta, porque el número sale igual de plausible.
 *
 * Esta pantalla es donde el colegio define esos porcentajes. Sacarlos de acá
 * los vuelve un dato del docente en vez de una constante del código.
 *
 * ESTA PANTALLA SÍ ESCRIBE — Y POR ESO ESTE SCRIPT NO LA TOCA
 * -----------------------------------------------------------
 * Cada fila tiene "Editar", que destraba los campos y cambia a "Actualizar".
 * Medido: en edición aparecen cinco <input> con el id de actividad, el cod_mat,
 * el id del logro, el porcentaje y el rótulo. Eso es lo que habría que enviar
 * para escribir.
 *
 * No hace falta: **el porcentaje ya se lee como texto en la fila sin editar**.
 * Así que este script NUNCA pulsa "Editar" ni "Actualizar" — la única razón
 * para hacerlo sería escribir, y acá no se escribe. Lo único que dispara es el
 * cambio de curso, que es lo mismo que elegirlo a mano.
 *
 * LAS COLUMNAS SE BUSCAN POR ENCABEZADO
 * -------------------------------------
 * Tres columnas de la tabla no tienen encabezado (los ids internos). Leerlas
 * obligaría a contar posiciones, y una columna nueva correría todo sin avisar.
 * Se leen solo las que tienen nombre —Descripción, Porcentaje, Ciclo, Destino—
 * que son justamente las que hacen falta. Los ids internos se ignoran a
 * propósito.
 *
 * CUÁNTO CUESTA
 * -------------
 * Los porcentajes son de la materia y el periodo, no del curso, así que con
 * UN curso por grado alcanza: 4 postbacks en vez de 19. El panel deja pedir
 * todos los cursos igual, para comprobar que no cambien entre cursos del mismo
 * grado.
 */

(() => {
  'use strict';

  const CLAVE_ESTADO = 'gla_actividades_estado_v1';
  const ESPERA_MS = 1500;
  const MAX_INTENTOS = 5;   // curso + materia + consultar, con margen
  const MAX_CARGAS = 60;

  const P = 'ctl00_ContentPlaceHolder1_';
  const N = 'ctl00$ContentPlaceHolder1$';
  const ID = { curso: P + 'lstCurso', materia: P + 'lstMateria', periodo: P + 'lstPeriodo',
               tabla: P + 'gvActividades', profesor: P + 'hfProfesor' };
  const NOMBRE = { curso: N + 'lstCurso', materia: N + 'lstMateria', consultar: N + 'btnRefresca' };

  /*
   * Lo ÚNICO que este script puede disparar.
   *
   * La pantalla tiene "Editar" y "Actualizar" en cada fila, que son los que
   * escriben, y "Descargar a Excel". Una lista blanca corta por lo sano: si
   * alguna vez alguien agrega un paso y se equivoca de control, revienta acá en
   * vez de guardar algo en la plataforma. Es más barato que acordarse.
   */
  const PERMITIDOS = new Set([NOMBRE.curso, NOMBRE.materia, NOMBRE.consultar]);

  function postear(nombreCtrl) {
    if (!PERMITIDOS.has(nombreCtrl)) {
      throw new Error('control no permitido para este script: ' + nombreCtrl);
    }
    window.__doPostBack(nombreCtrl, '');
  }

  const ES_USERSCRIPT = (typeof GM_info !== 'undefined');

  const $$ = window.jQuery;
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  const lim = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const norm = (s) => lim(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const el = (id) => document.getElementById(id);

  /** "60" → 60. Null si no se puede leer: un 0 de verdad es un dato. */
  function aNumero(t) {
    const s = lim(t).replace(',', '.');
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  /** El grado que le corresponde a un curso: '801' → 8, '1101' → 11. */
  const gradoDe = (curso) => {
    const c = lim(curso);
    return c.length >= 4 ? Number(c.slice(0, 2)) : Number(c.slice(0, 1));
  };

  // --- Estado ---------------------------------------------------------------

  const Estado = {
    leer() { try { return JSON.parse(sessionStorage.getItem(CLAVE_ESTADO) || 'null'); } catch { return null; } },
    guardar(e) { try { sessionStorage.setItem(CLAVE_ESTADO, JSON.stringify(e)); } catch { /* nada */ } },
    limpiar() { try { sessionStorage.removeItem(CLAVE_ESTADO); } catch { /* nada */ } },
  };
  let estado = Estado.leer();
  const persistir = () => Estado.guardar(estado);

  function anotar(msg, clase) {
    const linea = { t: new Date().toLocaleTimeString('es-CO'), msg: String(msg), clase: clase || null };
    if (estado) { estado.registro.push(linea); persistir(); }
    pintarLinea(linea);
    console.log('[actividades]', msg);
  }
  function abortar(motivo) {
    anotar('ABORTADO: ' + motivo, 'err');
    if (estado) { estado.activa = false; persistir(); }
    refrescarPanel();
  }

  // --- Leer la tabla --------------------------------------------------------

  /**
   * Las columnas por su encabezado. Las que no tienen nombre no se buscan: son
   * ids internos que no hacen falta, y contarlas por posición se rompería con
   * cualquier columna nueva.
   */
  function mapaColumnas(tabla) {
    const filaEnc = [...tabla.rows].find((f) => f.querySelector('th')) || tabla.rows[0];
    if (!filaEnc) return null;
    const enc = [...filaEnc.cells].map((c) => norm(c.textContent));
    const buscar = (...nombres) => {
      for (const n of nombres) { const i = enc.indexOf(n); if (i !== -1) return i; }
      return -1;
    };
    const mapa = {
      meta: buscar('meta de comprension'),
      general: buscar('descripcion general'),
      descripcion: buscar('descripcion'),
      porcentaje: buscar('porcentaje'),
      ciclo: buscar('ciclo'),
      destino: buscar('destino'),
    };
    return mapa.descripcion === -1 || mapa.porcentaje === -1 ? null : mapa;
  }

  /**
   * El valor de una celda que puede tener un control adentro.
   *
   * En una fila en edición el texto se va al `value` del input y la celda queda
   * vacía. No se edita nunca, pero si el docente dejó una fila abierta a mano
   * la corrida no tiene por qué perder esa fila.
   */
  function valorCelda(celda) {
    if (!celda) return '';
    const control = celda.querySelector('input, textarea');
    if (control && lim(control.value)) return lim(control.value);
    const sel = celda.querySelector('select');
    if (sel) return lim(sel.selectedOptions[0]?.text || '');
    return lim(celda.textContent);
  }

  function leerTabla() {
    const tabla = el(ID.tabla);
    if (!tabla) return { error: 'no hay tabla en pantalla' };
    const mapa = mapaColumnas(tabla);
    if (!mapa) return { error: 'la tabla no tiene las columnas Descripción y Porcentaje' };

    const cuerpo = tabla.tBodies[0] || tabla;
    const actividades = [];
    for (const f of [...cuerpo.rows].filter((r) => !r.querySelector('th'))) {
      const celda = (i) => (i >= 0 ? valorCelda(f.cells[i]) : '');
      const descripcion = celda(mapa.descripcion);
      const porcentaje = aNumero(celda(mapa.porcentaje));
      // Sin descripción no es una actividad: es el pie del GridView.
      if (!descripcion) continue;
      actividades.push({
        meta: celda(mapa.meta),
        general: celda(mapa.general),
        descripcion,
        porcentaje,
        ciclo: celda(mapa.ciclo),
        destino: celda(mapa.destino),
      });
    }
    return { actividades };
  }

  // --- Postbacks ------------------------------------------------------------

  let enVuelo = false;
  async function dispararPostback(desc, fn) {
    if (enVuelo) return;
    enVuelo = true;
    anotar('→ ' + desc);
    persistir();
    await dormir(ESPERA_MS);
    if (!estado || !estado.activa) { enVuelo = false; return; }
    try { fn(); } catch (e) { enVuelo = false; abortar('fallo al disparar el postback: ' + e.message); }
  }

  function ponerCurso(valor) {
    const sel = el(ID.curso);
    if (!sel) throw new Error('no encuentro el selector de curso');
    if (lim(valor) === '%') throw new Error('nunca se selecciona "< TODOS >"');
    if ($$ && $$.fn) $$(sel).val(valor).trigger('change.select2'); else sel.value = valor;
    postear(NOMBRE.curso);
  }

  /**
   * Elige una materia concreta.
   *
   * Hace falta porque **cambiar de curso deja la materia sin elegir y la tabla
   * vacía**. La primera versión no lo hacía y la corrida entera volvió con
   * "no hay tabla en pantalla" para los cuatro cursos: el `< TODOS >` de la
   * materia no dibuja nada.
   */
  function ponerMateria(valor) {
    const sel = el(ID.materia);
    if (!sel) throw new Error('no encuentro el selector de materia');
    if ($$ && $$.fn) $$(sel).val(valor).trigger('change.select2'); else sel.value = valor;
    postear(NOMBRE.materia);
  }

  /** Las materias que son una materia, no el "< TODOS >". */
  const materiasConcretas = () => {
    const sel = el(ID.materia);
    return [...(sel ? sel.options : [])].filter((o) => {
      const v = lim(o.value);
      return v && v !== '%' && v !== '0';
    });
  };

  const valorDe = (id) => { const s = el(id); return s ? lim(s.value) : null; };

  // --- Plan -----------------------------------------------------------------

  function cursosDisponibles() {
    const sel = el(ID.curso);
    return [...(sel ? sel.options : [])].map((o) => lim(o.value)).filter((v) => v && v !== '%');
  }

  /**
   * Un curso por grado, o todos.
   *
   * Los porcentajes son de la materia y el periodo, así que entre cursos del
   * mismo grado deberían ser iguales. Con uno por grado alcanza y son 4
   * postbacks en vez de 19. "Todos" queda para comprobar esa suposición, que es
   * exactamente la clase de cosa que conviene poder verificar en vez de creer.
   */
  function armarPlan(todos) {
    const cursos = cursosDisponibles();
    if (todos) return cursos;
    const porGrado = new Map();
    for (const c of cursos) {
      const g = gradoDe(c);
      if (!porGrado.has(g)) porGrado.set(g, c);
    }
    return [...porGrado.values()];
  }

  // --- Recorrido ------------------------------------------------------------

  const actual = () => estado.plan[estado.i] || null;

  async function continuar() {
    if (!estado || !estado.activa) return;
    if (estado.i >= estado.plan.length) return terminar();

    const curso = actual();
    const intentos = estado.intentos[curso] || 0;
    if (intentos > MAX_INTENTOS) {
      estado.errores.push({ curso, motivo: `no cargó tras ${MAX_INTENTOS} intentos` });
      anotar(`✗ ${curso}: no cargó. Sigo.`, 'err');
      estado.i++; estado.intentos[curso] = 0; persistir();
      return continuar();
    }

    if (lim(valorDe(ID.curso)) !== lim(curso)) {
      const opcion = [...el(ID.curso).options].find((o) => lim(o.value) === lim(curso));
      if (!opcion) {
        estado.errores.push({ curso, motivo: 'el curso ya no está en la lista' });
        estado.i++; persistir();
        return continuar();
      }
      estado.intentos[curso] = intentos + 1; persistir();
      return dispararPostback(`curso → ${curso}`, () => ponerCurso(opcion.value));
    }

    // --- La materia, que el cambio de curso deja sin elegir ---
    const materias = materiasConcretas();
    const materiaActual = lim(valorDe(ID.materia));
    const sinMateria = !materiaActual || materiaActual === '%' || materiaActual === '0';
    if (sinMateria && materias.length) {
      estado.intentos[curso] = intentos + 1; persistir();
      return dispararPostback(`materia → ${lim(materias[0].text)}`,
        () => ponerMateria(materias[0].value));
    }

    /*
     * --- Consultar ---
     * No alcanza con elegir: la tabla no aparece hasta pulsar "Consultar".
     * Es una consulta, no una escritura: refresca lo que se muestra y no toca
     * nada. Se dispara por su nombre, que está en la lista blanca.
     */
    if (!el(ID.tabla)) {
      estado.intentos[curso] = intentos + 1; persistir();
      return dispararPostback('consultar', () => postear(NOMBRE.consultar));
    }

    const lectura = leerTabla();
    if (lectura.error) {
      estado.errores.push({ curso, motivo: lectura.error });
      anotar(`· ${curso}: ${lectura.error}. Sigo.`, 'avi');
      estado.i++; estado.intentos[curso] = 0; persistir();
      return continuar();
    }

    estado.resultados.push({
      curso,
      grado: gradoDe(curso),
      materia: lim(valorDe(ID.materia)),
      materiaNombre: lim(el(ID.materia)?.selectedOptions[0]?.text || ''),
      periodo: lim(valorDe(ID.periodo)),
      actividades: lectura.actividades,
    });
    const suma = lectura.actividades.reduce((a, x) => a + (x.porcentaje || 0), 0);
    anotar(`✔ ${curso}: ${lectura.actividades.length} actividades, suman ${suma}%.`);
    estado.i++; estado.intentos[curso] = 0; persistir(); refrescarPanel();
    return continuar();
  }

  function terminar() {
    estado.activa = false;
    anotar(`Listo: ${estado.resultados.length} curso(s).`, 'ok');
    persistir(); refrescarPanel();
  }

  const construirJSON = () => ({
    generadoEn: new Date().toISOString(),
    profesor: lim(el(ID.profesor)?.value || ''),
    campos: ['meta', 'general', 'descripcion', 'porcentaje', 'ciclo', 'destino'],
    cursos: estado.resultados,
    errores: estado.errores,
  });

  // --- Panel ----------------------------------------------------------------

  const panel = document.createElement('div');
  panel.id = 'gla-act';
  panel.innerHTML = `
<style>
  #gla-act{position:fixed;right:14px;bottom:14px;width:360px;z-index:99999;
    font:13px/1.45 system-ui,sans-serif;background:#fff;color:#111;
    border:1px solid #cbd5e1;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.18)}
  #gla-act header{display:flex;gap:8px;padding:9px 12px;background:#0f172a;color:#fff;border-radius:9px 9px 0 0}
  #gla-act .pt{font-weight:600;flex:1}
  #gla-act .cuerpo{padding:11px 12px;max-height:60vh;overflow:auto}
  #gla-act button{font:inherit;padding:.45rem .8rem;border-radius:7px;border:1px solid #cbd5e1;
    background:#f8fafc;cursor:pointer;margin:2px 4px 2px 0}
  #gla-act button.p{background:#0f172a;color:#fff;border-color:#0f172a}
  #gla-act button[disabled]{opacity:.5;cursor:not-allowed}
  #gla-act textarea{width:100%;height:100px;font:11px/1.4 ui-monospace,monospace;border:1px solid #cbd5e1;border-radius:6px;padding:6px}
  #gla-act .log{margin-top:8px;max-height:130px;overflow:auto;font:11px/1.5 ui-monospace,monospace;
    background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:6px}
  #gla-act .err{color:#b91c1c} #gla-act .ok{color:#15803d} #gla-act .avi{color:#b45309}
  #gla-act .nota{color:#475569;font-size:.92em;margin:6px 0}
  #gla-act .alerta{background:#fff7ed;border:1px solid #fdba74;border-radius:6px;padding:7px;margin-bottom:7px}
</style>
<header><span class="pt">Actividades y porcentajes</span>
  <button id="ga-min" style="margin:0;padding:.1rem .45rem">—</button></header>
<div class="cuerpo">
  <div id="ga-alerta"></div>
  <label><input type="checkbox" id="ga-todos"> Recorrer los 19 cursos</label>
  <p class="nota" id="ga-costo"></p>
  <button class="p" id="ga-ir">Extraer</button>
  <button id="ga-cancelar">Cancelar</button>
  <button id="ga-copiar" style="display:none">Copiar JSON</button>
  <p class="nota">Lee la tabla que ya está en pantalla. <b>No pulsa "Editar" ni "Actualizar"</b>: no escribe nada.</p>
  <textarea id="ga-salida" readonly style="display:none"></textarea>
  <div class="log" id="ga-log"></div>
</div>`;
  document.body.appendChild(panel);
  const $ = (s) => panel.querySelector(s);
  const $log = $('#ga-log');

  function pintarLinea(l) {
    if (!$log) return;
    const d = document.createElement('div');
    if (l.clase) d.className = l.clase;
    d.textContent = `${l.t}  ${l.msg}`;
    $log.appendChild(d);
    $log.scrollTop = $log.scrollHeight;
  }

  function refrescarCosto() {
    const n = armarPlan($('#ga-todos').checked).length;
    // Hasta tres por curso: elegirlo, elegir la materia —que el cambio de curso
    // deja sin elegir— y Consultar, sin el cual la tabla no aparece.
    const tope = n * 3;
    const min = Math.max(1, Math.ceil((tope * ESPERA_MS) / 60000));
    $('#ga-costo').textContent = n
      ? `${n} curso(s) = hasta ${tope} recargas, aprox. ${min}–${min * 2} min.`
      : 'No encuentro cursos en el desplegable.';
  }
  $('#ga-todos').onchange = refrescarCosto;

  function refrescarPanel() {
    const corriendo = !!(estado && estado.activa);
    $('#ga-ir').disabled = corriendo;
    $('#ga-todos').disabled = corriendo;
    const hay = estado && ((estado.resultados || []).length || (estado.errores || []).length);
    $('#ga-copiar').style.display = hay ? '' : 'none';
    $('#ga-salida').style.display = hay ? '' : 'none';
    if (hay) $('#ga-salida').value = JSON.stringify(construirJSON(), null, 2);
    if (corriendo) $('#ga-costo').textContent = `Va en ${estado.i} de ${estado.plan.length}.`;
  }

  $('#ga-min').onclick = () => {
    const c = $('.cuerpo');
    c.style.display = c.style.display === 'none' ? '' : 'none';
  };

  $('#ga-ir').onclick = () => {
    const plan = armarPlan($('#ga-todos').checked);
    if (!plan.length) { anotar('No encuentro cursos.', 'err'); return; }
    estado = { activa: true, plan, i: 0, intentos: {}, cargas: 0,
               registro: [], resultados: [], errores: [] };
    persistir();
    $log.innerHTML = '';
    anotar(`Arranco: ${plan.length} curso(s).`);
    refrescarPanel();
    continuar();
  };

  $('#ga-cancelar').onclick = () => {
    Estado.limpiar(); estado = null; $log.innerHTML = '';
    pintarLinea({ t: new Date().toLocaleTimeString('es-CO'), msg: 'Cancelado. Nada quedó a medias: no se escribió nada.', clase: 'err' });
    refrescarPanel();
  };

  $('#ga-copiar').onclick = async () => {
    const texto = JSON.stringify(construirJSON(), null, 2);
    try {
      await navigator.clipboard.writeText(texto);
      anotar(`JSON copiado (${texto.length} caracteres).`, 'ok');
    } catch {
      $('#ga-salida').select();
      anotar('No pude copiar solo: seleccioná el texto y copialo a mano.', 'avi');
    }
  };

  // --- Arranque -------------------------------------------------------------

  if (!ES_USERSCRIPT) {
    $('#ga-alerta').innerHTML =
      '<div class="alerta"><b>No detecto Tampermonkey</b><br>' +
      'Cambiar de curso recarga la página, y lo que se pega en la consola no sobrevive a una recarga.</div>';
  }
  if (estado && estado.registro) estado.registro.forEach(pintarLinea);
  refrescarCosto();

  if (estado && estado.activa) {
    estado.cargas = (estado.cargas || 0) + 1;
    persistir();
    if (estado.cargas > MAX_CARGAS) abortar(`la página se recargó ${estado.cargas} veces. Corto por seguridad.`);
    else { anotar(`Retomo tras la recarga (#${estado.cargas}).`); refrescarPanel(); continuar(); }
  } else {
    refrescarPanel();
  }
})();
