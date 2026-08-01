# Verificador de planilla

Compara la planilla que descargaste de la plataforma contra la que generó tu
app, y te dice qué cambia **antes** de que la subas.

```bash
node verificar-planilla.mjs Califica-801-2508-02.xls modificada-801.xls
```

No toca la plataforma ni necesita sesión: son dos archivos locales.

## Por qué

Tu app **reescribe el archivo entero**, no solo las celdas de notas. Eso hace
invisible el peor error posible: si el archivo regenerado reordena las filas o
pierde un estudiante, las notas terminan en la persona equivocada y no hay
forma de notarlo mirando.

Y no sabemos si la plataforma actualiza por `COD_ALUM` o por posición de fila.
Mientras no lo sepamos, **cualquier cambio de orden es motivo suficiente para
no subir el archivo**.

Por eso la identidad se verifica antes que las notas.

## Qué revisa

| Nivel | Qué | Por qué |
| --- | --- | --- |
| **BLOQUEANTE** | Estudiantes faltantes o agregados | Falta o sobra una fila |
| **BLOQUEANTE** | Orden de filas alterado | Si el import va por posición, cada quien recibe la nota del vecino |
| **BLOQUEANTE** | El nombre de un `COD_ALUM` cambió | El código cambió de dueño |
| **BLOQUEANTE** | `cod_cur`, `cod_gru` o `cod_mat` distintos | El archivo es de otro curso |
| **BLOQUEANTE** | Columnas de logro distintas | Se agregó o desapareció un logro |
| **AVISO** | Una nota que pasa de un valor a `0` o vacío | El síntoma típico de un fallo de procesamiento |
| **CAMBIO** | Cualquier otra diferencia de nota | Es lo que venías a hacer |

## Código de salida

| Código | Significado |
| --- | --- |
| `0` | Sin problemas de identidad — se puede subir |
| `1` | Hay bloqueantes — **no subir** |
| `2` | Error de uso o archivo ilegible |

Sirve como compuerta en el pipeline de tu app:

```bash
node verificar-planilla.mjs original.xls generada.xls --json > informe.json || exit 1
```

Con `--json` sale el informe completo: `bloqueantes`, `avisos`, `cambios`,
cada uno con curso, tipo, `cod_alum`, logro, valor anterior y nuevo.

## Ejemplo

```
$ node verificar-planilla.mjs Califica-801-2508-02.xls modificada-801.xls

cursos: 1 → 1 · 244 celdas sin cambios

⚠ 1 nota(s) que se caen a cero o a vacío — revisá que sea a propósito:
    2019023231 PEÑA GARAVITO JOHN ESTEBAN · log_214: 100 → (vacío)

12 cambio(s) de nota:
  [801] 12 cambio(s)
    2019034387 ALONSO BELLO MIA · log_27: 70 → 85
    …

✓ Sin problemas de identidad. El archivo se puede subir.
```

## Lo que este verificador NO hace

**No sube nada.** Deliberadamente. La subida la seguís haciendo por el
formulario de la plataforma, que es código que ya funciona; automatizarla
agregaría riesgo sin ahorrar tiempo real.

**No sabe si la plataforma aceptará el archivo.** Solo compara los dos
archivos entre sí. Si el importador rechaza algo por sus propias reglas, eso se
ve al subir.

## Qué falta averiguar

Una pregunta sigue abierta y solo se responde con una importación real de
prueba: **¿qué hace Importar con las columnas que dejás vacías?** Si las
ignora, bien. Si las interpreta como "borrar", un archivo incompleto te vacía
el resto del trimestre.

Cuando quieras despejarla, hacelo con un curso, un logro, un estudiante, y el
export previo guardado como respaldo.

## Pruebas

```bash
npm install
npm test
```

`recon/pruebas/prueba-verificador.mjs` genera variantes del mismo archivo que
cambian **una sola cosa** cada una —orden, un estudiante de menos, uno de más,
un nombre distinto, una columna de logro que falta, otro curso— y verifica que
cada una salga con el nivel y el código de salida correctos.
