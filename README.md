# Extractor de COD_ALUM — Classroom Live Web (GLA)

Userscript que recorre los 19 cursos de **Importar/exportar planilla individual
GLA** (`ReporteCalificaMatriz.aspx`) y extrae, por curso, la lista de
estudiantes con su `COD_ALUM`. Salida: un único JSON descargable.

Solo lectura. Repite los mismos dos POST que haces a mano —cambiar de curso y
pulsar Exportar— y nunca envía `btnImportar`, que es el único camino de
escritura de esa pantalla.

## Instalación

1. Instalar [Tampermonkey](https://www.tampermonkey.net/) en el navegador.
2. Panel de Tampermonkey → **Crear un nuevo script**.
3. Borrar la plantilla, pegar el contenido de `codalum-extractor.user.js`.
4. `Ctrl+S`.

Un archivo, sin dependencias, sin build.

## Uso

1. Entrar a Classroom Live Web con tu cuenta.
2. Navegar **por el menú** hasta *Importar/exportar planilla individual GLA*.
   No se puede llegar por URL: el destino vive en la Session del servidor.
3. Abajo a la derecha aparece el panel **Extractor COD_ALUM**.
4. **Iniciar**. El progreso se ve como `Curso 7 de 19` y cada curso deja una
   línea en el registro.
5. Al terminar se descarga solo `codalum-gla-AAAA-MM-DD.json`.

Tarda unos 45–60 segundos: hay una espera de 1,5–2 s entre cursos y nunca hay
dos peticiones en vuelo a la vez.

**Abortar** corta la corrida y descarta el parcial. Si recargas la página a
mitad de camino, el panel ofrece **Reanudar** desde donde iba (el avance se
guarda en `sessionStorage` tras cada curso). No reanuda solo: disparar
peticiones de red al cargar la página sin pedirlo sería una sorpresa
desagradable.

## Salida

```json
{
  "generado": "2026-07-30T14:00:00Z",
  "cursos": [
    {
      "cod_cur": "801",
      "cod_gru": "08",
      "cod_mat": "2508",
      "estudiantes": [
        { "cod_alum": "2019034387", "nombre": "APELLIDO APELLIDO NOMBRE NOMBRE" }
      ]
    }
  ],
  "errores": []
}
```

Si un curso falla, se registra en `errores[]` y la corrida sigue con el
siguiente. Cada entrada trae `cod_cur`, `tipo` y `detalle`.

| `tipo` | Qué pasó |
| --- | --- |
| `fallo` | error de red, el servidor no cambió de curso, o el archivo no se pudo parsear |
| `cod_alum_invalido` | el curso salió, pero algún código no tiene 10 dígitos |
| `sin_estudiantes` | el export no trajo filas |

## Cómo validar que los 10 dígitos salieron bien

Contrastá contra el Califica del **801**, que ya tenés.

**Antes que nada:** el `COD_ALUM` empieza por año de matrícula —`2019034387`,
`2018044266`— y **no** es el número que nombra los archivos de foto
(`../Fotos/1007718065.jpg`). Son dos identificadores distintos. Compará contra
la columna `COD_ALUM` del Califica, no contra el nombre de la foto.

Cuatro chequeos, de más barato a más caro:

1. **Conteo.** El 801 tiene 28 estudiantes. Que `cursos[0].estudiantes.length`
   dé 28. Si da 27 o 29, algo se corrió de fila.
2. **Los extremos.** El primero y el último de la lista, en ese orden, tienen
   que coincidir con el primero y el último del Califica. El orden del export
   es el mismo de la planilla.
3. **Formato.** Que los 10 dígitos sean 10 y no 9 ni 11 — un cero a la
   izquierda perdido es el error clásico cuando un código pasa por un tipo
   numérico:

   ```js
   const d = JSON.parse(/* el JSON descargado */);
   d.cursos.flatMap(c => c.estudiantes)
           .filter(e => !/^\d{10}$/.test(e.cod_alum));   // debe dar []
   ```

   El script ya hace esta comprobación y la reporta en `errores[]`, pero
   correrla por tu cuenta sobre el archivo final no cuesta nada.
4. **Unicidad.** Ningún `cod_alum` debería repetirse dentro de un curso. Entre
   cursos distintos tampoco, salvo que tengas un estudiante en dos:

   ```js
   const todos = d.cursos.flatMap(c => c.estudiantes.map(e => e.cod_alum));
   todos.length - new Set(todos).size;                   // deberia dar 0
   ```

Si los cuatro pasan en el 801, el resto de los cursos usa exactamente el mismo
camino y las mismas columnas.

## Sobre el archivo que se parsea

`ReporteCalificaMatriz.aspx` **no muestra la lista de estudiantes en pantalla**
—no hay tabla que raspar—, así que el `COD_ALUM` solo puede venir del `.xls`
que genera Exportar. Y ese archivo no es HTML disfrazado: es OLE2/BIFF8 binario
de verdad (`Califica-801-2508-02.xls`, firma `d0 cf 11 e0`).

Por eso el userscript lleva embebido un parser de contenedor OLE2 y de
registros BIFF8. Se validó **antes** de escribir el extractor, contra archivos
generados con `xlwt` — incluido el caso del `SST` partido en registros
`CONTINUE`, donde el `grbit` cambia de 8 a 16 bits por carácter a mitad de
cadena, que es el bug clásico de los lectores de BIFF8.

```bash
cd recon/pruebas
pip install xlwt
python3 genera-xls-de-prueba.py
node prueba-parser.mjs        # el parser: OLE2, SST/CONTINUE, RK, LABELSST
node prueba-extraccion.mjs    # las columnas: COD_ALUM, nombre, metadatos
```

Ninguna de las dos pruebas tiene copia del código: lo recortan de
`codalum-extractor.user.js` en tiempo de ejecución, así que prueban lo que
realmente se ejecuta. Una de ellas verifica además que la copia del parser en
el userscript y la de la sonda no se hayan desincronizado.

El detalle del reconocimiento —cómo se determinaron los selectores, por qué el
postback es completo, de dónde salen `cod_gru` y `cod_mat`— está en
[`recon/README.md`](recon/README.md).
