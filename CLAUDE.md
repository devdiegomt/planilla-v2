# planilla-v2 — contexto para Claude

Userscripts (Tampermonkey) y herramientas locales de Diego Mayorga, docente de
informática del Colegio GLA, sobre la plataforma del colegio **Classroom Live Web**
(ASP.NET WebForms, postbacks con `__VIEWSTATE`). Complementa a **planilla-app**
(`devdiegomt/planilla-app`), la app donde lleva notas y asistencia.

## Qué hay

| Archivo | Qué hace | Escribe en la plataforma |
| --- | --- | --- |
| `codalum-extractor.user.js` | Extrae el COD_ALUM de los 19 cursos a un JSON. Modo rápido: un solo `.xls` de "planillas por profesor" (19 hojas). | No |
| `asistencia-autofill.user.js` | Marca la asistencia diaria desde un JSON, con dry-run. | Solo si Diego pulsa Guardar |
| `inventario-plataforma.user.js` | Recorre las pantallas del menú y captura su estructura. | No |
| `historial-extractor.user.js` | Recorre `ConsCalificaDocentesGen` (24) y saca la **definitiva** de cada estudiante por periodo. Es la única fuente de T1 y T2. | No |
| `verificar-planilla.mjs` | Compara un Califica descargado contra el generado por la app. Código 0 = se puede subir, 1 = bloqueante. | No (local) |
| `recon/sonda-csp.js` | Mide si la CSP de la plataforma deja correr un bookmarklet, para saber si Tampermonkey se puede reemplazar. | No |
| `recon/sonda-conscalifica.js` | Lee el DOM de `ConsCalificaDocentesGen` (24), la única pantalla con los cuatro periodos, para saber qué entrega antes de escribir el extractor. | No |
| `recon/sonda-pantalla.js` | **Sonda genérica**: lee el DOM de cualquier pantalla y dice qué filtros tiene, si hay tabla de datos, si aparece el COD_ALUM y **si la pantalla escribe**. La que hay que usar para una pantalla nueva. | No |
| `recon/hacer-bookmarklet.mjs` | Convierte un script en un favorito arrastrable. Genera el de la sonda y el del autofill. | No |
| `recon/` | Sondas de reconocimiento y pruebas. | — |

READMEs por herramienta: `README.md`, `README-asistencia.md`, `README-inventario.md`,
`README-verificador.md`, `README-historial.md`; datos disponibles en `CATALOGO.md`.

## Reglas de seguridad (no negociables)

- **Nunca enviar `btnImportar`** ni ningún control de escritura en los POST. El único
  camino de escritura automatizado es la asistencia, y se detiene antes de guardar.
- Nunca disparar peticiones al cargar la página sin un clic de Diego (nada de reanudar
  solo). Una petición en vuelo a la vez, con espera entre posts.
- Exportar "planillas por profesor" solo con el propio docente seleccionado; `-1`
  (TODOS) se rechaza.
- **Datos de estudiantes (menores):** nunca commitear `.xls`, `.json` ni capturas con
  nombres o códigos reales. Las pruebas usan archivos generados.

## Cómo trabajar

- Español (los READMEs usan voseo). Scripts de un archivo, sin dependencias ni build.
- El parser OLE2/BIFF8 vive embebido en `codalum-extractor.user.js`; las pruebas y el
  verificador lo **recortan en tiempo de ejecución** de ese archivo. No duplicarlo: si
  se cambia, correr las pruebas que detectan desincronización.
- Pruebas: `npm install` (jsdom) y `npm test`. Requiere `python3` (o `python` en
  Windows) con `xlwt` (`pip install xlwt`) para generar los `.xls` de prueba.
  `npm test` corre `recon/pruebas/correr.mjs`, que no lleva lista: corre **todo**
  `prueba-*.mjs` de esa carpeta, así que una prueba nueva entra sola por existir.
  Antes era una cadena de `&&` con los archivos nombrados uno por uno, y eso se
  quedó viejo sin avisar: la copia local de Windows —que había que reescribir
  porque `python3` y `>/dev/null` no existen ahí— siguió con la lista de tres
  commits atrás y dejó sin correr las pruebas del bookmarklet y de las sondas,
  justo las que comprueban que los scripts no escriban en la plataforma. El
  `npm test` decía "todo verde" igual.
- Git: igual que en planilla-app. Nunca commitear sin que Diego lo pida; cuando lo pide,
  rama nueva, push, y él mergea el PR.

## Reemplazar Tampermonkey — confirmado que se puede

Instalar Tampermonkey, pegar un script y activar "Permitir user scripts" es el
muro más alto para que otro docente use esto, y muchos colegios bloquean
extensiones. Un **bookmarklet** (favorito con código) se instala arrastrándolo.

**Medido el 16/09/2026** con `recon/sonda-csp.js` en la pantalla de asistencia
(`AsistenciaAsignaturaAusenciaDia.aspx`, Chrome 152):

- **Esa página no tiene CSP.** Cero violaciones, ningún `<meta>`, y tanto
  inyectar un `<script>` como `eval` funcionan.
- **El bookmarklet corrió** — devolvió el JSON, que es la prueba.
- Traer un script desde planilla-app falló, pero **no fue la CSP** (no hubo
  violación): es CORS o la red del colegio. Por eso el favorito lleva el script
  embebido, que además no depende de que la app esté accesible.

**La limitación, que es de diseño y no se arregla:** el "flujo completo" recorre
el filtro y cada paso hace un postback que recarga la página. Un userscript se
reinyecta en cada carga; un favorito no. Por eso, como bookmarklet se elige hora,
curso y asignatura a mano y se usa **"Solo marcar"**, que no navega hasta el
guardado y verifica que la pantalla coincida con el JSON antes de marcar.

El autofill es `@grant none` —no usa APIs de Tampermonkey— así que el mismo
archivo sirve de userscript y de favorito. `GM_info` solo se usa para detectar
cuál de los dos es y avisar; `npm test` comprueba que no se dependa de nada más.

Los HTML arrastrables están generados (`node recon/hacer-bookmarklet.mjs`) y
`npm test` avisa si quedaron desincronizados de su script.

## Datos de la plataforma que ya se confirmaron

- El Califica es OLE2/BIFF8 real (`d0 cf 11 e0`), no HTML disfrazado.
- COD_ALUM: 10 dígitos que empiezan por el año de matrícula; distinto del número de las fotos.
- `cod_mat` por grado: 2508, 2509, 2510, y **3011** para 11°.
- La pantalla "planillas por profesor" **sí acepta importar** el archivo de 19 hojas
  (confirmado por Diego en septiembre de 2026).
