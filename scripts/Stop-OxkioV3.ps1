[CmdletBinding()]
param([switch]$PrintOnly)

# Stops the OXKIO launcher processes started from THIS repository (canonical
# launcher or the V3 wrapper). Their Node child dies with them through the
# launcher's Job Object (kill-on-close). Nothing else is touched.

$ErrorActionPreference = 'Stop'
$scripts = [Regex]::Escape($PSScriptRoot)
$launchers = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -match "$scripts\\Start-Oxkio(V3)?\.ps1" -and $_.ProcessId -ne $PID }
if (-not $launchers) { Write-Host '[OK] No hay lanzadores OXKIO de este repositorio en ejecucion.'; exit 0 }
foreach ($launcher in $launchers) {
    if ($PrintOnly) { Write-Host "Se detendria el lanzador PID $($launcher.ProcessId)."; continue }
    Stop-Process -Id $launcher.ProcessId -Force
    Write-Host "[OK] Lanzador PID $($launcher.ProcessId) detenido (su Node cae con el Job Object)."
}
