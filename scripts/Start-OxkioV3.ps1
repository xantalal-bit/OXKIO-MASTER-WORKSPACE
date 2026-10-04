[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ConfigPath,
    [switch]$ValidateOnly,
    # Tests only: replaces the canonical launcher with a stub.
    [string]$LauncherPath = ''
)

# Windows PowerShell 5.1 leaves $PSScriptRoot empty inside param() defaults, so
# the canonical launcher next to this script is resolved here, in the body.
if ([string]::IsNullOrWhiteSpace($LauncherPath)) { $LauncherPath = Join-Path $PSScriptRoot 'Start-Oxkio.ps1' }

# Persistent local start of OXKIO V3 (Cliente Cero). It only sets NON-secret
# configuration in this Process and delegates to the canonical launcher, which
# loads every secret from Secret Manager into Process (never disk). The config
# file may contain only allowlisted variable names; anything that looks like a
# credential is refused, so a secret can never be persisted here.

$ErrorActionPreference = 'Stop'

function Stop-V3Start {
    param([string]$Message)
    Write-Host "[ERROR] $Message"
    exit 1
}

$allowed = @(
    'PORT',
    'OXKIO_V3_ENABLED',
    'OXKIO_V3_MEMORY_ROOT',
    'OXKIO_V3_PLANNER_DAILY_BUDGET_USD',
    'OXKIO_V3_REASONING_INTERNAL_EGRESS',
    'OXKIO_V3_PUBLIC_RESEARCH',
    'OXKIO_V3_REASONING_PROVIDER',
    'OXKIO_V3_REASONING_MODEL',
    'OXKIO_V3_REASONING_BASE_URL',
    'OXKIO_V3_REASONING_INPUT_USD_PER_MILLION',
    'OXKIO_V3_REASONING_OUTPUT_USD_PER_MILLION',
    'OXKIO_V3_REASONING_PRICING_REVIEWED_AT'
)

if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) { Stop-V3Start 'Configuracion V3 no encontrada.' }
try { $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json } catch { Stop-V3Start 'Configuracion V3 no es JSON valido.' }
if (-not $config.environment) { Stop-V3Start 'Configuracion V3 sin bloque environment.' }

foreach ($property in $config.environment.PSObject.Properties) {
    $name = [string]$property.Name
    if ($name -match '(?i)KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|RUNTIME_URL|UIDS') { Stop-V3Start "Variable no permitida en la configuracion V3: $name (los secretos e identidades no se guardan aqui)." }
    if ($name -notin $allowed) { Stop-V3Start "Variable desconocida en la configuracion V3: $name." }
    [Environment]::SetEnvironmentVariable($name, [string]$property.Value, 'Process')
}
if ([Environment]::GetEnvironmentVariable('OXKIO_V3_ENABLED', 'Process') -ne 'true') { Stop-V3Start 'La configuracion V3 debe fijar OXKIO_V3_ENABLED=true.' }
$memoryRoot = [Environment]::GetEnvironmentVariable('OXKIO_V3_MEMORY_ROOT', 'Process')
if ([string]::IsNullOrWhiteSpace($memoryRoot) -or -not [System.IO.Path]::IsPathRooted($memoryRoot)) { Stop-V3Start 'OXKIO_V3_MEMORY_ROOT debe ser una ruta absoluta.' }

# Cohort = Cliente Cero's admin identity, taken from the existing allowlist at
# start time; the uid is never written to the config, the log or the console.
$adminUids = [Environment]::GetEnvironmentVariable('OXKIO_ADMIN_FIREBASE_UIDS', 'Process')
if ([string]::IsNullOrWhiteSpace($adminUids)) { $adminUids = [Environment]::GetEnvironmentVariable('OXKIO_ADMIN_FIREBASE_UIDS', 'User') }
if ([string]::IsNullOrWhiteSpace($adminUids)) { Stop-V3Start 'OXKIO_ADMIN_FIREBASE_UIDS ausente: no hay cohorte V3.' }
[Environment]::SetEnvironmentVariable('OXKIO_V3_COHORT_UIDS', $adminUids, 'Process')
$adminUids = $null
Write-Host '[OK] Configuracion V3 (sin secretos) aplicada en Process; cohorte = allowlist admin.'

if (-not (Test-Path -LiteralPath $LauncherPath -PathType Leaf)) { Stop-V3Start 'Lanzador canonico no encontrado.' }
if ($ValidateOnly) {
    & $LauncherPath -ValidateOnly
    exit $LASTEXITCODE
}

# Service mode: the launcher (and the Node process it contains in its Job
# Object) write to rotated log files; the launcher output never includes a
# secret value, only [OK]/[ERROR] lines and the server's names-only banner.
$logDirectory = [string]$config.logDirectory
if ([string]::IsNullOrWhiteSpace($logDirectory) -or -not [System.IO.Path]::IsPathRooted($logDirectory)) { Stop-V3Start 'logDirectory debe ser una ruta absoluta.' }
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null

# Supervision: the task also fires every few minutes to bring OXKIO back if it
# died, so a start must be idempotent. If Node launched by THIS repository's
# launcher already listens on the port, nothing is started and the live logs
# are not rotated; if another process holds the port, nothing is started
# either. Each decision is appended to a supervisor log (codes and PIDs only).
$supervisorLog = Join-Path $logDirectory 'oxkio-v3.supervisor.log'
function Write-Supervisor {
    param([string]$Line)
    if ((Test-Path -LiteralPath $supervisorLog) -and (Get-Item -LiteralPath $supervisorLog).Length -gt 1MB) { Move-Item -LiteralPath $supervisorLog -Destination "$supervisorLog.1" -Force }
    Add-Content -LiteralPath $supervisorLog -Value ('{0} {1}' -f (Get-Date -Format 's'), $Line) -Encoding Ascii
}
# The launcher is recognised by its path in the parent's command line. The
# task always starts the wrapper with the same canonical path, and the wrapper
# starts the launcher with $LauncherPath, so the string is the same.
$launcherFull = (Resolve-Path -LiteralPath $LauncherPath).ProviderPath.ToLowerInvariant()
$port = 0
if (-not [int]::TryParse([string][Environment]::GetEnvironmentVariable('PORT', 'Process'), [ref]$port) -or $port -le 0) { $port = 3000 }
$listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
    $parent = if ($owner) { Get-CimInstance Win32_Process -Filter "ProcessId=$($owner.ParentProcessId)" -ErrorAction SilentlyContinue } else { $null }
    $ours = $owner -and $owner.Name -eq 'node.exe' -and $parent -and $parent.CommandLine -and $parent.CommandLine.ToLowerInvariant().Contains($launcherFull)
    if ($ours) {
        Write-Supervisor "already-running node=$($owner.ProcessId)"
        Write-Host '[OK] OXKIO ya esta en ejecucion; no se inicia otra instancia.'
        exit 0
    }
    Write-Supervisor "port-busy owner=$($listener.OwningProcess)"
    Write-Host "[ERROR] El puerto $port esta ocupado por otro proceso; no se inicia OXKIO."
    exit 2
}
Write-Supervisor 'start'

$outLog = Join-Path $logDirectory 'oxkio-v3.out.log'
$errLog = Join-Path $logDirectory 'oxkio-v3.err.log'
# Start-Process truncates its targets: the previous run is kept as .1.
foreach ($log in @($outLog, $errLog)) {
    if (Test-Path -LiteralPath $log) { Move-Item -LiteralPath $log -Destination "$log.1" -Force }
}
$launcher = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$LauncherPath`"") `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog -NoNewWindow -PassThru -Wait
exit $launcher.ExitCode
