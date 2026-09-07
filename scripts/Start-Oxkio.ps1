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

[Environment]::SetEnvironmentVariable('OXKIO_APPROVAL_REPOSITORY_BACKEND', 'postgres', 'Process')
Write-CheckOk 'Selector Approval fijado en Process (postgres).'

function Resolve-OxkioGcloudCommand {
    $gcloudCommand = Get-Command -Name 'gcloud.cmd' -CommandType Application -ErrorAction SilentlyContinue
    if (-not $gcloudCommand) {
        Stop-Validation 'gcloud.cmd no disponible.' 'Instale Google Cloud SDK y abra una consola nueva.'
    }
    return $gcloudCommand.Source
}

function Get-OxkioApprovalPostgresRuntimeUrl {
    param([Parameter(Mandatory = $true)][string]$GcloudPath)

    $secretArguments = @(
        'secrets', 'versions', 'access', 'latest',
        '--secret=OXKIO_APPROVAL_PG_RUNTIME_URL',
        '--project=oxkio-runtime-prod'
    )
    $secretOutput = & $GcloudPath @secretArguments 2>$null
    $secretExitCode = $LASTEXITCODE

    if ($secretExitCode -ne 0) {
        Stop-Validation 'No se pudo obtener OXKIO_APPROVAL_PG_RUNTIME_URL desde Secret Manager.' $null
    }

    $secretValue = ($secretOutput | Out-String).Trim()
    if ([string]::IsNullOrWhiteSpace($secretValue)) {
        Stop-Validation 'OXKIO_APPROVAL_PG_RUNTIME_URL vacio en Secret Manager.' $null
    }

    return $secretValue
}

$gcloudPath = Resolve-OxkioGcloudCommand
Write-CheckOk 'gcloud.cmd localizado.'

$approvalPgRuntimeUrl = Get-OxkioApprovalPostgresRuntimeUrl -GcloudPath $gcloudPath
[Environment]::SetEnvironmentVariable('OXKIO_APPROVAL_PG_RUNTIME_URL', $approvalPgRuntimeUrl, 'Process')
$approvalPgRuntimeUrl = $null
Write-CheckOk 'Credencial PostgreSQL Approval cargada de forma segura en Process.'

if ($ValidateOnly) {
    Write-Host '[OK] Configuracion Firebase Admin y selector Approval PostgreSQL validados. El servidor no se ha iniciado.'
    exit 0
}

$oxkioJobObjectNativeSource = @'
using System;
using System.Runtime.InteropServices;

public static class OxkioNodeJobObjectNative {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool SetInformationJobObject(IntPtr hJob, int JobObjectInfoClass, IntPtr lpJobObjectInfo, uint cbJobObjectInfoLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr hObject);

    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct IO_COUNTERS {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }
}
'@

function New-OxkioNodeContainmentJob {
    if (-not ('OxkioNodeJobObjectNative' -as [type])) {
        Add-Type -TypeDefinition $oxkioJobObjectNativeSource -Language CSharp
    }

    $jobHandle = [OxkioNodeJobObjectNative]::CreateJobObject([IntPtr]::Zero, $null)
    if ($jobHandle -eq [IntPtr]::Zero) {
        Stop-Validation 'No se pudo crear el Job Object de contencion del proceso Node.' $null
    }

    $JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000
    $JobObjectExtendedLimitInformation = 9

    $basicLimitInformation = New-Object OxkioNodeJobObjectNative+JOBOBJECT_BASIC_LIMIT_INFORMATION
    $basicLimitInformation.LimitFlags = $JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE

    $extendedLimitInformation = New-Object OxkioNodeJobObjectNative+JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    $extendedLimitInformation.BasicLimitInformation = $basicLimitInformation

    $informationLength = [System.Runtime.InteropServices.Marshal]::SizeOf($extendedLimitInformation)
    $informationPointer = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($informationLength)
    try {
        [System.Runtime.InteropServices.Marshal]::StructureToPtr($extendedLimitInformation, $informationPointer, $false)
        $configured = [OxkioNodeJobObjectNative]::SetInformationJobObject(
            $jobHandle, $JobObjectExtendedLimitInformation, $informationPointer, $informationLength
        )
    } finally {
        [System.Runtime.InteropServices.Marshal]::FreeHGlobal($informationPointer)
    }

    if (-not $configured) {
        [OxkioNodeJobObjectNative]::CloseHandle($jobHandle) | Out-Null
        Stop-Validation 'No se pudo configurar JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE en el Job Object.' $null
    }

    return $jobHandle
}

$previousLocation = Get-Location
$nodeProcess = $null
$nodeJobHandle = [IntPtr]::Zero
try {
    Set-Location -LiteralPath $repositoryRoot

    $nodeJobHandle = New-OxkioNodeContainmentJob
    Write-CheckOk 'Job Object de contencion creado (kill-on-close configurado).'

    $nodeProcess = Start-Process -FilePath $nodeCommand.Source -ArgumentList @($serverPath) -NoNewWindow -PassThru
    $null = $nodeProcess.Handle
    Write-CheckOk "Proceso Node iniciado (PID $($nodeProcess.Id))."

    $assigned = [OxkioNodeJobObjectNative]::AssignProcessToJobObject($nodeJobHandle, $nodeProcess.Handle)
    if (-not $assigned) {
        if (-not $nodeProcess.HasExited) {
            Stop-Process -Id $nodeProcess.Id -Force -ErrorAction SilentlyContinue
        }
        [OxkioNodeJobObjectNative]::CloseHandle($nodeJobHandle) | Out-Null
        $nodeJobHandle = [IntPtr]::Zero
        Stop-Validation 'No se pudo asignar el proceso Node al Job Object de contencion.' $null
    }
    Write-CheckOk 'Proceso Node contenido en el Job Object (no sobrevive a la terminacion del launcher).'

    $nodeProcess.WaitForExit()
    $nodeExitCode = $nodeProcess.ExitCode
} finally {
    if ($nodeProcess -and -not $nodeProcess.HasExited) {
        Stop-Process -Id $nodeProcess.Id -Force -ErrorAction SilentlyContinue
    }
    if ($nodeJobHandle -ne [IntPtr]::Zero) {
        [OxkioNodeJobObjectNative]::CloseHandle($nodeJobHandle) | Out-Null
    }
    Set-Location -LiteralPath $previousLocation
}

exit $nodeExitCode
