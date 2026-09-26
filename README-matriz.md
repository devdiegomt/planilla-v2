# Llenar la matriz de actividades

`actividades-autofill.user.js` — aplica en la pantalla **Definición de actividades
y sus porcentajes** (831) el plan que armás en planilla-app.

En la plataforma la matriz se edita fila por fila: "Editar", llenar, "Actualizar".
Son unas diez filas por curso y diecinueve cursos. Con esto la llenás de una vez en
la app, copiás el plan, lo pegás acá y pulsás **Aplicar** una vez por curso.

## Este script escribe

Es el **segundo** camino de escritura del repo, después de la asistencia, y se
decidió aparte. Lo que lo hace seguro no es que pidas permiso una vez:

- **Nunca crea filas.** Solo edita las que ya están en la pantalla. La matriz trae
  ocho casillas por categoría, usadas o no, así que estrenar una actividad es
  llenar una que ya existe.
- **Verifica antes de escribir.** El plan trae, por fila, lo que la app cree que
  hay hoy. Si la pantalla dice otra cosa, esa fila **no se toca** y te dice qué
  encontró en su lugar. Emparejar por posición sin comprobar sería el error de
  pegar una columna de notas en el orden equivocado.
- **Nunca inventa un id.** Los tres identificadores de la fila (actividad,
  `cod_mat`, logro) se leen de la propia fila y se devuelven tal cual.
- **Lista blanca de controles.** Lo único que puede disparar son los comandos
  `Edit$N` y `Update$N` de la tabla. Ni "Consultar", ni el selector de curso, ni
  "Descargar Tabla". Hay **una sola** llamada a `__doPostBack` en todo el script y
  revienta si el control o el comando no están permitidos.
- **No arranca solo.** Hace falta pulsar "Revisar" y después "Aplicar".

## Cómo se usa

1. En la app, entrá a **Matriz de actividades**, traé la matriz de la plataforma
   (el JSON del `actividades-extractor`), editá lo que quieras y copiá el plan.
2. En la plataforma, abrí la pantalla 831 y elegí **curso** y **materia** a mano,
   y pulsá **Consultar**. El script no navega el filtro: eso lo ponés vos.
3. Pegá el plan en el panel y pulsá **Revisar**. Te dice, fila por fila, qué va a
   cambiar, qué ya está así y qué no piensa tocar.
4. Pulsá **Aplicar en este curso**. Va fila por fila, una por vez, esperando entre
   postbacks.
5. Cambiá de curso y repetí desde el paso 2. El plan sirve para todos los cursos
   del grado; el panel toma el que tengas en pantalla.

## Qué mira para emparejar

La **meta** y la **posición dentro de la meta**, contando también las casillas sin
usar: es el número de fila tal como se ve. Por eso el extractor devuelve las
vacías con su posición y no solo contadas.

La posición sola no es identidad, así que el plan trae además lo que había antes
en esa fila y el script lo compara. Si no coincide, no escribe.

## Lo que no hace

- No recorre los cursos solo. Cada curso es un "Aplicar" tuyo.
- No toca filas que no estén en el plan.
- No crea actividades nuevas: para eso la plataforma tiene que tener la casilla.
- No cambia el periodo ni el filtro.

## Pruebas

`npm test` incluye `prueba-matriz-autofill.mjs`, sobre un jsdom que reproduce la
pantalla: la fila se abre con "Editar" y recién ahí aparecen los cinco inputs sin
id. Comprueba, en este orden, que **no escriba** donde no debe, que la lista
blanca esté en el código y que haya una sola llamada a `__doPostBack`.
