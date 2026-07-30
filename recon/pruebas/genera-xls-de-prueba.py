import xlwt, random

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
