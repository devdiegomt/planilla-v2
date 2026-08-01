/*
 * SONDA — Inventario del menú (Classroom Live Web)
 * ================================================
 *
 * Primer paso para mapear a qué llega tu usuario. Lee el menú de la página
 * actual y extrae todas las pantallas que ofrece, con su título, su id y la
 * sección a la que pertenecen.
 *
 * NO navega. NO hace click. NO envía nada. Solo lee el DOM que ya está.
 *
 * De dónde sale: el menú no usa URLs, llama a
 *     SessionEntrar(titulo, id, pageNum)
 * que escribe tres hidden y pulsa ctl00_btnsession. Los argumentos de esas
 * llamadas están en el HTML, así que el inventario se lee sin moverse de sitio.
 *
 * Uso: entrar a Classroom Live Web (la home sirve, cualquier página con menú
 * también) → F12 → Console → pegar → Enter → pegarme el JSON.
 */
(() => {
  'use strict';

  const lim = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const salida = { corridaEn: new Date().toISOString(), url: location.pathname };

  // --- 1. Todas las llamadas a SessionEntrar del documento ------------------
  // Se leen del HTML crudo para no depender de dónde estén colgadas.

  const RE_LLAMADA = /SessionEntrar\s*\(\s*(['"])([\s\S]*?)\1\s*,\s*(['"]?)([^,'"]*?)\3\s*,\s*(['"]?)([^)'"]*?)\5\s*\)/g;

  const porId = new Map();
  const registrar = (titulo, id, pageNum, extra) => {
    const clave = String(id).trim();
    if (!porId.has(clave)) {
      porId.set(clave, { id: clave, titulo: lim(titulo), pageNum: lim(pageNum), ...extra });
    } else if (extra && extra.seccion && !porId.get(clave).seccion) {
      Object.assign(porId.get(clave), extra);
    }
  };

  // 1a. Recorriendo elementos, que además dan la jerarquía del menú.
  for (const elemento of document.querySelectorAll('[onclick], [href]')) {
    const fuente = (elemento.getAttribute('onclick') || '') + ' ' + (elemento.getAttribute('href') || '');
    if (!/SessionEntrar/.test(fuente)) continue;

    RE_LLAMADA.lastIndex = 0;
    const m = RE_LLAMADA.exec(fuente);
    if (!m) continue;

    // La sección es el encabezado del submenú que contiene al enlace.
    let seccion = null;
    let n = elemento.parentElement;
    for (let i = 0; i < 8 && n && !seccion; i++, n = n.parentElement) {
      if (n.tagName === 'UL' || n.tagName === 'LI') {
        const cab = n.previousElementSibling || n.parentElement?.querySelector(':scope > a, :scope > span');
        const t = lim(cab?.textContent).slice(0, 60);
        // Un encabezado útil no es el texto del propio enlace.
        if (t && t !== lim(elemento.textContent)) seccion = t;
      }
    }

    registrar(m[2], m[4], m[6], {
      seccion,
      texto: lim(elemento.textContent).slice(0, 80),
      tag: elemento.tagName.toLowerCase(),
      visible: !!(elemento.offsetParent || elemento.getClientRects().length),
    });
  }

  // 1b. Barrido del HTML completo, por si alguna llamada vive en un script
  // en línea y no colgada de un elemento.
  RE_LLAMADA.lastIndex = 0;
  const html = document.documentElement.innerHTML;
  for (let m; (m = RE_LLAMADA.exec(html));) registrar(m[2], m[4], m[6], { soloEnHtml: true });

  salida.pantallas = [...porId.values()]
    .sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
  salida.totalPantallas = salida.pantallas.length;

  // --- 2. Secciones del menú, para ver la estructura -----------------------

  const menu = document.getElementById('main-menu-navigation');
  salida.menu = menu ? {
    id: menu.id,
    ramas: [...menu.children].slice(0, 40).map((li) => ({
      texto: lim(li.querySelector(':scope > a, :scope > span')?.textContent).slice(0, 60),
      hijos: [...li.querySelectorAll(':scope ul li')].slice(0, 40)
        .map((h) => lim(h.textContent).slice(0, 60)).filter(Boolean),
    })),
  } : null;

  // --- 3. Enlaces que NO pasan por SessionEntrar ---------------------------
  // Si los hay, esas pantallas sí admiten deep-link y son más fáciles de leer.

  salida.enlacesDirectos = [...document.querySelectorAll('a[href]')]
    .map((a) => a.getAttribute('href'))
    .filter((h) => /\.aspx/i.test(h) && !/^javascript:/i.test(h))
    .filter((h, i, arr) => arr.indexOf(h) === i)
    .slice(0, 40);

  // --- 4. Qué usuario es y qué ve -----------------------------------------

  const valorDe = (id) => document.getElementById(id)?.value ?? null;
  salida.contexto = {
    tipoUsuario: valorDe('ctl00_hfTipUsu'),
    titulo: document.title,
    // Útil para saber si el menú cambia según el rol.
    anchorsTotales: document.querySelectorAll('a').length,
  };

  // --- 5. Entrega ----------------------------------------------------------

  const json = JSON.stringify(salida, null, 2);
  console.log('%c=== INVENTARIO DEL MENÚ ===', 'font-weight:bold;font-size:14px');
  console.table(salida.pantallas.map(({ id, titulo, seccion }) => ({ id, titulo, seccion })));
  console.log(salida);
  try {
    copy(json);
    console.log(`%c✔ ${salida.totalPantallas} pantallas — JSON copiado al portapapeles`, 'color:green;font-weight:bold');
  } catch (_) {
    console.log('%c⚠ Copia manual del texto de abajo:', 'color:orange;font-weight:bold');
    console.log(json);
  }
  console.log('%cNo navegó, no hizo click, no envió nada.', 'color:#0aa');
  return salida;
})();
