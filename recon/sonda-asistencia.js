/*
 * SONDA — AsistenciaAsignaturaAusenciaDia.aspx
 * ===========================================
 *
 * Reconocimiento previo al userscript de asistencia. A diferencia de las sondas
 * de la parte 1, esta pantalla ESCRIBE en el sistema del colegio, así que la
 * sonda es especialmente conservadora:
 *
 *   - NO envía el formulario. NO hace fetch. NO llama a __doPostBack.
 *   - NO hace click en nada. NO marca ni desmarca ningún checkbox.
 *   - NO toca Guardar (ImageButton3) ni Salir (ImageButton1).
 *   - Solo lee el DOM que ya está en pantalla.
 *
 * Privacidad: omite __VIEWSTATE (solo su tamaño) y enmascara los nombres de
 * estudiantes. Los códigos numéricos salen intactos: son lo que hay que ver.
 *
 * CÓMO USARLA — dos capturas
 * --------------------------
 * CAPTURA A (la importante):
 *   1. Abrir la página por el menú (Asistencia > Asistencia diaria por asignatura).
 *   2. Elegir a mano hora + curso + asignatura hasta que aparezca la lista de
 *      estudiantes. Preferible un curso tuyo real, en un día que ya tengas
 *      registrado o que vayas a registrar de todos modos.
 *   3. F12 → Console → pegar este archivo → Enter → pegarme el JSON.
 *
 * CAPTURA B (para el modal de confirmación):
 *   La próxima vez que guardes asistencia A MANO, cuando salga el modal
 *   "Información procesada satisfactoriamente", corré esto otra vez sin cerrarlo.
 *   No hace falta guardar nada de más solo para esto: aprovechá un guardado
 *   que ibas a hacer igual.
 */
(() => {
  'use strict';

  const MASCARA_NOMBRES = true; // false si preferís mandarme los nombres reales

  const lim = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const mask = (s) => {
    const t = lim(s);
    if (!MASCARA_NOMBRES) return t.slice(0, 140);
    // Conserva dígitos, longitud y forma; sustituye solo las letras.
    return t.replace(/\p{L}{2,}/gu, (p) => p[0] + '·'.repeat(Math.min(p.length - 1, 6))).slice(0, 140);
  };

  // Normaliza un id/name reemplazando los índices por N: revela la convención
  // de nombres del GridView sin ahogarnos en 30 variantes iguales.
  const forma = (s) => String(s ?? '').replace(/\d+/g, 'N');

  const resumenControl = (el) => ({
    tag: el.tagName.toLowerCase(),
    tipo: el.type || null,
    id: el.id || null,
    name: el.getAttribute('name') || null,
    clase: lim(el.className) || null,
    marcado: (el.type === 'checkbox' || el.type === 'radio') ? el.checked : undefined,
    valor: el.tagName === 'SELECT'
      ? { value: el.value, nOpciones: el.options.length,
          opciones: [...el.options].slice(0, 8).map((o) => ({ v: o.value, t: lim(o.text) })) }
      : (el.type === 'checkbox' || el.type === 'radio' ? el.value : mask(el.value)),
    deshabilitado: el.disabled,
    soloLectura: el.readOnly === true,
    onclick: lim(el.getAttribute('onclick')).slice(0, 140) || null,
  });

  const salida = { corridaEn: new Date().toISOString(), url: location.pathname };

  // --- 1. Entorno: jQuery, Select2, validadores ----------------------------

  salida.entorno = {
    jQuery: (typeof window.jQuery !== 'undefined') ? window.jQuery.fn.jquery : null,
    select2: !!(window.jQuery && window.jQuery.fn && window.jQuery.fn.select2),
    doPostBack: typeof window.__doPostBack === 'function',
    pageRequestManager: !!(window.Sys?.WebForms?.PageRequestManager?.getInstance?.()),
    // Validadores de ASP.NET presentes en la página.
    validadores: (window.Page_Validators || []).map((v) => ({
      id: v.id, control: v.controltovalidate, tipo: v.evaluationfunction?.name || null,
      mensaje: lim(v.errormessage || v.innerText).slice(0, 80),
    })),
  };

  // --- 2. Controles del filtro --------------------------------------------

  const ID = (s) => 'ctl00_ContentPlaceHolder1_' + s;
  salida.filtro = {};
  for (const nombre of ['DropDownHora', 'txtFecha', 'lstCursos', 'lstMateria', 'chRegis']) {
    const el = document.getElementById(ID(nombre));
    salida.filtro[nombre] = el ? resumenControl(el) : null;
  }

  // ¿El textbox de fecha dispara postback? Es la diferencia entre un paso más
  // en la máquina de estados y una simple asignación.
  const fecha = document.getElementById(ID('txtFecha'));
  salida.fechaDetalle = fecha ? {
    onchange: fecha.getAttribute('onchange'),
    onblur: fecha.getAttribute('onblur'),
    autoPostBack: /__doPostBack/.test(
      (fecha.getAttribute('onchange') || '') + (fecha.getAttribute('onblur') || '')),
    soloLectura: fecha.readOnly,
    deshabilitado: fecha.disabled,
    valorCrudo: JSON.stringify(fecha.value), // con comillas, para ver el NBSP
    // Códigos de los caracteres, para no adivinar dónde está el NBSP (160).
    codigos: [...String(fecha.value)].map((c) => c.charCodeAt(0)),
    // ¿Hay datepicker enganchado?
    clases: lim(fecha.className),
    hermanosDatepicker: [...document.querySelectorAll('[id*="datepicker"], .ui-datepicker, [class*="datepicker"]')]
      .slice(0, 5).map((e) => ({ tag: e.tagName, id: e.id, clase: lim(e.className).slice(0, 60) })),
  } : null;

  // --- 3. Botones ----------------------------------------------------------

  salida.botones = [...document.querySelectorAll(
    'input[type=submit], input[type=button], input[type=image], button, a[href*="__doPostBack"]')]
    .map((b) => ({
      id: b.id || null,
      name: b.getAttribute('name') || null,
      tipo: b.getAttribute('type') || null,
      titulo: b.title || null,
      etiqueta: lim(b.value || b.textContent || b.alt),
      onclick: lim(b.getAttribute('onclick')).slice(0, 160) || null,
      href: lim(b.getAttribute('href')).slice(0, 160) || null,
      visible: !!(b.offsetParent || b.getClientRects().length),
    }));

  // --- 4. LA TABLA DE ESTUDIANTES -----------------------------------------

  const cont = document.querySelector('.table-responsive');
  salida.tablaResponsive = { existe: !!cont };

  if (cont) {
    salida.tablaResponsive.vacio = lim(cont.textContent) === '';
    salida.tablaResponsive.hijosDirectos = [...cont.children]
      .map((e) => ({ tag: e.tagName.toLowerCase(), id: e.id || null, clase: lim(e.className) || null }));

    // Esqueleto: por si la "tabla" no es un <table>. Colapsa hermanos repetidos.
    const esqueleto = (n, prof = 0) => {
      if (prof > 4) return null;
      const grupos = [];
      for (const h of n.children) {
        const f = h.tagName.toLowerCase() +
          (h.id ? '#' + forma(h.id) : '') +
          (h.className ? '.' + lim(h.className).split(' ')[0] : '');
        const ult = grupos[grupos.length - 1];
        if (ult && ult.f === f) ult.n++;
        else grupos.push({ f, n: 1, muestra: h });
      }
      return grupos.slice(0, 12).map((g) => ({
        nodo: g.f, repetido: g.n,
        hijos: g.n <= 2 ? esqueleto(g.muestra, prof + 1) : null,
      }));
    };
    salida.tablaResponsive.esqueleto = esqueleto(cont);

    const tabla = cont.querySelector('table');
    if (tabla) {
      const filas = [...tabla.rows];
      const filaEnc = filas.find((f) => f.querySelector('th')) || filas[0];

      salida.tabla = {
        id: tabla.id || null,
        clase: lim(tabla.className) || null,
        nFilas: filas.length,
        encabezados: filaEnc ? [...filaEnc.cells].map((c) => lim(c.textContent)) : [],

        // Primeras 3 filas de datos, completas: texto + todos los controles.
        muestraFilas: filas.filter((f) => f !== filaEnc).slice(0, 3).map((f) => ({
          idFila: f.id || null,
          claseFila: lim(f.className) || null,
          atributosFila: [...f.attributes]
            .filter((a) => !['class', 'style'].includes(a.name))
            .map((a) => `${a.name}=${lim(a.value).slice(0, 90)}`),
          celdas: [...f.cells].map((c, i) => ({
            col: i,
            texto: mask(c.textContent),
            atributos: [...c.attributes]
              .filter((a) => !['class', 'style', 'align', 'width', 'scope'].includes(a.name))
              .map((a) => `${a.name}=${lim(a.value).slice(0, 90)}`),
            controles: [...c.querySelectorAll('input, select, textarea')].map(resumenControl),
          })),
        })),
      };

      // Convención de nombres: agrupo TODOS los controles de la tabla por forma.
      // Esto es lo que revela si hay chkFalla/chkRetardo, un <select> de estado,
      // o radios — y con qué patrón se indexan las filas.
      const porForma = new Map();
      for (const el of tabla.querySelectorAll('input, select, textarea')) {
        const k = forma(el.getAttribute('name') || el.id || el.tagName);
        if (!porForma.has(k)) {
          porForma.set(k, {
            forma: k, tag: el.tagName.toLowerCase(), tipo: el.type || null,
            veces: 0, marcados: 0,
            ejemploId: el.id || null, ejemploName: el.getAttribute('name') || null,
          });
        }
        const e = porForma.get(k);
        e.veces++;
        if ((el.type === 'checkbox' || el.type === 'radio') && el.checked) e.marcados++;
      }
      salida.tabla.controlesPorForma = [...porForma.values()];

      // ¿Ya hay asistencia registrada? Regla de seguridad 4 del encargo.
      // Ojo: en esta pantalla los estados NO son checkboxes sino grupos de
      // radios, así que contar solo checkboxes daría 0 siempre y haría creer
      // que la hora está limpia cuando podría no estarlo.
      salida.tabla.marcadosAlLlegar = {
        checkboxes: [...tabla.querySelectorAll('input[type=checkbox]')].filter((c) => c.checked).length,
        radios: [...tabla.querySelectorAll('input[type=radio]')].filter((c) => c.checked).length,
        selectsNoVacios: [...tabla.querySelectorAll('select')].filter((s) => s.value && s.value !== '0' && s.value !== '%').length,
        textosNoVacios: [...tabla.querySelectorAll('input[type=text], textarea')].filter((t) => lim(t.value) !== '').length,
      };

      // --- ¿Dónde está el COD_ALUM? ---
      // En la parte 1 los COD_ALUM del export eran de 10 dígitos empezando por
      // año de matrícula (2019034387). Busco 6-12 dígitos por si acá difieren.
      const hallazgos = [];
      const RE = /\b\d{6,12}\b/;

      const w = document.createTreeWalker(tabla, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n && hallazgos.length < 20; n = w.nextNode()) {
        const m = RE.exec(n.nodeValue || '');
        if (!m) continue;
        const p = n.parentElement;
        const celda = p?.closest('td, th');
        const fila = p?.closest('tr');
        hallazgos.push({
          donde: 'texto', valor: m[0], digitos: m[0].length,
          col: celda && fila ? [...fila.cells].indexOf(celda) : null,
          contenedor: { tag: p?.tagName, id: forma(p?.id) || null, clase: lim(p?.className) || null },
        });
      }
      for (const el of tabla.querySelectorAll('*')) {
        if (hallazgos.length >= 40) break;
        for (const a of el.attributes) {
          if (a.value.length > 200) continue;
          const m = RE.exec(a.value);
          if (!m) continue;
          hallazgos.push({
            donde: 'atributo:' + a.name, valor: m[0], digitos: m[0].length,
            fragmento: lim(a.value).slice(0, 120),
            contenedor: { tag: el.tagName, id: el.id || null },
          });
          break;
        }
      }
      salida.tabla.numerosEnFilas = hallazgos;
    } else {
      salida.tabla = null;
      salida.avisoTabla = 'No hay <table> dentro de .table-responsive. ' +
        'Si no cargaste curso Y asignatura, hacelo y volvé a correr esto.';
    }
  }

  // --- 5. El modal de confirmación ----------------------------------------

  const modal = document.getElementById('myModal');
  salida.modal = modal ? {
    existeEnDom: true,
    clases: lim(modal.className),
    visible: !!(modal.offsetParent || modal.getClientRects().length),
    ariaHidden: modal.getAttribute('aria-hidden'),
    estiloDisplay: modal.style.display || null,
    cuerpoId: 'ctl00_ContentPlaceHolder1_lblModalBody',
    cuerpoTexto: lim(document.getElementById('ctl00_ContentPlaceHolder1_lblModalBody')?.textContent),
    // Estructura sin texto libre, para saber qué observar y cómo cerrarlo.
    estructura: [...modal.querySelectorAll('[id], button, .modal-title, .modal-body, .modal-footer')]
      .slice(0, 25).map((e) => ({
        tag: e.tagName.toLowerCase(), id: e.id || null,
        clase: lim(e.className).slice(0, 60) || null,
        texto: mask(e.textContent).slice(0, 60),
        dismiss: e.getAttribute('data-dismiss') || e.getAttribute('data-bs-dismiss') || null,
      })),
  } : { existeEnDom: false };

  // --- 6. El div oculto con la hora del cliente ---------------------------
  // Sospecha del encargo: el servidor podría validar que la hora de clase
  // corresponda al momento real. Si es así, esto importa mucho.

  salida.horaCliente = {};
  for (const t of ['TextBox1', 'TextBox2', 'TextBox3']) {
    const el = document.getElementById(ID(t)) || document.getElementById(t);
    salida.horaCliente[t] = el ? {
      id: el.id, name: el.getAttribute('name'), valor: el.value,
      visible: !!(el.offsetParent || el.getClientRects().length),
    } : null;
  }
  // ¿Algún script les asigna la hora en el cliente?
  salida.horaCliente.scriptsQueLosTocan = [...document.scripts]
    .filter((s) => !s.src && /TextBox[123]/.test(s.textContent || ''))
    .map((s) => lim(s.textContent).slice(0, 400));

  // --- 7. Campos ocultos (nombres y tamaños, sin VIEWSTATE) ---------------

  const SENSIBLE = /VIEWSTATE|EVENTVALIDATION/i;
  salida.ocultos = [...document.querySelectorAll('input[type=hidden]')].map((h) => ({
    id: h.id || null, name: h.getAttribute('name') || null,
    largo: (h.value || '').length,
    valor: SENSIBLE.test(h.name || h.id || '') ? `<omitido ${(h.value || '').length} chars>` : h.value.slice(0, 60),
  }));

  // --- 8. Entrega ----------------------------------------------------------

  const json = JSON.stringify(salida, null, 2);
  console.log('%c=== SONDA Asistencia ===', 'font-weight:bold;font-size:14px');
  console.log(salida);
  try {
    copy(json);
    console.log('%c✔ JSON copiado al portapapeles (' + json.length + ' chars)', 'color:green;font-weight:bold');
  } catch (_) {
    console.log('%c⚠ Copia manual del texto de abajo:', 'color:orange;font-weight:bold');
    console.log(json);
  }
  console.log('%cEsta sonda no envió nada ni marcó nada. Solo leyó el DOM.', 'color:#0aa');
  return salida;
})();
