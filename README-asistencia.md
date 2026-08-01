# Asistencia por asignatura — autofill

Userscript que rellena la asistencia diaria por asignatura
(`AsistenciaAsignaturaAusenciaDia.aspx`) a partir de un JSON.

**Esta pantalla escribe en el sistema del colegio.** El script está construido
para que nunca se guarde algo que no revisaste: llega hasta marcar en pantalla y
se detiene. Guardar solo ocurre con un clic tuyo.

## Instalación

Igual que el extractor de COD_ALUM: Tampermonkey → *Crear un nuevo script* →
pegar `asistencia-autofill.user.js` → `Ctrl+S`.

En Chrome reciente hay que activar además **"Permitir user scripts"** en
`chrome://extensions` → Detalles de Tampermonkey. Sin eso, la extensión se
instala pero los scripts no corren nunca y no aparece ningún error.

## Formato de entrada

```json
{
  "fecha": "30/07/2026",
  "hora": 3,
  "curso": "801",
  "asignatura": "INFORMATION TECHNOLOGY",
  "marcas": [
    { "cod_alum": "2019034387", "tipo": "falla" },
    { "cod_alum": "2018044266", "tipo": "retardo" }
  ]
}
```

| Campo | Notas |
| --- | --- |
| `fecha` | `DD/MM/AAAA`. El script conserva la hora del campo tal como está, incluido el NBSP de `p.<NBSP>m.`; solo reemplaza la fecha. |
| `hora` | 1–6, o **7 para Séptima Hora** (internamente vale `9`; el script traduce). |
| `curso` | Sin padding. El script busca la opción cuyo value recortado coincida, así que no depende de si son uno o dos espacios. |
| `asignatura` | Se compara sin tildes ni mayúsculas contra el texto de la lista. Si hay ambigüedad, aborta. |
| `marcas` | Puede ir vacía. Quien no esté en la lista se deja como esté. |

### Los cuatro estados

La tabla tiene un **grupo de radios por fila**, o sea que cada estudiante puede
tener exactamente un estado. `tipo` acepta los cuatro explícitos:

- `retardo_justificado`
- `retardo_injustificado`
- `ausencia_justificada`
- `ausencia_injustificada`

y los alias cortos, que apuntan a las **injustificadas**:

| Alias | Equivale a |
| --- | --- |
| `falla`, `ausencia` | `ausencia_injustificada` |
| `retardo`, `tarde` | `retardo_injustificado` |

Si necesitás justificar a alguien, usá el tipo explícito.

### El código correcto

`cod_alum` es el **código de matrícula** que muestra la columna *Codigo* de la
tabla: 10 dígitos que empiezan por el año (`2019034387`, `2018044266`). Es el
mismo que produce `codalum-extractor.user.js`, así que la salida de esa
herramienta alimenta esta directamente.

**No** es el número que nombra los archivos de foto (`../Fotos/1007718065.jpg`).
Si tu app de captura guarda ese otro, el match falla en todas las filas y el
script aborta antes de marcar nada.

## Tiene que estar instalado en Tampermonkey

Esto no es opcional para el flujo completo, y es la causa número uno de que
"se cierre solo".

Cada paso del filtro dispara un postback y **recarga la página entera**. Un
script instalado se reinyecta en cada carga y retoma donde iba (por eso el
estado vive en `sessionStorage`). Un script **pegado en la consola** de DevTools
no: la consola no reinyecta nada, así que muere en el primer postback y la
corrida queda a medias.

La parte 1 sí funcionaba desde la consola porque usaba `fetch` y nunca navegaba.
Esta no.

El panel lo detecta: si no encuentra Tampermonkey muestra un aviso rojo, y el
primer clic en *Flujo completo* avisa en vez de arrancar. Un segundo clic
arranca igual — el script avisa, no prohíbe.

## Uso

Hay dos modos.

### Flujo completo — requiere Tampermonkey

1. Entrar por el menú a *Asistencia > Asistencia diaria por asignatura*.
2. Pegar el JSON en el panel y pulsar **Flujo completo (dry-run)**.
3. El script recorre fecha → hora → curso → asignatura. Cada paso recarga la
   página; el script continúa solo. El panel muestra `recarga #N` y deja una
   línea en el log en cada una: si esos números no avanzan, el script no está
   sobreviviendo y el problema es de instalación.
4. Al llegar a la tabla marca los radios **en pantalla** y se detiene, mostrando
   un resumen: curso, hora, asignatura, fecha y cuántos de cada estado.
5. Revisá la pantalla. Si está bien, **Confirmar y guardar**. Si no,
   **Abortar** y recargá: las marcas eran locales y se descartan.

Solo entonces marca "Registro de asistencia" y pulsa Guardar.

### Solo marcar — funciona en cualquier parte

Si preferís no depender de la instalación, o querés el control del filtro:

1. Poné **a mano** fecha, hora, curso y asignatura, hasta ver la lista.
2. Pegar el JSON y pulsar **Solo marcar**.
3. El script no toca el filtro: verifica que la pantalla coincida con el JSON,
   marca, y se detiene igual en el dry-run.
4. **Confirmar y guardar**.

En este modo la única navegación es el guardado final, así que no depende de
sobrevivir a ninguna recarga — anda incluso pegado en la consola.

La verificación del paso 3 no es un detalle: si dejaste el 802 en pantalla y el
JSON habla del 801, aborta sin marcar nada. Compara los cuatro campos.

Una corrida es **un curso y una hora**, en los dos modos. El script rechaza una
entrada que traiga listas en `curso` u `hora`.

## Cuándo aborta sin tocar nada

| Situación | Por qué |
| --- | --- |
| La pantalla no coincide con el JSON | Marcarle al 802 lo que era del 801 es el peor error posible acá. |
| Un `cod_alum` no está en la tabla | Marcar el resto dejaría el registro a medias, sin que se note. |
| La hora ya tiene estados registrados | No se pisa asistencia previa, tuya o de un coordinador. |
| Un encabezado no coincide con el value de su radio | Ver abajo. |
| Un `cod_alum` repetido en `marcas` | Los estados son excluyentes: no puede tener dos. |
| La lista de asignaturas queda vacía | Probablemente no tenés clase en ese curso a esa hora. |
| Un paso no surte efecto tras 3 intentos | Antes que seguir a ciegas. |

Todas esas comprobaciones corren **antes** de marcar el primer radio: o se
marcan todas las filas o ninguna.

## Por qué el script no confía en los ids del servidor

Los ids de los radios no dicen lo que parecen:

| Columna | `id` / `value` del radio |
| --- | --- |
| Retardo **Justificado** | `checkretardo` |
| Retardo **Injustificado** | `checkretardo_J` |
| Ausencia **Justificada** | `checkausenciaj` |
| Ausencia **Injustificada** | `checkausenciaIn` |

El sufijo `_J` está en la columna **Injustificado**. Quien lo lea como
"justificado" marca lo contrario de lo que quiere, y eso queda en el registro
del estudiante.

Por eso cada estado se ubica por el **encabezado de su columna** y además se
verifica que el `value` del radio sea el esperado. Los cuatro se comprueban al
empezar, aunque la corrida use solo uno. Si encabezado y value no coinciden, el
script aborta.

## Qué revisar a mano la primera vez

1. **Hacé la primera corrida con una sola marca**, en un curso y hora que ya
   ibas a registrar igual. No arranques con 20 marcas.
2. **Antes de confirmar**, mirá la pantalla: los radios marcados tienen que
   estar en las columnas que esperás. El resumen del panel dice cuántos de cada
   estado, pero la tabla es la verdad.
3. **Después de guardar**, el panel dice `verificado: N/N`. Esa verificación
   relee la tabla que devolvió el servidor y compara estado por estado.
   Si dice `Verificación incompleta`, **revisá a mano**: algo no quedó.
4. **No te fíes del modal.** `#myModal` trae el texto *"Información procesada
   satisfactoriamente"* pre-renderizado en el HTML aunque no se haya guardado
   nada. El script lo reporta pero no lo usa como señal de éxito, y vos tampoco
   deberías.
5. **Fijate en la hora del registro.** La página manda unos campos ocultos con
   la hora (`TextBox1/2/3`) que el servidor rellena al renderizar. No sabemos si
   valida que la hora de clase corresponda al momento real. Si registrás una
   hora pasada y el guardado se verifica bien, no hay problema; si la
   verificación falla justo en ese caso, probablemente sea eso.

## Lo que el script nunca hace

- No toca **Salir** (`ImageButton1`).
- No escribe en los hidden (`hfCurso`, `hfCodAlum`, `hfId_asistencia`…): los
  llena el servidor.
- No toca los campos ocultos de hora del cliente.
- **No limpia marcas existentes.** Los radios no se pueden desmarcar por JS: la
  plataforma lo hace con un link *Desmarcar* que es un postback por fila. El
  script no lo usa. Si necesitás devolver a alguien a "presente", es a mano.
- No recorre varios cursos ni varias horas.
- Nunca hay dos postbacks en vuelo, y espera 1,5 s como mínimo entre uno y otro.

## Pruebas

```bash
npm install      # jsdom
npm test
```

`recon/pruebas/prueba-asistencia.mjs` monta con jsdom un DOM que replica la
página real —mismos ids, mismos `name` de GridView, mismos encabezados y el
mismo grupo de radios por fila— y evalúa el userscript tal cual, simulando las
recargas de página con `sessionStorage` intacto.

Cubre el camino feliz, los cuatro tipos explícitos, la traducción de la Séptima
Hora, la conservación del NBSP en la fecha, y cada una de las guardas: código
inexistente, hora ya registrada, mapeo de columnas alterado, abortar. Dos casos
que vale la pena nombrar:

- **Atomicidad.** Con el mapeo alterado en una columna intermedia, el script
  debe abortar sin haber marcado la fila anterior, que sí era válida. La primera
  versión fallaba justo ahí: marcaba y después abortaba.
- **El modal que miente.** Se simula un guardado rechazado dejando el texto de
  éxito en el modal. El script tiene que reportar `0/3 confirmados`, no éxito.

El detalle del reconocimiento —cómo se determinó cada selector— está en
[`recon/README.md`](recon/README.md).
