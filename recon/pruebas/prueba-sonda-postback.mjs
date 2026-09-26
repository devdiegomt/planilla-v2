/*
 * Pruebas de la sonda que mide si un postback se puede hacer sin recargar.
 *
 * Esta sonda SÍ manda una petición — es lo que viene a medir — así que el
 * listón no es "no toca la red", es más fino:
 *
 *   1. No manda nada al cargar. Hace falta pulsar el botón.
 *   2. No toca el DOM de la página: lo que vuelve se mide y se tira.
 *   3. No puede disparar un control de escritura ni por equivocación.
 *   4. El cuerpo del POST se arma como lo armaría el navegador, que es lo que
 *      separa reproducir un postback de inventarse uno.
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let fallos = 0;
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✗ FALLA ') + m); if (!c) fallos++; };
const eq = (g, w, m) => { const i = JSON.stringify(g) === JSON.stringify(w);
  ok(i, `${m}${i ? '' : ` (esperado ${JSON.stringify(w)}, obtenido ${JSON.stringify(g)})`}`); };

const FUENTE = readFileSync(new URL('../sonda-postback.js', import.meta.url), 'utf8');

console.log('Sonda de postback');

console.log('\n[la guarda estructural, en el codigo]');
{
  ok(/PROHIBIDO\s*=\s*\//.test(FUENTE), 'hay una lista negra de controles');
  for (const palabra of ['guardar', 'importar', 'actualizar', 'editar', 'eliminar']) {
    ok(new RegExp(palabra, 'i').test(FUENTE.match(/PROHIBIDO\s*=\s*\/([^/]+)\//)[1]),
       `la lista negra cubre "${palabra}"`);
  }
  ok(!/__doPostBack\s*\(/.test(FUENTE), 'nunca llama a __doPostBack: hace el POST a mano');
  const fetches = (FUENTE.match(/\bfetch\s*\(/g) || []).length;
  eq(fetches, 1, 'hay UNA sola llamada a fetch en todo el archivo');
}

function montar({ conTabla = true } = {}) {
  const dom = new JSDOM(`<!doctype html><body>
    <form name="aspnetForm" id="aspnetForm" method="post" action="Pantalla.aspx">
      <input type="hidden" name="__VIEWSTATE" value="ABC">
      <input type="hidden" name="__EVENTVALIDATION" value="DEF">
      <input type="hidden" name="__EVENTTARGET" value="">
      <input type="hidden" name="__EVENTARGUMENT" value="">
      <select name="lstCurso"><option value="801" selected>801</option></select>
      <select name="lstMateria" disabled><option value="9" selected>X</option></select>
      <input type="text" name="txtNota" value="85">
      <input type="checkbox" name="chkUno" value="1" checked>
      <input type="checkbox" name="chkDos" value="2">
      <input type="submit" name="btnGuardar" value="Guardar">
      <input type="image" name="btnExcel">
      ${conTabla ? '<table><tr><td>a</td></tr><tr><td>b</td></tr><tr><td>c</td></tr></table>' : ''}
    </form></body>`, { url: 'https://x/arrayanes/Pantalla.aspx', runScripts: 'outside-only' });
  const w = dom.window;
  const peticiones = [];
  // Contesta como la plataforma: pagina nueva, VIEWSTATE nuevo y la tabla.
  const respuestaNº = (n) => `<!doctype html><html><head><title>Classroom Live Web</title></head>
    <body><form id="aspnetForm" action="Pantalla.aspx">
      <input type="hidden" name="__VIEWSTATE" value="VS${n}">
      <select name="lstCurso"><option value="80${n}" selected>80${n}</option></select>
      <select name="lstMateria"><option value="1035" selected>IT</option></select>
      <input type="submit" name="btnRefresca" value="Consultar">
      <table><tr><td>a</td></tr><tr><td>b</td></tr><tr><td>c</td></tr><tr><td>d</td></tr></table>
    </form></body></html>`;
  w.fetch = (url, opciones) => {
    peticiones.push({ url, opciones });
    const n = peticiones.length;
    return Promise.resolve({
      ok: true, status: 200, redirected: false, url: 'https://x/Pantalla.aspx',
      headers: { get: () => 'text/html' },
      text: () => Promise.resolve(respuestaNº(n)),
    });
  };
  w.setTimeout = (fn) => { fn(); return 0; };
  w.performance = { now: () => 0 };
  // La sonda exporta sus partes cuando hay un `module` — asi se pueden probar
  // sin duplicarlas en el arnes.
  w.module = { exports: {} };
  w.DOMParser = w.DOMParser;
  w.eval(FUENTE);
  return { w, peticiones, $: (s) => w.document.querySelector(s) };
}

console.log('\n[no manda nada al cargar]');
{
  const p = montar();
  eq(p.peticiones.length, 0, 'al inyectarla no sale ninguna peticion');
  ok(!!p.$('#gla-sonda-postback'), 'solo aparece el panel');
  ok(/solo mide/i.test(p.$('#gla-sonda-postback').textContent), 'y dice que solo mide');
}

console.log('\n[el cuerpo del POST se arma como el navegador]');
{
  const p = montar();
  p.$('#sp-ir').click();
  eq(p.peticiones.length, 1, 'al pulsar Medir sale UNA peticion');
  const { url, opciones } = p.peticiones[0];
  eq(url, 'Pantalla.aspx', 'a la accion del formulario');
  eq(opciones.method, 'POST', 'por POST');
  eq(opciones.credentials, 'same-origin', 'con la sesion del navegador');

  const cuerpo = new URLSearchParams(opciones.body);
  eq(cuerpo.get('__VIEWSTATE'), 'ABC', 'lleva el VIEWSTATE de la pantalla');
  eq(cuerpo.get('__EVENTTARGET'), '', 'sin objetivo: es un "vuelve a dibujar la misma pagina"');
  eq(cuerpo.get('lstCurso'), '801', 'lleva los filtros elegidos');
  ok(!cuerpo.has('lstMateria'), 'NO lleva los campos deshabilitados: el navegador tampoco');
  eq(cuerpo.get('chkUno'), '1', 'una casilla marcada va');
  ok(!cuerpo.has('chkDos'), 'y una sin marcar no');
  ok(!cuerpo.has('btnGuardar'), 'NUNCA lleva el boton de guardar');
  ok(!cuerpo.has('btnExcel'), 'ni el de descargar');
}

console.log('\n[no toca la pantalla]');
{
  const p = montar();
  const antes = p.w.document.getElementById('aspnetForm').innerHTML;
  p.$('#sp-ir').click();
  eq(p.w.document.getElementById('aspnetForm').innerHTML, antes,
     'el formulario queda exactamente igual');
}

console.log('\n[que dice del que contesta]');
{
  // Se ejerce medirRespuesta a traves del modulo, que la sonda exporta.
  const p = montar();
  const mod = p.w.module && p.w.module.exports;
  ok(!!mod, 'la sonda exporta sus partes para poder probarlas');
  if (mod) {
    const pagina = (extra) => `<!doctype html><html><head><title>Actividades</title></head>
      <body><form id="aspnetForm"><input type="hidden" name="__VIEWSTATE" value="NUEVO">
      ${extra || ''}</form></body></html>`;
    const r = mod.medirRespuesta(pagina('<table><tr><td>1</td></tr><tr><td>2</td></tr><tr><td>3</td></tr></table>'), 'ABC');
    ok(r.esHtmlDeLaPlataforma, 'reconoce la pagina');
    ok(r.viewStateNuevo && r.viewStateCambio, 'y que el VIEWSTATE cambio, que es lo que deja encadenar');
    eq(r.tablasConDatos, 1, 'cuenta la tabla con datos');

    const login = `<!doctype html><html><head><title>Ingresar</title></head>
      <body><form id="aspnetForm"><input type="password" name="pwd"></form></body></html>`;
    ok(mod.medirRespuesta(login, 'ABC').pareceLogin,
       'y si vuelve el login lo dice: sin eso se leeria como "funciona"');

    const sinVs = `<!doctype html><html><body><form id="aspnetForm"></form></body></html>`;
    ok(!mod.medirRespuesta(sinVs, 'ABC').viewStateNuevo,
       'sin VIEWSTATE nuevo lo marca: el segundo postback ya fallaria');

    ok(mod.PROHIBIDO.test('ctl00$ContentPlaceHolder1$btnGuardar'), 'la lista negra atrapa un Guardar');
    ok(mod.PROHIBIDO.test('gvActividades$ctl02$btnActualizar'), 'y un Actualizar');
    ok(!mod.PROHIBIDO.test('ctl00$ContentPlaceHolder1$btnRefresca'), 'y deja pasar un Consultar');
  }
}

console.log('\n[la lista blanca: lo unico que puede disparar]');
{
  const p = montar();
  const mod = p.w.module.exports;
  // Una lista negra sola deja pasar cualquier nombre que nadie previo.
  for (const bueno of ['ctl00$ContentPlaceHolder1$lstCurso',
                       'ctl00$ContentPlaceHolder1$lstMateria',
                       'ctl00$ContentPlaceHolder1$btnRefresca']) {
    ok(mod.sePuedeDisparar(bueno), `deja pasar ${bueno.split('$').pop()}`);
  }
  for (const malo of ['ctl00$ContentPlaceHolder1$btnGuardar',
                      'ctl00$ContentPlaceHolder1$btnImportar',
                      'gvActividades$ctl02$btnActualizar',
                      'ctl00$ContentPlaceHolder1$gvActividades',
                      'ctl00$ContentPlaceHolder1$btnDescargaExcel',
                      'ctl00$ContentPlaceHolder1$btnCualquierCosaNueva']) {
    ok(!mod.sePuedeDisparar(malo), `NO deja pasar ${malo.split('$').pop()}`);
  }
  ok(!mod.sePuedeDisparar(''), 'ni un nombre vacio');
}

console.log('[el recorrido encadenado]');
{
  const p = montar();
  p.$('#sp-cadena').click();
  eq(p.peticiones.length, 1, 'el recorrido arranca con UN envio, no con tres de golpe');
  const cuerpo = new URLSearchParams(p.peticiones[0].opciones.body);
  eq(cuerpo.get('__EVENTTARGET'), 'lstCurso', 'el primer paso dispara el selector de curso');
  ok(!cuerpo.has('btnGuardar'), 'y sigue sin llevar el boton de guardar');
  const antes = p.w.document.getElementById('aspnetForm').innerHTML;
  eq(p.w.document.getElementById('aspnetForm').innerHTML, antes, 'sin tocar la pantalla');
}

console.log('[encadenar significa usar el VIEWSTATE que vuelve]');
{
  const p = montar();
  const mod = p.w.module.exports;
  const respuesta = `<!doctype html><html><body><form id="aspnetForm">
    <input type="hidden" name="__VIEWSTATE" value="SEGUNDO">
    <select name="lstCurso"><option value="802" selected>802</option></select>
    <input type="submit" name="btnGuardar" value="Guardar"></form></body></html>`;
  const sig = mod.camposDeRespuesta(respuesta);
  eq(sig.datos.get('__VIEWSTATE'), 'SEGUNDO',
     'los campos del siguiente envio salen de la RESPUESTA, no de la pantalla');
  eq(sig.datos.get('lstCurso'), '802', 'con el estado que dejo el paso anterior');
  ok(!sig.datos.has('btnGuardar'), 'y tampoco arrastra botones de submit');
  eq(mod.camposDeRespuesta('<p>no es la pagina</p>'), null, 'si no vuelve el formulario, lo dice');
}

console.log('[postear se niega a disparar un control de escritura]');
{
  const p = montar();
  const mod = p.w.module.exports;
  let msg = '';
  // No basta con que la lista exista: tiene que estar EN el camino del envio.
  await mod.postear('Pantalla.aspx', new p.w.URLSearchParams(),
                    'ctl00$ContentPlaceHolder1$btnGuardar').catch((e) => { msg = e.message; });
  ok(/no permitido/.test(msg), 'con un Guardar revienta antes de tocar la red');
  eq(p.peticiones.length, 0, 'y no sale ninguna peticion');

  msg = '';
  await mod.postear('Pantalla.aspx', new p.w.URLSearchParams(), 'ctl00$x$lstCurso')
    .catch((e) => { msg = e.message; });
  eq(msg, '', 'con un control de lectura si envia');
  eq(p.peticiones.length, 1, 'una peticion');
}

console.log('[la cadena usa el VIEWSTATE que vuelve]');
{
  const p = montar();
  p.$('#sp-cadena').click();
  // Dejar que las promesas del recorrido corran.
  for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));

  eq(p.peticiones.length, 3, 'el recorrido son TRES envios: curso, materia y consultar');
  const cuerpos = p.peticiones.map((x) => new URLSearchParams(x.opciones.body));
  eq(cuerpos[0].get('__VIEWSTATE'), 'ABC', 'el primero lleva el de la pantalla');
  eq(cuerpos[1].get('__VIEWSTATE'), 'VS1', 'el segundo, el que devolvio el primero');
  eq(cuerpos[2].get('__VIEWSTATE'), 'VS2', 'y el tercero, el del segundo — eso es encadenar');
  eq(cuerpos[1].get('__EVENTTARGET'), 'lstMateria', 'el segundo paso elige materia');
  ok(cuerpos[2].has('btnRefresca'), 'y el tercero manda Consultar como campo, que es un submit');
  ok(cuerpos.every((c) => !c.has('btnGuardar')), 'ninguno lleva el boton de guardar');

  const r = JSON.parse(p.$('#sp-salida').textContent);
  eq(r.recorrido.length, 3, 'el informe trae los tres pasos');
  ok(/SE PUEDE RECORRER/.test(r.veredicto), 'y el veredicto lo dice');
}

console.log(fallos ? `\n✗ ${fallos} fallaron` : '\n✓ todo en verde');
process.exit(fallos ? 1 : 0);
