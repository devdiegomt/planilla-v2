# Reconocimiento previo — ReporteCalificaMatriz.aspx

Este paso existe para **no adivinar selectores**. La sonda solo lee el DOM: no
envía formularios, no dispara postbacks y no toca la Session del servidor.

## Cómo correrla

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

## Lo que la sonda no puede contestar sola

Si el cambio de curso es postback **completo** o **parcial**. La sección `ajax`
da pistas fuertes (`hayPageRequestManager`, `updatePanelsRegistrados`,
`controlesAsync`), pero la confirmación es visual:

> Cambia de curso a mano una vez y observa: ¿parpadea la página entera y el
> scroll salta arriba (**completo**), o solo se refresca la tabla
> (**parcial**)?

El extractor final maneja los dos casos, pero saberlo de antemano simplifica el
diseño y evita una corrida de prueba.
