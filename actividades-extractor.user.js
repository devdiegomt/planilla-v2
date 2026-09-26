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


  const ESPERA_MS = 1500;

  const P = 'ctl00_ContentPlaceHolder1_';
  const N = 'ctl00$ContentPlaceHolder1$';
  const ID = { curso: P + 'lstCurso', materia: P + 'lstMateria', periodo: P + 'lstPeriodo',
               tabla: P + 'gvActividades', profesor: P + 'hfProfesor' };
  const NOMBRE = { curso: N + 'lstCurso', materia: N + 'lstMateria', consultar: N + 'btnRefresca' };

  /** A dónde se envía. La acción del formulario, o la misma pantalla. */
  const ACCION = (() => {
    const f = document.forms['aspnetForm'] || document.querySelector('form');
    return (f && f.getAttribute('action')) || location.pathname + location.search;
  })();

  /*
   * Lo ÚNICO que este script puede disparar.
   *
   * La pantalla tiene "Editar" y "Actualizar" en cada fila, que son los que
   * escriben, y "Descargar a Excel". Una lista blanca corta por lo sano: si
   * alguna vez alguien agrega un paso y se equivoca de control, revienta acá en
   * vez de guardar algo en la plataforma. Es más barato que acordarse.
   */
  const PERMITIDOS = new Set([NOMBRE.curso, NOMBRE.materia, NOMBRE.consultar]);


  const ES_USERSCRIPT = (typeof GM_info !== 'undefined');

  const $$ = window.jQuery;
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  const lim = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const norm = (s) => lim(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  /*
   * Ahora recibe el documento.
   *
   * El recorrido ya no navega: pide las páginas con `fetch` y las lee con
   * DOMParser, así que lo que se inspecciona casi nunca es la pantalla abierta.
   * Por omisión sigue siendo ella, que es de donde sale el plan.
   */
  const el = (id, doc) => (doc || document).getElementById(id);

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

  /*
   * Vive en memoria y ya está.
   *
   * Antes iba a `sessionStorage` porque cada postback recargaba la página y
   * había que retomar donde se iba. El recorrido ahora es un bucle con
   * `fetch`, así que no hay recarga a la que sobrevivir — y guardarlo sería
   * dejar basura en el navegador del docente por nada.
   */
  let estado = null;

  function anotar(msg, clase) {
    const linea = { t: new Date().toLocaleTimeString('es-CO'), msg: String(msg), clase: clase || null };
    if (estado) estado.registro.push(linea);
    pintarLinea(linea);
    console.log('[actividades]', msg);
  }
  function abortar(motivo) {
    anotar('ABORTADO: ' + motivo, 'err');
    if (estado) estado.activa = false;
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

  function leerTabla(doc) {
    const tabla = el(ID.tabla, doc);
    if (!tabla) return { error: 'no hay tabla en pantalla' };
    const mapa = mapaColumnas(tabla);
    if (!mapa) return { error: 'la tabla no tiene las columnas Descripción y Porcentaje' };

    const cuerpo = tabla.tBodies[0] || tabla;
    const actividades = [];
    const porMeta = new Map();
    const vacias = [];
    for (const f of [...cuerpo.rows].filter((r) => !r.querySelector('th'))) {
      const celda = (i) => (i >= 0 ? valorCelda(f.cells[i]) : '');
      const descripcion = celda(mapa.descripcion);
      const porcentaje = aNumero(celda(mapa.porcentaje));
      // Sin descripción no es una actividad: es el pie del GridView.
      if (!descripcion) continue;
      /*
       * La posición dentro de su meta cuenta TAMBIÉN las casillas sin usar,
       * porque es el número de fila en la pantalla y es así como se empareja
       * al escribir. Contando solo las llenas, la tercera actividad de una
       * meta con un hueco antes apuntaría a la fila de al lado.
       */
      const meta = celda(mapa.meta);
      porMeta.set(meta, (porMeta.get(meta) ?? 0) + 1);
      const posicion = porMeta.get(meta);
      /*
       * Las casillas sin usar.
       *
       * La tabla trae ocho actividades por categoría estén usadas o no; las
       * vacías vienen con 0 % y con la descripción repitiendo el rótulo
       * ("ACT.3"). Medido: de 33 filas, solo 10 u 11 son actividades reales.
       *
       * Se reconocen porque **no traen columna**: una actividad de verdad dice
       * "T3 - C4. TÍTULO" y una vacía dice "ACT.3" a secas. Antes esto miraba
       * si la descripción repetía la "Descripción General", y eso era una
       * suposición: esa columna no se había visto en ninguna corrida real.
       * La columna sí, en todas.
       *
       * Se cuentan y se dicen, no se tiran en silencio: si alguna vez una
       * actividad de verdad quedara en 0 % habría que poder notarlo.
       */
      if (!porcentaje && !/T\s*\d+\s*[-–—]\s*C\s*\d+/i.test(descripcion)) {
        // Con su meta y su posición, no solo contadas: son las casillas que el
        // formulario de la app puede ofrecer para estrenar una actividad. La
        // fila ya existe en la plataforma, que es lo que hace posible
        // escribirla sin inventar ningún id.
        vacias.push({ meta, posicion, descripcion });
        continue;
      }
      actividades.push({
        meta,
        // Dentro de su meta, la fila número N de la pantalla. Es como se
        // empareja al escribir: el rótulo de la columna "Descripción General"
        // no se ha visto nunca en una corrida real, así que no se depende de él.
        posicion,
        general: celda(mapa.general),
        descripcion,
        porcentaje,
        ciclo: celda(mapa.ciclo),
        destino: celda(mapa.destino),
      });
    }
    return { actividades, vacias };
  }

  // --- Leer el filtro -------------------------------------------------------

  /*
   * Estos dos se quedaron sin casa cuando el recorrido dejó de navegar: vivían
   * junto a los `ponerCurso`/`ponerMateria`, que ya no existen. Siguen siendo
   * lectores, así que van con los lectores — y ahora reciben el documento,
   * porque lo que se lee casi siempre es una respuesta, no la pantalla.
   */

  const valorDe = (id, doc) => { const c = el(id, doc); return c ? lim(c.value) : null; };

  /** Las materias que son una materia, no el "< TODOS >". */
  const materiasConcretas = (doc) => {
    const sel = el(ID.materia, doc);
    return [...(sel ? sel.options : [])].filter((o) => {
      const v = lim(o.value);
      return v && v !== '%' && v !== '0';
    });
  };

  // --- Recorrer sin recargar -------------------------------------------------

  /*
   * El recorrido va por `fetch`, no navegando.
   *
   * Medido el 26/09/2026 contra la plataforma: los tres pasos del filtro
   * —cambiar curso, elegir materia, consultar— contestan 200 con un
   * `__VIEWSTATE` nuevo, y el tercero devuelve la tabla de 34 filas. Y
   * reproducen la misma máquina de estados que en el navegador: tras el curso
   * no hay tabla, tras la materia tampoco, y vuelve al consultar. Ver
   * `recon/sonda-postback.js` y `CATALOGO.md`.
   *
   * Lo que eso se lleva por delante: **la máquina de estados**. Antes cada paso
   * recargaba la página, así que había que guardar en sessionStorage por dónde
   * iba, contar intentos, contar cargas y volver a entrar en `continuar()` en
   * cada arranque. Sin recargas no hay nada que persistir — es un bucle.
   *
   * Y de paso deja de hacer falta Tampermonkey: un favorito no sobrevive a una
   * recarga, pero acá no hay ninguna.
   *
   * **Nunca toca la pantalla.** Lo que vuelve se lee con DOMParser y se tira;
   * el formulario que el docente tiene abierto queda como estaba.
   */

  /** Los campos de un formulario, como los mandaría el navegador. */
  function camposDe(form) {
    const datos = new URLSearchParams();
    for (const c of form.querySelectorAll('input[name], select[name], textarea[name]')) {
      if (c.disabled) continue;
      if (c.type === 'checkbox' || c.type === 'radio') {
        if (c.checked) datos.append(c.name, c.value);
        continue;
      }
      // Los submit no viajan solos: solo el que se pulsó, y eso se pone aparte.
      if (c.type === 'submit' || c.type === 'image' || c.type === 'button') continue;
      datos.append(c.name, c.value);
    }
    return datos;
  }

  const formularioDe = (doc) => doc.forms['aspnetForm'] || doc.querySelector('form');

  /**
   * Un envío. Es el ÚNICO lugar del script que toca la red.
   *
   * `objetivo` es el control que dispara (un `__EVENTTARGET`) y `extra` lo que
   * haya que poner además — el valor elegido, o el botón de consultar, que al
   * ser un submit viaja como campo propio y no como evento.
   */
  async function enviar(campos, objetivo, extra) {
    if (objetivo && !PERMITIDOS.has(objetivo)) {
      throw new Error('control no permitido para este script: ' + objetivo);
    }
    for (const [k, v] of Object.entries(extra || {})) {
      if (!PERMITIDOS.has(k)) {
        throw new Error('control no permitido para este script: ' + k);
      }
      campos.set(k, v);
    }
    campos.set('__EVENTTARGET', objetivo || '');
    campos.set('__EVENTARGUMENT', '');

    const r = await fetch(ACCION, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: campos.toString(),
    });
    if (!r.ok) throw new Error('el servidor contestó ' + r.status);
    const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
    if (doc.querySelector('input[type=password]')) {
      throw new Error('volvió el login: se cayó la sesión');
    }
    const form = formularioDe(doc);
    if (!form) throw new Error('la respuesta no trae el formulario');
    return { doc, campos: camposDe(form) };
  }

  /** El botón de consultar tal como está en esa respuesta. */
  function botonConsultar(doc) {
    const b = [...doc.querySelectorAll('input[type=submit][name]')]
      .find((x) => x.name === NOMBRE.consultar);
    return b ? { [b.name]: b.value || 'Consultar' } : null;
  }

  // --- Plan -----------------------------------------------------------------

  /*
   * Los cursos, con su valor TAL CUAL y no recortado.
   *
   * En la plataforma los valores traen espacios al final (`'1101 '`). Mientras
   * el recorrido navegaba daba igual, porque se asignaba `sel.value = valor` y
   * el navegador emparejaba la opción. Ahora el valor viaja en el cuerpo del
   * POST, así que mandar `'1101'` por `'1101 '` es mandar un curso que el
   * servidor no reconoce. Se guarda el bruto para enviar y el recortado para
   * mostrar y para sacar el grado.
   */
  function cursosDisponibles() {
    const sel = el(ID.curso);
    return [...(sel ? sel.options : [])]
      .map((o) => ({ valor: o.value, texto: lim(o.value) }))
      .filter((c) => c.texto && c.texto !== '%');
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
      const g = gradoDe(c.texto);
      if (!porGrado.has(g)) porGrado.set(g, c);
    }
    return [...porGrado.values()];
  }

  // --- Recorrido ------------------------------------------------------------


  /**
   * El recorrido entero: por cada curso, tres envíos y una lectura.
   *
   * Uno por vez y con espera entre cursos, que es la regla del repo. Un curso
   * que falle no tumba la corrida: se anota y se sigue con el siguiente.
   */
  async function recorrer(plan) {
    estado.activa = true;
    refrescarPanel();

    // Se arranca del formulario de la pantalla, que es el estado de partida.
    let campos = camposDe(formularioDe(document));

    for (const c of plan) {
      if (!estado.activa) break;
      const curso = c.texto;
      estado.i = plan.indexOf(c);
      refrescarPanel();

      try {
        anotar(`→ ${curso}: curso`);
        // El valor va sin recortar: en la plataforma trae espacios al final.
        let paso = await enviar(campos, NOMBRE.curso, { [NOMBRE.curso]: c.valor });

        const materias = materiasConcretas(paso.doc);
        if (!materias.length) throw new Error('el curso no tiene materias');
        anotar(`→ ${curso}: ${lim(materias[0].text)}`);
        paso = await enviar(paso.campos, NOMBRE.materia,
                            { [NOMBRE.materia]: materias[0].value });

        const boton = botonConsultar(paso.doc);
        if (!boton) throw new Error('no está el botón de consultar');
        anotar(`→ ${curso}: consultar`);
        paso = await enviar(paso.campos, null, boton);

        const lectura = leerTabla(paso.doc);
        if (lectura.error) throw new Error(lectura.error);

        estado.resultados.push({
          curso,
          grado: gradoDe(curso),
          materia: lim(valorDe(ID.materia, paso.doc)),
          materiaNombre: lim(el(ID.materia, paso.doc)?.selectedOptions[0]?.text || ''),
          periodo: lim(valorDe(ID.periodo, paso.doc)),
          actividades: lectura.actividades,
          casillasSinUsar: lectura.vacias,
        });
        const suma = lectura.actividades.reduce((a, x) => a + (x.porcentaje || 0), 0);
        anotar(`✔ ${curso}: ${lectura.actividades.length} actividades `
          + `(${lectura.vacias.length} casillas sin usar), suman ${suma}%.`);

        // El siguiente curso arranca del estado que dejó este.
        campos = paso.campos;
      } catch (e) {
        estado.errores.push({ curso, motivo: e.message });
        anotar(`✗ ${curso}: ${e.message}. Sigo.`, 'err');
        // Se vuelve al formulario de la pantalla: el estado del que falló no
        // sirve de punto de partida.
        campos = camposDe(formularioDe(document));
      }
      refrescarPanel();
      await dormir(ESPERA_MS);
    }

    estado.activa = false;
    anotar(`Listo: ${estado.resultados.length} curso(s).`, 'ok');
    refrescarPanel();
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
    estado = { activa: true, plan, i: 0, registro: [], resultados: [], errores: [] };
    $log.innerHTML = '';
    anotar(`Arranco: ${plan.length} curso(s).`);
    recorrer(plan);
  };

  $('#ga-cancelar').onclick = () => {
    if (estado) estado.activa = false;   // el bucle corta en el próximo curso
    estado = null; $log.innerHTML = '';
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
      'El recorrido va sin recargar la página, así que sirve igual pegado en la consola.</div>';
  }
  refrescarCosto();
  refrescarPanel();
  // Para las pruebas: sin esto la lista blanca solo se puede comprobar leyendo
  // el código, y una guarda que nadie ejerce es una guarda que puede estar rota.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { enviar, camposDe, leerTabla, PERMITIDOS };
  }
})();
