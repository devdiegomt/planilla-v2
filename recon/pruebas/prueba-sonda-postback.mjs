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
  w.fetch = (url, opciones) => { peticiones.push({ url, opciones }); return new Promise(() => {}); };
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

console.log(fallos ? `\n✗ ${fallos} fallaron` : '\n✓ todo en verde');
process.exit(fallos ? 1 : 0);
