// ==UserScript==
// @name         GLA — Extractor de COD_ALUM (Classroom Live Web)
// @namespace    https://github.com/devdiegomt/planilla-v2
// @version      2.1.0
// @description  Recorre los 19 cursos de ReporteCalificaMatriz.aspx y extrae, por curso, la lista de estudiantes con su COD_ALUM. Salida: un único JSON descargable.
// @author       devdiegomt
// @match        *://webapps3-classroomliveweb.com/*/Seguro/ReporteCalificaMatriz.aspx
// @match        *://webapps3-classroomliveweb.com/*/Seguro/ReporteCalificaMatrizProfesor.aspx
// @include      https://webapps3-classroomliveweb.com:2443/*/Seguro/ReporteCalificaMatriz.aspx
// @include      /^https?:\/\/[^/]*classroomliveweb\.com(:\d+)?\/.*\/Seguro\/ReporteCalificaMatriz(Profesor)?\.aspx/
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * QUÉ HACE
 * --------
 * Por cada curso repite los dos mismos POST que hace la interfaz cuando tú
 * cambias de curso y pulsas Exportar:
 *
 *   1. __EVENTTARGET = ctl00$ContentPlaceHolder1$lstCurso  → devuelve HTML
 *   2. ctl00$ContentPlaceHolder1$btnExportar = Exportar    → devuelve el .xls
 *
 * El .xls se lee en memoria (nunca se guarda en disco) con un parser
 * OLE2/BIFF8 embebido, y de ahí salen COD_CUR, COD_GRU, COD_MAT, COD_ALUM y el
 * nombre — todas columnas propias del archivo.
 *
 * QUÉ NO HACE
 * -----------
 * Cero escrituras. Nunca envía ctl00$ContentPlaceHolder1$btnImportar (el único
 * camino de escritura de esta pantalla), no toca notas ni asistencia, no
 * guarda nada en el servidor. Un solo POST en vuelo a la vez.
 *
 * SOBRE LA PERSISTENCIA
 * ---------------------
 * El recon confirmó que esta página NO usa UpdatePanel: cambiar de curso por
 * la UI dispara un postback completo. Pero al replicar los POST con fetch(),
 * la página nunca navega, así que la corrida entera ocurre en una sola pasada
 * y no hay recargas que sobrevivir.
 *
 * Aun así el avance se persiste en sessionStorage tras cada curso, por si
 * recargas sin querer a mitad de camino. Al volver, el panel ofrece reanudar.
 * Deliberadamente NO reanuda solo: disparar peticiones de red al cargar la
 * página, sin que las pidas, sería una sorpresa desagradable. Es un clic.
 */

(() => {
  'use strict';

  // ======================================================================
  // CONFIGURACIÓN
  // ======================================================================

  const CURSOS_ESPERADOS = [
    '801', '802', '803', '804', '805', '806',
    '901', '902', '903', '904', '905',
    '1001', '1002', '1003', '1004',
    '1101', '1102', '1103', '1104',
  ];

  // Se muestra en el panel: sin esto, diagnosticar "¿qué versión tenés
  // cargada?" obliga a preguntar. Una prueba verifica que coincida con @version.
  const VERSION = '2.1.0';

  const CLAVE_ESTADO = 'gla_codalum_extractor_v1';
  const ESPERA_MIN_MS = 1500;   // entre cursos
  const ESPERA_MAX_MS = 2000;
  const ESPERA_ENTRE_POSTS_MS = 500; // entre "cambiar curso" y "exportar"

  const ID_LST_CURSO = 'ctl00_ContentPlaceHolder1_lstCurso';
  const NOMBRE_LST_CURSO = 'ctl00$ContentPlaceHolder1$lstCurso';
  const NOMBRE_BTN_EXPORTAR = 'ctl00$ContentPlaceHolder1$btnExportar';
  const NOMBRE_BTN_IMPORTAR = 'ctl00$ContentPlaceHolder1$btnImportar';
  const ID_HF_CURSO = 'ctl00_ContentPlaceHolder1_hfCurso';

  // ======================================================================
  // PARSER OLE2 / BIFF8
  // Validado contra archivos reales antes de escribir esto — ver
  // recon/pruebas/. Incluye el caso del SST partido en registros CONTINUE,
  // donde el grbit cambia de 8 a 16 bits por carácter a mitad de cadena.
  // ======================================================================

  const LIBRE = 0xFFFFFFFF, FIN_CADENA = 0xFFFFFFFE;

  function leerCFB(buffer) {
    const dv = new DataView(buffer);
    const u8 = new Uint8Array(buffer);

    const FIRMA = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    for (let i = 0; i < 8; i++) {
      if (u8[i] !== FIRMA[i]) throw new Error('No es un contenedor OLE2 (firma incorrecta)');
    }

    const tamSector = 1 << dv.getUint16(30, true);   // normalmente 512
    const tamMini = 1 << dv.getUint16(32, true);     // normalmente 64
    const nFat = dv.getUint32(44, true);
    const dirIni = dv.getUint32(48, true);
    const corteMini = dv.getUint32(56, true);        // streams menores van al mini-FAT
    const miniFatIni = dv.getUint32(60, true);
    const nMiniFat = dv.getUint32(64, true);
    const difatIni = dv.getUint32(68, true);
    const nDifat = dv.getUint32(72, true);

    const offSector = (s) => (s + 1) * tamSector;    // el sector 0 va justo tras la cabecera

    // DIFAT: 109 entradas en la cabecera, más sectores encadenados si el archivo es grande.
    const difat = [];
    for (let i = 0; i < 109; i++) {
      const s = dv.getUint32(76 + i * 4, true);
      if (s === LIBRE) break;
      difat.push(s);
    }
    let sd = difatIni;
    for (let k = 0; k < nDifat && sd !== LIBRE && sd !== FIN_CADENA; k++) {
      const base = offSector(sd);
      const porSector = tamSector / 4 - 1;            // la última entrada apunta al siguiente DIFAT
      for (let i = 0; i < porSector; i++) {
        const s = dv.getUint32(base + i * 4, true);
        if (s !== LIBRE) difat.push(s);
      }
      sd = dv.getUint32(base + porSector * 4, true);
    }

    // FAT: la tabla de "siguiente sector" para cada sector del archivo.
    const fat = [];
    for (const s of difat.slice(0, nFat || difat.length)) {
      const base = offSector(s);
      for (let i = 0; i < tamSector / 4; i++) fat.push(dv.getUint32(base + i * 4, true));
    }

    const cadena = (ini, tabla) => {
      const c = [];
      let s = ini, guarda = 0;
      while (s !== FIN_CADENA && s !== LIBRE && s < tabla.length && guarda++ < 1e5) {
        c.push(s);
        s = tabla[s];
      }
      return c;
    };

    const leerSectores = (ini, tam) => {
      const secs = cadena(ini, fat);
      const out = new Uint8Array(secs.length * tamSector);
      secs.forEach((s, i) => out.set(u8.subarray(offSector(s), offSector(s) + tamSector), i * tamSector));
      return tam != null ? out.slice(0, tam) : out;
    };

    // Mini-FAT: misma idea pero para los streams pequeños.
    const miniFat = [];
    if (nMiniFat) {
      for (const s of cadena(miniFatIni, fat)) {
        const base = offSector(s);
        for (let i = 0; i < tamSector / 4; i++) miniFat.push(dv.getUint32(base + i * 4, true));
      }
    }

    // Directorio: entradas de 128 bytes con nombre, tipo, sector inicial y tamaño.
    const dirBytes = leerSectores(dirIni);
    const dvDir = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength);
    const entradas = [];
    for (let off = 0; off + 128 <= dirBytes.length; off += 128) {
      const tipo = dirBytes[off + 66];               // 0=vacía 1=storage 2=stream 5=raíz
      if (tipo === 0) continue;
      const nomLen = dvDir.getUint16(off + 64, true);
      let nombre = '';
      for (let i = 0; i + 1 < Math.max(0, nomLen - 2); i += 2) {
        nombre += String.fromCharCode(dirBytes[off + i] | (dirBytes[off + i + 1] << 8));
      }
      entradas.push({
        nombre,
        tipo,
        inicio: dvDir.getUint32(off + 116, true),
        tam: dvDir.getUint32(off + 120, true),
      });
    }

    const raiz = entradas.find((e) => e.tipo === 5);
    const miniStream = raiz ? leerSectores(raiz.inicio, raiz.tam) : new Uint8Array(0);

    const leerStream = (e) => {
      if (e.tam >= corteMini) return leerSectores(e.inicio, e.tam);
      const secs = cadena(e.inicio, miniFat);
      const out = new Uint8Array(secs.length * tamMini);
      secs.forEach((s, i) => out.set(miniStream.subarray(s * tamMini, s * tamMini + tamMini), i * tamMini));
      return out.slice(0, e.tam);
    };

    return { entradas, leerStream, tamSector, tamMini, corteMini };
  }

  // =========================================================================
  // PARTE 2 — Lector de registros BIFF (el contenido del stream "Workbook")
  // El stream es una secuencia plana: [tipo u16][largo u16][datos].
  // =========================================================================

  const REG = {
    BOF: 0x0809, EOF: 0x000A, BOUNDSHEET: 0x0085, SST: 0x00FC, CONTINUE: 0x003C,
    LABELSST: 0x00FD, LABEL: 0x0204, RSTRING: 0x00D6, NUMBER: 0x0203,
    RK: 0x027E, MULRK: 0x00BD, FORMULA: 0x0006, STRING: 0x0207,
    BLANK: 0x0201, MULBLANK: 0x00BE, DIMENSIONS: 0x0200, ROW: 0x0208,
  };

  // Registros de formato/estructura que existen pero no aportan datos.
  const IGNORADOS = new Set([
    REG.EOF, REG.BLANK, REG.MULBLANK, REG.DIMENSIONS, REG.STRING, REG.CONTINUE,
    REG.ROW, 0x00FF /*DBCELL*/, 0x0022 /*DATE1904*/, 0x013D /*RRTABID*/,
  ]);

  function troceaRegistros(stream) {
    const dv = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
    const regs = [];
    let p = 0;
    while (p + 4 <= stream.length) {
      const tipo = dv.getUint16(p, true);
      const len = dv.getUint16(p + 2, true);
      // El stream viene rellenado con ceros hasta completar el sector: ahí se acabó.
      if (tipo === 0 && len === 0) break;
      if (p + 4 + len > stream.length) break;
      regs.push({ tipo, ini: p + 4, len });
      p += 4 + len;
    }
    return { dv, regs };
  }

  /*
   * El SST guarda todas las cadenas del libro una sola vez. Si no cabe en un
   * registro (máx. 8224 bytes) sigue en registros CONTINUE — y ahí está la
   * trampa: una cadena puede partirse por la mitad, y el primer byte del
   * CONTINUE es un grbit NUEVO que puede cambiar de 8 a 16 bits por carácter
   * a mitad del string. Por eso se lee con un cursor que sabe de bloques.
   */
  function leerSST(dv, regs, idx) {
    const r0 = regs[idx];
    const nUnicos = dv.getUint32(r0.ini + 4, true);

    const bloques = [{ ini: r0.ini + 8, fin: r0.ini + r0.len }]; // saltar los 2 contadores
    for (let i = idx + 1; i < regs.length && regs[i].tipo === REG.CONTINUE; i++) {
      bloques.push({ ini: regs[i].ini, fin: regs[i].ini + regs[i].len });
    }

    let b = 0, p = bloques[0].ini;
    const agotado = () => b >= bloques.length;
    const finBloque = () => agotado() || p >= bloques[b].fin;
    const siguienteBloque = () => { b++; if (!agotado()) p = bloques[b].ini; };
    const byte = () => dv.getUint8(p++);
    const u16 = () => { const v = dv.getUint16(p, true); p += 2; return v; };
    const u32 = () => { const v = dv.getUint32(p, true); p += 4; return v; };

    const cadenas = [];
    let truncadas = 0;

    for (let n = 0; n < nUnicos; n++) {
      if (finBloque()) siguienteBloque();
      if (agotado()) { truncadas = nUnicos - n; break; }

      const cch = u16();
      const grbit = byte();
      let alto = grbit & 1;                      // 1 = UTF-16LE, 0 = 8 bits comprimido
      const rico = (grbit >> 3) & 1;
      const ext = (grbit >> 2) & 1;
      const cRun = rico ? u16() : 0;
      const cbExt = ext ? u32() : 0;

      let s = '', leidos = 0;
      while (leidos < cch) {
        if (finBloque()) {
          siguienteBloque();
          if (agotado()) break;
          alto = byte() & 1;                     // grbit nuevo tras el corte
        }
        s += alto ? String.fromCharCode(u16()) : String.fromCharCode(byte());
        leidos++;
      }

      // Saltar runs de formato y datos fonéticos, respetando los cortes de bloque.
      let saltar = cRun * 4 + cbExt;
      while (saltar > 0 && !agotado()) {
        const disponible = bloques[b].fin - p;
        if (saltar < disponible) { p += saltar; saltar = 0; }
        else { saltar -= disponible; siguienteBloque(); }
      }
      cadenas.push(s);
    }
    return { cadenas, nUnicos, truncadas };
  }

  // RK: número comprimido en 32 bits. Los 2 bits bajos son banderas.
  const dvRK = new DataView(new ArrayBuffer(8));
  function decodificaRK(u) {
    let v;
    if (u & 2) {
      v = (u | 0) >> 2;                          // entero con signo de 30 bits
    } else {
      dvRK.setUint32(0, 0, true);                // los 30 bits altos son la parte alta de un double
      dvRK.setUint32(4, u & 0xFFFFFFFC, true);
      v = dvRK.getFloat64(0, true);
    }
    return (u & 1) ? v / 100 : v;
  }

  // Cadena corta con cabecera de 1 byte de largo (BOUNDSHEET, etc.)
  function cadenaCorta(dv, off) {
    const cch = dv.getUint8(off);
    const alto = dv.getUint8(off + 1) & 1;
    let s = '';
    for (let i = 0; i < cch; i++) {
      s += alto ? String.fromCharCode(dv.getUint16(off + 2 + i * 2, true))
                : String.fromCharCode(dv.getUint8(off + 2 + i));
    }
    return s;
  }

  function parsearLibro(stream) {
    const { dv, regs } = troceaRegistros(stream);

    const idxSST = regs.findIndex((r) => r.tipo === REG.SST);
    const sst = idxSST >= 0 ? leerSST(dv, regs, idxSST) : { cadenas: [], nUnicos: 0, truncadas: 0 };

    const nombresHoja = regs.filter((r) => r.tipo === REG.BOUNDSHEET)
      .map((r) => cadenaCorta(dv, r.ini + 6));

    const versionBIFF = regs.length ? dv.getUint16(regs[0].ini, true) : null;

    const hojas = [];
    let hoja = null;
    const noManejados = {};

    for (let i = 0; i < regs.length; i++) {
      const r = regs[i];
      const o = r.ini;

      if (r.tipo === REG.BOF) {
        const dt = dv.getUint16(o + 2, true);
        if (dt === 0x0010) { hoja = { celdas: new Map(), maxFila: -1, maxCol: -1 }; hojas.push(hoja); }
        continue;
      }
      if (!hoja) continue;

      const poner = (fila, col, valor) => {
        hoja.celdas.set(fila + ':' + col, valor);
        if (fila > hoja.maxFila) hoja.maxFila = fila;
        if (col > hoja.maxCol) hoja.maxCol = col;
      };

      switch (r.tipo) {
        case REG.LABELSST: {
          const isst = dv.getUint32(o + 6, true);
          poner(dv.getUint16(o, true), dv.getUint16(o + 2, true), sst.cadenas[isst] ?? '');
          break;
        }
        case REG.LABEL:
        case REG.RSTRING: {
          const cch = dv.getUint16(o + 6, true);
          const alto = dv.getUint8(o + 8) & 1;
          let s = '';
          for (let k = 0; k < cch; k++) {
            s += alto ? String.fromCharCode(dv.getUint16(o + 9 + k * 2, true))
                      : String.fromCharCode(dv.getUint8(o + 9 + k));
          }
          poner(dv.getUint16(o, true), dv.getUint16(o + 2, true), s);
          break;
        }
        case REG.NUMBER:
          poner(dv.getUint16(o, true), dv.getUint16(o + 2, true), dv.getFloat64(o + 6, true));
          break;
        case REG.RK:
          poner(dv.getUint16(o, true), dv.getUint16(o + 2, true), decodificaRK(dv.getUint32(o + 6, true)));
          break;
        case REG.MULRK: {
          const fila = dv.getUint16(o, true);
          const colIni = dv.getUint16(o + 2, true);
          const n = (r.len - 6) / 6;               // pares (xf, rk), y al final colLast
          for (let k = 0; k < n; k++) {
            poner(fila, colIni + k, decodificaRK(dv.getUint32(o + 4 + k * 6 + 2, true)));
          }
          break;
        }
        case REG.FORMULA: {
          // Resultado cacheado: si los bytes 6 y 12-13 marcan "cadena", viene en el STRING siguiente.
          const fila = dv.getUint16(o, true), col = dv.getUint16(o + 2, true);
          const esCadena = dv.getUint8(o + 6) === 0 && dv.getUint16(o + 12, true) === 0xFFFF;
          if (esCadena) {
            const sig = regs[i + 1];
            if (sig && sig.tipo === REG.STRING) {
              const cch = dv.getUint16(sig.ini, true);
              const alto = dv.getUint8(sig.ini + 2) & 1;
              let s = '';
              for (let k = 0; k < cch; k++) {
                s += alto ? String.fromCharCode(dv.getUint16(sig.ini + 3 + k * 2, true))
                          : String.fromCharCode(dv.getUint8(sig.ini + 3 + k));
              }
              poner(fila, col, s);
            }
          } else {
            poner(fila, col, dv.getFloat64(o + 6, true));
          }
          break;
        }
        default:
          if (!IGNORADOS.has(r.tipo)) noManejados[r.tipo] = (noManejados[r.tipo] || 0) + 1;
      }
    }

    const aMatriz = (h) => {
      const filas = [];
      for (let f = 0; f <= h.maxFila; f++) {
        const fila = [];
        for (let c = 0; c <= h.maxCol; c++) fila.push(h.celdas.get(f + ':' + c) ?? null);
        filas.push(fila);
      }
      return filas;
    };

    return {
      versionBIFF: versionBIFF ? '0x' + versionBIFF.toString(16) : null,
      nombresHoja,
      sst: { unicasDeclaradas: sst.nUnicos, leidas: sst.cadenas.length, truncadas: sst.truncadas },
      totalRegistros: regs.length,
      tiposNoManejados: Object.entries(noManejados).map(([t, n]) => ({ tipo: '0x' + Number(t).toString(16), veces: n })),
      matrices: hojas.map(aMatriz),
    };
  }

  // ======================================================================
  // CAPA DE RED — replica exactamente los POST de la interfaz
  // ======================================================================

  const ACCION = document.forms.aspnetForm ? document.forms.aspnetForm.action : location.href;

  // Tipos de control que el navegador NO envía salvo que sean el disparador.
  // Excluirlos es lo que garantiza que btnImportar jamás viaje en el cuerpo.
  const TIPOS_OMITIDOS = new Set(['submit', 'button', 'reset', 'image', 'file']);

  function serializarFormulario(doc) {
    const form = doc.forms.aspnetForm || doc.querySelector('form#aspnetForm');
    if (!form) throw new Error('No encuentro #aspnetForm en la respuesta');

    const params = new URLSearchParams();
    for (const el of form.elements) {
      if (!el.name || el.disabled) continue;
      const tipo = (el.type || '').toLowerCase();
      if (TIPOS_OMITIDOS.has(tipo)) continue;
      if ((tipo === 'checkbox' || tipo === 'radio') && !el.checked) continue;

      if (el.tagName === 'SELECT') {
        // En un documento parseado con DOMParser, .value depende de que el
        // parser haya interpretado el atributo selected; si falla, lo busco a mano.
        const opciones = [...el.options];
        if (el.multiple) {
          for (const o of opciones.filter((o) => o.selected || o.hasAttribute('selected'))) {
            params.append(el.name, o.value);
          }
        } else {
          const sel = opciones.find((o) => o.selected) || opciones.find((o) => o.hasAttribute('selected'));
          params.append(el.name, sel ? sel.value : (opciones[0] ? opciones[0].value : ''));
        }
        continue;
      }
      params.append(el.name, el.value);
    }

    // Red de seguridad: aunque el bucle de arriba ya los excluye por tipo.
    params.delete(NOMBRE_BTN_IMPORTAR);
    params.delete(NOMBRE_BTN_EXPORTAR);
    return params;
  }

  async function postear(params, señal) {
    const r = await fetch(ACCION, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
      signal: señal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
    return r;
  }

  /* POST 1: cambiar de curso. Devuelve el formulario ya actualizado. */
  async function cambiarCurso(params, valorCurso, señal) {
    const p = new URLSearchParams(params);
    p.set('__EVENTTARGET', NOMBRE_LST_CURSO);
    p.set('__EVENTARGUMENT', '');
    p.set('__LASTFOCUS', '');
    p.set(NOMBRE_LST_CURSO, valorCurso);

    const r = await postear(p, señal);
    const html = await r.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    // ¿El servidor realmente cambió de curso? Si no, no exporto nada.
    const hf = doc.getElementById(ID_HF_CURSO);
    const cursoServidor = hf ? String(hf.value || '').trim() : null;
    return { params: serializarFormulario(doc), cursoServidor };
  }

  /* POST 2: exportar el curso ya cargado. Devuelve el .xls como ArrayBuffer. */
  async function exportar(params, señal) {
    const p = new URLSearchParams(params);
    p.set('__EVENTTARGET', '');
    p.set('__EVENTARGUMENT', '');
    p.set(NOMBRE_BTN_EXPORTAR, 'Exportar');

    const r = await postear(p, señal);
    const disposicion = r.headers.get('content-disposition') || '';
    const buf = await r.arrayBuffer();

    const m = /filename=([^;]+)/i.exec(disposicion);
    return { buf, nombreArchivo: m ? m[1].trim() : null };
  }

  // ======================================================================
  // EXTRACCIÓN — del .xls a los datos que queremos
  // ======================================================================

  const normaliza = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

  // Para comparar encabezados sin depender de tildes ni mayúsculas.
  const clave = (s) => normaliza(s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');

  const aTexto = (v) => {
    if (v == null) return '';
    // Un COD_ALUM puede venir como número si el servidor lo escribe así.
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v));
    return normaliza(v);
  };

  /* Una hoja → un curso. El export por profesor trae 19 hojas en un archivo,
     el individual trae una: el mismo código sirve para las dos. */
  function extraerDeMatriz(matriz) {
    if (!matriz || !matriz.length) throw new Error('La hoja vino vacía');

    // Localizo la fila de encabezados buscando COD_ALUM, en vez de asumir que
    // siempre es la fila 12: si el reporte cambia de membrete, esto aguanta.
    let filaEnc = -1, colDe = {};
    for (let f = 0; f < matriz.length; f++) {
      const mapa = {};
      matriz[f].forEach((celda, c) => {
        const k = clave(celda);
        if (k) mapa[k] = c;
      });
      if (mapa.codalum != null) { filaEnc = f; colDe = mapa; break; }
    }
    if (filaEnc < 0) throw new Error('No encuentro la columna COD_ALUM en la hoja');

    // El nombre no tiene un encabezado tan estable como los COD_*.
    const colNombre = colDe.nombrealumno ?? colDe.nombrealum ?? colDe.nombre ??
      Object.entries(colDe).find(([k]) => k.startsWith('nombre') && k.includes('alum'))?.[1];
    if (colNombre == null) throw new Error('No encuentro la columna del nombre del alumno');

    const filas = matriz.slice(filaEnc + 1)
      .filter((fila) => aTexto(fila[colDe.codalum]) !== '');

    const primera = filas[0] || [];
    const leerMeta = (k) => (colDe[k] != null ? aTexto(primera[colDe[k]]) : '');

    return {
      cod_cur: leerMeta('codcur'),
      cod_gru: leerMeta('codgru'),
      cod_mat: leerMeta('codmat'),
      estudiantes: filas.map((fila) => ({
        cod_alum: aTexto(fila[colDe.codalum]),
        nombre: aTexto(fila[colNombre]),
      })),
    };
  }

  function abrirLibro(buffer) {
    const cfb = leerCFB(buffer);
    const wb = cfb.entradas.find((e) => e.tipo === 2 && /^(Workbook|Book)$/i.test(e.nombre));
    if (!wb) throw new Error('El archivo no tiene stream Workbook');
    return parsearLibro(cfb.leerStream(wb));
  }

  /* Todas las hojas con datos. Una que falle no tumba las demás: se registra
     y se sigue, igual que un curso que falla en el modo lento. */
  function extraerHojas(buffer) {
    const libro = abrirLibro(buffer);
    const cursos = [], errores = [];
    libro.matrices.forEach((matriz, i) => {
      const hoja = libro.nombresHoja[i] || `Hoja${i + 1}`;
      try {
        const datos = extraerDeMatriz(matriz);
        if (datos.estudiantes.length) cursos.push({ hoja, ...datos });
        else errores.push({ cod_cur: datos.cod_cur || hoja, tipo: 'sin_estudiantes', detalle: `la hoja ${hoja} no trajo filas` });
      } catch (e) {
        errores.push({ cod_cur: hoja, tipo: 'fallo', detalle: `hoja ${hoja}: ${e.message}` });
      }
    });
    return { cursos, errores, nHojas: libro.matrices.length };
  }

  // El modo lento espera un solo curso por archivo.
  function extraerDelLibro(buffer) {
    return extraerDeMatriz(abrirLibro(buffer).matrices[0]);
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
      try { sessionStorage.setItem(CLAVE_ESTADO, JSON.stringify(e)); }
      catch (_) { /* cuota llena: la corrida sigue, solo se pierde el respaldo */ }
    },
    limpiar() {
      try { sessionStorage.removeItem(CLAVE_ESTADO); } catch (_) { /* nada */ }
    },
  };

  // ======================================================================
  // INTERFAZ
  // ======================================================================

  const CSS = `
    #gla-panel{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:320px;
      font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1a2330;
      background:#fff;border:1px solid #c9d3e0;border-radius:10px;
      box-shadow:0 8px 28px rgba(16,32,56,.22);overflow:hidden}
    #gla-panel header{display:flex;align-items:center;gap:8px;padding:9px 12px;
      background:#1f3a5f;color:#fff;font-weight:600;font-size:12.5px;letter-spacing:.02em}
    #gla-panel header .pt{flex:1}
    #gla-panel .cuerpo{padding:12px}
    #gla-panel .barra{height:6px;background:#e6ecf4;border-radius:3px;overflow:hidden;margin:9px 0}
    #gla-panel .barra i{display:block;height:100%;width:0;background:#2f6fb5;transition:width .25s}
    #gla-panel .estado{font-variant-numeric:tabular-nums}
    #gla-panel .acciones{display:flex;gap:8px;margin-top:10px}
    #gla-panel button{flex:1;padding:7px 10px;border-radius:6px;border:1px solid transparent;
      font:inherit;font-weight:600;cursor:pointer}
    #gla-panel button:disabled{opacity:.45;cursor:not-allowed}
    #gla-panel .prim{background:#2f6fb5;color:#fff}
    #gla-panel .sec{background:#fff;color:#7a2230;border-color:#d9b3ba}
    #gla-panel .log{margin-top:10px;max-height:132px;overflow:auto;font-size:11.5px;
      background:#f6f8fb;border:1px solid #e2e9f2;border-radius:6px;padding:7px}
    #gla-panel .log div{padding:1px 0;word-break:break-word}
    #gla-panel .log .err{color:#a3253c}
    #gla-panel .log .ok{color:#1d6b3f}
    #gla-panel .nota{margin-top:8px;font-size:11px;color:#5b6981}
  `;

  const panel = document.createElement('div');
  panel.id = 'gla-panel';
  panel.innerHTML = `
    <header><span class="pt">Extractor COD_ALUM</span><span id="gla-ver" style="opacity:.65;font-weight:400;font-size:11px"></span><span id="gla-min" style="cursor:pointer">—</span></header>
    <div class="cuerpo">
      <div class="estado" id="gla-estado">Listo. ${CURSOS_ESPERADOS.length} cursos por recorrer.</div>
      <div class="barra"><i id="gla-barra"></i></div>
      <div class="acciones">
        <button class="prim" id="gla-iniciar">Iniciar</button>
        <button class="sec" id="gla-abortar" disabled>Abortar</button>
      </div>
      <div class="log" id="gla-log"></div>
      <div class="nota">Solo lectura: cambia de curso y exporta, igual que a mano.</div>
    </div>`;

  const estilo = document.createElement('style');
  estilo.textContent = CSS;
  document.head.appendChild(estilo);
  document.body.appendChild(panel);

  const $estado = panel.querySelector('#gla-estado');
  const $barra = panel.querySelector('#gla-barra');
  const $log = panel.querySelector('#gla-log');
  const $iniciar = panel.querySelector('#gla-iniciar');
  const $abortar = panel.querySelector('#gla-abortar');
  const $cuerpo = panel.querySelector('.cuerpo');

  panel.querySelector('#gla-min').onclick = () => {
    $cuerpo.style.display = $cuerpo.style.display === 'none' ? '' : 'none';
  };

  function log(msg, clase) {
    const d = document.createElement('div');
    if (clase) d.className = clase;
    d.textContent = msg;
    $log.appendChild(d);
    $log.scrollTop = $log.scrollHeight;
  }

  function progreso(hechos, total, texto) {
    $barra.style.width = total ? (hechos / total * 100).toFixed(1) + '%' : '0';
    $estado.textContent = texto;
  }

  // ======================================================================
  // CORRIDA
  // ======================================================================

  let corriendo = false;
  let abortado = false;
  let controlador = null;

  const dormir = (ms) => new Promise((res) => setTimeout(res, ms));
  const esperaEntreCursos = () => ESPERA_MIN_MS + Math.random() * (ESPERA_MAX_MS - ESPERA_MIN_MS);

  /* Los values del <select> vienen paddeados a 5 caracteres ("801  ", "1001 "),
     así que el emparejamiento va siempre por .trim(). */
  function mapaDeCursos() {
    const lst = document.getElementById(ID_LST_CURSO);
    if (!lst) throw new Error('No encuentro el selector de curso. ¿Estás en ReporteCalificaMatriz.aspx?');
    const mapa = new Map();
    for (const o of lst.options) {
      const cod = String(o.value).trim();
      if (cod && cod !== '%') mapa.set(cod, o.value);
    }
    return mapa;
  }

  // ======================================================================
  // MODO RÁPIDO — ReporteCalificaMatrizProfesor.aspx
  // ======================================================================

  /*
   * Esa pantalla exporta TODAS las planillas de un docente en un solo archivo:
   * Califica-451-02.xls, 19 hojas, una por curso. Una petición en vez de 38.
   *
   * El selector de profesor tiene 187 opciones y "-1" es TODOS. Exportar las
   * planillas de todo el colegio es una acción distinta de exportar las tuyas,
   * así que el script solo procede con tu propio código —el que el servidor
   * puso en hfProfesor— y para todo lo demás pide una confirmación aparte.
   */
  const ID_LST_PROFESOR = 'ctl00_ContentPlaceHolder1_lstProfesor';
  const ID_HF_PROFESOR = 'ctl00_ContentPlaceHolder1_hfProfesor';
  // El botón de exportar se llama igual en las dos pantallas: NOMBRE_BTN_EXPORTAR.

  /*
   * El modo lo decide el DOM, no la URL: lo que importa es qué controles tiene
   * la página. La pantalla por profesor trae lstProfesor y no trae lstCurso;
   * la individual, al revés. Así la detección no depende de que la ruta sea
   * exactamente la esperada.
   */
  const esPantallaPorProfesor = () =>
    !!document.getElementById(ID_LST_PROFESOR) && !document.getElementById(ID_LST_CURSO);

  function revisarProfesorSeleccionado() {
    const lst = document.getElementById(ID_LST_PROFESOR);
    const propio = document.getElementById(ID_HF_PROFESOR)?.value?.trim();
    if (!lst) return { error: 'no encuentro el selector de profesor.' };

    const elegido = String(lst.value).trim();
    const texto = normaliza(lst.selectedOptions[0]?.text);
    if (elegido === '-1') {
      return { error: `el selector está en "${texto}" (${lst.options.length} docentes). ` +
        'Elegí tu propio nombre: no voy a descargar las planillas de todo el colegio.' };
    }
    return { elegido, texto, propio, esPropio: !!propio && elegido === propio };
  }

  async function extraerTodoDeUnaVez(señal) {
    const params = serializarFormulario(document);
    params.set('__EVENTTARGET', '');
    params.set('__EVENTARGUMENT', '');
    params.set(NOMBRE_BTN_EXPORTAR, 'Exportar');

    const r = await postear(params, señal);
    const disposicion = r.headers.get('content-disposition') || '';
    const buf = await r.arrayBuffer();
    const m = /filename=([^;]+)/i.exec(disposicion);
    return { buf, nombreArchivo: m ? m[1].trim() : null, bytes: buf.byteLength };
  }

  function descargarJSON(datos) {
    const blob = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `codalum-gla-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function correr(reanudar) {
    if (corriendo) return;
    corriendo = true;
    abortado = false;
    controlador = new AbortController();
    $iniciar.disabled = true;
    $abortar.disabled = false;

    const mapa = mapaDeCursos();
    const faltantes = CURSOS_ESPERADOS.filter((c) => !mapa.has(c));
    if (faltantes.length) log(`Aviso: no están en el selector: ${faltantes.join(', ')}`, 'err');

    const pendientesTodos = CURSOS_ESPERADOS.filter((c) => mapa.has(c));

    const previo = reanudar ? Estado.leer() : null;
    const cursos = previo ? previo.cursos : [];
    const errores = previo ? previo.errores : [];
    const hechos = new Set([...cursos.map((c) => c.__cod), ...errores.map((e) => e.cod_cur)]);
    const pendientes = pendientesTodos.filter((c) => !hechos.has(c));

    if (previo) log(`Reanudando: faltan ${pendientes.length} de ${pendientesTodos.length}.`);

    // El estado del formulario arranca desde la página visible y se va
    // encadenando con el __VIEWSTATE que devuelve cada respuesta.
    let params = serializarFormulario(document);

    for (let i = 0; i < pendientes.length; i++) {
      if (abortado) break;
      const cod = pendientes[i];
      const hechoTotal = pendientesTodos.length - pendientes.length + i;
      progreso(hechoTotal, pendientesTodos.length,
        `Curso ${hechoTotal + 1} de ${pendientesTodos.length} — ${cod}`);

      try {
        // --- POST 1: cambiar de curso
        const cambio = await cambiarCurso(params, mapa.get(cod), controlador.signal);
        params = cambio.params;

        if (cambio.cursoServidor !== cod) {
          throw new Error(`el servidor quedó en "${cambio.cursoServidor}" y no en "${cod}"`);
        }
        if (abortado) break;
        await dormir(ESPERA_ENTRE_POSTS_MS);

        // --- POST 2: exportar
        const exp = await exportar(params, controlador.signal);

        // El nombre del archivo es Califica-<curso>-<materia>-<periodo>.xls:
        // sirve como segunda confirmación de que no me trajeron otro curso.
        if (exp.nombreArchivo && !new RegExp(`-${cod}-`).test(exp.nombreArchivo)) {
          throw new Error(`el archivo devuelto es "${exp.nombreArchivo}", no corresponde a ${cod}`);
        }

        const datos = extraerDelLibro(exp.buf);

        // Tercera confirmación: la columna COD_CUR dentro del propio archivo.
        if (datos.cod_cur && datos.cod_cur !== cod) {
          throw new Error(`el archivo dice COD_CUR="${datos.cod_cur}" y esperaba "${cod}"`);
        }

        const malos = datos.estudiantes.filter((e) => !/^\d{10}$/.test(e.cod_alum));
        if (malos.length) {
          errores.push({
            cod_cur: cod,
            tipo: 'cod_alum_invalido',
            detalle: `${malos.length} código(s) no son de 10 dígitos`,
            muestra: malos.slice(0, 5).map((e) => e.cod_alum),
          });
          log(`${cod}: ${malos.length} código(s) con formato raro`, 'err');
        }

        if (!datos.estudiantes.length) {
          errores.push({ cod_cur: cod, tipo: 'sin_estudiantes', detalle: 'el export no trajo filas' });
          log(`${cod}: sin estudiantes`, 'err');
        }

        cursos.push({
          __cod: cod,
          cod_cur: datos.cod_cur || cod,
          cod_gru: datos.cod_gru,
          cod_mat: datos.cod_mat,
          estudiantes: datos.estudiantes,
        });
        log(`${cod}: ${datos.estudiantes.length} estudiantes`, 'ok');
      } catch (e) {
        if (e && e.name === 'AbortError') break;
        errores.push({ cod_cur: cod, tipo: 'fallo', detalle: String(e && e.message ? e.message : e) });
        log(`${cod}: ${e && e.message ? e.message : e}`, 'err');
      }

      // Se guarda el parcial pase lo que pase, para poder reanudar.
      Estado.guardar({ cursos, errores, ts: Date.now() });

      if (i < pendientes.length - 1 && !abortado) await dormir(esperaEntreCursos());
    }

    corriendo = false;
    $iniciar.disabled = false;
    $abortar.disabled = true;
    controlador = null;

    if (abortado) {
      progreso(0, 1, 'Abortado. Parcial descartado.');
      log('Corrida abortada por el usuario.', 'err');
      Estado.limpiar();
      return;
    }

    const salida = {
      generado: new Date().toISOString(),
      cursos: cursos.map(({ __cod, ...resto }) => resto),
      errores,
    };
    const totalEst = salida.cursos.reduce((n, c) => n + c.estudiantes.length, 0);

    progreso(1, 1, `Listo: ${salida.cursos.length} cursos, ${totalEst} estudiantes.`);
    log(`Terminado. ${salida.cursos.length} cursos, ${totalEst} estudiantes, ${errores.length} error(es).`, 'ok');
    descargarJSON(salida);
    Estado.limpiar();
  }

  /* Modo rápido: un POST, 19 hojas, sin recorrer nada. */
  async function correrRapido(confirmadoAjeno) {
    if (corriendo) return;

    const revision = revisarProfesorSeleccionado();
    if (revision.error) { log(revision.error, 'err'); return; }

    // Exportar las planillas de otro docente es legítimo si tenés el rol para
    // hacerlo, pero no debería ocurrir por inercia: se pide un clic aparte.
    if (!revision.esPropio && !confirmadoAjeno) {
      log(`El selector está en "${revision.texto}", que no es tu código (${revision.propio}).`, 'err');
      log('Pulsá otra vez para confirmar que querés esas planillas, o cambiá el selector.', 'err');
      $iniciar.textContent = 'Confirmar (docente ajeno)';
      $iniciar.onclick = () => correrRapido(true);
      return;
    }

    corriendo = true;
    abortado = false;
    controlador = new AbortController();
    $iniciar.disabled = true;
    $abortar.disabled = false;

    try {
      log(`Exportando las planillas de ${revision.texto}…`);
      progreso(0, 1, 'Pidiendo el archivo…');
      const exp = await extraerTodoDeUnaVez(controlador.signal);
      log(`Archivo recibido: ${exp.nombreArchivo || 'sin nombre'} (${Math.round(exp.bytes / 1024)} KB).`);

      progreso(0.5, 1, 'Parseando las hojas…');
      const { cursos, errores, nHojas } = extraerHojas(exp.buf);
      log(`${nHojas} hoja(s) en el archivo.`);

      for (const c of cursos) {
        const malos = c.estudiantes.filter((e) => !/^\d{10}$/.test(e.cod_alum));
        if (malos.length) {
          errores.push({
            cod_cur: c.cod_cur, tipo: 'cod_alum_invalido',
            detalle: `${malos.length} código(s) no son de 10 dígitos`,
            muestra: malos.slice(0, 5).map((e) => e.cod_alum),
          });
        }
        log(`${c.cod_cur || c.hoja}: ${c.estudiantes.length} estudiantes`, 'ok');
      }

      const salida = {
        generado: new Date().toISOString(),
        cursos: cursos.map(({ hoja, ...resto }) => resto),
        errores,
      };
      const totalEst = salida.cursos.reduce((n, c) => n + c.estudiantes.length, 0);

      const faltantes = CURSOS_ESPERADOS.filter((c) => !salida.cursos.some((x) => x.cod_cur === c));
      if (faltantes.length) log(`Aviso: no vinieron ${faltantes.join(', ')}`, 'err');

      progreso(1, 1, `Listo: ${salida.cursos.length} cursos, ${totalEst} estudiantes.`);
      log(`Terminado. ${salida.cursos.length} cursos, ${totalEst} estudiantes, ${errores.length} error(es).`, 'ok');
      descargarJSON(salida);
    } catch (e) {
      if (!(e && e.name === 'AbortError')) log('Falló: ' + (e && e.message ? e.message : e), 'err');
    } finally {
      corriendo = false;
      $iniciar.disabled = false;
      $abortar.disabled = true;
      controlador = null;
    }
  }

  $iniciar.onclick = () => correr(false);
  $abortar.onclick = () => {
    abortado = true;
    if (controlador) controlador.abort();
    $abortar.disabled = true;
    log('Abortando…');
  };

  /* En la pantalla por profesor no hay nada que recorrer: un POST trae las 19
     hojas. El modo lento queda como respaldo en la pantalla individual, por si
     el colegio cambia el reporte agregado. */
  panel.querySelector('#gla-ver').textContent = 'v' + VERSION;

  if (esPantallaPorProfesor()) {
    const revision = revisarProfesorSeleccionado();
    $estado.textContent = revision.error
      ? 'Revisá el selector de profesor.'
      : `Listo. Un archivo con todas las planillas de ${revision.texto}.`;
    $iniciar.textContent = 'Extraer todo (1 petición)';
    $iniciar.onclick = () => correrRapido(false);
    log('Pantalla por profesor: no hace falta recorrer curso por curso.');
    if (revision.error) log(revision.error, 'err');
    else if (!revision.esPropio) log(`Ojo: el selector no está en tu código (${revision.propio}).`, 'err');
    return;
  }

  /* Modo lento. Si el panel aparece acá cuando esperabas el rápido, esta línea
     es el diagnóstico: dice en qué pantalla cree estar y dónde está la otra. */
  log(`Pantalla individual (${location.pathname.split('/').pop()}): recorrido curso por curso.`);
  log('El modo de 1 petición está en "Importar/exportar planillas por profesor GLA".');

  // Si quedó una corrida a medias (por una recarga), ofrecer reanudarla.
  const previo = Estado.leer();
  if (previo && (previo.cursos.length || previo.errores.length)) {
    const hechos = previo.cursos.length + previo.errores.length;
    $estado.textContent = `Corrida interrumpida: ${hechos} de ${CURSOS_ESPERADOS.length}.`;
    $iniciar.textContent = 'Reanudar';
    $iniciar.onclick = () => correr(true);
    log(`Encontrado un parcial con ${hechos} curso(s). "Reanudar" sigue desde ahí.`);

    const $desc = document.createElement('button');
    $desc.className = 'sec';
    $desc.textContent = 'Descartar';
    $desc.onclick = () => {
      Estado.limpiar();
      $desc.remove();
      $iniciar.textContent = 'Iniciar';
      $iniciar.onclick = () => correr(false);
      $estado.textContent = `Listo. ${CURSOS_ESPERADOS.length} cursos por recorrer.`;
      log('Parcial descartado.');
    };
    panel.querySelector('.acciones').appendChild($desc);
  }
})();
