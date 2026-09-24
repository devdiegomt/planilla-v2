# Reconocimiento previo — ReporteCalificaMatriz.aspx

Este paso existe para **no adivinar selectores**.

| Sonda | Golpea el servidor | Qué responde |
| --- | --- | --- |
| `sonda-reportecalificamatriz.js` (v1) | no, lectura pura de DOM | selectores, botones, tablas, AJAX |
| `sonda-v3-export.js` | **sí, un POST** (el mismo del botón Exportar) | formato del archivo exportado |
| `sonda-v4-xls.js` | **sí, un POST** (idem) | parsea el `.xls` y vuelca el layout de la hoja |
| `sonda-conscalifica.js` | no, lectura pura de DOM | otra pantalla: `ConsCalificaDocentesGen` (24), la de los cuatro periodos |
| `sonda-pantalla.js` | no, lectura pura de DOM | **genérica**: sirve para cualquier pantalla. Es la que hay que usar para una nueva. |

## Hallazgos confirmados

- **Postback completo.** `Sys.WebForms.PageRequestManager` no tiene instancia en
  esta página, pese a que carga `ScriptResource.axd`. No hay UpdatePanel.
- **Selector de curso:** `ctl00_ContentPlaceHolder1_lstCurso` /
  `ctl00$ContentPlaceHolder1$lstCurso`, AutoPostBack vía
  `setTimeout('__doPostBack(...)', 0)`. Sin botón "Consultar".
- **Values paddeados a 5 caracteres:** `"801  "`, `"1001 "`. Comparar siempre
  con `.trim()`.
- **20 opciones** = 19 cursos + `"%"` (`< TODOS >`).
- **`cod_mat` sale del texto, no del value:** `lstMateria` da
  `value="1035"` con texto `"Information Technology-2508"`. El 2508 es el
  sufijo tras el último guion.
- **`cod_gru` no está en el DOM.** Hay que derivarlo del código de curso
  (`801→08`, `1001→10`).
- **No hay lista de estudiantes en la página.** Con el 801 cargado
  (`hfCurso: "801  "`), `tablas: []`. El único número de 10 dígitos es la foto
  del menú (`ctl00_FotoMenu → ../Fotos/1099999999.jpg`). El COD_ALUM solo puede
  venir del archivo de Exportar → por eso existe la v3.
- **`btnImportar` es el camino de escritura.** Vetado: ninguna sonda ni el
  extractor lo incluyen en el POST.

## v1 — cómo correrla

1. Entrar a Classroom Live Web con tu cuenta y navegar por el menú hasta
   **Importar/exportar planilla individual GLA** (id 1096).
2. Cargar un curso cualquiera (el **801** es ideal, porque tienes el Califica
   para contrastar).
3. `F12` → pestaña **Console**.
4. Pegar el contenido completo de `sonda-reportecalificamatriz.js` y `Enter`.
5. El JSON queda copiado al portapapeles. Pegármelo.

## Qué sale y qué no

| Sale | No sale |
| --- | --- |
| ids y `name` de selects, botones y tablas | `__VIEWSTATE` / `__EVENTVALIDATION` (solo su tamaño) |
| `onchange` / `onclick` completos | nombres de estudiantes sin enmascarar |
| encabezados de tabla y 3 filas de muestra | cookies, tokens, credenciales |
| ubicación exacta de cualquier número de 10 dígitos | |

Los nombres salen como `A····· B·····` (se conserva la forma, no el contenido).
Si prefieres mandármelos completos, cambia `MASCARA_NOMBRES` a `false` en la
línea 24.

## Las tres preguntas que resuelve

1. **Estructura real de la página** → secciones `selects`, `botones`, `tablas`.
2. **Cómo se cambia de curso** → `selects[].autoPostBack` y la lista `botones`.
   - `autoPostBack: true` → el `<select>` se dispara solo.
   - `autoPostBack: false` + un botón "Consultar" → hay que seleccionar y luego
     hacer click.
3. **Dónde vive el COD_ALUM** → sección `diezDigitos`.
   - `total: 0` → no está en el DOM; hay que ir por el archivo exportado.
   - `donde: "texto"` con `indiceColumna` → está en una columna de la tabla.
   - `donde: "atributo:..."` → está oculto en la fila (`data-*`, `value`, `onclick`).

## v3 — formato del archivo exportado

Como el COD_ALUM no está en el DOM, hay que ver qué produce Exportar.

1. ReporteCalificaMatriz.aspx con el **801 cargado** (no `< TODOS >`).
2. `F12` → Console → pegar `sonda-v3-export.js` → `Enter`.
3. Pegarme el JSON y **recargar la página** (`F5`) para refrescar el VIEWSTATE.

Esta sonda hace **un POST**: el mismo que el botón Exportar. Es de lectura
(genera un archivo, no modifica nada), lee la respuesta en memoria sin
guardarla en disco, no cambia de curso, y excluye explícitamente
`btnImportar` del cuerpo del POST (`camposEnviados.incluyeImportar` lo
confirma en la salida).

Lo que decide el plan es `formatoDetectado`:

| Firma | Formato | Parseo |
| --- | --- | --- |
| `3c ...` (`<`) | HTML disfrazado de `.xls` | `DOMParser`, sin dependencias |
| texto con `,` o `;` | CSV / TSV | trivial |
| `50 4b 03 04` | XLSX real (ZIP) | requiere inflate — replantear |
| `d0 cf 11 e0` | XLS binario OLE2 | requiere parser — replantear |

Y `codAlum.muestra` trae los primeros 3 códigos para contrastar contra tu
Califica del 801.

### Resultado de la v3

```
content-type:        application/vnd.ms-excel
content-disposition: attachment; filename=Califica-801-2508-02.xls
primeros bytes:      d0 cf 11 e0 a1 b1 1a e1   → OLE2 / BIFF8 real
tamaño:              14336 bytes
```

No es HTML disfrazado: es un `.xls` binario de verdad. El nombre del archivo
confirma el esquema `Califica-<curso>-<materia>-<periodo>.xls`, así que
`cod_mat` sale de ahí sin parsear el texto del `<select>`.

## v4 — parsear el .xls sin dependencias

`sonda-v4-xls.js` lleva embebido el parser candidato (contenedor OLE2/CFB +
registros BIFF8), hace el mismo POST y vuelca la hoja como grilla. Mismo
protocolo que la v3: 801 cargado, consola, pegar, `F5` al terminar.

Lo que interesa de la salida es `perfilColumnas` y `veredicto`: cuentan, por
columna, cuántas celdas son de exactamente 10 dígitos, y señalan cuál es la del
COD_ALUM.

### Banco de pruebas del parser

El parser se validó **antes** de escribir el extractor, contra archivos BIFF8
reales generados con `xlwt`:

```bash
cd recon/pruebas
pip install xlwt
python3 genera-xls-de-prueba.py    # crea 3 .xls (no versionados)
node prueba-parser.mjs
```

`prueba-parser.mjs` no tiene copia del parser: lo recorta de
`sonda-v4-xls.js` en tiempo de ejecución, así que prueba el código que
realmente se envía.

| Caso | Qué cubre |
| --- | --- |
| `caso1_texto.xls` | 30 estudiantes, COD_ALUM como texto (`LABELSST`) |
| `caso2_numero.xls` | COD_ALUM como número — verifica que `RK` no pierde precisión en 10 dígitos |
| `caso3_continue.xls` | 600 filas, SST partido en `CONTINUE`, mezclando ASCII / latin1 / griego para forzar el cambio de `grbit` a mitad de cadena |

El tercero es el que importa: es el bug clásico de los lectores de BIFF8. Las
600 cadenas se comparan una por una contra lo que generó el script.

## ConsCalificaDocentesGen (24) — el historial de los cuatro periodos

Las planillas (1096, 1099) solo ofrecen el periodo en curso, así que esta es la
única pantalla de la que puede salir el año completo. En `CATALOGO.md` figura
como **por verificar**: se sabe que existe y que tiene "Descargar Tabla", pero
nadie ha visto qué entrega ni con qué columnas. Escribir el extractor antes de
saberlo sería inventar un formato, así que primero va la sonda.

`sonda-conscalifica.js` es **lectura pura**: no envía nada, no dispara
postbacks y **no pulsa "Descargar Tabla"** — lo inspecciona y dice qué clase de
cosa es, que es lo que decide todo lo que sigue:

| Lo que resulta ser el botón | Qué implica |
| --- | --- |
| lo arma el navegador (Blob) | las notas ya están en el DOM: no hace falta el archivo |
| postback de ASP.NET | hay que reproducir el formulario, como en la v3 |
| enlace a archivo | un `fetch` y a parsear |

Cómo correrla:

1. Abrí `ConsCalificaDocentesGen.aspx` y cargá un curso **hasta ver las notas**.
   Con la tabla vacía la sonda lo dice y no sirve de nada.
2. `F12` → Console → pegar el archivo entero → `Enter`.
3. Se copia sola al portapapeles. El `veredicto` del final dice qué sigue.

Los nombres salen enmascarados (`MASCARA_NOMBRES = true`) y del `__VIEWSTATE`
solo va el tamaño. Los códigos numéricos sí salen tal cual: son justamente lo
que hay que verificar.

### Que sea de solo lectura, comprobado

`prueba-sondas.mjs` no se fía de la cabecera: corre la sonda en un DOM falso
(jsdom) que imita la pantalla y compara una foto del antes contra el después.
La foto lleva el HTML **y el valor de cada control**, porque `input.value = 'x'`
cambia el campo pero no el atributo — con el HTML solo, escribir un campo
pasaba desapercibido.

Y para que esa comprobación no sea decorativa, la prueba corre además dos
sondas falsas que sí escriben y verifica que la foto las delate.

```bash
node recon/pruebas/prueba-sondas.mjs   # va también en `npm test`
```

## La sonda genérica — para las pantallas que faltan

`sonda-pantalla.js` hace lo mismo que las anteriores pero **sin saber en qué
pantalla está**. Existe porque ya se escribió dos veces casi la misma sonda, y
cada lección que salió de usarlas hubo que aplicarla a mano en cada copia:

- el número de las fotos también tiene 10 dígitos y **no** es el COD_ALUM;
- una tabla de maquetado (muchas filas, una columna) **no** es una tabla de datos;
- un `<input type="image">` es un submit, no un botón desconocido.

Con una sola, la próxima lección se arregla en un solo lugar.

Sirve para las que quedan en `CATALOGO.md` como "por verificar": matriz de
actividades (831), planeador (803), seguimiento (853), actas (875).

Además de lo que ya reportaban las otras, contesta **la pregunta de seguridad de
este repo**: si la pantalla escribe. Mira los botones (Guardar, Importar,
Grabar…) y también si las celdas de la tabla son editables, que es la forma
silenciosa de que una pantalla escriba. Si escribe, lo dice en rojo en la
consola antes que cualquier otra cosa.

Cómo usarla: abrí la pantalla, cargala hasta ver datos, `F12` → Console → pegá
el archivo → Enter. Si no hay tabla y hay un filtro en `< TODOS >`, el veredicto
señala ese filtro en vez de dar un consejo genérico.

`sonda-conscalifica.js` queda por ahora: la genérica la reemplaza, pero conviene
correr la nueva en una pantalla real antes de borrar la que ya funcionó.
