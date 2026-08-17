<#
.SYNOPSIS
    Backup automatico minimo (N2) del checkpoint tecnico/documental de XANTALAL/OXKIO.

.DESCRIPTION
    Automatiza EXCLUSIVAMENTE el procedimiento ya demostrado manualmente y
    verificado con PASS remoto: staging con exclusiones de secretos, ZIP,
    SHA-256, manifiesto sin secretos, copia local + Google Drive, verificacion
    de integridad/sincronizacion y restore test del ZIP NO cifrado.

    Fuera de alcance deliberadamente (ver README.md de esta carpeta):
    backup cifrado de memory.json/approvalQueue.json, passphrase, restore de
    ese backup cifrado, copia fisica de la clave, assets pesados de Xose.

    Fail-closed: cualquier paso que no pueda verificarse detiene la ejecucion
    sin borrar el ultimo backup valido y sin modificar ningun original.

.PARAMETER Milestone
    Marca este backup como cierre de fase/bloque (sufijo -CIERRE en el
    nombre). Los backups marcados asi quedan exentos de la retencion
    automatica de los ultimos 8 backups rutinarios.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\Backup-XantalalCheckpoint.ps1

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\Backup-XantalalCheckpoint.ps1 -Milestone
#>

[CmdletBinding()]
param(
    [switch]$Milestone
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Rutas fijas (mismas ya validadas manualmente; no inventar alternativas)
# ---------------------------------------------------------------------------
$RepoRoot     = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$XantalalRoot = Resolve-Path (Join-Path $RepoRoot '..\..')
$LocalDest    = 'C:\Users\janta\Documents\XANTALAL_BACKUPS'
$DriveDest    = 'C:\Users\janta\Mi unidad\XANTALAL_BACKUPS'
$FailMarker   = Join-Path $LocalDest 'BACKUP-FAILED.txt'

$SourceRelPaths = @(
    '00_GOVERNANCE',
    '10_PRODUCTS\OXKIO',
    '40_LAB',
    '50_ARCHIVE'
)

$ExcludeDirs = @('node_modules', '.git', '.cache', '.audit-final-output', 'tmp', 'temp', 'runtime-snapshots')

$ExcludeFileNames = @(
    '.env',
    '.env.local',
    'googleTokens.json',
    'memory.json',
    'approvalQueue.json',
    'approvalQueue.v2.json',
    'executionLog.json'
)

# Patrones adicionales detectados en la verificacion manual de N2 (2026-08-17):
# backend/backups/runtime-snapshots/ contiene copias historicas de los mismos
# stores sensibles bajo nombres con timestamp (p.ej. approvalQueue_2026-07-06_
# PRE_MIGRATION.json, memory_2026-07-06_PRE_MIGRATION.json), no cubiertas por
# el nombre exacto. Se excluye el directorio completo (arriba) y, como
# refuerzo defensivo, tambien por patron de nombre en cualquier ubicacion.
$ExcludeFilePatterns = @(
    '*firebase-adminsdk*.json',
    '*firebase-admin-service-account*.json',
    'approvalQueue_*.json',
    'memory_*.json',
    'executionLog_*.json'
)

$Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$StagingRoot = Join-Path $env:TEMP "oxkio-checkpoint-staging-$Timestamp"
$RestoreRoot = Join-Path $env:TEMP "oxkio-checkpoint-restore-$Timestamp"

function Write-FailMarker {
    param(
        [string]$Phase,
        [string]$Message,
        [int]$Code
    )
    $lines = @(
        "Fecha/hora: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
        "Fase fallida: $Phase",
        "Mensaje tecnico (sanitizado): $Message",
        "Codigo de salida: $Code"
    )
    try {
        if (-not (Test-Path $LocalDest)) {
            New-Item -ItemType Directory -Path $LocalDest -Force | Out-Null
        }
        Set-Content -Path $FailMarker -Value $lines -Encoding UTF8
    } catch {
        Write-Warning "No se pudo escribir el marcador de fallo: $($_.Exception.Message)"
    }
}

function Clear-StagingArtifacts {
    if (Test-Path $StagingRoot) {
        Remove-Item -Path $StagingRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path $RestoreRoot) {
        Remove-Item -Path $RestoreRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Resolve-FailedFast {
    param(
        [string]$Phase,
        [string]$Message
    )
    Write-Error "[$Phase] $Message"
    Write-FailMarker -Phase $Phase -Message $Message -Code 1
    Clear-StagingArtifacts
    exit 1
}

Write-Host "=== Backup-XantalalCheckpoint : inicio $Timestamp ==="

# ---------------------------------------------------------------------------
# PASO: baseline / entorno
# ---------------------------------------------------------------------------
try {
    Push-Location $RepoRoot
    $headShort = (git rev-parse --short HEAD 2>$null).Trim()
    Pop-Location
} catch {
    Resolve-FailedFast -Phase 'baseline-git' -Message 'No se pudo leer HEAD del repositorio OXKIO.'
}
if ([string]::IsNullOrWhiteSpace($headShort)) {
    Resolve-FailedFast -Phase 'baseline-git' -Message 'HEAD vacio o ilegible.'
}

foreach ($rel in $SourceRelPaths) {
    $full = Join-Path $XantalalRoot $rel
    if (-not (Test-Path $full)) {
        Resolve-FailedFast -Phase 'baseline-paths' -Message "Ruta de origen ausente: $rel"
    }
}

if (-not (Test-Path $DriveDest)) {
    Resolve-FailedFast -Phase 'baseline-drive' -Message 'Ruta de Google Drive de destino no existe. Fail-closed: no se inventa otra ruta.'
}

$driveProcess = Get-Process -Name 'GoogleDriveFS' -ErrorAction SilentlyContinue
if (-not $driveProcess) {
    Resolve-FailedFast -Phase 'baseline-drive' -Message 'Proceso GoogleDriveFS no esta en ejecucion. Fail-closed.'
}

if (-not (Test-Path $LocalDest)) {
    New-Item -ItemType Directory -Path $LocalDest -Force | Out-Null
}

# ---------------------------------------------------------------------------
# PASO: staging con exclusiones (robocopy, mismas exclusiones ya validadas)
# ---------------------------------------------------------------------------
New-Item -ItemType Directory -Path $StagingRoot -Force | Out-Null

foreach ($rel in $SourceRelPaths) {
    $src = Join-Path $XantalalRoot $rel
    $dst = Join-Path $StagingRoot $rel

    $robocopyArgs = @(
        $src, $dst, '/E',
        '/XD'
    ) + $ExcludeDirs + @('/XF') + $ExcludeFileNames + $ExcludeFilePatterns + @(
        '/NFL', '/NDL', '/NJH', '/NJS', '/NC', '/NS', '/NP'
    )

    robocopy @robocopyArgs | Out-Null
    if ($LASTEXITCODE -ge 8) {
        Resolve-FailedFast -Phase 'staging' -Message "robocopy fallo (codigo $LASTEXITCODE) copiando $rel"
    }
}

$stagedFiles = Get-ChildItem -Path $StagingRoot -Recurse -File
$stagedFileCount = $stagedFiles.Count
if ($stagedFileCount -eq 0) {
    Resolve-FailedFast -Phase 'staging' -Message 'Staging vacio tras robocopy; no se genera un backup vacio.'
}

# secret sweep sobre el staging: nombres prohibidos no deben aparecer
$forbiddenHits = Get-ChildItem -Path $StagingRoot -Recurse -File |
    Where-Object {
        $name = $_.Name
        ($ExcludeFileNames -contains $name) -or
        ($name -like '*firebase-adminsdk*.json') -or
        ($name -like '*firebase-admin-service-account*.json')
    }
if ($forbiddenHits) {
    Resolve-FailedFast -Phase 'secret-sweep' -Message 'Se detecto un nombre de archivo prohibido en el staging tras robocopy.'
}

# ---------------------------------------------------------------------------
# PASO: ZIP + SHA-256
# ---------------------------------------------------------------------------
$milestoneSuffix = ''
if ($Milestone) { $milestoneSuffix = '-CIERRE' }

$backupName = "XANTALAL-OXKIO-CHECKPOINT-$Timestamp-$headShort$milestoneSuffix"
$zipPath = Join-Path $env:TEMP "$backupName.zip"

if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

Compress-Archive -Path (Join-Path $StagingRoot '*') -DestinationPath $zipPath -CompressionLevel Optimal
if (-not (Test-Path $zipPath)) {
    Resolve-FailedFast -Phase 'zip' -Message 'Compress-Archive no genero el fichero ZIP esperado.'
}

$zipHash = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash
$zipSize = (Get-Item $zipPath).Length

# ---------------------------------------------------------------------------
# PASO: manifiesto SIN secretos
# ---------------------------------------------------------------------------
$manifestName = "$backupName-manifest.txt"
$manifestPath = Join-Path $env:TEMP $manifestName

$manifestLines = @(
    'XANTALAL / OXKIO - CHECKPOINT MANIFEST (automatizado N2)'
    '========================================================'
    ''
    "Fecha/hora de creacion: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    "Nombre del checkpoint:  $backupName"
    "Tipo: $(if ($Milestone) { 'CIERRE DE FASE/BLOQUE (exento de retencion)' } else { 'Rutinario (sujeto a retencion, ultimos 8)' })"
    ''
    'Estado Git en el momento de la captura'
    '---------------------------------------'
    "HEAD (short): $headShort"
    ''
    'Rutas de origen incluidas'
    '---------------------------------------'
) + ($SourceRelPaths | ForEach-Object { "- $_" }) + @(
    ''
    'Exclusiones obligatorias aplicadas'
    '---------------------------------------'
    "Directorios: $($ExcludeDirs -join ', ')"
    "Archivos por nombre: $($ExcludeFileNames -join ', ')"
    "Patrones: $($ExcludeFilePatterns -join ', ')"
    ''
    'Numeros'
    '---------------------------------------'
    "Numero de archivos incluidos: $stagedFileCount"
    "Tamano del ZIP (bytes): $zipSize"
    "SHA-256 del ZIP: $zipHash"
    ''
    'Herramienta usada'
    '---------------------------------------'
    'Windows PowerShell 5.1 - Compress-Archive (CompressionLevel=Optimal).'
    'Staging previo con robocopy (/XD /XF). Hash con Get-FileHash -Algorithm SHA256.'
    'Script: scripts/backup/Backup-XantalalCheckpoint.ps1'
    ''
    'CERO valores de secretos aparecen en este manifiesto.'
)

Set-Content -Path $manifestPath -Value $manifestLines -Encoding UTF8

$hashSidecarName = "$backupName.sha256"
$hashSidecarPath = Join-Path $env:TEMP $hashSidecarName
Set-Content -Path $hashSidecarPath -Value "$zipHash *$backupName.zip" -Encoding ASCII

# ---------------------------------------------------------------------------
# PASO: copia a destinos LOCAL y GOOGLE DRIVE
# ---------------------------------------------------------------------------
$artifacts = @(
    @{ Src = $zipPath;         Name = "$backupName.zip" },
    @{ Src = $manifestPath;    Name = $manifestName },
    @{ Src = $hashSidecarPath; Name = $hashSidecarName }
)

foreach ($a in $artifacts) {
    Copy-Item -Path $a.Src -Destination (Join-Path $LocalDest $a.Name) -Force
    Copy-Item -Path $a.Src -Destination (Join-Path $DriveDest $a.Name) -Force
}

# ---------------------------------------------------------------------------
# PASO: verificacion de integridad y sincronizacion
# ---------------------------------------------------------------------------
$localZip = Join-Path $LocalDest "$backupName.zip"
$driveZip = Join-Path $DriveDest "$backupName.zip"

if (-not (Test-Path $localZip) -or -not (Test-Path $driveZip)) {
    Resolve-FailedFast -Phase 'copy-verify' -Message 'Copia local o Drive del ZIP no existe tras la copia.'
}

$localHash = (Get-FileHash -Path $localZip -Algorithm SHA256).Hash
$driveHash = (Get-FileHash -Path $driveZip -Algorithm SHA256).Hash
$localSize = (Get-Item $localZip).Length
$driveSize = (Get-Item $driveZip).Length

if ($localHash -ne $zipHash -or $driveHash -ne $zipHash) {
    Resolve-FailedFast -Phase 'copy-verify' -Message 'Hash de la copia local o Drive no coincide con el original.'
}
if ($localSize -ne $zipSize -or $driveSize -ne $zipSize) {
    Resolve-FailedFast -Phase 'copy-verify' -Message 'Tamano de la copia local o Drive no coincide con el original.'
}

# ---------------------------------------------------------------------------
# PASO: restore test del ZIP NO cifrado, en carpeta temporal aislada
# ---------------------------------------------------------------------------
New-Item -ItemType Directory -Path $RestoreRoot -Force | Out-Null
try {
    Expand-Archive -Path $localZip -DestinationPath $RestoreRoot -Force
} catch {
    Resolve-FailedFast -Phase 'restore-test' -Message "Expand-Archive fallo: $($_.Exception.Message)"
}

$restoredFiles = Get-ChildItem -Path $RestoreRoot -Recurse -File
$restoredFileCount = $restoredFiles.Count

if ($restoredFileCount -ne $stagedFileCount) {
    Resolve-FailedFast -Phase 'restore-test' -Message "Conteo restaurado ($restoredFileCount) no coincide con el staged ($stagedFileCount)."
}

foreach ($rel in $SourceRelPaths) {
    $restoredSub = Join-Path $RestoreRoot $rel
    if (-not (Test-Path $restoredSub)) {
        Resolve-FailedFast -Phase 'restore-test' -Message "Subcarpeta esperada ausente tras restore: $rel"
    }
}

# limpieza: solo el restore temporal y el staging (nunca el backup)
Clear-StagingArtifacts
Remove-Item -Path $zipPath -Force -ErrorAction SilentlyContinue
Remove-Item -Path $manifestPath -Force -ErrorAction SilentlyContinue
Remove-Item -Path $hashSidecarPath -Force -ErrorAction SilentlyContinue

# ---------------------------------------------------------------------------
# PASO: si habia un fallo previo registrado, archivarlo (no borrar en silencio)
# ---------------------------------------------------------------------------
if (Test-Path $FailMarker) {
    $resolvedName = "BACKUP-FAILED-RESOLVED-$Timestamp.txt"
    Move-Item -Path $FailMarker -Destination (Join-Path $LocalDest $resolvedName) -Force
    Write-Host "Fallo previo archivado como $resolvedName (no borrado en silencio)."
}

# ---------------------------------------------------------------------------
# PASO: retencion V1 (solo backups rutinarios, solo tras PASS del nuevo)
# ---------------------------------------------------------------------------
if (-not $Milestone) {
    foreach ($dest in @($LocalDest, $DriveDest)) {
        $routineZips = Get-ChildItem -Path $dest -Filter 'XANTALAL-OXKIO-CHECKPOINT-*.zip' |
            Where-Object { $_.Name -notlike '*-CIERRE.zip' } |
            Sort-Object Name -Descending

        if ($routineZips.Count -gt 8) {
            $toDelete = $routineZips | Select-Object -Skip 8
            foreach ($old in $toDelete) {
                $baseName = [System.IO.Path]::GetFileNameWithoutExtension($old.Name)
                Remove-Item -Path $old.FullName -Force -ErrorAction SilentlyContinue
                Remove-Item -Path (Join-Path $dest "$baseName-manifest.txt") -Force -ErrorAction SilentlyContinue
                Remove-Item -Path (Join-Path $dest "$baseName.sha256") -Force -ErrorAction SilentlyContinue
                Write-Host "Retencion: eliminado backup rutinario antiguo $($old.Name)"
            }
        }
    }
}

Write-Host "=== PASS: $backupName ==="
Write-Host "Local: $localZip"
Write-Host "Drive: $driveZip"
Write-Host "SHA-256: $zipHash"
exit 0
