/*
 * SONDA GENÉRICA — cualquier pantalla de Classroom Live
 * =====================================================
 *
 * Por qué existe: ya se escribió dos veces casi la misma sonda (la de
 * ReporteCalificaMatriz y la de ConsCalificaDocentesGen), y cada lección que
 * salió de usarlas —que el número de la foto no es el COD_ALUM, que una tabla
 * de maquetado no es una tabla de datos, que un <input type="image"> es un
 * submit— hubo que aplicarla a mano en cada copia. Esta sirve para cualquier
 * pantalla, así que la lección se arregla en un solo lugar.
 *
 * Sirve para las que faltan: matriz de actividades (831), planeador (803),
 * seguimiento (853), actas (875), y las que aparezcan.
 *
 * Qué hace:  lee el DOM de la página YA CARGADA y devuelve un JSON.
 * Qué NO hace: no envía nada, no dispara postbacks, no pulsa ningún botón —ni
 *            los de descargar—, no toca la Session ni modifica un solo campo.
 *            Es 100 % lectura sobre el DOM local.
 *
 * Privacidad: NO copia el __VIEWSTATE (solo su tamaño). Los nombres salen
 *            enmascarados (MASCARA_NOMBRES = true). Los códigos numéricos sí
 *            salen tal cual: son lo que hay que verificar.
 *
 * Cómo usarla:
 *   1. Abrí la pantalla y cargala hasta que se vean datos.
 *   2. F12 → Console → pegá TODO este archivo → Enter.
 *   3. Se copia sola al portapapeles. El `veredicto` dice qué sigue.
 */
(() => {
  'use strict';

  const MASCARA_NOMBRES = true;   // ponelo en false si preferís mandar los nombres reales

  const limpiar = (s) => (s || '').replace(/\s+/g, ' ').trim();

  const enmascarar = (s) => {
    const t = limpiar(s);
    if (!MASCARA_NOMBRES) return t.slice(0, 120);
    return t.replace(/\p{L}{2,}/gu, (p) => p[0] + '·'.repeat(Math.min(p.length - 1, 6))).slice(0, 120);
  };

  const resumir = (el) => el && ({
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    name: el.getAttribute('name') || null,
    clase: el.className || null,
  });

  const salida = {
    pantalla: location.pathname.split('/').pop() || location.pathname,
    url: location.pathname + location.search,
    titulo: document.title,
    cuando: new Date().toISOString(),
  };

  // --- 1. Formulario y ocultos ---------------------------------------------
  // No se da por hecho que el form se llame igual: hay pantallas con otra
  // master page (ver README-inventario).

  const form = document.forms.aspnetForm || document.forms[0];
  salida.form = form && {
    id: form.id || null,
    nombre: form.getAttribute('name') || null,
    action: form.getAttribute('action'),
    method: form.method,
  };

  const SENSIBLE = /VIEWSTATE|EVENTVALIDATION|VIEWSTATEENCRYPTED|REQUESTDIGEST/i;
  salida.ocultos = [...document.querySelectorAll('input[type=hidden]')]
    .map((h) => {
      const v = h.value || '';
      return {
        id: h.id || null,
        name: h.name || null,
        largo: v.length,
        valor: SENSIBLE.test(h.name || h.id || '') ? `<omitido ${v.length} chars>` : v.slice(0, 60),
      };
    })
    .slice(0, 60);

  // --- 2. Los filtros -------------------------------------------------------
  // Con qué se acota la pantalla, y si elegir recarga la página: eso decide si
  // un recorrido puede ser un favorito o tiene que ser userscript.

  const LISTA_LARGA = 25;   // más que los 20 cursos: ya no es una lista del oficio

  salida.selects = [...document.querySelectorAll('select')].map((s) => {
    const onchange = s.getAttribute('onchange');
    return {
      id: s.id || null,
      name: s.getAttribute('name') || null,
      autoPostBack: /__doPostBack/i.test(onchange || ''),
      deshabilitado: s.disabled,
      nOpciones: s.options.length,
      seleccionado: { value: s.value, texto: limpiar(s.selectedOptions[0]?.text) },
      // Los TEXTOS se enmascaran cuando la lista es larga. Corrida real en el
      // planeador: `lstFilProfesor` trae 203 opciones con el nombre completo de
      // cada docente del colegio, y la sonda los volcaba en claro en un JSON
      // que después se pega en un chat. No son menores, pero son personas
      // reales que no eligieron estar ahí. Los `value` (ids) sí van: son lo que
      // hace falta para armar el filtro y no identifican a nadie por sí solos.
      //
      // El umbral separa las listas del oficio —cursos (20), periodos (5),
      // ciclos (10)— de lo que ya es un directorio de gente.
      opciones: [...s.options].slice(0, 40).map((o) => ({
        value: o.value,
        texto: s.options.length > LISTA_LARGA ? enmascarar(o.text) : limpiar(o.text),
      })),
      textosEnmascarados: s.options.length > LISTA_LARGA,
      hayMas: s.options.length > 40,
    };
  });

  // Los campos de texto y fecha también son filtros, y se olvidan seguido.
  salida.campos = [...document.querySelectorAll('input[type=text], input[type=date], textarea')]
    .map((i) => ({
      id: i.id || null,
      name: i.getAttribute('name') || null,
      tipo: i.getAttribute('type') || i.tagName.toLowerCase(),
      soloLectura: i.readOnly || i.disabled,
      // El valor solo si no parece un dato de alguien: da la forma esperada
      // (una fecha, un código) sin llevarse texto libre de un estudiante.
      valor: /^[\d/\-: .apm]*$/i.test(i.value || '') ? limpiar(i.value).slice(0, 40) : '<texto>',
    }))
    .slice(0, 30);

  // --- 3. Los disparadores: qué clase de cosa es cada botón ------------------
  // Solo se INSPECCIONAN. No se pulsa ninguno.

  const ES_DISPARADOR =
    'a, button, input[type=submit], input[type=button], input[type=image], [onclick]';
  const PARECE_ACCION =
    /descargar|exportar|excel|xls|csv|imprimir|pdf|consultar|buscar|generar|ver|tabla|guardar|importar|actualizar|grabar|editar|modificar|nuevo|agregar/i;

  const clasificar = (b) => {
    const txt = `${b.href || ''} ${b.onclick || ''}`;
    if (/^https?:|^\//i.test(b.href || '') || /\.(aspx|xls|csv|pdf)/i.test(b.href || '')) {
      return 'enlace a archivo o página';
    }
    if (/__doPostBack/i.test(txt)) return 'postback de ASP.NET';
    if (/window\.open/i.test(txt)) return 'abre otra ventana';
    if (/blob:|createObjectURL|msSaveBlob|new Blob/i.test(txt)) {
      return 'lo arma el navegador (los datos ya están en el DOM)';
    }
    if (b.tipo === 'submit') return 'envía el formulario';
    // Un <input type="image"> de ASP.NET es un submit con disfraz: sin href ni
    // onclick caía en "desconocido" justo con el botón que importa. Al postear
    // manda `name.x` y `name.y` en vez de `name=valor`.
    if (b.tipo === 'image') return 'envía el formulario (input type=image: postea name.x y name.y)';
    return 'desconocido';
  };

  // Escribir o no escribir es LA pregunta de seguridad de este repo.
  // "Editar" cuenta: en la matriz de actividades cada fila tiene uno, y es el
  // que habilita los campos para escribir. Sin él la sonda decía que la
  // pantalla no escribía porque los controles estaban deshabilitados — que es
  // cierto hasta que se pulsa Editar.
  const PARECE_ESCRITURA =
    /guardar|importar|grabar|eliminar|borrar|anular|actualizar|editar|modificar|nuevo|agregar|btnImportar/i;

  /*
   * El menú lateral NO es la pantalla.
   *
   * Corrida real en la matriz de actividades: la sonda declaró "esta pantalla
   * escribe" nombrando "Importar/exportar planilla…" seis veces — que son
   * entradas del menú, no botones de acá— y NO nombró los "Editar" de cada
   * fila, que son los que de verdad escriben. Gritó por lo que no era y se
   * calló con lo que sí. Las entradas del menú se reconocen porque navegan con
   * `SessionEntrar` o porque su id es el número de pantalla.
   *
   * NO se usa la visibilidad para reconocerlas, aunque el menú esté plegado:
   * un botón de la pantalla también puede estar oculto en un panel cerrado, y
   * de paso en jsdom todo es invisible, así que la prueba dejaba de distinguir
   * justo lo que tenía que comprobar. Se reconoce el menú por lo que ES.
   */
  const esDelMenu = (b) =>
    /SessionEntrar/i.test(b.onclick || '') ||
    /^\d+$/.test(b.id || '');

  salida.acciones = [...document.querySelectorAll(ES_DISPARADOR)]
    .map((b) => ({
      etiqueta: limpiar(b.value || b.textContent || b.getAttribute('alt') || b.title),
      tag: b.tagName.toLowerCase(),
      tipo: b.getAttribute('type') || null,
      id: b.id || null,
      name: b.getAttribute('name') || null,
      href: b.getAttribute('href') || null,
      onclick: limpiar(b.getAttribute('onclick')).slice(0, 240) || null,
      visible: !!(b.offsetParent || b.getClientRects().length),
    }))
    .filter((b) => !esDelMenu(b))
    .filter((b) => PARECE_ACCION.test(`${b.etiqueta} ${b.id} ${b.href} ${b.onclick}`))
    .slice(0, 25)
    .map((b) => ({
      ...b,
      clase: clasificar(b),
      escribe: PARECE_ESCRITURA.test(`${b.etiqueta} ${b.id} ${b.name}`),
    }));

  // --- 4. Las tablas --------------------------------------------------------
  // Una tabla de DATOS tiene filas y columnas. Pedir solo filas dejaba pasar
  // las de maquetado: una de 6 filas y UNA columna se declaró "la tabla de
  // notas" y de ahí salió un diagnóstico entero equivocado.

  salida.tablas = [...document.querySelectorAll('table')]
    .map((t) => ({ t, filas: [...t.rows] }))
    .filter(({ filas }) => filas.length >= 2)
    .map(({ t, filas }) => {
      const encabezado = filas.find((f) => f.querySelector('th')) || filas[0];
      const datos = filas.filter((f) => f !== encabezado).slice(0, 3);
      return {
        id: t.id || null,
        clase: t.className || null,
        nFilas: filas.length,
        nColumnas: encabezado ? encabezado.cells.length : 0,
        encabezados: encabezado ? [...encabezado.cells].map((c) => limpiar(c.textContent)) : [],
        muestraFilas: datos.map((f) => ({
          idFila: f.id || null,
          // A veces la clave viaja en un atributo de la fila, no en una celda.
          atributos: [...f.attributes]
            .filter((a) => !['class', 'style'].includes(a.name))
            .map((a) => `${a.name}=${limpiar(a.value).slice(0, 80)}`),
          celdas: [...f.cells].map((c) => {
            const control = c.querySelector('input, select, textarea');
            const texto = enmascarar(c.textContent);
            // Una celda con control cambia todo: la pantalla escribe. Pero hay
            // que decir si se puede escribir AHORA: la matriz de actividades
            // trae todo deshabilitado hasta que se pulsa "Editar" en la fila, y
            // confundir las dos cosas hace creer que una pantalla de escritura
            // es de consulta.
            if (!control) return texto;
            const trabado = control.disabled || control.readOnly;
            return `${texto} <${control.tagName.toLowerCase()} ${control.getAttribute('name') || ''}${trabado ? ' trabado' : ''}>`;
          }),
        })),
      };
    })
    .slice(0, 12);

  const esDeDatos = (t) => t.nFilas >= 5 && t.nColumnas >= 3;

  // --- 5. ¿Hay códigos de estudiante? ---------------------------------------
  // Diez dígitos que empiezan por el año de matrícula. Sin él no hay forma de
  // emparejar con la app: el nombre no aguanta un apellido corregido.

  const RE_10 = /\b\d{10}\b/;
  const hallazgos = [];
  const descartados = [];

  const caminador = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = caminador.nextNode(); n && hallazgos.length < 20; n = caminador.nextNode()) {
    const m = RE_10.exec(n.nodeValue || '');
    if (!m) continue;
    const padre = n.parentElement;
    const celda = padre?.closest('td, th');
    const fila = padre?.closest('tr');
    hallazgos.push({
      donde: 'texto',
      valor: m[0],
      contenedor: resumir(padre),
      indiceColumna: celda ? [...(fila?.cells || [])].indexOf(celda) : null,
      tablaId: padre?.closest('table')?.id || null,
    });
  }

  // El número de las FOTOS también tiene 10 dígitos y NO es el COD_ALUM (está
  // en CATALOGO.md). La plataforma pone la foto del docente en el encabezado de
  // todas las pantallas, así que sin descartarla la sonda respondía "sí, hay
  // COD_ALUM" en cualquier lado. No se esconde: va aparte con el motivo.
  const ES_FOTO = /\/Fotos\//i;

  for (const el of document.querySelectorAll('*')) {
    if (hallazgos.length >= 35) break;
    for (const a of el.attributes) {
      if (SENSIBLE.test(el.getAttribute('name') || '')) continue;
      if (a.value.length > 300) continue;
      const m = RE_10.exec(a.value);
      if (!m) continue;
      const hallazgo = {
        donde: `atributo:${a.name}`,
        valor: m[0],
        contenedor: resumir(el),
        fragmento: limpiar(a.value).slice(0, 120),
      };
      if (ES_FOTO.test(a.value)) {
        descartados.push({ ...hallazgo, motivo: 'es el número de la foto, no el COD_ALUM' });
      } else {
        hallazgos.push(hallazgo);
      }
      break;
    }
  }

  salida.diezDigitos = { total: hallazgos.length, hallazgos, descartados };

  // --- 6. Veredicto ---------------------------------------------------------
  // Para no tener que leer 300 líneas de JSON antes de saber qué sigue.

  const tabla = salida.tablas.find(esDeDatos) || null;
  const conCodigo = hallazgos.length > 0;
  const enNavegador = salida.acciones.some((a) => /navegador/.test(a.clase));
  const escriben = salida.acciones.filter((a) => a.escribe);
  const conFiltroSinElegir = salida.selects.filter((s) => {
    const v = (s.seleccionado.value || '').trim();
    return v === '' || v === '%' || v === '-1';
  });
  const conControles = salida.tablas.some((t) =>
    t.muestraFilas.some((f) => f.celdas.some((c) => /<(input|select|textarea)/.test(c))));
  const editablesAhora = salida.tablas.some((t) =>
    t.muestraFilas.some((f) => f.celdas.some((c) => /<(input|select|textarea)[^>]*>/.test(c) && !/trabado>/.test(c))));

  /*
   * ¿Esta pantalla habla de estudiantes?
   *
   * La sonda daba siempre un veredicto sobre el COD_ALUM, incluso en la matriz
   * de actividades y en el planeador, donde no hay un solo estudiante: son
   * actividades y planes. "Habría que emparejar por nombre" ahí no es un
   * consejo, es ruido que hace dudar de todo lo demás.
   */
  const DE_ESTUDIANTES = /codigo|cod_alum|alumno|estudiante|nombre/i;
  const esDeEstudiantes = conCodigo || salida.tablas.some((t) =>
    t.nFilas >= 5 && t.encabezados.some((h) => DE_ESTUDIANTES.test(h)));

  salida.veredicto = {
    hayTablaDeDatos: !!tabla,
    tablaMasProbable: tabla ? { id: tabla.id, filas: tabla.nFilas, columnas: tabla.nColumnas } : null,
    apareceCodAlum: conCodigo,
    laPantallaEscribe: escriben.length > 0 || conControles,
    seEscribeAhora: editablesAhora,
    seEditaPorFila: conControles && !editablesAhora,
    esDeEstudiantes,
    botonesDeEscritura: escriben.map((a) => a.etiqueta || a.id),
    acciones: salida.acciones.map((a) => ({ etiqueta: a.etiqueta, id: a.id, clase: a.clase, escribe: a.escribe })),
    siguiente: !tabla
      ? (conFiltroSinElegir.length
          ? `No hay tabla, y estos filtros están sin elegir: ${conFiltroSinElegir.map((s) => s.id || s.name).join(', ')}. Elegilos y volvé a correr la sonda.`
          : 'No hay tabla de datos en pantalla. Cargá la consulta hasta que se vean y volvé a correr la sonda.')
      : enNavegador
        ? 'Los datos ya están en el DOM y el archivo lo arma el navegador: se puede leer de ahí, sin descargar nada.'
        : !esDeEstudiantes
          ? 'Hay tabla y se puede leer del DOM. Esta pantalla no habla de estudiantes, así que el COD_ALUM no aplica: lo que identifica cada fila son los ids de sus columnas.'
          : conCodigo
            ? 'Hay tabla y hay códigos: se puede leer del DOM. Falta ver qué entrega el botón, por si trae más columnas.'
            : 'Hay tabla de estudiantes pero NO se ve el COD_ALUM. Habría que emparejar por nombre —frágil— o buscarlo en el archivo que baja el botón.',
  };

  // --- 7. Entrega -----------------------------------------------------------

  const json = JSON.stringify(salida, null, 2);
  console.log('%c=== SONDA — ' + salida.pantalla + ' ===', 'font-weight:bold;font-size:14px');
  console.log(salida);
  console.log('%c→ ' + salida.veredicto.siguiente, 'color:#0369a1;font-weight:bold');
  if (salida.veredicto.laPantallaEscribe) {
    console.log('%c⚠ Esta pantalla ESCRIBE: ' + salida.veredicto.botonesDeEscritura.join(', '),
                'color:#b45309;font-weight:bold');
  }
  try {
    copy(json);
    console.log('%c✔ JSON copiado al portapapeles (' + json.length + ' chars)', 'color:green;font-weight:bold');
  } catch (_) {
    console.log('%c⚠ No se pudo copiar sola. Copiá el texto de abajo:', 'color:orange;font-weight:bold');
    console.log(json);
  }
  return salida;
})();
