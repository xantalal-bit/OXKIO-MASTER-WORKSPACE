[CmdletBinding()]
param(
    [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'

function Write-CheckOk {
    param([string]$Name)
    Write-Host "[OK] $Name"
}

function Stop-Validation {
    param([string]$Name, [string]$Guidance)
    Write-Host "[ERROR] $Name"
    if ($Guidance) {
        Write-Host $Guidance
    }
    exit 1
}

function Resolve-OxkioEnvironmentVariable {
    param([string]$Name)

    $allowedNames = @(
        'GOOGLE_APPLICATION_CREDENTIALS',
        'FIREBASE_PROJECT_ID',
        'OXKIO_ADMIN_FIREBASE_UIDS'
    )
    if ($Name -notin $allowedNames) {
        Stop-Validation "Variable $Name no permitida." $null
    }

    $processValue = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if (-not [string]::IsNullOrWhiteSpace($processValue)) {
        return $processValue
    }

    $userValue = [Environment]::GetEnvironmentVariable($Name, 'User')
    if ([string]::IsNullOrWhiteSpace($userValue)) {
        Stop-Validation "Variable $Name ausente en proceso y usuario." $null
    }

    [Environment]::SetEnvironmentVariable($Name, $userValue, 'Process')
    Write-CheckOk "Variable $Name recuperada desde la configuracion de usuario."
    return $userValue
}

if ($PSVersionTable.PSVersion.Major -lt 5) {
    Stop-Validation 'PowerShell no compatible.' 'Use Windows PowerShell 5.1 o una version posterior.'
}
Write-CheckOk 'PowerShell compatible.'

$nodeCommand = Get-Command node -CommandType Application -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    Stop-Validation 'Node no disponible.' 'Instale Node y abra una consola nueva.'
}
Write-CheckOk 'Node disponible.'

$scriptsDirectory = $PSScriptRoot
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptsDirectory '..'))
$serverPath = Join-Path $repositoryRoot 'backend\api\server.js'
if (-not (Test-Path -LiteralPath $serverPath -PathType Leaf)) {
    Stop-Validation 'Servidor OXKIO no localizado.' 'Compruebe la integridad del repositorio.'
}
Write-CheckOk 'Servidor OXKIO localizado.'

$firebaseAdminPackage = Join-Path $repositoryRoot 'node_modules\firebase-admin\package.json'
if (-not (Test-Path -LiteralPath $firebaseAdminPackage -PathType Leaf)) {
    Stop-Validation 'firebase-admin no disponible.' 'Restaure las dependencias del proyecto antes de arrancar.'
}
try {
    $firebaseAdminMetadata = Get-Content -LiteralPath $firebaseAdminPackage -Raw | ConvertFrom-Json
    if ($firebaseAdminMetadata.name -ne 'firebase-admin') {
        throw 'Paquete inesperado.'
    }
} catch {
    Stop-Validation 'firebase-admin no es resoluble.' 'Restaure las dependencias del proyecto antes de arrancar.'
}
Write-CheckOk 'firebase-admin disponible.'

$requiredVariables = @(
    'GOOGLE_APPLICATION_CREDENTIALS',
    'FIREBASE_PROJECT_ID',
    'OXKIO_ADMIN_FIREBASE_UIDS'
)
foreach ($variableName in $requiredVariables) {
    $variableValue = Resolve-OxkioEnvironmentVariable -Name $variableName
    Write-CheckOk "Variable $variableName presente."
}

$credentialPath = [Environment]::ExpandEnvironmentVariables(
    [Environment]::GetEnvironmentVariable('GOOGLE_APPLICATION_CREDENTIALS', 'Process')
)
if (-not (Test-Path -LiteralPath $credentialPath -PathType Leaf)) {
    Stop-Validation 'Credencial Firebase no localizada.' 'Revise la variable de ruta sin copiar la credencial al repositorio.'
}
Write-CheckOk 'Credencial Firebase localizada.'

try {
    $credentialStream = [System.IO.File]::Open(
        $credentialPath,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::Read
    )
    $credentialStream.Dispose()
} catch {
    Stop-Validation 'Credencial Firebase no legible.' 'Revise los permisos del archivo de credencial.'
}
Write-CheckOk 'Credencial Firebase legible.'

try {
    $credential = Get-Content -LiteralPath $credentialPath -Raw | ConvertFrom-Json
} catch {
    Stop-Validation 'Credencial Firebase con JSON invalido.' 'Use un archivo service-account JSON valido.'
}
Write-CheckOk 'Credencial Firebase contiene JSON valido.'

if ($credential.type -ne 'service_account') {
    Stop-Validation 'Tipo de credencial Firebase no valido.' 'Use una credencial de tipo service_account.'
}
Write-CheckOk 'Tipo de credencial Firebase valido.'

foreach ($propertyName in @('project_id', 'client_email', 'private_key')) {
    $property = $credential.PSObject.Properties[$propertyName]
    if (-not $property -or [string]::IsNullOrWhiteSpace([string]$property.Value)) {
        Stop-Validation "Credencial Firebase incompleta: falta $propertyName." 'Obtenga una credencial service-account completa.'
    }
}
Write-CheckOk 'Credencial Firebase contiene las propiedades necesarias.'

$configuredProject = [Environment]::GetEnvironmentVariable('FIREBASE_PROJECT_ID', 'Process').Trim()
if ([string]$credential.project_id -cne $configuredProject) {
    Stop-Validation 'Project ID no coincide con la credencial.' 'Corrija la configuracion de usuario antes de arrancar.'
}
Write-CheckOk 'Project ID coincide con la credencial.'

$adminUids = [Environment]::GetEnvironmentVariable('OXKIO_ADMIN_FIREBASE_UIDS', 'Process')
$allowlist = @($adminUids.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($allowlist.Count -lt 1) {
    Stop-Validation 'Allowlist Firebase vacia.' 'Configure al menos un UID administrativo sin mostrarlo en consola.'
}
Write-CheckOk 'Allowlist Firebase contiene al menos una identidad.'

if ($ValidateOnly) {
    Write-Host '[OK] Configuracion Firebase Admin validada. El servidor no se ha iniciado.'
    exit 0
}

$previousLocation = Get-Location
try {
    Set-Location -LiteralPath $repositoryRoot
    & $nodeCommand.Source $serverPath
    $nodeExitCode = $LASTEXITCODE
} finally {
    Set-Location -LiteralPath $previousLocation
}

exit $nodeExitCode
