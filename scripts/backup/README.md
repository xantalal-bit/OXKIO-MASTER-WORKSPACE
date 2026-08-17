# Backup automático de checkpoint (N2)

Automatiza el procedimiento de backup técnico/documental ya demostrado
manualmente y verificado con PASS remoto (checkpoint post-B1, 2026-08-16).
No es un sistema nuevo: reproduce mecánicamente los mismos pasos.

## Qué se automatiza

Script: `Backup-XantalalCheckpoint.ps1`

1. Verifica baseline (repo Git accesible, rutas de origen existen, destino
   Google Drive accesible y `GoogleDriveFS` en ejecución). Fail-closed si
   falta cualquiera de estas condiciones.
2. Hace staging con `robocopy` de las mismas 4 rutas ya validadas:
   `00_GOVERNANCE`, `10_PRODUCTS/OXKIO`, `40_LAB`, `50_ARCHIVE`.
3. Aplica las mismas exclusiones ya validadas manualmente (ver tabla
   abajo), más un directorio y tres patrones añadidos durante la
   verificación manual de N2 al detectar snapshots históricos sensibles
   no cubiertos por el nombre exacto.
4. Genera el ZIP (`Compress-Archive`, nivel Optimal) y su SHA-256.
5. Genera un manifiesto de texto sin secretos.
6. Copia ZIP + manifiesto + `.sha256` a los dos destinos ya validados.
7. Verifica tamaño y hash idénticos en ambas copias.
8. Hace un restore test del ZIP en una carpeta temporal aislada (fuera de
   OneDrive y del proyecto), verifica conteo de ficheros y estructura, y
   borra únicamente esa carpeta temporal.
9. Aplica retención (ver abajo) solo si el nuevo backup dio PASS.

Salida: `exit 0` = PASS. Cualquier otro código = FAIL; no borra el último
backup válido ni modifica ningún original.

## Exclusiones aplicadas

Directorios: `node_modules`, `.git`, `.cache`, `.audit-final-output`,
`tmp`, `temp`, `runtime-snapshots`.

Ficheros por nombre exacto: `.env`, `.env.local`, `googleTokens.json`,
`memory.json`, `approvalQueue.json`, `approvalQueue.v2.json`,
`executionLog.json`.

Patrones: `*firebase-adminsdk*.json`, `*firebase-admin-service-account*.json`,
`approvalQueue_*.json`, `memory_*.json`, `executionLog_*.json`.

## Destinos

- Local: `C:\Users\janta\Documents\XANTALAL_BACKUPS\`
- Google Drive: `C:\Users\janta\Mi unidad\XANTALAL_BACKUPS\`

Ninguna ruta se inventa: si el destino de Drive no existe o el proceso
`GoogleDriveFS` no está activo, el script falla-cerrado sin intentar otra
ubicación.

## Periodicidad

Tarea de Windows Task Scheduler `XANTALAL-OXKIO-Backup-Checkpoint`,
semanal (domingos 21:00), usuario actual, sin credenciales ni passphrase
almacenadas. Ejecuta únicamente el script probado.

## Checkpoint de cierre de fase/bloque

Para marcar manualmente un backup como cierre de fase (exento de
retención automática):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Backup-XantalalCheckpoint.ps1 -Milestone
```

El nombre del backup añade el sufijo `-CIERRE` y nunca se borra por
retención automática.

**Nota:** el checkpoint manual `XANTALAL-OXKIO-CHECKPOINT-20260816-200112-a721285`
(cierre post-B1) fue creado antes de que existiera esta convención y por
tanto NO lleva el sufijo `-CIERRE`. Mientras no se le añada manualmente
ese sufijo (o se documente su exención de otro modo), quedará sujeto a la
retención automática igual que un backup rutinario una vez se acumulen
más de 8 backups rutinarios. Revisar antes de que eso ocurra.

## Retención V1

Solo backups **rutinarios** (sin `-CIERRE` en el nombre): se conservan los
8 más recientes (por nombre, que es ordenable por timestamp) en cada
destino; los más antiguos se eliminan junto a su manifiesto y `.sha256`.
La retención solo se ejecuta **después** de confirmar PASS del nuevo
backup, nunca antes.

## Gestión de fallos

Ante FAIL, se crea/actualiza `C:\Users\janta\Documents\XANTALAL_BACKUPS\BACKUP-FAILED.txt`
con fecha/hora, fase fallida, mensaje técnico saneado (sin secretos) y
código de salida. Un `BACKUP-FAILED.txt` previo, en la siguiente ejecución
con PASS, se archiva como `BACKUP-FAILED-RESOLVED-<timestamp>.txt` (no se
borra en silencio).

## Explícitamente FUERA de N2

- Backup cifrado de `memory.json` + `approvalQueue.json` (procedimiento
  manual ya validado en PASO 3B; sigue siendo manual, con la passphrase
  introducida siempre por el titular en su propia terminal).
- La passphrase de cifrado: nunca en script, comando, log, variable ni
  junto al backup.
- Restore test del backup cifrado.
- Copia física de recuperación de la clave.
- Assets pesados de Xose/PROFESOR-IA (~769 MB): no incorporados; el
  procedimiento ya validado para ese checkpoint (`ASSET-PROFESOR-IA`) es
  independiente y no se ha automatizado en N2.
- Los 4 registros paralelos de nomenclatura detectados en N1.
- Cualquier cosa relacionada con B2.

## Qué sigue siendo manual

- El backup cifrado de estado (memory/approvalQueue) y su restore.
- La custodia y copia física de la passphrase.
- Decidir cuándo marcar un backup como `-Milestone`.
- Revisar la tarea programada si cambia la ruta del repositorio o del
  usuario de Windows.
