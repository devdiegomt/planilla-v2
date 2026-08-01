// ==UserScript==
// @name         GLA — Asistencia por asignatura (autofill)
// @namespace    https://github.com/devdiegomt/planilla-v2
// @version      1.1.0
// @description  Rellena la asistencia diaria por asignatura a partir de un JSON. Dry-run por defecto: marca en pantalla y se detiene hasta que confirmes.
// @author       devdiegomt
// @match        *://webapps3-classroomliveweb.com/*/Seguro/AsistenciaAsignaturaAusenciaDia.aspx
// @include      https://webapps3-classroomliveweb.com:2443/*/Seguro/AsistenciaAsignaturaAusenciaDia.aspx
// @include      /^https?:\/\/[^/]*classroomliveweb\.com(:\d+)?\/.*AsistenciaAsignaturaAusenciaDia\.aspx/
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * ESTA PÁGINA ESCRIBE EN EL SISTEMA DEL COLEGIO.
 * Todo el diseño está orientado a que nunca se guarde algo que no revisaste.
 *
 * FLUJO
 * -----
 *   IDLE → SET_FECHA → SET_HORA → SET_CURSO → SET_MATERIA → MARCAR → CONFIRMAR → GUARDAR → FIN
 *
 * Cada paso del filtro dispara un postback completo, así que el estado vive en
 * sessionStorage y el script continúa solo tras cada recarga. Los pasos son
 * idempotentes: al cargar, cada uno primero verifica si su efecto ya está en el
 * DOM; si sí, avanza sin postear. Si no, reintenta hasta MAX_INTENTOS y aborta.
 *
 * MARCAR no dispara postback: los radios de la tabla no tienen handler, así que
 * las marcas se ponen todas en una pasada y viajan en el único POST de Guardar.
 *
 * DRY-RUN
 * -------
 * El script se detiene en CONFIRMAR con las marcas ya puestas en pantalla pero
 * NO enviadas. Recargar la página las descarta. Guardar solo ocurre si hacés
 * clic en "Confirmar y guardar".
 *
 * LO QUE NUNCA HACE
 * -----------------
 *   - No toca Salir (ImageButton1).
 *   - No escribe en los hidden (hfCurso, hfCodAlum, hfId_asistencia…): los
 *     llena el servidor.
 *   - No toca los campos ocultos de hora del cliente (TextBox1/2/3).
 *   - No limpia marcas existentes: si la hora ya tiene asistencia, aborta.
 *   - No recorre varios cursos: una corrida es un curso y una hora.
 */

(() => {
  'use strict';

  // ======================================================================
  // CONFIGURACIÓN
  // ======================================================================

  const CLAVE_ESTADO = 'gla_asistencia_estado_v1';
  const CLAVE_ENTRADA = 'gla_asistencia_entrada_v1'; // plantilla, en localStorage
  const ESPERA_MS = 1500;      // mínimo entre postbacks
  const MAX_INTENTOS = 3;      // por paso
  const MAX_CARGAS = 15;       // recargas de página por corrida: cortafuegos anti-bucle

  /*
   * ¿Esto corre como userscript instalado, o alguien lo pegó en la consola?
   * Importa muchísimo: cada paso del filtro recarga la página, y la consola no
   * reinyecta nada. Pegado en la consola, el script muere en el primer postback
   * y la corrida queda a medias sin ninguna señal.
   *
   * Tampermonkey define GM_info incluso con @grant none, así que sirve de
   * discriminador. Si no está, avisamos en vez de morir en silencio.
   */
  const ES_USERSCRIPT = (typeof GM_info !== 'undefined');

  const P = 'ctl00_ContentPlaceHolder1_';
  const N = 'ctl00$ContentPlaceHolder1$';

  const ID = {
    hora: P + 'DropDownHora',
    fecha: P + 'txtFecha',
    curso: P + 'lstCursos',
    materia: P + 'lstMateria',
    registro: P + 'chRegis',
    guardar: P + 'ImageButton3',
    tabla: 'gvDatos',
    modal: 'myModal',
    modalBody: P + 'lblModalBody',
  };
  const NOMBRE = {
    hora: N + 'DropDownHora',
    fecha: N + 'txtFecha',
    curso: N + 'lstCursos',
    materia: N + 'lstMateria',
  };

  /*
   * Los cuatro estados de asistencia son UN grupo de radios por fila
   * (name = ...$gvDatos$ctlNN$radio), o sea mutuamente excluyentes.
   *
   * CUIDADO con los ids del servidor: "checkretardo_J" NO es el justificado,
   * está en la columna "Retardo Injustificado". Por eso cada estado se ubica
   * por el ENCABEZADO de su columna y además se verifica que el value del
   * radio sea el esperado. Si alguno de los dos no coincide, se aborta: es
   * señal de que la página cambió y adivinar acá le deja una anotación
   * equivocada a un estudiante.
   */
  const ESTADOS = {
    retardo_justificado: { encabezado: 'retardo justificado', valor: 'checkretardo', etiqueta: 'Retardo Justificado' },
    retardo_injustificado: { encabezado: 'retardo injustificado', valor: 'checkretardo_J', etiqueta: 'Retardo Injustificado' },
    ausencia_justificada: { encabezado: 'ausencia justificada', valor: 'checkausenciaj', etiqueta: 'Ausencia Justificada' },
    ausencia_injustificada: { encabezado: 'ausencia injustificada', valor: 'checkausenciaIn', etiqueta: 'Ausencia Injustificada' },
  };

  // Alias del formato de entrada corto. Ambos apuntan a las INJUSTIFICADAS.
  const ALIAS = {
    falla: 'ausencia_injustificada',
    ausencia: 'ausencia_injustificada',
    retardo: 'retardo_injustificado',
    tarde: 'retardo_injustificado',
  };

  // ======================================================================
  // UTILIDADES
  // ======================================================================

  const $$ = window.jQuery;
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  const lim = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

  // Normaliza para comparar textos sin depender de tildes ni mayúsculas.
  const norm = (s) => lim(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  const el = (id) => document.getElementById(id);

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

  function nuevoEstado(cfg) {
    return {
      activa: true, paso: 'SET_FECHA', cfg,
      intentos: {}, cargas: 0, registro: [], resumen: null, iniciado: Date.now(),
    };
  }

  function persistir() { Estado.guardar(estado); }

  function anotar(msg, clase) {
    const linea = { t: new Date().toLocaleTimeString('es-CO'), msg: String(msg), clase: clase || null };
    if (estado) { estado.registro.push(linea); persistir(); }
    pintarLinea(linea);
    console.log('[asistencia]', msg);
  }

  function abortar(motivo) {
    anotar('ABORTADO: ' + motivo, 'err');
    if (estado) { estado.activa = false; estado.paso = 'ABORTADO'; persistir(); }
    refrescarPanel();
  }

  // ======================================================================
  // LECTURA DEL DOM
  // ======================================================================

  const RE_FECHA = /^(\d{2}\/\d{2}\/\d{4})([\s\S]*)$/;

  /* Conserva el resto del valor tal cual —incluido el NBSP de "p.<NBSP>m."—
     y solo reemplaza la parte de fecha. Fabricar el formato completo a mano es
     pedirle al RequiredFieldValidator que lo rechace. */
  function construirFecha(actual, nueva) {
    const m = RE_FECHA.exec(actual);
    if (!m) return null;
    return nueva + m[2];
  }
  const fechaActual = (v) => (RE_FECHA.exec(v || '') || [])[1] || null;

  // 1..6 van directo; la Séptima Hora tiene value "9".
  function valorHora(h) {
    const n = Number(h);
    if (!Number.isInteger(n)) return null;
    if (n === 7 || n === 9) return '9';
    if (n >= 1 && n <= 6) return String(n);
    return null;
  }

  function opcionPorValorTrim(select, objetivo) {
    return [...select.options].find((o) => String(o.value).trim() === String(objetivo).trim()) || null;
  }

  function opcionMateria(select, nombre) {
    const objetivo = norm(nombre);
    const cand = [...select.options].filter((o) => o.value !== '%' &&
      (norm(o.text) === objetivo || String(o.value) === String(nombre)));
    return cand;
  }

  /* Índices de columna sacados del encabezado, nunca hardcodeados. */
  function mapaColumnas(tabla) {
    const filaEnc = [...tabla.rows].find((f) => f.querySelector('th'));
    if (!filaEnc) return null;
    const enc = [...filaEnc.cells].map((c) => norm(c.textContent));
    const idx = (texto) => enc.indexOf(texto);
    const mapa = { codigo: idx('codigo'), nombre: idx('nombre'), estados: {} };
    for (const [clave, def] of Object.entries(ESTADOS)) mapa.estados[clave] = idx(def.encabezado);
    mapa.encabezados = enc;
    return mapa;
  }

  function filasDatos(tabla) {
    const cuerpo = tabla.tBodies[0] || tabla;
    return [...cuerpo.rows].filter((f) => !f.querySelector('th'));
  }

  // El radio del grupo de estado es el que termina en "$radio" — así se
  // distingue de "$radioq" (Salida Temprano) y de "$aus" (Ausencia Día).
  const esRadioEstado = (r) => /\$radio$/.test(r.getAttribute('name') || '');

  function radiosEstadoMarcados(tabla) {
    return [...tabla.querySelectorAll('input[type=radio]')].filter((r) => esRadioEstado(r) && r.checked);
  }

  // ======================================================================
  // VALIDACIÓN DE LA ENTRADA
  // ======================================================================

  function validarEntrada(texto) {
    let cfg;
    try { cfg = JSON.parse(texto); }
    catch (e) { throw new Error('El JSON no se puede parsear: ' + e.message); }

    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('La entrada debe ser un objeto JSON.');

    // Una corrida = un curso y una hora. Nada de lotes.
    for (const campo of ['curso', 'hora']) {
      if (Array.isArray(cfg[campo])) throw new Error(`"${campo}" no puede ser una lista: una corrida es un solo curso y una sola hora.`);
    }
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(String(cfg.fecha || ''))) {
      throw new Error('"fecha" debe venir como DD/MM/AAAA. Recibí: ' + JSON.stringify(cfg.fecha));
    }
    if (valorHora(cfg.hora) === null) throw new Error('"hora" debe ser 1-6 o 7 (Séptima Hora). Recibí: ' + JSON.stringify(cfg.hora));
    if (!lim(cfg.curso)) throw new Error('Falta "curso".');
    if (!lim(cfg.asignatura)) throw new Error('Falta "asignatura".');
    if (!Array.isArray(cfg.marcas)) throw new Error('"marcas" debe ser una lista (puede ir vacía).');

    const vistos = new Set();
    cfg.marcas = cfg.marcas.map((m, i) => {
      const cod = lim(m && m.cod_alum);
      if (!cod) throw new Error(`marcas[${i}]: falta cod_alum.`);
      if (!/^\d{6,12}$/.test(cod)) throw new Error(`marcas[${i}]: cod_alum "${cod}" no parece un código.`);
      if (vistos.has(cod)) throw new Error(`cod_alum ${cod} aparece dos veces. Los estados son excluyentes: solo puede tener uno.`);
      vistos.add(cod);

      const bruto = norm(m.tipo).replace(/[\s-]+/g, '_');
      const tipo = ESTADOS[bruto] ? bruto : ALIAS[bruto];
      if (!tipo) {
        throw new Error(`marcas[${i}]: tipo "${m.tipo}" desconocido. Válidos: ` +
          Object.keys(ESTADOS).join(', ') + ' (o los alias ' + Object.keys(ALIAS).join(', ') + ').');
      }
      return { cod_alum: cod, tipo };
    });
    return cfg;
  }

  // ======================================================================
  // POSTBACKS — uno a la vez, nunca en paralelo
  // ======================================================================

  let postbackEnVuelo = false;

  async function dispararPostback(descripcion, fn) {
    if (postbackEnVuelo) { console.warn('[asistencia] postback ya en vuelo, ignorado'); return; }
    postbackEnVuelo = true;
    anotar('→ ' + descripcion);
    persistir();
    await dormir(ESPERA_MS);
    if (!estado || !estado.activa) { postbackEnVuelo = false; return; }
    try { fn(); }
    catch (e) { postbackEnVuelo = false; abortar('fallo al disparar el postback: ' + e.message); }
  }

  /* Los tres selects usan Select2: poner .value a mano no sincroniza el widget
     ni notifica al handler, así que se pasa por jQuery y después se dispara el
     postback explícito en vez de confiar en que el change propague. */
  function ponerSelect(idEl, nombreCtrl, valor) {
    const sel = el(idEl);
    if (!sel) throw new Error('no encuentro el control ' + idEl);
    if ($$ && $$.fn) $$(sel).val(valor).trigger('change.select2');
    else sel.value = valor;
    window.__doPostBack(nombreCtrl, '');
  }

  // ======================================================================
  // MÁQUINA DE ESTADOS
  // ======================================================================

  function intentosDe(paso) { return estado.intentos[paso] || 0; }
  function sumarIntento(paso) { estado.intentos[paso] = intentosDe(paso) + 1; persistir(); }

  function pasarA(paso) { estado.paso = paso; persistir(); refrescarPanel(); }

  async function continuar() {
    if (!estado || !estado.activa) return;
    refrescarPanel();
    const cfg = estado.cfg;

    switch (estado.paso) {
      // ---------------------------------------------------------------- FECHA
      case 'SET_FECHA': {
        const campo = el(ID.fecha);
        if (!campo) return abortar('no encuentro el campo de fecha. ¿Es la pantalla correcta?');
        if (fechaActual(campo.value) === cfg.fecha) {
          anotar(`Fecha ya en ${cfg.fecha}.`, 'ok');
          pasarA('SET_HORA');
          return continuar();
        }
        if (intentosDe('SET_FECHA') >= MAX_INTENTOS) {
          return abortar(`la fecha sigue en "${fechaActual(campo.value)}" tras ${MAX_INTENTOS} intentos.`);
        }
        const nuevo = construirFecha(campo.value, cfg.fecha);
        if (!nuevo) return abortar(`el campo de fecha tiene un formato que no reconozco: ${JSON.stringify(campo.value)}`);
        sumarIntento('SET_FECHA');
        return dispararPostback(`fecha → ${cfg.fecha}`, () => {
          campo.value = nuevo;              // conserva la hora y el NBSP originales
          window.__doPostBack(NOMBRE.fecha, '');
        });
      }

      // ----------------------------------------------------------------- HORA
      case 'SET_HORA': {
        const sel = el(ID.hora);
        if (!sel) return abortar('no encuentro el selector de hora.');
        const objetivo = valorHora(cfg.hora);
        if (String(sel.value) === objetivo) {
          anotar(`Hora ya en ${lim(sel.selectedOptions[0]?.text)}.`, 'ok');
          pasarA('SET_CURSO');
          return continuar();
        }
        if (!opcionPorValorTrim(sel, objetivo)) {
          return abortar(`la hora ${cfg.hora} (value "${objetivo}") no está entre las opciones.`);
        }
        if (intentosDe('SET_HORA') >= MAX_INTENTOS) {
          return abortar(`la hora no quedó en "${objetivo}" tras ${MAX_INTENTOS} intentos.`);
        }
        sumarIntento('SET_HORA');
        return dispararPostback(`hora → ${objetivo}`, () => ponerSelect(ID.hora, NOMBRE.hora, objetivo));
      }

      // ---------------------------------------------------------------- CURSO
      case 'SET_CURSO': {
        const sel = el(ID.curso);
        if (!sel) return abortar('no encuentro el selector de curso.');
        const opcion = opcionPorValorTrim(sel, cfg.curso);
        if (!opcion) {
          return abortar(`el curso "${cfg.curso}" no está entre las opciones: ` +
            [...sel.options].map((o) => JSON.stringify(o.value)).join(', '));
        }
        if (String(sel.value).trim() === String(cfg.curso).trim()) {
          anotar(`Curso ya en ${cfg.curso} (${lim(opcion.text)}).`, 'ok');
          pasarA('SET_MATERIA');
          return continuar();
        }
        if (intentosDe('SET_CURSO') >= MAX_INTENTOS) {
          return abortar(`el curso no quedó en "${cfg.curso}" tras ${MAX_INTENTOS} intentos.`);
        }
        sumarIntento('SET_CURSO');
        // Se manda el value REAL de la opción, con su padding, sin fabricarlo.
        return dispararPostback(`curso → ${cfg.curso}`, () => ponerSelect(ID.curso, NOMBRE.curso, opcion.value));
      }

      // -------------------------------------------------------------- MATERIA
      case 'SET_MATERIA': {
        const sel = el(ID.materia);
        if (!sel) return abortar('no encuentro el selector de asignatura.');

        // La lista es en cascada: llega vacía hasta que hora+curso están puestos.
        const utiles = [...sel.options].filter((o) => o.value !== '%');
        if (!utiles.length) {
          if (intentosDe('SET_MATERIA') >= MAX_INTENTOS) {
            return abortar('la lista de asignaturas sigue vacía. Revisá que tengas clase en ese curso a esa hora.');
          }
          sumarIntento('SET_MATERIA');
          anotar('Asignaturas aún vacías; reintento el curso para repoblar.');
          const opcion = opcionPorValorTrim(el(ID.curso), cfg.curso);
          return dispararPostback('repoblar asignaturas', () => ponerSelect(ID.curso, NOMBRE.curso, opcion.value));
        }

        const cand = opcionMateria(sel, cfg.asignatura);
        if (cand.length === 0) {
          return abortar(`la asignatura "${cfg.asignatura}" no está. Disponibles: ` +
            utiles.map((o) => `"${lim(o.text)}"`).join(', '));
        }
        if (cand.length > 1) {
          return abortar(`"${cfg.asignatura}" coincide con ${cand.length} asignaturas. Precisá cuál.`);
        }
        if (String(sel.value) === String(cand[0].value)) {
          anotar(`Asignatura ya en ${lim(cand[0].text)}.`, 'ok');
          pasarA('MARCAR');
          return continuar();
        }
        if (intentosDe('SET_MATERIA_SEL') >= MAX_INTENTOS) {
          return abortar(`la asignatura no quedó seleccionada tras ${MAX_INTENTOS} intentos.`);
        }
        estado.intentos.SET_MATERIA_SEL = (estado.intentos.SET_MATERIA_SEL || 0) + 1;
        return dispararPostback(`asignatura → ${lim(cand[0].text)}`,
          () => ponerSelect(ID.materia, NOMBRE.materia, cand[0].value));
      }

      // --------------------------------------------------------------- MARCAR
      case 'MARCAR':
        return marcar();

      // ------------------------------------------------------------ CONFIRMAR
      case 'CONFIRMAR':
        // Se queda esperando el clic. Si la página se recargó, las marcas se
        // perdieron: hay que rehacerlas antes de volver a ofrecer Guardar.
        if (!estado.marcasAplicadas) {
          anotar('La página se recargó y las marcas se perdieron. Las vuelvo a aplicar.');
          pasarA('MARCAR');
          return continuar();
        }
        refrescarPanel();
        return;

      // --------------------------------------------------------------- GUARDAR
      case 'GUARDAR':
        return guardar();

      // ------------------------------------------------------------------ FIN
      case 'FIN':
        return verificarGuardado();

      default:
        return;
    }
  }

  // ======================================================================
  // MARCAR — todas las validaciones ANTES de tocar un solo radio
  // ======================================================================

  /*
   * ¿La página muestra de verdad lo que dice el JSON? En el flujo completo el
   * script mismo puso los filtros, pero verificarlo igual cuesta nada y atrapa
   * que el servidor haya cambiado algo por su cuenta. En el modo "solo marcar"
   * —donde filtraste vos a mano— es la única defensa contra marcarle al 802 lo
   * que era del 801.
   */
  function desajusteDeFiltro(cfg) {
    const fecha = el(ID.fecha), hora = el(ID.hora), curso = el(ID.curso), materia = el(ID.materia);
    if (!fecha || !hora || !curso || !materia) return 'faltan controles del filtro en la página.';

    const problemas = [];
    const vistaFecha = fechaActual(fecha.value);
    if (vistaFecha !== cfg.fecha) problemas.push(`fecha en pantalla ${vistaFecha}, el JSON dice ${cfg.fecha}`);

    if (String(hora.value) !== valorHora(cfg.hora)) {
      problemas.push(`hora en pantalla "${lim(hora.selectedOptions[0]?.text)}", el JSON dice ${cfg.hora}`);
    }
    if (String(curso.value).trim() !== String(cfg.curso).trim()) {
      problemas.push(`curso en pantalla ${JSON.stringify(curso.value)}, el JSON dice ${cfg.curso}`);
    }
    const textoMateria = lim(materia.selectedOptions[0]?.text);
    if (norm(textoMateria) !== norm(cfg.asignatura) && String(materia.value) !== String(cfg.asignatura)) {
      problemas.push(`asignatura en pantalla "${textoMateria}", el JSON dice "${cfg.asignatura}"`);
    }
    return problemas.length ? problemas.join('; ') : null;
  }

  function marcar() {
    const cfg = estado.cfg;

    const desajuste = desajusteDeFiltro(cfg);
    if (desajuste) return abortar('la página no muestra lo que dice el JSON → ' + desajuste + '. No marco nada.');

    const tabla = el(ID.tabla);
    if (!tabla) return abortar('la tabla de estudiantes no está en el DOM.');

    const cols = mapaColumnas(tabla);
    if (!cols) return abortar('la tabla no tiene fila de encabezados.');
    if (cols.codigo < 0 || cols.nombre < 0) {
      return abortar('no encuentro las columnas "Codigo" y/o "Nombre". Encabezados: ' + JSON.stringify(cols.encabezados));
    }
    for (const [clave, idx] of Object.entries(cols.estados)) {
      if (idx < 0) return abortar(`no encuentro la columna "${ESTADOS[clave].etiqueta}". La página cambió; no sigo a ciegas.`);
    }

    const filas = filasDatos(tabla);
    if (!filas.length) return abortar('la tabla no tiene filas de estudiantes.');
    anotar(`Tabla cargada: ${filas.length} estudiantes.`);

    // --- Regla: si ya hay asistencia registrada, no se toca nada -----------
    const yaMarcados = radiosEstadoMarcados(tabla);
    if (yaMarcados.length) {
      const detalle = yaMarcados.slice(0, 8).map((r) => {
        const fila = r.closest('tr');
        const cod = lim(fila.cells[cols.codigo]?.textContent);
        const est = Object.values(ESTADOS).find((e) => e.valor === r.value);
        return `${cod} (${est ? est.etiqueta : r.value})`;
      });
      return abortar(`esta hora YA tiene ${yaMarcados.length} estudiante(s) con estado registrado: ` +
        detalle.join(', ') + (yaMarcados.length > 8 ? '…' : '') +
        '. No piso datos existentes; revisá a mano.');
    }

    // Otros rastros de datos previos: no bloquean, pero conviene saberlo.
    const conTexto = [...tabla.querySelectorAll('input[type=text], textarea')].filter((t) => lim(t.value) !== '');
    if (conTexto.length) anotar(`Aviso: ${conTexto.length} campo(s) de observación ya traen texto. No los toco.`, 'err');

    // --- Índice por cod_alum ------------------------------------------------
    const porCodigo = new Map();
    for (const fila of filas) {
      const cod = lim(fila.cells[cols.codigo]?.textContent);
      if (cod) porCodigo.set(cod, fila);
    }

    // --- Regla: si falta alguno, no se marca NADA ---------------------------
    const faltantes = cfg.marcas.filter((m) => !porCodigo.has(m.cod_alum)).map((m) => m.cod_alum);
    if (faltantes.length) {
      return abortar(`estos cod_alum no están en la tabla del ${cfg.curso}: ${faltantes.join(', ')}. ` +
        'No marco nada. Ojo: el código de esta tabla es el de matrícula (empieza por año), ' +
        'no el número que nombra las fotos.');
    }

    /* --- El mapa completo, verificado contra la primera fila ---------------
       Los cuatro estados tienen que estar donde dice el encabezado Y con el
       value que les corresponde. Se comprueban los cuatro, no solo los que usa
       esta corrida: un desajuste en cualquiera es señal de que la página
       cambió, y ahí adivinar le deja una anotación equivocada a un estudiante. */
    for (const [clave, def] of Object.entries(ESTADOS)) {
      const celda = filas[0].cells[cols.estados[clave]];
      const radio = celda ? celda.querySelector('input[type=radio]') : null;
      if (!radio) return abortar(`la columna "${def.etiqueta}" no tiene radio en la primera fila.`);
      if (radio.value !== def.valor) {
        return abortar(`desajuste de mapeo: bajo el encabezado "${def.etiqueta}" hay un radio con value ` +
          `"${radio.value}" y esperaba "${def.valor}". La página cambió; no marco nada.`);
      }
      if (!esRadioEstado(radio)) {
        return abortar(`el radio de "${def.etiqueta}" no pertenece al grupo de estado ` +
          `(name="${radio.getAttribute('name')}").`);
      }
    }

    /* --- Primera pasada: resolver y validar TODOS los objetivos ------------
       Sin tocar nada todavía. Si algo falla acá, la tabla queda intacta. */
    const objetivos = [];
    for (const m of cfg.marcas) {
      const fila = porCodigo.get(m.cod_alum);
      const def = ESTADOS[m.tipo];
      const celda = fila.cells[cols.estados[m.tipo]];
      const radio = celda ? celda.querySelector('input[type=radio]') : null;

      if (!radio) return abortar(`no hay radio en la columna "${def.etiqueta}" para ${m.cod_alum}. No marco nada.`);
      if (radio.value !== def.valor) {
        return abortar(`desajuste en ${m.cod_alum}: la columna "${def.etiqueta}" tiene un radio con value ` +
          `"${radio.value}" y esperaba "${def.valor}". No marco nada.`);
      }
      if (!esRadioEstado(radio)) {
        return abortar(`el radio de ${m.cod_alum} no pertenece al grupo de estado ` +
          `(name="${radio.getAttribute('name')}"). No marco nada.`);
      }
      objetivos.push({ m, def, radio, fila });
    }

    // --- Segunda pasada: recién ahora se marca ------------------------------
    const aplicadas = objetivos.map(({ m, def, radio, fila }) => {
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
      return {
        cod_alum: m.cod_alum,
        nombre: lim(fila.cells[cols.nombre]?.textContent),
        tipo: m.tipo, etiqueta: def.etiqueta, valor: def.valor,
      };
    });

    const cuenta = {};
    for (const a of aplicadas) cuenta[a.etiqueta] = (cuenta[a.etiqueta] || 0) + 1;

    estado.marcasAplicadas = aplicadas;
    estado.resumen = {
      curso: cfg.curso, hora: cfg.hora, fecha: cfg.fecha,
      asignatura: lim(el(ID.materia)?.selectedOptions[0]?.text) || cfg.asignatura,
      totalFilas: filas.length, cuenta,
    };
    anotar(`Marcados en pantalla (sin enviar): ${aplicadas.length} de ${filas.length}.`, 'ok');
    pasarA('CONFIRMAR');
  }

  // ======================================================================
  // GUARDAR — solo desde el clic del usuario
  // ======================================================================

  function guardar() {
    const tabla = el(ID.tabla);
    if (!tabla) return abortar('la tabla desapareció antes de guardar.');

    // Última comprobación: lo que está marcado ahora tiene que ser exactamente
    // lo que se mostró en el resumen. Si no, algo cambió entre medio.
    const marcados = radiosEstadoMarcados(tabla);
    const esperados = estado.marcasAplicadas || [];
    if (marcados.length !== esperados.length) {
      return abortar(`iba a guardar ${esperados.length} marcas pero en pantalla hay ${marcados.length}. No envío.`);
    }

    const chk = el(ID.registro);
    if (chk && !chk.checked) {
      chk.checked = true;
      chk.dispatchEvent(new Event('change', { bubbles: true }));
      anotar('Marcado "Registro de asistencia".');
    }

    const btn = el(ID.guardar);
    if (!btn) return abortar('no encuentro el botón Guardar.');

    estado.paso = 'FIN';
    persistir();
    return dispararPostback('GUARDAR (envío al servidor)', () => btn.click());
  }

  // ======================================================================
  // FIN — verificar contra el DOM, no contra el texto del modal
  // ======================================================================

  function verificarGuardado() {
    const tabla = el(ID.tabla);
    const esperados = estado.marcasAplicadas || [];

    /* El modal #myModal trae "Información procesada satisfactoriamente"
       pre-renderizado en el HTML aunque no se haya guardado nada, así que su
       TEXTO no sirve como señal. Lo que vale es si está visible. */
    const modal = el(ID.modal);
    const modalVisible = !!modal && (
      modal.classList.contains('show') ||
      modal.style.display === 'block' ||
      modal.getAttribute('aria-hidden') === 'false' ||
      !!(modal.offsetParent || modal.getClientRects().length));
    const modalTexto = lim(el(ID.modalBody)?.textContent);

    // La prueba de verdad: releer la tabla y ver si el servidor devolvió los
    // estados que mandamos.
    let verificadas = 0, discrepancias = [];
    if (tabla) {
      const cols = mapaColumnas(tabla);
      const porCodigo = new Map();
      if (cols && cols.codigo >= 0) {
        for (const fila of filasDatos(tabla)) {
          const cod = lim(fila.cells[cols.codigo]?.textContent);
          if (cod) porCodigo.set(cod, fila);
        }
        for (const m of esperados) {
          const fila = porCodigo.get(m.cod_alum);
          const radio = fila ? fila.cells[cols.estados[m.tipo]]?.querySelector('input[type=radio]') : null;
          if (radio && radio.checked) verificadas++;
          else discrepancias.push(m.cod_alum);
        }
      }
    }

    anotar(`Modal ${modalVisible ? 'visible' : 'no visible'}${modalTexto ? ` — "${modalTexto}"` : ''}.`);

    if (esperados.length && verificadas === esperados.length) {
      anotar(`✔ Guardado y verificado: ${verificadas}/${esperados.length} estados quedaron registrados.`, 'ok');
    } else if (!tabla) {
      anotar('No pude verificar: la tabla no volvió a renderizarse. Revisá a mano antes de dar por hecho el guardado.', 'err');
    } else {
      anotar(`⚠ Verificación incompleta: ${verificadas}/${esperados.length} confirmados. ` +
        (discrepancias.length ? 'Sin confirmar: ' + discrepancias.join(', ') + '. ' : '') +
        'Revisá a mano antes de dar por hecho el guardado.', 'err');
    }

    estado.activa = false;
    estado.paso = 'TERMINADO';
    estado.verificacion = { verificadas, total: esperados.length, discrepancias, modalVisible, modalTexto };
    persistir();
    refrescarPanel();
  }

  // ======================================================================
  // INTERFAZ
  // ======================================================================

  const CSS = `
    #gla-asis{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:360px;
      font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1a2330;background:#fff;
      border:1px solid #d8c2c6;border-radius:10px;box-shadow:0 8px 28px rgba(60,16,24,.24);overflow:hidden}
    #gla-asis header{display:flex;align-items:center;gap:8px;padding:9px 12px;background:#7a2230;color:#fff;
      font-weight:600;font-size:12.5px}
    #gla-asis header .pt{flex:1}
    #gla-asis .cuerpo{padding:12px;max-height:70vh;overflow:auto}
    #gla-asis textarea{width:100%;height:118px;font:11.5px/1.4 ui-monospace,Menlo,Consolas,monospace;
      border:1px solid #d3dae4;border-radius:6px;padding:7px;resize:vertical;box-sizing:border-box}
    #gla-asis .paso{font-weight:600;margin:9px 0 4px}
    #gla-asis .acciones{display:flex;gap:8px;flex-wrap:wrap;margin-top:9px}
    #gla-asis button{flex:1 1 46%;padding:7px 10px;border-radius:6px;border:1px solid transparent;
      font:inherit;font-weight:600;cursor:pointer}
    #gla-asis button:disabled{opacity:.4;cursor:not-allowed}
    #gla-asis .prim{background:#2f6fb5;color:#fff}
    #gla-asis .peligro{background:#a3253c;color:#fff}
    #gla-asis .sec{background:#fff;color:#4a5568;border-color:#cbd5e0}
    #gla-asis .resumen{margin-top:9px;padding:9px;border-radius:6px;background:#fff8e6;border:1px solid #e8d59a}
    #gla-asis .resumen b{display:block;margin-bottom:4px}
    #gla-asis .resumen ul{margin:5px 0 0;padding-left:17px}
    #gla-asis .log{margin-top:9px;max-height:150px;overflow:auto;font-size:11.5px;background:#f6f8fb;
      border:1px solid #e2e9f2;border-radius:6px;padding:7px}
    #gla-asis .log div{padding:1px 0;word-break:break-word}
    #gla-asis .log .err{color:#a3253c;font-weight:600}
    #gla-asis .log .ok{color:#1d6b3f}
    #gla-asis .nota{margin-top:8px;font-size:11px;color:#5b6981}
    #gla-asis .alerta{margin-bottom:10px;padding:9px;border-radius:6px;background:#fdecec;
      border:1px solid #e2a1a1;color:#7a2230;font-size:11.5px}
    #gla-asis .alerta b{display:block;margin-bottom:3px}
  `;

  const panel = document.createElement('div');
  panel.id = 'gla-asis';
  panel.innerHTML = `
    <header><span class="pt">Asistencia — autofill</span><span id="ga-min" style="cursor:pointer">—</span></header>
    <div class="cuerpo">
      <div id="ga-alerta"></div>
      <div id="ga-entrada-caja">
        <label for="ga-entrada" style="font-size:11.5px;color:#5b6981">JSON de entrada</label>
        <textarea id="ga-entrada" spellcheck="false"></textarea>
      </div>
      <div class="paso" id="ga-paso">Listo.</div>
      <div id="ga-resumen"></div>
      <div class="acciones">
        <button class="prim" id="ga-preparar">Flujo completo (dry-run)</button>
        <button class="prim" id="ga-solomarcar">Solo marcar</button>
        <button class="peligro" id="ga-guardar" disabled>Confirmar y guardar</button>
        <button class="sec" id="ga-abortar">Abortar</button>
        <button class="sec" id="ga-limpiar">Limpiar log</button>
      </div>
      <div class="log" id="ga-log"></div>
      <div class="nota" id="ga-nota">Dry-run: marca en pantalla y se detiene. Nada se envía hasta que confirmes.</div>
    </div>`;

  const estilo = document.createElement('style');
  estilo.textContent = CSS;
  document.head.appendChild(estilo);
  document.body.appendChild(panel);

  const $entradaCaja = panel.querySelector('#ga-entrada-caja');
  const $entrada = panel.querySelector('#ga-entrada');
  const $paso = panel.querySelector('#ga-paso');
  const $resumen = panel.querySelector('#ga-resumen');
  const $log = panel.querySelector('#ga-log');
  const $preparar = panel.querySelector('#ga-preparar');
  const $soloMarcar = panel.querySelector('#ga-solomarcar');
  const $guardar = panel.querySelector('#ga-guardar');
  const $abortar = panel.querySelector('#ga-abortar');
  const $alerta = panel.querySelector('#ga-alerta');
  const $cuerpo = panel.querySelector('.cuerpo');

  panel.querySelector('#ga-min').onclick = () => {
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
    const paso = estado ? estado.paso : 'IDLE';
    const recargas = estado && estado.cargas ? ` · recarga #${estado.cargas}` : '';

    $paso.textContent = estado ? `Paso: ${paso}${recargas}` : 'Listo.';
    // La caja de entrada se queda visible durante la corrida: verla llena tras
    // una recarga es la señal más simple de que el script sobrevivió.
    $entrada.readOnly = activa;
    $entrada.style.opacity = activa ? '.6' : '';
    $preparar.disabled = activa;
    $soloMarcar.disabled = activa;
    $guardar.disabled = !(estado && estado.paso === 'CONFIRMAR');

    $resumen.innerHTML = '';
    if (estado && estado.resumen && (estado.paso === 'CONFIRMAR' || estado.paso === 'TERMINADO')) {
      const r = estado.resumen;
      const items = Object.entries(r.cuenta).map(([k, v]) => `<li>${v} × ${k}</li>`).join('');
      const div = document.createElement('div');
      div.className = 'resumen';
      div.innerHTML =
        `<b>${estado.paso === 'CONFIRMAR' ? 'Voy a guardar esto:' : 'Se guardó esto:'}</b>` +
        `Curso ${r.curso} · hora ${r.hora} · ${r.asignatura} · ${r.fecha}<br>` +
        `${r.totalFilas} estudiantes en la lista.<ul>${items}</ul>`;
      $resumen.appendChild(div);
    }
  }

  // --- Acciones -----------------------------------------------------------

  /* Devuelve el cfg validado, o null habiendo ya reportado el error. */
  function prepararCfg() {
    let cfg;
    try { cfg = validarEntrada($entrada.value); }
    catch (e) {
      estado = null;
      $log.innerHTML = '';
      pintarLinea({ t: new Date().toLocaleTimeString('es-CO'), msg: 'Entrada inválida: ' + e.message, clase: 'err' });
      return null;
    }
    try { localStorage.setItem(CLAVE_ENTRADA, $entrada.value); } catch (_) { /* nada */ }
    $log.innerHTML = '';
    return cfg;
  }

  let avisadoDeConsola = false;

  $preparar.onclick = async () => {
    // El flujo completo recorre el filtro, y cada paso recarga la página. Sin
    // userscript instalado eso es fatal: no hay quién retome tras la recarga.
    if (!ES_USERSCRIPT && !avisadoDeConsola) {
      avisadoDeConsola = true;
      $preparar.textContent = 'Seguir igual (va a morir)';
      pintarLinea({
        t: new Date().toLocaleTimeString('es-CO'), clase: 'err',
        msg: 'Esto no parece estar instalado en Tampermonkey. El flujo completo recarga la ' +
          'página en cada paso del filtro y el script no volverá. Usá "Solo marcar", o instalalo.',
      });
      return;
    }

    const cfg = prepararCfg();
    if (!cfg) return;
    estado = nuevoEstado(cfg);
    persistir();
    anotar(`Corrida: curso ${cfg.curso}, hora ${cfg.hora}, ${cfg.asignatura}, ${cfg.fecha}, ${cfg.marcas.length} marca(s).`);
    refrescarPanel();
    await continuar();
  };

  /*
   * Modo "solo marcar": vos ya pusiste fecha, hora, curso y asignatura a mano,
   * y el script se salta todo el filtro. Como no navega hasta el guardado, no
   * depende de sobrevivir a ninguna recarga — funciona incluso pegado en la
   * consola. Antes de marcar verifica que la pantalla coincida con el JSON.
   */
  $soloMarcar.onclick = async () => {
    const cfg = prepararCfg();
    if (!cfg) return;
    estado = nuevoEstado(cfg);
    estado.modo = 'SOLO_MARCAR';
    estado.paso = 'MARCAR';
    persistir();
    anotar(`Solo marcar: curso ${cfg.curso}, hora ${cfg.hora}, ${cfg.asignatura}, ${cfg.fecha}, ${cfg.marcas.length} marca(s).`);
    if (!el(ID.tabla)) {
      return abortar('no hay tabla de estudiantes en pantalla. Poné hora, curso y asignatura a mano primero.');
    }
    refrescarPanel();
    await continuar();
  };

  $guardar.onclick = async () => {
    if (!estado || estado.paso !== 'CONFIRMAR') return;
    $guardar.disabled = true;
    anotar('Confirmado por el usuario.');
    estado.paso = 'GUARDAR';
    persistir();
    await continuar();
  };

  $abortar.onclick = () => {
    Estado.limpiar();
    estado = null;
    $log.innerHTML = '';
    $resumen.innerHTML = '';
    pintarLinea({ t: new Date().toLocaleTimeString('es-CO'), msg: 'Abortado. Estado limpiado. Recargá para descartar las marcas de pantalla.', clase: 'err' });
    refrescarPanel();
  };

  panel.querySelector('#ga-limpiar').onclick = () => {
    $log.innerHTML = '';
    if (estado) { estado.registro = []; persistir(); }
  };

  // ======================================================================
  // ARRANQUE
  // ======================================================================

  try { $entrada.value = localStorage.getItem(CLAVE_ENTRADA) || ''; } catch (_) { /* nada */ }
  if (!$entrada.value) {
    $entrada.value = JSON.stringify({
      fecha: '30/07/2026', hora: 3, curso: '801', asignatura: 'INFORMATION TECHNOLOGY',
      marcas: [{ cod_alum: '2019034387', tipo: 'falla' }],
    }, null, 2);
  }

  // Aviso de entorno: es la causa número uno de "se cierra al recargar".
  if (!ES_USERSCRIPT) {
    $alerta.innerHTML =
      '<div class="alerta"><b>No detecto Tampermonkey</b>' +
      'Si pegaste esto en la consola, cada recarga lo borra y el flujo completo no puede continuar. ' +
      '<b style="margin-top:5px">Usá "Solo marcar"</b>' +
      'Poné hora, curso y asignatura a mano; el script marca y guarda sin recargar hasta el final.</div>';
  }

  if (estado && estado.registro) estado.registro.forEach(pintarLinea);

  if (estado && estado.activa) {
    // Se cuenta una vez por carga real de la página, no por paso interno.
    estado.cargas = (estado.cargas || 0) + 1;
    persistir();
    if (estado.cargas > MAX_CARGAS) {
      abortar(`la página se recargó ${estado.cargas} veces en una sola corrida. Corto por seguridad.`);
    } else {
      anotar(`Retomo tras la recarga (#${estado.cargas}) en ${location.pathname}.`);
      refrescarPanel();
      continuar();
    }
  } else {
    refrescarPanel();
  }
})();
