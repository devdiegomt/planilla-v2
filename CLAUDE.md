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
| `actividades-extractor.user.js` | Saca de la matriz (831) el **porcentaje de cada logro**, por grado. Es lo que en planilla-app está fijo en `SLOTS_*` y ata la app a una sola materia. **Nunca pulsa Editar.** | No |
| `actividades-autofill.user.js` | **Llena** la matriz (831) con el plan que arma planilla-app: título, porcentaje, ciclo y destino. Fila por fila, y solo donde la pantalla coincide con lo que el plan dice que hay. | **Sí**, al pulsar Aplicar |
| `verificar-planilla.mjs` | Compara un Califica descargado contra el generado por la app. Código 0 = se puede subir, 1 = bloqueante. | No (local) |
| `recon/sonda-csp.js` | Mide si la CSP de la plataforma deja correr un bookmarklet, para saber si Tampermonkey se puede reemplazar. | No |
| `recon/sonda-conscalifica.js` | Lee el DOM de `ConsCalificaDocentesGen` (24), la única pantalla con los cuatro periodos, para saber qué entrega antes de escribir el extractor. | No |
| `recon/sonda-postback.js` | Mide si un postback se puede hacer con `fetch` **sin recargar la página**. Es lo que decide si Tampermonkey sigue siendo obligatorio para los scripts que recorren. | No |
| `recon/sonda-pantalla.js` | **Sonda genérica**: lee el DOM de cualquier pantalla y dice qué filtros tiene, si hay tabla de datos, si aparece el COD_ALUM y **si la pantalla escribe**. La que hay que usar para una pantalla nueva. | No |
| `recon/hacer-bookmarklet.mjs` | Convierte un script en un favorito arrastrable. Genera el de la sonda y el del autofill. | No |
| `recon/` | Sondas de reconocimiento y pruebas. | — |

READMEs por herramienta: `README.md`, `README-asistencia.md`, `README-inventario.md`,
`README-verificador.md`, `README-historial.md`, `README-matriz.md`; datos disponibles
en `CATALOGO.md`.

## Reglas de seguridad (no negociables)

- **Nunca enviar `btnImportar`** ni ningún control de escritura en los POST.
- **Los caminos de escritura son dos, y cada uno se decidió aparte.** La asistencia,
  que se detiene antes de guardar; y la matriz de actividades (`actividades-autofill`,
  decidido con Diego el 24/09/2026), que sí guarda pero solo cuando él pulsa "Aplicar",
  y una vez por curso. Un camino nuevo no sale de "ya que estamos": se pregunta.
- **Lo que hace segura la escritura de la matriz** no es el permiso, son cuatro cosas:
  **nunca crea filas** (solo edita las que ya existen; la pantalla trae ocho casillas
  por categoría usadas o no, así que estrenar una actividad es llenar una que ya está);
  **verifica antes de escribir** (el plan trae lo que la app cree que hay hoy en cada
  fila, y si la pantalla dice otra cosa esa fila no se toca — la posición sola no es
  identidad); **nunca inventa un id** (los tres identificadores de la fila se leen de
  la propia fila y se devuelven tal cual); y **una sola llamada a `__doPostBack`** con
  lista blanca de control y de comando (`Edit$N` y `Update$N` de la tabla, nada más).
  `npm test` comprueba las cuatro, y que romperlas se note.
- Nunca disparar peticiones al cargar la página sin un clic de Diego (nada de reanudar
  solo). Una petición en vuelo a la vez, con espera entre posts.
- Exportar "planillas por profesor" solo con el propio docente seleccionado; `-1`
  (TODOS) se rechaza.
- **Datos de estudiantes (menores):** nunca commitear `.xls`, `.json` ni capturas con
  nombres o códigos reales. Las pruebas usan archivos generados.
- **Tampoco los de los colegas.** `lstFilProfesor` (planeador) trae los 203 docentes con
  nombre completo. Las sondas enmascaran los textos de cualquier lista de más de 25
  opciones: los ids alcanzan para armar un filtro y no identifican a nadie.
- **Ninguna pantalla que escribe se automatiza sin decidirlo aparte.** La matriz (831)
  escribe fila por fila con "Editar" → "Actualizar"; el extractor de actividades **no
  pulsa ninguno de los dos** y lee el porcentaje del texto de la fila sin editar.

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

**La limitación:** el "flujo completo" recorre el filtro y cada paso hace un
postback que recarga la página. Un userscript se reinyecta en cada carga; un
favorito no. Por eso, como bookmarklet se elige hora, curso y asignatura a mano
y se usa **"Solo marcar"**, que no navega hasta el guardado y verifica que la
pantalla coincida con el JSON antes de marcar. Lo mismo deja fuera al extractor
de actividades, al de historial y al autofill de la matriz, que recorren.

**Pero la limitación vale mientras el postback NAVEGUE**, y eso está sin medir.
WebForms manda el formulario entero por POST y devuelve la página entera; si ese
mismo envío se hace con `fetch` y el DOM se actualiza con lo que vuelve, la
página nunca se recarga y el favorito no muere — es lo que hace un UpdatePanel.
`recon/sonda-postback.js` lo mide, y **el 26/09/2026 dio que SÍ**: sobre la
matriz (831), 200 en 177 ms, sin redirect, sin login, con `__VIEWSTATE` nuevo y
la tabla de 34 filas de vuelta. El estado de los filtros sobrevive, porque los
`<select>` viajan como campos. Ver `CATALOGO.md`.
La sonda **no implementa** el mecanismo: manda envíos de lectura, los mide y los
tira, sin tocar el DOM. Tiene lista negra (Guardar, Importar, Actualizar,
Editar, Eliminar) **y lista blanca** (`lst*`, `ddl*`, `btnRefresca`): con la
negra sola, un control nuevo que nadie previó pasaría.
**Lo que falta medir** es del lado del cliente: que reemplazar el DOM con la
respuesta deje la página funcionando. El servidor, que era lo que podía matar la
idea de un plumazo, colabora.

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
