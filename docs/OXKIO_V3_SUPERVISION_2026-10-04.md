# OXKIO V3 — supervisión del arranque persistente — 2026-10-04

## Motivo

El 04/10/2026 el runtime del puerto 3000 cayó entre las 17:01 y las 17:33 (`LastTaskResult` 0xC000013A, señal de consola al wrapper) y nada lo relanzó: el `RestartCount` de la tarea solo cubre fallos al **lanzar**, no la muerte del proceso. Además, el log `Microsoft-Windows-TaskScheduler/Operational` estaba desactivado, por lo que no quedó rastro de la terminación.

## Cambio en el código (esta PR)

`scripts/Start-OxkioV3.ps1`, en modo servicio, es idempotente antes de rotar logs o arrancar:

- Si en el puerto configurado ya escucha un `node.exe` cuyo padre es **el lanzador de este repositorio**: registra `already-running`, termina con 0 y no rota los logs vivos.
- Si el puerto lo ocupa otro proceso: registra `port-busy`, termina con 2 y no arranca nada.
- En otro caso: registra `start` y arranca como antes.
- Cada decisión se añade a `oxkio-v3.supervisor.log`, en ASCII y sin BOM: fecha, código y PID, nunca valores ni secretos. Se rota a `.1` al superar 1 MB.

`-ValidateOnly` no cambia.

## Configuración de la tarea (después de mergear y activar esta PR)

Añadir un disparador que repita cada 5 minutos, conservando el de inicio de sesión. Con `MultipleInstances=IgnoreNew`, mientras la tarea vive el disparo se ignora; si el proceso murió, la tarea arranca y la guarda decide. El tiempo máximo sin servicio pasa a ser de unos 5 minutos.

```powershell
$t = Get-ScheduledTask -TaskName 'OXKIO V3 Cliente Cero'
$every5 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes 5)
Set-ScheduledTask -TaskName 'OXKIO V3 Cliente Cero' -Trigger @($t.Triggers + $every5)
```

No requiere administrador (tarea del propio usuario, RunLevel Limited). Orden obligatorio: primero activar la guarda; sin ella, un disparo con el lanzador aún vivo intentaría otra instancia.

## Puerta humana: log Operational del Programador de tareas

Requiere una consola de PowerShell **como administrador**:

```powershell
wevtutil sl Microsoft-Windows-TaskScheduler/Operational /e:true
```

Comprobación (sin administrador): `(Get-WinEvent -ListLog 'Microsoft-Windows-TaskScheduler/Operational').IsEnabled` debe devolver `True`.

## Evidencia

- Tests nuevos en `start-oxkio-v3.test.js` (stubs, puertos libres aleatorios, sin servidor real ni secretos):
  - puerto libre → arranca y registra `start`, sin BOM;
  - proceso ajeno en el puerto → código 2, no arranca y no rota los logs vivos;
  - OXKIO ya en marcha desde este lanzador → código 0, no arranca otra instancia y no rota.
- Comprobación en solo lectura contra producción: la lógica de la guarda reconoce el node vivo del 3000 (padre: lanzador canónico) como `already-running`.
- Suite secuencial: 1742 tests, 1726 PASS, 0 FAIL, 16 SKIP. Secretos: 0.
