// ==UserScript==
// @name         GLA · Llenar la matriz de actividades
// @namespace    https://github.com/devdiegomt/planilla-v2
// @version      1.0.0
// @description  Aplica en la matriz (831) el plan que arma planilla-app: título, porcentaje, ciclo y destino, fila por fila y solo donde la pantalla coincide con lo que el plan dice que hay.
// @match        *://*/DefActividadDocentePorcMatriz.aspx*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * ESTE SCRIPT ESCRIBE EN LA PLATAFORMA. Es el segundo camino de escritura del
 * repo, después de la asistencia, y se decidió aparte (Diego, 24/09/2026).
 *
 * Lo que lo hace seguro no es que pida permiso una vez, sino cuatro cosas:
 *
 * 1. **Nunca crea filas.** Solo edita las que ya están en la pantalla. La
 *    matriz trae ocho casillas por categoría usadas o no, así que estrenar una
 *    actividad es llenar una que ya existe.
 * 2. **Verifica antes de escribir.** El plan trae, por fila, lo que la app cree
 *    que hay hoy (`antes`). Si la pantalla dice otra cosa, esa fila NO se toca
 *    y se dice por qué. Emparejar por posición sin comprobar sería el error de
 *    pegar una columna de notas en el orden equivocado.
 * 3. **Nunca inventa un id.** Los tres identificadores de la fila (actividad,
 *    cod_mat, logro) se leen de la propia fila en edición y se devuelven tal
 *    cual. El plan solo trae los cuatro campos editables.
 * 4. **Un solo lugar dispara postbacks**, con lista blanca: los comandos
 *    Edit$N y Update$N de la tabla, y nada más. Ni Consultar, ni el selector de
 *    curso, ni "Descargar Tabla". El filtro lo pone Diego a mano.
 *
 * Y no arranca solo: hace falta pulsar "Revisar" y después "Aplicar".
 */
(function () {
  'use strict';

  const CLAVE_ESTADO = 'gla_matriz_estado_v1';
  const ESPERA_MS = 1500;
  const MAX_CARGAS = 200;   // ~10 filas × 2 postbacks × 19 cursos, con margen

  const P = 'ctl00_ContentPlaceHolder1_';
  const N = 'ctl00$ContentPlaceHolder1$';
  const ID = { curso: P + 'lstCurso', materia: P + 'lstMateria',
               periodo: P + 'lstPeriodo', tabla: P + 'gvActividades' };
  const TABLA = N + 'gvActividades';

  /*
   * Lo ÚNICO que este script puede disparar: editar y actualizar una fila de
   * la matriz. Todo pasa por `postear`, que revienta si el nombre no está en
   * esta lista — más barato que acordarse de no escribir de más.
   */
  const PERMITIDOS = new Set([TABLA]);
  const COMANDO = /^(Edit|Update)\$\d+$/;

  const el = (id) => document.getElementById(id);
  const lim = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const norm = (s) => lim(s).toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  const aNumero = (v) => {
    const s = lim(v).replace(',', '.');
    return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
  };
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
    console.log('[matriz]', msg);
  }
  function abortar(motivo) {
    anotar('ABORTADO: ' + motivo, 'err');
    if (estado) { estado.activa = false; persistir(); }
    refrescarPanel();
  }

  // --- Leer la pantalla -----------------------------------------------------

  function mapaColumnas(tabla) {
    const filaEnc = [...tabla.rows].find((f) => f.querySelector('th')) || tabla.rows[0];
    if (!filaEnc) return null;
    const enc = [...filaEnc.cells].map((c) => norm(c.textContent));
    const buscar = (...nombres) => {
      for (const n of nombres) { const i = enc.indexOf(n); if (i !== -1) return i; }
      return -1;
    };
    const mapa = {
      meta: buscar('META DE COMPRENSION', 'META'),
      descripcion: buscar('DESCRIPCION'),
      porcentaje: buscar('PORCENTAJE'),
      ciclo: buscar('CICLO'),
      destino: buscar('DESTINO'),
    };
    return mapa.meta >= 0 && mapa.descripcion >= 0 && mapa.porcentaje >= 0 ? mapa : null;
  }

  /** El texto de una celda, mirando el control adentro si está en edición. */
  function valorCelda(celda) {
    if (!celda) return '';
    const ctrl = celda.querySelector('textarea, input[type=text], select');
    if (ctrl) {
      if (ctrl.tagName === 'SELECT') {
        /*
         * Lo que dice que no hay nada elegido es el VALUE vacío, no el texto.
         * Mirando el texto, el rótulo del hueco ("—", "Seleccione", lo que la
         * plataforma ponga) se leía como si fuera un valor, y una casilla sin
         * estrenar dejaba de emparejar con el "antes" vacío del plan: el
         * ayudante decía "no coincide" y no la llenaba nunca.
         */
        const opcion = ctrl.selectedOptions[0];
        if (!opcion || !lim(opcion.value)) return '';
        return lim(opcion.text);
      }
      return lim(ctrl.value);
    }
    return lim(celda.textContent);
  }

  /**
   * Las filas de la pantalla con su meta y su posición dentro de ella.
   *
   * La posición cuenta TODAS las filas, llenas y vacías: es el número de fila
   * en la pantalla, y es lo que el plan usa para emparejar.
   */
  function leerFilas() {
    const tabla = el(ID.tabla);
    if (!tabla) return { error: 'no hay tabla en pantalla' };
    const mapa = mapaColumnas(tabla);
    if (!mapa) return { error: 'no reconozco los encabezados de la tabla' };

    const cuerpo = tabla.tBodies[0] || tabla;
    const porMeta = new Map();
    const filas = [];
    for (const f of [...cuerpo.rows].filter((r) => !r.querySelector('th'))) {
      const celda = (i) => (i >= 0 ? valorCelda(f.cells[i]) : '');
      const descripcion = celda(mapa.descripcion);
      if (!descripcion) continue;                  // el pie del GridView
      const meta = celda(mapa.meta);
      porMeta.set(meta, (porMeta.get(meta) ?? 0) + 1);
      filas.push({
        fila: f,
        meta,
        posicion: porMeta.get(meta),
        descripcion,
        porcentaje: aNumero(celda(mapa.porcentaje)) ?? 0,
        ciclo: celda(mapa.ciclo),
        destino: celda(mapa.destino),
      });
    }
    return { filas, mapa };
  }

  const cursoEnPantalla = () => {
    const s = el(ID.curso);
    return s && s.selectedOptions[0] ? lim(s.selectedOptions[0].text) : '';
  };

  // --- Comparar el plan con la pantalla -------------------------------------

  /**
   * Una casilla sin estrenar dice "ACT.3" a secas; una actividad de verdad
   * trae su columna. El plan manda '' como "antes" de una casilla vacía, así
   * que acá se traduce igual para poder compararlas.
   */
  const descripcionComparable = (d) =>
    /T\s*\d+\s*[-–—]\s*C\s*\d+/i.test(d) ? norm(d) : '';

  const mismos = (a, b) =>
    descripcionComparable(a.descripcion) === descripcionComparable(b.descripcion) &&
    Number(a.porcentaje) === Number(b.porcentaje) &&
    norm(a.ciclo) === norm(b.ciclo) &&
    norm(a.destino) === norm(b.destino);

  /**
   * Qué se puede hacer con cada cambio del plan, contra lo que hay en pantalla.
   *
   * - `escribir`: la fila coincide con el "antes" y hay algo que cambiar.
   * - `ya`: la fila ya está como la quiere el plan. No se toca.
   * - `noCoincide`: la pantalla dice otra cosa. **No se toca y se dice.**
   * - `falta`: el plan nombra una fila que no está en la pantalla.
   */
  function revisar(cambios, filas) {
    const porClave = new Map(filas.map((f) => [norm(f.meta) + '|' + f.posicion, f]));
    return cambios.map((c) => {
      const enPantalla = porClave.get(norm(c.meta) + '|' + c.posicion);
      if (!enPantalla) return { c, estado: 'falta', motivo: 'esa fila no está en la pantalla' };
      if (mismos(enPantalla, c.despues)) return { c, estado: 'ya', enPantalla };
      if (!mismos(enPantalla, c.antes)) {
        return {
          c, estado: 'noCoincide', enPantalla,
          motivo: `la pantalla dice "${enPantalla.descripcion}" · ${enPantalla.porcentaje}% · ` +
                  `ciclo ${enPantalla.ciclo || '—'} · ${enPantalla.destino || '—'}`,
        };
      }
      return { c, estado: 'escribir', enPantalla };
    });
  }

  // --- Escribir una fila ----------------------------------------------------

  let enVuelo = false;

  function postear(nombreCtrl, comando) {
    if (!PERMITIDOS.has(nombreCtrl)) {
      throw new Error('control no permitido para este script: ' + nombreCtrl);
    }
    if (!COMANDO.test(comando)) {
      throw new Error('comando no permitido para este script: ' + comando);
    }
    if (typeof window.__doPostBack !== 'function') {
      throw new Error('la página no expone __doPostBack');
    }
    window.__doPostBack(nombreCtrl, comando);
  }

  async function dispararPostback(desc, fn) {
    if (enVuelo) return;
    enVuelo = true;
    anotar('→ ' + desc);
    persistir();
    await dormir(ESPERA_MS);
    if (!estado || !estado.activa) { enVuelo = false; return; }
    try { fn(); } catch (e) { enVuelo = false; abortar('fallo al disparar el postback: ' + e.message); }
  }

  /** El índice de fila que usa el GridView para sus comandos (Edit$N). */
  function indiceDeFila(fila) {
    const enlace = fila.querySelector('a[href*="__doPostBack"]');
    const m = enlace && /['"](?:Edit|Update)\$(\d+)['"]/.exec(enlace.getAttribute('href') || '');
    return m ? m[1] : null;
  }

  /**
   * Pone los cuatro campos editables en la fila que está en edición.
   *
   * Los tres ids internos (actividad, cod_mat, logro) NO se tocan: viajan en
   * sus propios inputs, con el valor que la plataforma ya les puso.
   *
   * El porcentaje es el cuarto de los cinco `<input type=text>` sin id de la
   * fila. Es posicional, así que se **comprueba**: si el valor que trae no es
   * el que el plan dice que hay, no se escribe nada. Con una columna nueva o
   * un cambio de plantilla, el script se detiene en vez de escribir el
   * porcentaje encima de un id.
   */
  function llenarFila(fila, cambio) {
    const desc = fila.querySelector('textarea');
    if (!desc) throw new Error('la fila en edición no trae el campo de descripción');

    const sueltos = [...fila.querySelectorAll('input[type=text]')];
    if (sueltos.length < 4) {
      throw new Error(`esperaba al menos 4 casillas sin nombre y hay ${sueltos.length}`);
    }
    const pct = sueltos[3];
    if (aNumero(pct.value) !== Number(cambio.antes.porcentaje)) {
      throw new Error(
        `la casilla del porcentaje trae "${pct.value}" y el plan dice que hay ` +
        `${cambio.antes.porcentaje}: no escribo a ciegas`);
    }

    desc.value = cambio.despues.descripcion;
    pct.value = String(cambio.despues.porcentaje);

    for (const [sufijo, valor] of [['lstCiclo', cambio.despues.ciclo],
                                   ['lstDestino', cambio.despues.destino]]) {
      const sel = fila.querySelector(`select[name$="${sufijo}"]`);
      if (!sel) continue;
      if (!valor) continue;                        // '—' es "dejalo como está"
      const op = [...sel.options].find((o) => norm(o.text) === norm(valor));
      if (!op) throw new Error(`"${valor}" no es una opción de ${sufijo} en esta fila`);
      sel.value = op.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  // --- El recorrido ---------------------------------------------------------

  async function continuar() {
    if (!estado || !estado.activa) return;
    if (++estado.cargas > MAX_CARGAS) return abortar('demasiadas recargas');
    persistir();

    const pendientes = estado.pendientes;
    if (estado.i >= pendientes.length) {
      estado.activa = false;
      persistir();
      anotar(`✔ Listo: ${estado.escritas} fila(s) escritas en ${estado.curso}.`, 'ok');
      refrescarPanel();
      return;
    }

    const cambio = pendientes[estado.i];
    const lectura = leerFilas();
    if (lectura.error) return abortar(lectura.error);

    const enPantalla = lectura.filas.find(
      (f) => norm(f.meta) === norm(cambio.meta) && f.posicion === cambio.posicion);
    if (!enPantalla) {
      anotar(`· ${cambio.meta} fila ${cambio.posicion}: ya no está en la pantalla. Sigo.`, 'avi');
      estado.i++; persistir();
      return continuar();
    }

    const enEdicion = !!enPantalla.fila.querySelector('textarea:not([readonly])');
    const idx = indiceDeFila(enPantalla.fila);
    if (idx === null) return abortar('no encuentro el comando de esa fila');

    if (!enEdicion) {
      // Abrir la fila. "Editar" no guarda nada: solo cambia el modo de la fila.
      return dispararPostback(
        `abrir ${cambio.meta} fila ${cambio.posicion}`,
        () => postear(TABLA, 'Edit$' + idx));
    }

    // Ya está abierta: llenar y guardar.
    try {
      llenarFila(enPantalla.fila, cambio);
    } catch (e) {
      anotar(`✗ ${cambio.meta} fila ${cambio.posicion}: ${e.message}. No la toco.`, 'err');
      estado.i++; estado.saltadas++; persistir();
      return continuar();
    }
    estado.escritas++;
    estado.i++;
    return dispararPostback(
      `guardar ${cambio.meta} fila ${cambio.posicion}`,
      () => postear(TABLA, 'Update$' + idx));
  }

  // --- Panel ----------------------------------------------------------------

  let planPegado = null;
  let revision = null;

  const panel = document.createElement('div');
  panel.id = 'gla-matriz';
  panel.innerHTML = `
<style>
  #gla-matriz{position:fixed;right:14px;bottom:14px;width:380px;z-index:99999;
    font:13px/1.45 system-ui,sans-serif;background:#fff;color:#111;
    border:1px solid #cbd5e1;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.18)}
  #gla-matriz header{display:flex;gap:8px;padding:9px 12px;background:#7c2d12;color:#fff;border-radius:9px 9px 0 0}
  #gla-matriz .pt{font-weight:600;flex:1}
  #gla-matriz .cuerpo{padding:11px 12px;max-height:64vh;overflow:auto}
  #gla-matriz button{font:inherit;padding:.45rem .8rem;border-radius:7px;border:1px solid #cbd5e1;
    background:#f8fafc;cursor:pointer;margin:2px 4px 2px 0}
  #gla-matriz button.p{background:#7c2d12;color:#fff;border-color:#7c2d12}
  #gla-matriz button[disabled]{opacity:.5;cursor:not-allowed}
  #gla-matriz textarea{width:100%;height:90px;font:11px/1.4 ui-monospace,monospace;
    border:1px solid #cbd5e1;border-radius:6px;padding:6px}
  #gla-matriz .log{margin-top:8px;max-height:150px;overflow:auto;font:11px/1.5 ui-monospace,monospace;
    background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:6px}
  #gla-matriz .ok{color:#15803d} #gla-matriz .err{color:#b91c1c} #gla-matriz .avi{color:#a16207}
  #gla-matriz .aviso{background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;padding:7px;margin-bottom:8px}
</style>
<header><span class="pt">Llenar la matriz</span><button id="gm-min">–</button></header>
<div class="cuerpo">
  <div class="aviso">
    <strong>Este ayudante escribe.</strong> Solo cambia filas que ya existen, y
    solo si la pantalla coincide con lo que el plan dice que hay.
  </div>
  <p id="gm-donde" style="margin:0 0 6px"></p>
  <textarea id="gm-plan" placeholder="Pegá acá el plan que copiaste en la app…"></textarea>
  <div>
    <button id="gm-revisar">Revisar</button>
    <button id="gm-aplicar" class="p" disabled>Aplicar en este curso</button>
    <button id="gm-limpiar">Limpiar</button>
  </div>
  <div id="gm-detalle" style="margin-top:8px"></div>
  <div class="log" id="gm-log"></div>
</div>`;

  const $ = (sel) => panel.querySelector(sel);

  function pintarLinea(linea) {
    const log = $('#gm-log');
    if (!log) return;
    const d = document.createElement('div');
    if (linea.clase) d.className = linea.clase;
    d.textContent = `${linea.t} ${linea.msg}`;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
  }

  function refrescarPanel() {
    const curso = cursoEnPantalla();
    const materia = el(ID.materia);
    const nombreMat = materia && materia.selectedOptions[0] ? lim(materia.selectedOptions[0].text) : '';
    $('#gm-donde').innerHTML =
      `En pantalla: <strong>${curso || '(sin curso)'}</strong>` +
      (nombreMat ? ` · ${nombreMat}` : '');
    $('#gm-aplicar').disabled = !revision || !revision.some((r) => r.estado === 'escribir')
      || (estado && estado.activa);
  }

  function pintarRevision() {
    const cont = $('#gm-detalle');
    if (!revision) { cont.innerHTML = ''; return; }
    const cuenta = (e) => revision.filter((r) => r.estado === e).length;
    const problemas = revision.filter((r) => r.estado === 'noCoincide' || r.estado === 'falta');
    cont.innerHTML =
      `<div><strong>${cuenta('escribir')}</strong> fila(s) a cambiar · ` +
      `${cuenta('ya')} ya están así · ` +
      `<span class="${problemas.length ? 'err' : ''}">${problemas.length} sin tocar</span></div>` +
      (problemas.length
        ? '<ul style="margin:6px 0 0 16px;padding:0;font-size:11px">' +
          problemas.map((r) =>
            `<li class="err">${r.c.meta} fila ${r.c.posicion}: ${r.motivo}</li>`).join('') +
          '</ul>'
        : '') +
      '<ul style="margin:6px 0 0 16px;padding:0;font-size:11px">' +
      revision.filter((r) => r.estado === 'escribir').map((r) =>
        `<li>${r.c.meta} fila ${r.c.posicion} → ` +
        `${r.c.despues.descripcion || '(vacía)'} · ${r.c.despues.porcentaje}%</li>`).join('') +
      '</ul>';
  }

  function hacerRevision() {
    revision = null;
    pintarRevision();
    let plan;
    try {
      plan = JSON.parse($('#gm-plan').value);
    } catch {
      anotar('Eso no es un plan: no se pudo leer como JSON.', 'err');
      return refrescarPanel();
    }
    if (!plan || !Array.isArray(plan.grados)) {
      anotar('Al plan le falta la lista de grados. ¿Copiaste todo el texto?', 'err');
      return refrescarPanel();
    }
    const curso = cursoEnPantalla();
    const grado = gradoDe(curso);
    const suyo = plan.grados.find((g) => Number(g.grado) === grado);
    if (!suyo) {
      anotar(`El plan no trae nada para ${grado}° (el curso en pantalla es ${curso}).`, 'avi');
      return refrescarPanel();
    }
    const lectura = leerFilas();
    if (lectura.error) {
      anotar(lectura.error + '. Elegí la materia y pulsá Consultar.', 'err');
      return refrescarPanel();
    }
    planPegado = plan;
    revision = revisar(suyo.cambios || [], lectura.filas);
    const n = revision.filter((r) => r.estado === 'escribir').length;
    anotar(`Revisado ${curso}: ${n} fila(s) para cambiar.`, n ? 'ok' : 'avi');
    pintarRevision();
    refrescarPanel();
  }

  function aplicar() {
    if (!revision) return;
    const aEscribir = revision.filter((r) => r.estado === 'escribir').map((r) => r.c);
    if (!aEscribir.length) return;
    estado = {
      activa: true, curso: cursoEnPantalla(), pendientes: aEscribir,
      i: 0, escritas: 0, saltadas: 0, cargas: 0, registro: [],
      plan: $('#gm-plan').value,
    };
    persistir();
    anotar(`Aplicando ${aEscribir.length} fila(s) en ${estado.curso}…`);
    refrescarPanel();
    continuar();
  }

  document.body.appendChild(panel);
  $('#gm-min').onclick = () => {
    const c = $('.cuerpo');
    c.style.display = c.style.display === 'none' ? '' : 'none';
  };
  $('#gm-revisar').onclick = hacerRevision;
  $('#gm-aplicar').onclick = aplicar;
  $('#gm-limpiar').onclick = () => {
    Estado.limpiar();
    estado = null; revision = null; planPegado = null;
    $('#gm-log').innerHTML = '';
    pintarRevision();
    refrescarPanel();
  };

  // Al recargar por un postback, el recorrido sigue donde iba. Solo si estaba
  // activo: nunca se arranca solo por abrir la página.
  if (estado) {
    for (const l of estado.registro) pintarLinea(l);
    if (estado.plan) $('#gm-plan').value = estado.plan;
  }
  refrescarPanel();
  if (estado && estado.activa) continuar();

  // Para las pruebas.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { revisar, leerFilas, llenarFila, mismos, descripcionComparable };
  }
})();
