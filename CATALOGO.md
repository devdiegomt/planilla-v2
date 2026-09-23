# Catálogo de datos disponibles

Qué se puede sacar de Classroom Live Web con una cuenta docente, de dónde, y
cuánto cuesta. Sirve para contrastar contra lo que tu app necesita, sin tener
que leer el inventario completo.

Estado de cada fila:

- **listo** — implementado y verificado contra datos reales.
- **a mano** — el archivo ya lo trae; falta código para leerlo.
- **por verificar** — la pantalla existe y tiene botón de exportar, pero
  todavía no vimos qué devuelve.

---

## Lo que ya funciona

| Dato | Origen | Costo | Estado |
| --- | --- | --- | --- |
| `cod_alum` (10 dígitos), nombre completo | `ReporteCalificaMatrizProfesor.aspx` | **1 petición, ~3 s** | listo |
| `cod_cur`, `cod_gru`, `cod_mat`, periodo | idem, columnas del archivo | idem | listo |

Una descarga trae los 19 cursos (19 hojas). En la corrida real: 538
estudiantes, todos con código de 10 dígitos y nombre.

## Lo que está en ese mismo archivo y no leemos

Esto es lo importante: **no hace falta otra petición**. El `.xls` que ya
descargamos trae, por estudiante y por curso:

| Dato | Dónde en la hoja |
| --- | --- |
| Nota de cada logro | columnas 8 en adelante — `50 80 70 0 30 0 30 50 80 75` |
| Código del logro | fila de encabezados — `log_21`, `log_22`, `log_27`… |
| Descripción del logro | fila anterior — `"Ciencias T2 - C4. Observe Carefully With Bodily Learning"` |
| Nombre de la materia | columna 5 — `Information Technology` |

Estado: **a mano**. El parser ya devuelve la matriz completa; hoy el extractor
descarta las columnas de notas y se queda con el `cod_alum`. Sacarlas es
ampliar `extraerDeMatriz`, no escribir un extractor nuevo.

Ojo con el `0`: en la muestra aparecen logros en `0` junto a otros en `100`.
Habría que confirmar si `0` significa "sin calificar" o "cero". No es lo mismo
para nada, y el archivo no lo distingue por sí solo.

## Lo que requiere otra pantalla

| Dato | Pantalla | Salida | Estado |
| --- | --- | --- | --- |
| Notas por **periodo y corte** (1/2/3/Final × Único/C1/C2/Evaluación) | `ConsCalificaDocentesGen.aspx` (24) | **tabla en el DOM** (y botón Descargar Tabla) | **confirmado** — ver abajo |
| Actas de reunión — 31 filas ya cargadas sin filtrar | `ActaReunionGLA.aspx` (875) | Excel | por verificar |
| Seguimiento convivencial por curso | `Seguimientoacademicoyconvivencial.aspx` (853) | Excel | por verificar |
| Definición de actividades y sus porcentajes | `DefActividadDocentePorcMatriz.aspx` (831) | Excel | por verificar |
| Plan trimestral de asignatura (PTA) | `PlaneadorClase.aspx` (803) | Excel | por verificar |
| Reporte de mitad y final de trimestre | `NotificacionyobservacionGLA.aspx` (863) | Excel | por verificar |
| Planillas de electivas | `ReporteCalificaMatrizElectiva.aspx` (1234) | Excel **y PDF** | por verificar |
| Instructivos/circulares recibidas | `CircularesProf.aspx` (124) | tabla en pantalla | por verificar |
| Calendario de actividades | `CalendarioN2.aspx` (136) | tabla en pantalla | por verificar |

Casi todas las de "Excel" deberían salir en el mismo formato OLE2/BIFF8 que ya
parseamos, así que cada una es un extractor corto, no un proyecto.

**Limitación del periodo:** las pantallas de planillas (1096, 1099) solo
ofrecen el periodo en curso (`02`). Para histórico, la única con los periodos
anteriores es `ConsCalificaDocentesGen` (24).

### ConsCalificaDocentesGen (24), medido el 23/09/2026

Con `recon/sonda-conscalifica.js` en la pantalla, curso cargado:

- **Las notas ya están en el DOM.** El archivo del botón no hace falta:
  `#ctl00_ContentPlaceHolder1_gvDatos`, una fila por estudiante, y la **primera
  columna es el COD_ALUM** en texto plano. Se lee como el extractor de códigos
  lee el menú, sin parsear un `.xls`.
- **Once columnas**, y las cinco categorías salen con el nombre completo:

  `Código · Nombre · CONOCIMIENTO · MÉTODO · USO · COMUNICACIÓN ·
  EVA. TRIMESTRAL · EVA. BIMESTRAL · Definitiva · fallas · retardos`

  Son las K/M/U/C/E de la app más la definitiva. Y de yapa **fallas y
  retardos**, que ninguna otra pantalla entrega consolidados.
- **Los decimales van con coma** (`95,00`): hay que cambiarla por punto antes
  de convertir a número.
- **No son cuatro periodos, son tres y el final.** `lstPeriodo` ofrece
  `01` PRIMERO, `02` SEGUNDO, `03` TERCERO y `05` FINAL — no hay `04`, y `%`
  es "< Seleccione >". Lo de "los cuatro periodos" era una suposición que la
  pantalla desmiente.
- **`lstCorte` no usa los textos como valores:** `1` ÚNICO, `2` Corte 1,
  `3` Corte 2, `4` Evaluación.
- **Los cuatro filtros son AutoPostBack** (curso, materia, periodo, corte), así
  que recorrerlos recarga la página en cada paso: esto va como userscript, no
  como bookmarklet — la misma limitación que la asistencia.
- **`lstCurso` repite el padding a 5 caracteres** (`"801  "`, `"1001 "`) y trae
  19 cursos + `%`. Comparar siempre con `.trim()`.
- **`lstMateria` sale filtrada por lo que dicta el curso**: con un 10° cargado
  ofrecía solo `2510`.
- **"Descargar Tabla" es un `<input type="image">`**
  (`ctl00$ContentPlaceHolder1$btnDescarga`), o sea un submit: al postear manda
  `name.x` y `name.y`, no `name=valor`. Queda sin explorar a propósito —
  teniendo la tabla en el DOM, no hace falta.

## Lo que solo escribe

Sin salida de datos. Automatizarlas es el territorio de la parte 2, con dry-run:

`AsistenciaAsignaturaAusenciaDia` (899, ya hecho) · `asistenciaProfesorReemplazo`
(1143) · `AsistenciaElectivasGrado` (1059) · `SeguimientoIntegralEstudiantev3`
(874) · `Actividades` (58).

## Lo que existe pero yo no tocaría

`EvalconsAlumgMatriz.aspx` (40) tiene un `<select>` con **2784 estudiantes** de
todo el colegio, y solo exporta a PDF. `SeguimientoIntegralEstudiantev3` (874)
trae una columna `Tarifa`, que suena a información financiera de familias.

Son accesos que tu cuenta tiene, pero no son tus cursos, y el costo de
equivocarse ahí es distinto.

---

## Qué necesito de tu app

En orden de utilidad. Con lo primero suele alcanzar:

1. **El esquema.** El archivo de modelos, el `CREATE TABLE`, el `schema.prisma`,
   los tipos de TypeScript — lo que sea que defina qué guarda tu app y con qué
   campos. Un solo archivo dice más que cualquier descripción.
2. **Qué llenás a mano hoy.** El paso que más tiempo te come es el primero que
   conviene automatizar, y no siempre es el que parece.
3. **Un registro de ejemplo**, con los datos cambiados. No necesito estudiantes
   reales para entender la forma.

Lo que **no** hace falta: el código completo, capturas de la interfaz, ni la
lógica de negocio. Con el esquema y el flujo manual armo el mapeo campo por
campo y te digo qué sale de una petición, qué necesita otra pantalla, y qué no
está disponible.
