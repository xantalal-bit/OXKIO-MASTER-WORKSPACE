[CmdletBinding()]
param([ValidateRange(1,65535)][int]$Port = 3000)

# Solo lectura: nunca detiene procesos, lee credenciales ni imprime argumentos.
Write-Host "[OXKIO] Diagnostico de listener TCP en puerto $Port"
try {
    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
        Sort-Object -Property OwningProcess -Unique)
} catch {
    Write-Host "[OXKIO] Consulta de listeners no disponible; no se ha modificado ningun proceso."
    exit 0
}
if ($listeners.Count -eq 0) {
    Write-Host "[OXKIO] No hay listener TCP confirmado en el puerto $Port."
    exit 0
}
foreach ($listener in $listeners) {
    $ownerPid = [int]$listener.OwningProcess
    $procName = 'desconocido'
    $parentPid = 'no disponible'
    try {
        $proc = Get-Process -Id $ownerPid -ErrorAction Stop
        $procName = $proc.ProcessName
    } catch {}
    try {
        $details = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $ownerPid" -ErrorAction Stop
        if ($details) { $parentPid = [string]$details.ParentProcessId }
    } catch {}
    Write-Host "[OXKIO] LISTENER PID=$ownerPid; proceso=$procName; PID padre=$parentPid; direccion=$($listener.LocalAddress):$Port"
}
Write-Host '[OXKIO] Diagnostico terminado. Sin cambios en procesos ni configuracion.'
