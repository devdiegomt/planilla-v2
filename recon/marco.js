/*
 * El marco: lo que hace innecesario Tampermonkey para el flujo completo.
 *
 * PROBLEMA. Un favorito se inyecta una vez y muere en la siguiente recarga. El
 * flujo completo de la asistencia recorre el filtro —fecha, hora, curso,
 * asignatura— y cada paso es un postback que recarga la página, así que el
 * favorito no llega ni al segundo paso. Por eso hasta hoy había que elegir los
 * cuatro filtros a mano y usar "Solo marcar"; y con eso, marcar la asistencia
 * en planilla-app no le ahorraba tiempo a nadie.
 *
 * QUÉ HACE TAMPERMONKEY, EN REALIDAD. Reinyectar el script en cada carga. Eso
 * es todo. No hay magia que dependa de la extensión.
 *
 * QUÉ HACE ESTO. Lo mismo, sin extensión: mete la plataforma en un iframe del
 * mismo origen y reinyecta el script en cada carga DE ADENTRO. El que navega
 * es el iframe —una página de verdad, con sus scripts y su Guardar vivos— y el
 * marco, que vive arriba, no se recarga nunca.
 *
 * Con `fetch` no servía: la asistencia tiene que ACABAR en una pantalla de
 * verdad porque el docente revisa y pulsa Guardar, y reemplazar el HTML a mano
 * no vuelve a ejecutar los scripts — `__doPostBack` quedaría muerto y el
 * Guardar no haría nada. La pantalla se vería bien. Ese es el peor fallo.
 *
 * Medido con `recon/sonda-iframe.js` el 26/09/2026 contra la pantalla de
 * asistencia: sin `X-Frame-Options` ni `frame-ancestors`, el documento de
 * adentro se lee desde afuera, adentro viven el formulario, el `__VIEWSTATE` y
 * `__doPostBack`, y una recarga de adentro deja intacto al script de afuera.
 *
 * === LO QUE EL MARCO NO HACE ===
 *
 *   - No toca ningún control de la plataforma. No llama a `__doPostBack`, no
 *     envía formularios, no pulsa nada. Solo crea el iframe e inyecta.
 *   - No cambia NADA del script que inyecta: va tal cual, byte a byte.
 *   - No enmarca otra cosa que la dirección que ya tenés abierta.
 *   - No inyecta si el iframe no es del mismo origen: ahí se detiene y lo dice,
 *     en vez de fallar más adelante por un motivo que no se entiende.
 */
(function () {
  'use strict';

  // FUENTE la define el generador justo antes de esto. Se comprueba para no
  // abrir un marco vacío que parezca que algo va a pasar.
  if (typeof FUENTE !== 'string' || !FUENTE) {
    alert('Este favorito salió mal: no trae el script adentro.');
    return;
  }

  const ID = 'gla-marco';
  const viejo = document.getElementById(ID);
  if (viejo) { viejo.remove(); return; }   // pulsarlo otra vez lo cierra

  const caja = document.createElement('div');
  caja.id = ID;
  caja.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#111;'
    + 'display:flex;flex-direction:column';

  const barra = document.createElement('div');
  barra.style.cssText = 'flex:0 0 auto;display:flex;align-items:center;gap:10px;'
    + 'padding:6px 10px;background:#111;color:#fff;'
    + 'font:13px/1.4 system-ui,sans-serif';
  barra.innerHTML = '<strong>Asistencia GLA</strong>'
    + '<span style="opacity:.75">La plataforma va aquí dentro. Revisá y guardá '
    + 'como siempre, sin salir.</span>';

  const cerrar = document.createElement('button');
  cerrar.type = 'button';
  cerrar.textContent = 'Cerrar';
  cerrar.style.cssText = 'margin-left:auto;padding:3px 10px;border-radius:6px;'
    + 'border:1px solid #666;background:#222;color:#fff;cursor:pointer';
  cerrar.onclick = () => caja.remove();
  barra.appendChild(cerrar);

  const ifr = document.createElement('iframe');
  ifr.style.cssText = 'flex:1 1 auto;width:100%;border:0;background:#fff';
  // Solo la dirección que ya está abierta. El script sabe llegar solo desde la
  // portada a la pantalla de asistencia; no hace falta adivinar una ruta acá.
  ifr.src = location.href;

  caja.appendChild(barra);
  caja.appendChild(ifr);
  document.body.appendChild(caja);

  let avisado = false;

  /*
   * Reinyectar en CADA carga de adentro. Es exactamente lo que hace la
   * extensión, y es lo único que el script necesita para completar su
   * recorrido: su estado vive en `sessionStorage`, que es del mismo origen, así
   * que sobrevive las recargas del iframe y el script retoma donde iba.
   */
  ifr.addEventListener('load', () => {
    let doc;
    try {
      doc = ifr.contentDocument;
      if (!doc) throw new Error('sin documento');
    } catch (e) {
      if (!avisado) {
        avisado = true;
        barra.insertAdjacentHTML('beforeend',
          '<span style="color:#ffb4b4;margin-left:10px">No puedo entrar al marco: '
          + 'la página de adentro es de otro origen. Cerrá esto y usá el camino de '
          + 'siempre.</span>');
      }
      return;
    }
    try {
      // La marca le dice al script que alguien lo va a reinyectar, que es lo
      // único que necesita saber para animarse al recorrido completo.
      ifr.contentWindow.__glaMarco = true;
      const s = doc.createElement('script');
      s.textContent = FUENTE;
      (doc.head || doc.documentElement).appendChild(s);
      s.remove();
    } catch (e) {
      console.error('[marco] no pude inyectar:', e);
    }
  });
})();
