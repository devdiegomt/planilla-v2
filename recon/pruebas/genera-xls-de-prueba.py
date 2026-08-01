import xlwt, random, os

# Los .xls se generan junto a este script, no en el cwd, para que
# `npm test` funcione desde la raiz del repo.
os.chdir(os.path.dirname(os.path.abspath(__file__)))

def guarda(nombre, filas, codigos_como_texto):
    wb = xlwt.Workbook(encoding='utf-8')
    ws = wb.add_sheet('Califica')
    ws.write(0, 0, 'GIMNASIO LOS ARRAYANES BILINGUE')
    ws.write(1, 0, 'Califica-801-2508-02')
    enc = ['No', 'COD_ALUM', 'ESTUDIANTE', 'N1', 'N2', 'N3', 'DEF']
    for c, h in enumerate(enc):
        ws.write(3, c, h)
    for i, (cod, nom) in enumerate(filas):
        f = 4 + i
        ws.write(f, 0, i + 1)
        ws.write(f, 1, cod if codigos_como_texto else int(cod))
        ws.write(f, 2, nom)
        for c in range(3, 7):
            ws.write(f, c, round(random.uniform(1, 5), 1))
    wb.save(nombre)

# --- caso 1: realista, 30 estudiantes, codigos como texto, con tildes/enies ---
base = ['MUNOZ PENA ANDRES FELIPE', 'NINO GARZON MARIA JOSE', 'ANGEL RODRIGUEZ JUAN',
        'ZUNIGA ACUNA VALENTINA', 'PENA MUNOZ SANTIAGO ANDRES']
f1 = [(str(1007718000 + i), base[i % len(base)] + ' ' + str(i)) for i in range(30)]
guarda('caso1_texto.xls', f1, True)

# --- caso 2: identico pero los codigos van como NUMERO ---
guarda('caso2_numero.xls', f1, False)

# --- caso 3: fuerza registros CONTINUE en el SST ---
# Cadenas largas y unicas hasta pasar de sobra los 8224 bytes por registro,
# mezclando ASCII puro con acentuadas para que el grbit cambie en los cortes.
f3 = []
for i in range(600):
    largo = 90 + (i % 40)
    if i % 3 == 0:
        nom = ('MUNOZ PENA ANDRES ' * 10)[:largo] + str(i)      # comprimible a 8 bits
    elif i % 3 == 1:
        nom = ('ÑÁÉÍÓÚ MUÑOZ PEÑA ' * 10)[:largo] + str(i)      # latin1
    else:
        nom = ('ΩΨΧ ΦΥΤΣΡΠ ΟΞΝΜΛΚ ' * 10)[:largo] + str(i)      # obliga UTF-16
    f3.append((str(1007710000 + i), nom))
guarda('caso3_continue.xls', f3, True)

print('generados')
for n in ['caso1_texto.xls', 'caso2_numero.xls', 'caso3_continue.xls']:
    import os
    print(' ', n, os.path.getsize(n), 'bytes')

# --- caso 4: replica el layout REAL de Califica-801-2508-02.xls ---------------
# Membrete disperso, encabezados en la fila 12, columna 0 siempre vacia.
def guarda_real(nombre, n_alumnos, codigos_como_texto, filas_membrete_extra=0):
    wb = xlwt.Workbook(encoding='utf-8')
    ws = wb.add_sheet('RepCalifica')
    d = filas_membrete_extra
    ws.write(1, 5, 'GIMNASIO LOS ARRAYANES BILINGUE')
    ws.write(4, 5, 'Año Lectivo: 2026')
    ws.write(10 + d, 1, 'Curso: OCHOCIENTOS UNO (801) Materia:Information Technology')
    logros = ['Ciencias T2 - C4. Observe Carefully With Bodily Learning',
              'Ciencias T2 - C5. Improve Reading Or Digital Support',
              'Matemat T2 - C6. Aplica Simple Con Enteros']
    for c in range(8, 18):
        ws.write(11 + d, c, logros[c % 3])
    enc = ['COD_PER', 'COD_CUR', 'COD_GRU', 'COD_MAT', 'Nombre Materia',
           'COD_ALUM', 'Nombre Alumno']
    for c, h in enumerate(enc):
        ws.write(12 + d, c + 1, h)
    for c in range(8, 18):
        ws.write(12 + d, c, 'log_%d' % (200 + c))
    apellidos = ['ANGEL BRAVO MEJIA', 'ÁLVAREZ SUÁREZ ISABEL SOFÍA',
                 'MUÑOZ PEÑA ANDRÉS', 'ZÚÑIGA MOLINA NICOLÁS']
    for i in range(n_alumnos):
        f = 13 + d + i
        cod = str(2019034000 + i * 7)
        ws.write(f, 1, '02')
        ws.write(f, 2, '801')
        ws.write(f, 3, '08')
        ws.write(f, 4, '2508')
        ws.write(f, 5, 'Information Technology')
        ws.write(f, 6, cod if codigos_como_texto else int(cod))
        ws.write(f, 7, apellidos[i % len(apellidos)] + ' ' + str(i))
        for c in range(8, 18):
            ws.write(f, c, (i * 10 + c) % 101)
    wb.save(nombre)

guarda_real('caso4_layout_real.xls', 28, True)
guarda_real('caso5_cod_numerico.xls', 28, False)
guarda_real('caso6_membrete_corrido.xls', 28, True, filas_membrete_extra=5)
for n in ['caso4_layout_real.xls', 'caso5_cod_numerico.xls', 'caso6_membrete_corrido.xls']:
    import os
    print(' ', n, os.path.getsize(n), 'bytes')

# --- caso 7: hoja sin columna COD_ALUM (debe fallar limpio) -------------------
wb = xlwt.Workbook(encoding='utf-8')
ws = wb.add_sheet('RepCalifica')
for c, h in enumerate(['No', 'MATRICULA', 'ESTUDIANTE', 'NOTA']):
    ws.write(3, c, h)
for i in range(5):
    ws.write(4 + i, 0, i + 1)
    ws.write(4 + i, 1, 'M%04d' % i)
    ws.write(4 + i, 2, 'ALGUIEN APELLIDO %d' % i)
    ws.write(4 + i, 3, 50)
wb.save('caso7_sin_codalum.xls')
import os
print('  caso7_sin_codalum.xls', os.path.getsize('caso7_sin_codalum.xls'), 'bytes')

# --- caso 8: un solo archivo con VARIAS hojas, como Califica-451-02.xls -------
# El export por profesor trae 19 hojas, una por curso. Se incluye una hoja rota
# a proposito para verificar que no tumba a las demas.
def hoja_curso(ws, cod_cur, cod_gru, n_alumnos, semilla, rota=False):
    ws.write(0, 0, 1035)
    ws.write(1, 5, 'GIMNASIO LOS ARRAYANES BILINGUE')
    ws.write(10, 1, 'Curso: X (%s) Materia:Information Technology' % cod_cur)
    if rota:
        # Sin encabezado COD_ALUM: debe ir a errores, no romper el archivo.
        ws.write(12, 1, 'OTRA COSA')
        return
    enc = ['COD_PER', 'COD_CUR', 'COD_GRU', 'COD_MAT', 'Nombre Materia',
           'COD_ALUM', 'Nombre Alumno']
    for c, h in enumerate(enc):
        ws.write(12, c + 1, h)
    for i in range(n_alumnos):
        f = 13 + i
        ws.write(f, 1, '02')
        ws.write(f, 2, cod_cur)
        ws.write(f, 3, cod_gru)
        ws.write(f, 4, '2508')
        ws.write(f, 5, 'Information Technology')
        ws.write(f, 6, str(semilla + i * 3))
        ws.write(f, 7, 'APELLIDO NOMBRE %d' % i)
        for c in range(8, 18):
            ws.write(f, c, (i * 7 + c) % 101)

wb = xlwt.Workbook(encoding='utf-8')
hoja_curso(wb.add_sheet('Sheet1'), '801', '08', 28, 2019034000)
hoja_curso(wb.add_sheet('Sheet2'), '802', '08', 25, 2020011000)
hoja_curso(wb.add_sheet('Sheet3'), '1101', '11', 31, 2017005000)
hoja_curso(wb.add_sheet('Sheet4'), '', '', 0, 0, rota=True)
wb.save('caso8_multihoja.xls')
print('  caso8_multihoja.xls', os.path.getsize('caso8_multihoja.xls'), 'bytes')
