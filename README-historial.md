# Historial de definitivas por periodo

`historial-extractor.user.js` recorre **Consultas → Notas parciales por meta**
(`ConsCalificaDocentesGen.aspx`) y arma un JSON con **la definitiva de cada
estudiante en cada periodo**.

## Para qué

Para saber en cuánto lleva la materia cada estudiante.

La plataforma tiene el dato, pero te lo muestra de a un curso y un periodo por
vez: para ver el acumulado de tus 540 estudiantes tendrías que hacer 19 × 3
recorridos y sumarlo a mano. Y no hay otra fuente: las pantallas de planillas
(1096, 1099) **solo ofrecen el periodo en curso**, así que T1 y T2 salen de acá
o no salen.

Lo que aporta la app no son los datos, es la agregación: `T1 · T2 · T3 →
acumulado`, por estudiante, en una pantalla.

## Qué trae, y qué no

Trae `cod_alum`, `nombre` y `definitiva`. Nada más.

La tabla de la plataforma tiene once columnas —las cinco categorías, la
evaluación bimestral, fallas y retardos—, y se ignoran a propósito: el desglose
por categoría lo tenés en la app, y la asistencia la app la lleva de primera
mano. Traerlos sería guardar dos veces lo mismo y tener que decidir cuál gana
cuando difieran.

**Corte ÚNICO**, que es el consolidado del periodo. Los otros tres
(Corte 1, Corte 2, Evaluación) multiplicarían los postbacks por cuatro para dar
un desglose que ya tenés.

**Las observaciones no están en esta pantalla.** No es una decisión: la tabla no
las tiene.

## Cómo se usa

1. Instalalo en Tampermonkey. **Tiene que ser userscript, no favorito**: cada
   elección de los desplegables recarga la página, y lo que se pega en la
   consola no sobrevive a una recarga. La corrida quedaría en el primer curso.
2. Abrí la pantalla por el menú: **Consultas → Notas parciales por meta**.
3. En el panel, marcá los periodos. Vienen marcados **Primero y Segundo**: el
   tercero es el que estás cursando y ya lo tenés en la app, y Final todavía no
   tiene nada que dar.
4. Mirá el costo que anuncia el panel y dale **Extraer**.
5. Al terminar, **Copiar JSON** y pegalo en la app.

## Cuánto tarda

Un periodo son los 19 cursos más uno para fijar el periodo: **20 recargas**. Con
los dos periodos pasados, **40**. Entre dos y cuatro minutos según responda la
plataforma. El panel lo calcula solo y lo muestra antes de que le des arrancar,
que es cuando sirve saberlo.

Se recorre **periodo por fuera y curso por dentro** a propósito: así el postback
del periodo se paga una vez cada 19 cursos en lugar de una vez por curso.

## Lo que nunca hace

Esta pantalla es de consulta: no tiene Guardar ni Importar. Aun así, el script
se acota:

- **No toca "Descargar Tabla"** (`btnDescarga`). La tabla ya está en el DOM, así
  que el archivo no hace falta y no vale la pena averiguar qué manda.
- **Nunca pone el curso en `< TODOS >`.** Está medido: con `%` la pantalla deja
  de dibujar la tabla. Además de inútil sería un postback perdido.
- **No arranca solo.** Hace falta un clic, siempre.
- **Un postback en vuelo por vez**, con espera entre uno y otro, tope de
  reintentos por combinación y cortafuegos contra bucles de recarga.
- Si un curso no tiene notas en un periodo, lo anota en `errores[]` y sigue. No
  aborta la corrida entera por uno.

## Detalles que costaron

- **Las columnas se buscan por su encabezado, nunca por posición.** Una
  definitiva leída de la columna de al lado no se nota: es un número plausible
  en el lugar correcto del JSON. `npm test` lo comprueba agregando una columna
  al principio y exigiendo que el resultado no cambie.
- **Los decimales vienen con coma** (`95,00`). Y cuando una celda no se puede
  leer el campo queda en `null`, no en `0`: un 0 de verdad significa "sin
  calificar" y es un dato. Confundirlos haría que un error de lectura se viera
  como un estudiante con cero.
- **El GridView mete un pie** que no es un estudiante. Se descarta exigiendo que
  la primera celda sea un código de 10 dígitos.
- **Si un curso tuviera más de una materia**, se lee la que la plataforma dejó
  puesta y queda anotado en `avisos[]`. Con una sola materia —el caso de hoy—
  no pasa nunca, pero no se pierde en silencio.

## El JSON

```json
{
  "generadoEn": "2026-09-23T03:00:00.000Z",
  "profesor": "451",
  "corte": "UNICO",
  "periodos": ["01", "02"],
  "campos": ["cod_alum", "nombre", "definitiva"],
  "cursos": [
    {
      "periodo": "01",
      "curso": "801",
      "materia": "2508",
      "materiaNombre": "Information Technology",
      "estudiantes": [
        { "cod_alum": "2010000000", "nombre": "APELLIDO NOMBRE", "definitiva": 87 }
      ]
    }
  ],
  "avisos": [],
  "errores": []
}
```

## Pruebas

```bash
npm test          # recon/pruebas/prueba-historial.mjs va adentro
```

Corre el script tal cual sobre un jsdom que replica la pantalla, simulando la
recarga en cada postback. Comprueba que no pulse nada, que no se le escape ni se
invente una fila, que no exceda las recargas anunciadas y que las columnas se
lean por encabezado. Los códigos de las pruebas son inventados.
