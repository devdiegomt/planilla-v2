/*
 * SONDA v4 — Parsear el .xls binario del export
 * =============================================
 *
 * La v3 confirmó que Exportar devuelve OLE2/BIFF8 real (firma d0 cf 11 e0),
 * no HTML disfrazado. Esta sonda hace el mismo POST y parsea el archivo en
 * memoria con el parser candidato — el mismo que irá embebido en el userscript
 * final. Objetivo doble:
 *
 *   1. Validar que el parser aguanta un archivo real de Classroom Live.
 *   2. Descubrir el layout de la hoja: qué columna trae el COD_ALUM y cuál el
 *      nombre.
 *
 * ⚠ Hace UN POST: el mismo del botón Exportar. Lectura, no toca Importar, no
 * guarda nada en disco, no cambia de curso. Recarga la página (F5) al terminar.
 *
 * Uso: 801 cargado → F12 → Console → pegar → Enter → pegarme el JSON.
 */
(async () => {
  'use strict';

  const MASCARA_NOMBRES = true; // false si prefieres mandarme los nombres reales

  const lim = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const mask = (v) => {
    if (typeof v === 'number') return v;              // los números van intactos
    const t = lim(v);
    if (!MASCARA_NOMBRES) return t.slice(0, 120);
    return t.replace(/\p{L}{2,}/gu, (p) => p[0] + '·'.repeat(Math.min(p.length - 1, 6))).slice(0, 120);
  };

  // =========================================================================
  // PARTE 1 — Lector de contenedor OLE2 / CFB (Compound File Binary)
  // Un .xls es un mini sistema de archivos: hay que sacar el stream "Workbook".
  // =========================================================================

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

  // =========================================================================
  // PARTE 3 — Traer el archivo y analizarlo
  // =========================================================================

  const salida = { corridaEn: new Date().toISOString() };
  const form = document.forms.aspnetForm;
  if (!form) { console.error('No encuentro #aspnetForm'); return; }

  /* Los filtros en pantalla, sean los que sean. Esta sonda sirve para
     cualquier pantalla con un btnExportar: 1096 (planilla individual) y 1099
     (planillas por profesor) usan el mismo nombre de botón. */
  salida.filtrosEnPantalla = [...document.querySelectorAll('select')].map((s) => ({
    id: s.id, valor: s.value, texto: lim(s.selectedOptions[0]?.text), nOpciones: s.options.length,
  }));

  const lstCurso = document.getElementById('ctl00_ContentPlaceHolder1_lstCurso');
  if (lstCurso && lstCurso.value.trim() === '%') {
    console.warn('⚠ Tienes "< TODOS >" seleccionado en el curso. Carga uno y vuelve a correr esto.');
    return;
  }

  /* En ReporteCalificaMatrizProfesor.aspx el selector de profesor tiene 187
     opciones y "-1" significa TODOS. Exportar las planillas de 187 docentes es
     una acción muy distinta a exportar las tuyas, y no es algo que deba pasar
     por descuido en una sonda de reconocimiento. */
  const lstProfesor = document.getElementById('ctl00_ContentPlaceHolder1_lstProfesor');
  if (lstProfesor && String(lstProfesor.value).trim() === '-1') {
    console.warn('⚠ El selector de profesor está en "< TODOS >" (187 docentes). ' +
      'Seleccioná tu propio nombre y volvé a correr esto.');
    return;
  }
  if (lstProfesor) {
    console.log(`%cExportando las planillas de: ${lim(lstProfesor.selectedOptions[0]?.text)}`,
      'font-weight:bold');
  }

  const OMITIR = new Set(['submit', 'button', 'reset', 'image', 'file']);
  const params = new URLSearchParams();
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    const t = (el.type || '').toLowerCase();
    if (OMITIR.has(t)) continue;
    if ((t === 'checkbox' || t === 'radio') && !el.checked) continue;
    if (el.tagName === 'SELECT' && el.multiple) {
      for (const o of el.selectedOptions) params.append(el.name, o.value);
      continue;
    }
    params.append(el.name, el.value);
  }
  params.set('__EVENTTARGET', '');
  params.set('__EVENTARGUMENT', '');
  params.set('ctl00$ContentPlaceHolder1$btnExportar', 'Exportar');

  console.log('→ POST Exportar…');
  const r = await fetch(form.action, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  const buf = await r.arrayBuffer();
  salida.archivo = {
    contentDisposition: r.headers.get('content-disposition'),
    bytes: buf.byteLength,
  };

  try {
    const cfb = leerCFB(buf);
    salida.streams = cfb.entradas.map((e) => ({ nombre: e.nombre, tipo: e.tipo, bytes: e.tam }));

    const wb = cfb.entradas.find((e) => e.tipo === 2 && /^(Workbook|Book)$/i.test(e.nombre));
    if (!wb) throw new Error('No encuentro el stream Workbook/Book');

    const libro = parsearLibro(cfb.leerStream(wb));
    salida.libro = {
      versionBIFF: libro.versionBIFF,
      nombresHoja: libro.nombresHoja,
      sst: libro.sst,
      totalRegistros: libro.totalRegistros,
      tiposNoManejados: libro.tiposNoManejados,
      nHojas: libro.matrices.length,
    };

    const m = libro.matrices[0] || [];
    salida.hoja = {
      filas: m.length,
      columnas: m[0]?.length ?? 0,
      // Primeras filas completas, con nombres enmascarados y números intactos.
      primerasFilas: m.slice(0, 15).map((fila, i) => ({ f: i, celdas: fila.map(mask) })),
      ultimaFila: m.length ? { f: m.length - 1, celdas: m[m.length - 1].map(mask) } : null,
    };

    // ¿Qué columna trae el COD_ALUM? Contar celdas de exactamente 10 dígitos por columna.
    const nCols = salida.hoja.columnas;
    const perfil = [];
    for (let c = 0; c < nCols; c++) {
      let diez = 0, textos = 0, numeros = 0, vacias = 0;
      const ejemplos = [];
      for (const fila of m) {
        const v = fila[c];
        if (v == null || v === '') { vacias++; continue; }
        if (typeof v === 'number') numeros++; else textos++;
        const s = typeof v === 'number' ? String(Math.round(v)) : String(v).trim();
        if (/^\d{10}$/.test(s)) { diez++; if (ejemplos.length < 3) ejemplos.push(s); }
      }
      perfil.push({ col: c, diezDigitos: diez, numeros, textos, vacias, ejemplos });
    }
    salida.perfilColumnas = perfil;

    const mejor = perfil.slice().sort((a, b) => b.diezDigitos - a.diezDigitos)[0];
    salida.veredicto = mejor && mejor.diezDigitos > 0
      ? `COD_ALUM parece estar en la columna ${mejor.col} (${mejor.diezDigitos} coincidencias). Muestra: ${mejor.ejemplos.join(', ')}`
      : 'NINGUNA columna tiene valores de 10 dígitos — replantear.';
  } catch (e) {
    salida.errorParseo = String(e && e.stack ? e.stack : e);
    salida.primerosBytesHex = [...new Uint8Array(buf).slice(0, 32)]
      .map((b) => b.toString(16).padStart(2, '0')).join(' ');
  }

  const json = JSON.stringify(salida, null, 2);
  console.log('%c=== SONDA v4 — parseo del .xls ===', 'font-weight:bold;font-size:14px');
  console.log(salida);
  try {
    copy(json);
    console.log('%c✔ listo — JSON copiado al portapapeles (' + json.length + ' chars)', 'color:green;font-weight:bold');
  } catch (_) {
    console.log('%c⚠ Copia manual del texto de abajo:', 'color:orange;font-weight:bold');
    console.log(json);
  }
  console.log('%c↻ Recarga la página (F5) antes de seguir usándola.', 'color:#0aa;font-weight:bold');
  return salida;
})();
