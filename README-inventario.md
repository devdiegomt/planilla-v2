# Inventario de la plataforma

Recorre las pantallas del menú de Classroom Live Web y captura la estructura de
cada una. Salida: un JSON con el mapa de a qué llega tu usuario.

No es un extractor de datos. Es el paso previo: te dice **dónde vive cada cosa,
qué filtro la gatea, y qué pantallas pueden modificar información**, para
decidir qué vale la pena automatizar.

## Por qué no hace click en nada

Esta plataforma tiene botones que escriben: `Guardar`, `Importar`, `Desmarcar`,
`Cambiar Clave`, `Salida Segura`. Un recorrido que pulsara todo lo que
encuentra te cerraría la sesión y modificaría datos sin dejar rastro de qué
tocó.

El inventario **no pulsa ningún control de las pantallas**. La única acción que
ejecuta es navegar, y para eso llama a la función del propio menú:

```js
window.SessionEntrar(titulo, id, pageNum)
```

En todo el archivo no hay un `.click()` ni un `.submit()` propio —salvo el `<a>`
sintético de la descarga final—, no se dispara `__doPostBack`, no se escribe en
los hidden de navegación y no se cambia el valor de ningún control. Hay pruebas
estructurales que lo verifican sobre el código fuente, y una prueba de
comportamiento que engancha un escucha de `click` a todos los botones y exige
que el contador quede en cero.

Los botones **se clasifican** para que el mapa te diga dónde está el peligro:

| Clase | Ejemplos |
| --- | --- |
| `escritura` | Guardar, Importar, Eliminar, Crear, Desmarcar, Cambiar Clave |
| `sesion` | Salir, Salida Segura, Inicio |
| `lectura` | Exportar, Consultar, Buscar, Generar, Imprimir |
| `desconocido` | todo lo demás |

`desconocido` cuenta como peligroso: nada se asume inofensivo.

## Uso

**Requiere Tampermonkey.** Cada pantalla es una recarga completa; pegado en la
consola muere en la primera. El panel avisa si no lo detecta.

1. Instalar `inventario-plataforma.user.js`.
2. Entrar a la plataforma (la home sirve).
3. Panel abajo a la derecha → **Iniciar recorrido**.
4. Va pantalla por pantalla, con 2 s entre cada una. El progreso se ve como
   `Pantalla 7 de 22`.
5. Al terminar descarga `inventario-gla-AAAA-MM-DD.json`.

Con 22 pantallas tarda algo menos de un minuto. **Abortar** corta en cualquier
momento.

Si una pantalla no abre, lo registra en `errores[]` y sigue con la siguiente. Si
la navegación no produce recarga —el servidor ignoró la petición— hay un vigía
de 8 s que lo detecta; sin él el recorrido se colgaba en silencio.

## Qué sale

```json
{
  "generado": "...",
  "totalPantallas": 22,
  "capturadas": 22,
  "resumen": [
    { "id": "1096", "titulo": "...", "seccion": "Evaluación",
      "escribe": true, "tieneDatos": false, "nTablas": 0 }
  ],
  "pantallas": [ /* la captura completa de cada una */ ],
  "errores": []
}
```

Empezá por `resumen`: una línea por pantalla con lo decisivo —si escribe, si
trae datos, cuántas tablas—. De ahí salís sabiendo cuáles mirar en detalle.

Cada entrada de `pantallas` trae los `selects` con sus opciones (que son los
filtros), las `entradas` de texto, los `botones` clasificados, las `tablas` con
encabezados y una fila de muestra, los campos ocultos, los validadores y si usa
AJAX.

**Los nombres de estudiantes salen enmascarados** (`A····· B·····`): se conserva
la forma para saber qué columna es, no el contenido. El `__VIEWSTATE` no se
vuelca. Si querés los nombres reales, `MASCARA_NOMBRES = false` en el archivo.

## Lo que este mapa no te va a dar

**Datos.** Casi todas las pantallas llegan vacías porque no muestran nada hasta
elegir filtros — igual que `ReporteCalificaMatriz` y
`AsistenciaAsignaturaAusenciaDia`. El inventario captura la estructura y los
filtros disponibles; sacar los datos es un extractor por pantalla, después.

**Pantallas que no estén en el menú.** No se prueban ids al azar. Iterar
`id=1..2000` a ver qué responde el servidor es tantear accesos que el sistema no
te ofreció, y eso es otra cosa que "todo lo que mi usuario expone".

## Pruebas

```bash
npm install
npm test
```

`recon/pruebas/prueba-inventario.mjs` monta la plataforma en jsdom —menú,
navegación por `SessionEntrar`, y pantallas con los botones reales que ya
conocemos— y corre el userscript tal cual.

Dos detalles que valieron la pena:

- Los chequeos estructurales miran el código **con los comentarios quitados**.
  La primera versión matcheaba la propia cabecera del archivo, que menciona
  `.click()` justamente para explicar que no lo usa: el test se aprobaba solo
  leyendo prosa.
- El caso de la navegación que no ocurre se dispara a mano en la prueba,
  separando los temporizadores largos de los cortos. Fue lo que sacó a la luz
  que el recorrido se colgaba sin timeout.
