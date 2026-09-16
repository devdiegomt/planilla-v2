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
| `verificar-planilla.mjs` | Compara un Califica descargado contra el generado por la app. Código 0 = se puede subir, 1 = bloqueante. | No (local) |
| `recon/sonda-csp.js` | Mide si la CSP de la plataforma deja correr un bookmarklet, para saber si Tampermonkey se puede reemplazar. | No |
| `recon/` | Sondas de reconocimiento y pruebas. | — |

READMEs por herramienta: `README.md`, `README-asistencia.md`, `README-inventario.md`,
`README-verificador.md`; datos disponibles en `CATALOGO.md`.

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
- Pruebas: `npm install` (jsdom) y `npm test`. Requiere `python3` con `xlwt`
  (`pip install xlwt`) para generar los `.xls` de prueba.
- Git: igual que en planilla-app. Nunca commitear sin que Diego lo pida; cuando lo pide,
  rama nueva, push, y él mergea el PR.

## Reemplazar Tampermonkey (en evaluación)

Instalar Tampermonkey, pegar un script y activar "Permitir user scripts" es el
muro más alto para que otro docente use esto — y muchos colegios bloquean
extensiones por política. La alternativa es un **bookmarklet**: un favorito con
código, que se instala arrastrándolo a la barra.

Si la CSP de la plataforma lo permite o no lo dice `recon/sonda-csp.js`. La
pregunta no es una sola: el autofill pesa ~48 KB, así que un bookmarklet no
puede llevarlo adentro sin más — tendría que cargarlo, y eso es lo primero que
una CSP corta. La sonda mide por separado si corre código en línea, si corre
`eval`, si deja traer un script de planilla-app y si deja hablar con ella, y
distingue un bloqueo de CSP de un fallo de CORS (que sí se arregla).

## Datos de la plataforma que ya se confirmaron

- El Califica es OLE2/BIFF8 real (`d0 cf 11 e0`), no HTML disfrazado.
- COD_ALUM: 10 dígitos que empiezan por el año de matrícula; distinto del número de las fotos.
- `cod_mat` por grado: 2508, 2509, 2510, y **3011** para 11°.
- La pantalla "planillas por profesor" **sí acepta importar** el archivo de 19 hojas
  (confirmado por Diego en septiembre de 2026).
