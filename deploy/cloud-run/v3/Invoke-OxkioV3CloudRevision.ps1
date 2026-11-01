# Revision V3 en Cloud Run con guardas fail-closed (origen: mision 58, 22/10/2026).
# Se ejecuta con la politica vigente (RemoteSigned basta: archivo local, sin
# Zone.Identifier); no requiere -ExecutionPolicy Bypass.
# Modos:
#   Validate        solo carga la sintaxis.
#   Simulate        ejecuta Invoke-OxkioV3CloudRevision.Tests.ps1 (sin nube).
#   ProveIsolation  arranca en local el commit exacto con el entorno sintetico y deja prueba de aislamiento.
#   Check           lecturas cloud y validaciones `replace --dry-run` (sin escrituras).
#   CheckReal       igual, para la revision V3 real (PostgreSQL + Secret Manager): solo dry-run.
#   Cloud -Paso N   pasos 0..6 (escrituras cloud desde el paso 1; requieren Check y ProveIsolation previos).
#   Rollback        restaura la plantilla y el trafico exportados en el paso 0.
# El UID del owner nunca se versiona: -OwnerUid o OXKIO_V3_OWNER_UID.
[CmdletBinding()]
param([ValidateSet('Validate','Simulate','ProveIsolation','Check','CheckReal','Cloud','Rollback')][string]$Mode='Validate',
      [ValidateRange(0,6)][int]$Paso=0,
      [ValidatePattern('^([0-9a-f]{40})?$')][string]$Commit='',
      [string]$OwnerUid=$env:OXKIO_V3_OWNER_UID,
      [string]$EvidenceRoot='',
      [ValidatePattern('^([a-z0-9.-]{1,253})?$')][string]$PgHost='',
      [ValidatePattern('^[a-z0-9_]{1,63}$')][string]$PgDatabase='neondb',
      [ValidatePattern('^(latest|[1-9][0-9]*)$')][string]$IntegrityKeyVersion='latest',
      [ValidatePattern('^[1-9][0-9]*$')][string]$PgPasswordVersion='1',
      # Cloud/Rollback: Synthetic (sin secretos) o Real (PostgreSQL + Secret Manager, requiere CheckReal en verde).
      [ValidateSet('Synthetic','Real')][string]$Variant='Synthetic',
      # Variante Real: razonamiento V3 (Issue #85). Off por defecto; InternalEgress exige autorizacion humana expresa.
      [ValidateSet('Off','InternalEgress')][string]$V3Reasoning='Off',
      # Revision que sirve el 100 % (cambia solo tras una promocion autorizada; ver Issue #86).
      [ValidatePattern('^oxkio-api-staging-[0-9a-z]+(-[0-9a-z]+)*$')][string]$ServingRevision='oxkio-api-staging-00018-9xl')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$script:RepoLocal=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..')).ProviderPath
if(-not $Commit){ $Commit=(& git.exe -C $script:RepoLocal rev-parse HEAD).Trim() }
$script:ExpectedRevision=$ServingRevision
$script:ExpectedCommit=$Commit
$script:LimitEUR=[decimal]2
$script:Project='oxkio-runtime-prod'
$script:Region='europe-west3'
$script:Service='oxkio-api-staging'
$script:ImageRepo='europe-west3-docker.pkg.dev/oxkio-runtime-prod/oxkio-staging/oxkio-api'
$script:ShortCommit=$script:ExpectedCommit.Substring(0,7)
$script:TestTag='v3-synth-'+$script:ShortCommit
$script:TestRevision='oxkio-api-staging-v3s-'+$script:ShortCommit
$script:ServiceAccount='oxkio-runtime-prod@oxkio-runtime-prod.iam.gserviceaccount.com'
# Cuenta dedicada de Cloud Build (setup-github-wif.sh apply-build-sa). Nunca la cuenta Compute
# por defecto (roles/editor): actAs sobre ella daria a quien construye permisos de editor.
$script:BuildServiceAccount='oxkio-gha-build@oxkio-runtime-prod.iam.gserviceaccount.com'
$script:OwnerUid=[string]$OwnerUid
$script:RealTag='v3-real-'+$script:ShortCommit
$script:RealRevision='oxkio-api-staging-v3r-'+$script:ShortCommit
$script:ChatPath='/api/executive/chat'
$script:Secrets=@('OXKIO_APPROVAL_PG_RUNTIME_URL','OXKIO_MISSION_PG_RUNTIME_URL','OXKIO_REASONING_API_KEY','OXKIO_V3_INTEGRITY_KEY','oxkio-google-client-secret','oxkio-google-oauth-tokens')
$script:OAuthSecrets=@('oxkio-google-client-secret','oxkio-google-oauth-tokens')
# Evidencia fuera del repositorio (publico): journal, snapshot DPAPI y pruebas.
if(-not $EvidenceRoot){ $EvidenceRoot=Join-Path $env:USERPROFILE ('OXKIO-worktrees\ops\cloud-v3-'+$script:ShortCommit) }
$script:Evidence=Join-Path $EvidenceRoot 'evidencia'
$script:JournalPath=Join-Path $script:Evidence 'journal.json'
$script:IsolationProofPath=Join-Path $script:Evidence ('isolation-'+$script:ShortCommit+'.json')
$script:CheckPath=Join-Path $script:Evidence ('check-'+$script:ShortCommit+'.json')
$script:CheckRealPath=Join-Path $script:Evidence ('check-real-'+$script:ShortCommit+'.json')
# La variante Real reutiliza la secuencia 0..6 con su propia revision, etiqueta y journal.
$script:Variant=$Variant
# Razonamiento V3 de la revision real (Issue #85). Off: la revision no conversa (solo vocabulario
# determinista) y lo declara. InternalEgress: la configuracion que funcionaba en el runtime local de
# Cliente Cero (proveedor, modelo y precios revisados el 04/10) con residencia UE. Solo lo INTERNAL
# puede salir al proveedor (Autorizacion B); lo CONFIDENTIAL y lo derivado de memoria, correo o agenda
# no sale nunca (Privacy Gate). La clave se reutiliza por referencia (OXKIO_REASONING_API_KEY, ya
# montada en la plantilla vigente): ni secretos ni permisos nuevos.
$script:V3Reasoning=$V3Reasoning
$script:V3ReasoningEnv=[ordered]@{OXKIO_V3_REASONING_PROVIDER='openai';OXKIO_V3_REASONING_MODEL='gpt-5.6-luna'
    OXKIO_V3_REASONING_BASE_URL='https://eu.api.openai.com/v1';OXKIO_V3_REASONING_INPUT_USD_PER_MILLION='0.20'
    OXKIO_V3_REASONING_OUTPUT_USD_PER_MILLION='1.20';OXKIO_V3_REASONING_PRICING_REVIEWED_AT='2026-10-04'
    OXKIO_V3_REASONING_INTERNAL_EGRESS='true';OXKIO_V3_PLANNER_DAILY_BUDGET_USD='0.90'}
$script:V3ReasoningKeySecret='OXKIO_REASONING_API_KEY'
# Linea de arranque de server.js que demuestra el proveedor V3 listo (modelId y region).
$script:V3ReasoningReadyLog='V3 Reasoning: ready (openai:gpt-5.6-luna, region eu)'
$script:V3ReasoningOffLog='V3 Reasoning: not configured'
if($script:Variant -ceq 'Real'){ $script:TestTag=$script:RealTag; $script:TestRevision=$script:RealRevision; $script:JournalPath=Join-Path $script:Evidence 'journal-real.json' }
$script:BuildContextFiles=@('Dockerfile','.dockerignore','package.json','package-lock.json','backend','app','orchestration/CONTINUITY-REGISTRY.json')

function Assert-True([bool]$Condition,[string]$Message) { if(-not $Condition){throw $Message} }
function Assert-OwnerUid { Assert-True ($script:OwnerUid -cmatch '^[A-Za-z0-9]{20,128}$') 'Falta -OwnerUid / OXKIO_V3_OWNER_UID (UID Firebase del owner)' }
# Solo se construye y despliega codigo ya integrado en main.
function Assert-CommitOnMain {
    $r=Invoke-Native 'git.exe' @('-C',$script:RepoLocal,'merge-base','--is-ancestor',$script:ExpectedCommit,'origin/main') 60
    Assert-True ($r.ExitCode -eq 0 -and -not $r.TimedOut) 'El commit no esta en origin/main'
}
function Get-Canonical($Value) { ConvertTo-Json -InputObject $Value -Depth 100 -Compress }
function Get-Prop($Object,[string]$Name,$Default=$null) {
    if($null -ne $Object -and $Object.PSObject.Properties[$Name]){ return $Object.$Name }
    return $Default
}
function Assert-NativeResult($Result) {
    Assert-True ($Result.ExitCode -eq 0) 'Error de comando externo'
    Assert-True (-not $Result.TimedOut) 'Tiempo de comando agotado'
    return $Result.Value
}
# Antes del paso 3 el servicio sirve con latestRevision=true sobre 00018; el paso 3
# fija el trafico a la revision por nombre en la misma operacion que crea la nueva.
function Assert-Traffic($Traffic,[switch]$AllowLatest) {
    $positive=@($Traffic | Where-Object { [int]$_.percent -gt 0 })
    Assert-True ($positive.Count -eq 1) 'Distribucion de trafico inesperada'
    Assert-True ($positive[0].revisionName -ceq $script:ExpectedRevision) 'Revision activa incorrecta'
    Assert-True ([int]$positive[0].percent -eq 100) 'Trafico distinto de 100 por ciento'
    foreach($item in $Traffic) {
        Assert-True ([int]$item.percent -ge 0 -and [int]$item.percent -le 100) 'Porcentaje invalido'
        if($item.latestRevision) {
            Assert-True ($AllowLatest -and $item.revisionName -ceq $script:ExpectedRevision -and [int]$item.percent -eq 100) 'Trafico no fijado a revision'
        }
    }
}
function Assert-Invariants($Baseline,$Current,[switch]$AllowLatest) {
    Assert-Traffic $Current.Traffic -AllowLatest:$AllowLatest
    foreach($field in @('IAM','OAuth','SecretVersions','OriginalRevision')) {
        Assert-True ((Get-Canonical $Baseline.$field) -ceq (Get-Canonical $Current.$field)) "Alteracion de $field"
    }
}
function Assert-Budget($Ledger,$Quote,[decimal]$ElapsedSeconds) {
    Assert-True ($Quote.Currency -ceq 'EUR') 'Estimacion debe estar en EUR'
    Assert-True ($Quote.Verified -and $Quote.Source -and $Quote.FXSource) 'Faltan tarifas o FX verificados'
    Assert-True ($Quote.ValidUntilUTC -gt [datetime]::UtcNow) 'Estimacion caducada'
    Assert-True ($Quote.BuildSeconds -gt 0 -and $Quote.TestSeconds -gt 0 -and $Quote.StorageByteDays -gt 0) 'Faltan cotas de recursos'
    Assert-True ($Quote.MaxOperationSeconds -gt 0 -and $ElapsedSeconds -lt $Quote.MaxOperationSeconds) 'Tiempo operativo agotado'
    Assert-True ($Ledger.SpentEUR -ge 0 -and $Ledger.ReservedEUR -ge 0 -and $Quote.NextReservationEUR -gt 0) 'Reserva invalida'
    Assert-True (($Ledger.SpentEUR+$Ledger.ReservedEUR+$Quote.NextReservationEUR) -le $script:LimitEUR) 'Limite operativo acumulado excedido'
    # Reserva se registra ANTES de lanzar una operacion; fallo/timeout no libera reserva.
    # Una estimacion/reserva operativa nunca garantiza un tope de facturacion.
}
# Cota superior por paso. Tarifas publicas en USD consultadas el 22/10/2026:
# Cloud Build (pool por defecto) 0,006 USD/min; Cloud Run por solicitud 0,000024 USD/vCPU-s
# y 0,0000025 USD/GiB-s; Artifact Registry 0,10 USD/GiB-mes. Se ignoran las cuotas gratuitas.
# FX: 1 USD = 1,25 EUR, cota deliberadamente pesimista, no tipo de mercado.
function New-ConservativeQuote([datetime]$StartedUtc) {
    $fx=[decimal]1.25
    $buildUsd=[decimal]10*[decimal]0.006                                # timeout del build: 600 s
    $instanceUsdPerSecond=[decimal]0.000024+[decimal]0.5*[decimal]0.0000025
    $startupUsd=[decimal]600*$instanceUsdPerSecond                      # arranque y comprobaciones de la revision
    $storageUsd=[decimal]0.25*[decimal]0.10                             # 0,25 GiB durante un mes completo
    $testUsd=[decimal]1800*$instanceUsdPerSecond                        # ventana maxima de prueba: 30 min activos
    $toEur={param([decimal]$Usd) [decimal]([math]::Ceiling([double]($Usd*$fx*100))/100)+[decimal]0.01}
    $reservations=@{1=(& $toEur $buildUsd);2=[decimal]0.01;3=(& $toEur ($startupUsd+$storageUsd));4=(& $toEur $testUsd);5=[decimal]0.01;6=[decimal]0.01}
    [pscustomobject]@{Currency='EUR';Verified=$true
        Source='cloud.google.com/build/pricing; cloud.google.com/run/pricing; cloud.google.com/artifact-registry/pricing (22/10/2026)'
        FXSource='Cota fija 1 USD = 1,25 EUR (pesimista, no es tipo de mercado)'
        ValidUntilUTC=$StartedUtc.AddHours(6);BuildSeconds=600;TestSeconds=1800
        StorageByteDays=[decimal](0.25*1GB*30);MaxOperationSeconds=6*3600;NextReservationEUR=[decimal]0;Reservations=$reservations}
}
function Assert-IsolatedRevision($Revision) {
    Assert-True ($Revision.Commit -ceq $script:ExpectedCommit) 'Commit incorrecto'
    Assert-True ($Revision.Name -cne $script:ExpectedRevision) 'Revision original protegida'
    Assert-True ($Revision.Digest -cmatch '^sha256:[0-9a-f]{64}$') 'Digest inmutable requerido'
    Assert-True ($Revision.Percent -eq 0) 'Revision sintetica con trafico'
    Assert-True ($Revision.MinInstances -eq 0 -and $Revision.MaxInstances -eq 1 -and $Revision.Concurrency -eq 1) 'Recursos fuera de cota'
    Assert-True ($Revision.CPU -eq 1 -and $Revision.MemoryMi -eq 512 -and $Revision.TimeoutSeconds -le 60 -and $Revision.TimeoutSeconds -gt 0) 'Recursos o timeout incorrectos'
    Assert-True ($Revision.SecretMounts.Count -eq 0) 'Secretos montados en revision sintetica'
    Assert-True ($Revision.Env.OXKIO_APPROVAL_REPOSITORY_BACKEND -ceq 'json') 'Backend no efimero'
    Assert-True ($Revision.Env.OXKIO_V3_MEMORY_ROOT -ceq '/tmp/oxkio-v3') 'Memoria no efimera'
    Assert-True ($Revision.Env.GOOGLE_CLIENT_SECRET -ceq 'disabled-synthetic-test') 'OAuth no deshabilitado'
    foreach($name in $Revision.Env.Keys) {
        Assert-True ($name -notmatch '^OXKIO_REASONING_|^OXKIO_V3_REASONING_|OXKIO_GOOGLE_OAUTH_TOKEN|DATABASE|POSTGRES|_PG_') 'Variable de acceso real prohibida'
    }
    Assert-True ($Revision.IsolationProvenAtCommit -ceq $script:ExpectedCommit) 'Falta prueba de aislamiento en commit exacto'
}
# Revision real: V3 durable para la cohorte del owner, credenciales solo por referencia.
function Assert-RealRevision($Revision) {
    Assert-True ($Revision.Commit -ceq $script:ExpectedCommit) 'Commit incorrecto'
    Assert-True ($Revision.Name -ceq $script:RealRevision -and $Revision.Name -cne $script:ExpectedRevision) 'Revision real inesperada'
    Assert-True ($Revision.Digest -cmatch '^sha256:[0-9a-f]{64}$') 'Digest inmutable requerido'
    Assert-True ($Revision.Percent -eq 0) 'Revision real con trafico'
    Assert-True ($Revision.Env.OXKIO_V3_ENABLED -ceq 'true' -and $Revision.Env.OXKIO_V3_COHORT_UIDS -ceq $script:OwnerUid) 'Cohorte distinta del owner'
    Assert-True ($Revision.Env.OXKIO_V3_MEMORY_BACKEND -ceq 'postgres' -and $Revision.Env.OXKIO_V3_APPROVAL_BACKEND -ceq 'postgres') 'Memoria o aprobaciones no durables'
    Assert-True ($Revision.Env.OXKIO_V3_PG_USER -ceq 'oxkio_v3_runtime' -and $Revision.Env.OXKIO_V3_PG_HOST -ceq $script:PgHost) 'Conexion PostgreSQL inesperada'
    foreach($s in $script:RealV3Secrets){ Assert-True ($s -in @($Revision.SecretMounts)) "Falta la referencia $s" }
    foreach($name in $Revision.Env.Keys){ Assert-True ($name -notin $script:RealV3Secrets -and $name -notmatch '_API_KEY$') "Variable no permitida en claro: $name" }
    if($script:V3Reasoning -ceq 'InternalEgress'){
        foreach($e in $script:V3ReasoningEnv.GetEnumerator()){ Assert-True ([string]$Revision.Env[$e.Key] -ceq $e.Value) "Razonamiento V3 distinto del revisado: $($e.Key)" }
        foreach($name in $Revision.Env.Keys){ Assert-True ($name -notmatch '^OXKIO_V3_REASONING_|^OXKIO_V3_PLANNER_' -or $script:V3ReasoningEnv.Contains($name)) "Variable de razonamiento no revisada: $name" }
        Assert-True ($script:V3ReasoningKeySecret -in @($Revision.SecretMounts)) 'La clave del proveedor solo puede ir por referencia de Secret Manager'
    } else {
        foreach($name in $Revision.Env.Keys){ Assert-True ($name -notmatch '^OXKIO_V3_REASONING_|^OXKIO_V3_PLANNER_') "Razonamiento V3 no autorizado: $name" }
    }
}
function Assert-TestResult($Test) {
    Assert-True ($Test.Authenticated -and $Test.ExistingIAM -and $Test.SyntheticOnly) 'Identidad o datos no permitidos'
    Assert-True ($Test.HttpStatus -eq 200 -and $Test.AssertionsPassed -and $Test.RequestCount -le 3 -and $Test.RequestCount -gt 0) 'Prueba sintetica fallida'
    Assert-True ($Test.DurationSeconds -le 60 -and $Test.DurationSeconds -gt 0 -and -not $Test.TimedOut) 'Prueba fuera de duracion'
}
function New-RollbackPlan($Baseline) {
    Assert-Traffic $Baseline.Traffic -AllowLatest
    Assert-True ($null -ne $Baseline.ServiceExport -and $null -ne $Baseline.OriginalRevision) 'Snapshot incompleto'
    return [ordered]@{ Operation='RestoreFullService'; ServiceExport=$Baseline.ServiceExport;
        OriginalRevision=$Baseline.OriginalRevision; Traffic=$Baseline.Traffic;
        ExpectedIAM=$Baseline.IAM; ExpectedOAuth=$Baseline.OAuth;
        ExpectedSecretVersions=$Baseline.SecretVersions; AllowIAMWrite=$false; AllowSecretWrite=$false }
}
function Protect-LocalSnapshot($Baseline,[string]$Destination) {
    # Solo cifrado local ligado al usuario Windows. Nunca imprimir el documento.
    Add-Type -AssemblyName System.Security
    $bytes=[System.Text.Encoding]::UTF8.GetBytes((Get-Canonical $Baseline))
    try {
        $encrypted=[System.Security.Cryptography.ProtectedData]::Protect($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)
        $path=[System.IO.Path]::GetFullPath($Destination)
        Assert-True (-not [System.IO.File]::Exists($path)) 'Snapshot existente: no sobrescribir'
        $temp=$path+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
        [System.IO.File]::WriteAllBytes($temp,$encrypted)
        [System.IO.File]::Move($temp,$path)
        return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    } finally { [Array]::Clear($bytes,0,$bytes.Length) }
}
function Read-LocalSnapshot([string]$Path) {
    Add-Type -AssemblyName System.Security
    $bytes=[System.Security.Cryptography.ProtectedData]::Unprotect([System.IO.File]::ReadAllBytes($Path),$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    try { return ([System.Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json) }
    finally { [Array]::Clear($bytes,0,$bytes.Length) }
}
# Documento del servicio para ReplaceService: el JSON real del servicio sin campos de
# salida. Plantilla, variables, referencias de secretos, recursos, sondas y cuenta de
# servicio quedan como estaban; el trafico se fija por nombre a la revision original.
$script:OutputAnnotations=@('serving.knative.dev/creator','serving.knative.dev/lastModifier','run.googleapis.com/operation-id')
function New-CleanServiceDocument($Service,[switch]$KeepResourceVersion) {
    $document=(Get-Canonical $Service) | ConvertFrom-Json
    Assert-True ($document.apiVersion -ceq 'serving.knative.dev/v1' -and $document.kind -ceq 'Service') 'Servicio Cloud Run v1 requerido'
    Assert-True ($null -ne (Get-Prop (Get-Prop (Get-Prop $document.spec 'template') 'spec') 'containers')) 'Servicio sin contenedores'
    $document.PSObject.Properties.Remove('status')
    $keys=@('uid','generation','creationTimestamp','selfLink','managedFields'); if(-not $KeepResourceVersion){ $keys+='resourceVersion' }
    foreach($key in $keys) { $document.metadata.PSObject.Properties.Remove($key) }
    $annotations=Get-Prop $document.metadata 'annotations'
    if($annotations){ foreach($key in $script:OutputAnnotations){ $annotations.PSObject.Properties.Remove($key) } }
    return $document
}
function New-RestoreServiceDocument($Baseline) {
    Assert-Traffic $Baseline.Traffic -AllowLatest
    $document=New-CleanServiceDocument $Baseline.ServiceExport
    # Sin nombre de revision: Cloud Run crea una nueva con la configuracion original y 0 % de trafico.
    $document.spec.template.metadata.PSObject.Properties.Remove('name')
    $traffic=@([pscustomobject][ordered]@{revisionName=$script:ExpectedRevision;percent=100})
    $document.spec | Add-Member -NotePropertyName traffic -NotePropertyValue $traffic -Force
    return $document
}
# Un unico entorno sintetico, compartido por la prueba local de aislamiento y la revision cloud.
function New-SyntheticEnv([string]$IntegrityKey) {
    Assert-True ($IntegrityKey.Length -ge 64) 'Clave de integridad corta'
    Assert-OwnerUid
    [ordered]@{
        NODE_ENV='production'; FIREBASE_PROJECT_ID='oxkio-9af40'; GOOGLE_CLOUD_PROJECT=$script:Project
        OXKIO_ADMIN_FIREBASE_UIDS=$script:OwnerUid; OXKIO_APPROVAL_REPOSITORY_BACKEND='json'
        # OAuth deshabilitado en la revision sintetica: identificador marcador, no el real.
        GOOGLE_CLIENT_ID='disabled-synthetic-test.apps.googleusercontent.com'
        GOOGLE_CLIENT_SECRET='disabled-synthetic-test'; GOOGLE_REDIRECT_URI='http://127.0.0.1:8081/oauth/google/callback'
        OXKIO_V3_ENABLED='true'; OXKIO_V3_COHORT_UIDS=$script:OwnerUid; OXKIO_V3_MEMORY_ROOT='/tmp/oxkio-v3'
        OXKIO_V3_INTEGRITY_KEY=$IntegrityKey
    }
}
function New-IntegrityKey { $b=New-Object byte[] 32; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $_.ToString('x2') }) }
# Metadatos de servicio del JSON real (con resourceVersion: falla si alguien lo cambio
# entretanto); la plantilla sintetica se genera completa. Trafico: 100 % a 00018 por
# nombre y 0 % etiquetado a la nueva revision.
function New-SyntheticServiceDocument($Service,[string]$ImageRef,[string]$IntegrityKey) {
    Assert-True ($ImageRef -cmatch '@sha256:[0-9a-f]{64}$') 'Imagen sin digest'
    $document=New-CleanServiceDocument $Service -KeepResourceVersion
    $envList=@((New-SyntheticEnv $IntegrityKey).GetEnumerator() | ForEach-Object { [pscustomobject][ordered]@{name=$_.Key;value=[string]$_.Value} })
    $container=[pscustomobject][ordered]@{image=$ImageRef;ports=@([pscustomobject]@{containerPort=8080;name='http1'});env=$envList
        resources=[pscustomobject]@{limits=[pscustomobject]@{cpu='1';memory='512Mi'}}
        startupProbe=[pscustomobject][ordered]@{failureThreshold=1;periodSeconds=240;tcpSocket=[pscustomobject]@{port=8080};timeoutSeconds=240}}
    $template=[pscustomobject][ordered]@{
        metadata=[pscustomobject][ordered]@{name=$script:TestRevision
            annotations=[pscustomobject]@{'autoscaling.knative.dev/maxScale'='1';'autoscaling.knative.dev/minScale'='0'}
            labels=[pscustomobject]@{'oxkio-commit'=$script:ExpectedCommit;'oxkio-purpose'='v3-synthetic'}}
        spec=[pscustomobject][ordered]@{containerConcurrency=1;timeoutSeconds=60;serviceAccountName=$script:ServiceAccount;containers=@($container)}}
    $document.spec | Add-Member -NotePropertyName template -NotePropertyValue $template -Force
    $traffic=@([pscustomobject][ordered]@{revisionName=$script:ExpectedRevision;percent=100},
               [pscustomobject][ordered]@{revisionName=$script:TestRevision;percent=0;tag=$script:TestTag})
    $document.spec | Add-Member -NotePropertyName traffic -NotePropertyValue $traffic -Force
    return $document
}
# Solo quita la etiqueta de prueba: misma plantilla (no crea revision) y 100 % a 00018.
function New-UntaggedServiceDocument($Service) {
    $document=New-CleanServiceDocument $Service -KeepResourceVersion
    $traffic=@([pscustomobject][ordered]@{revisionName=$script:ExpectedRevision;percent=100})
    $document.spec | Add-Member -NotePropertyName traffic -NotePropertyValue $traffic -Force
    return $document
}
# Revision V3 real: parte de la plantilla vigente (variables, referencias de secretos,
# recursos y cuenta de servicio intactos) y anade V3 con memoria y aprobaciones en
# PostgreSQL. Credenciales solo como referencias de Secret Manager, nunca valores.
# Razonamiento V3 solo con -V3Reasoning InternalEgress (autorizacion expresa). Trafico: 100 % a 00018
# por nombre y 0 % etiquetado a la nueva revision.
$script:RealV3Secrets=@('OXKIO_V3_INTEGRITY_KEY','OXKIO_V3_PG_PASSWORD')
function New-RealV3ServiceDocument($Service,[string]$ImageRef) {
    Assert-True ($ImageRef -cmatch '@sha256:[0-9a-f]{64}$') 'Imagen sin digest'
    Assert-OwnerUid
    Assert-True ($script:PgHost -cmatch '^[a-z0-9-]+(\.[a-z0-9-]+)+$') 'Falta -PgHost (host del endpoint Neon)'
    $document=New-CleanServiceDocument $Service -KeepResourceVersion
    $template=(Get-Canonical $document.spec.template) | ConvertFrom-Json
    $container=@($template.spec.containers)[0]
    $current=@(Get-Prop $container 'env' @())
    $plain=@{}; foreach($e in $current){ if(-not (Get-Prop $e 'valueFrom')){ $plain[$e.name]=[string](Get-Prop $e 'value' '') } }
    Assert-True ($plain['OXKIO_APPROVAL_REPOSITORY_BACKEND'] -ceq 'postgres') 'Approval no usa PostgreSQL: las aprobaciones V3 no serian durables'
    Assert-True (@($current | Where-Object { $_.name -ceq 'OXKIO_APPROVAL_PG_RUNTIME_URL' -and (Get-Prop $_ 'valueFrom') }).Count -eq 1) 'Falta la referencia al secreto de Approval'
    $v3=[ordered]@{OXKIO_V3_ENABLED='true';OXKIO_V3_COHORT_UIDS=$script:OwnerUid;OXKIO_V3_MEMORY_ROOT='/tmp/oxkio-v3'
        OXKIO_V3_MEMORY_BACKEND='postgres';OXKIO_V3_PG_HOST=$script:PgHost;OXKIO_V3_PG_PORT='5432'
        OXKIO_V3_PG_DATABASE=$script:PgDatabase;OXKIO_V3_PG_USER='oxkio_v3_runtime';OXKIO_V3_APPROVAL_BACKEND='postgres'}
    $refs=[ordered]@{OXKIO_V3_INTEGRITY_KEY=$script:IntegrityKeyVersion;OXKIO_V3_PG_PASSWORD=$script:PgPasswordVersion}
    if($script:V3Reasoning -ceq 'InternalEgress'){
        # Custodia existente: la plantilla ya monta la clave del proveedor por referencia. Si no, no se crea nada.
        Assert-True (@($current | Where-Object { $_.name -ceq $script:V3ReasoningKeySecret -and (Get-Prop $_ 'valueFrom') }).Count -eq 1) 'Falta la referencia existente a la clave del proveedor: no se crea ningun secreto'
        foreach($e in $script:V3ReasoningEnv.GetEnumerator()){ $v3[$e.Key]=$e.Value }
    }
    # Ninguna variable de razonamiento V3 heredada de la plantilla: solo las revisadas, y solo si se autorizan.
    $kept=@($current | Where-Object { $_.name -notin @($v3.Keys) -and $_.name -notin @($refs.Keys) -and $_.name -notmatch '^OXKIO_V3_REASONING_|^OXKIO_V3_PLANNER_' })
    $added=@($v3.GetEnumerator() | ForEach-Object { [pscustomobject][ordered]@{name=$_.Key;value=[string]$_.Value} })
    $added+=@($refs.GetEnumerator() | ForEach-Object { [pscustomobject][ordered]@{name=$_.Key;valueFrom=[pscustomobject]@{secretKeyRef=[pscustomobject]@{name=$_.Key;key=$_.Value}}} })
    $container | Add-Member -NotePropertyName env -NotePropertyValue @($kept+$added) -Force
    $container | Add-Member -NotePropertyName image -NotePropertyValue $ImageRef -Force
    $template.metadata | Add-Member -NotePropertyName name -NotePropertyValue $script:RealRevision -Force
    $labels=Get-Prop $template.metadata 'labels'
    if(-not $labels){ $labels=[pscustomobject]@{}; $template.metadata | Add-Member -NotePropertyName labels -NotePropertyValue $labels -Force }
    $labels | Add-Member -NotePropertyName 'oxkio-commit' -NotePropertyValue $script:ExpectedCommit -Force
    $labels | Add-Member -NotePropertyName 'oxkio-purpose' -NotePropertyValue 'v3-real' -Force
    $document.spec | Add-Member -NotePropertyName template -NotePropertyValue $template -Force
    $traffic=@([pscustomobject][ordered]@{revisionName=$script:ExpectedRevision;percent=100},
               [pscustomobject][ordered]@{revisionName=$script:RealRevision;percent=0;tag=$script:RealTag})
    $document.spec | Add-Member -NotePropertyName traffic -NotePropertyValue $traffic -Force
    return $document
}
# Solo lecturas y dry-run del documento real: registra que falta (secretos, IAM) sin escribir.
function Invoke-CheckReal {
    New-Item -ItemType Directory -Force -Path $script:Evidence | Out-Null
    Assert-OwnerUid
    Assert-CommitOnMain
    $state=Read-CloudState
    Assert-Traffic $state.Traffic -AllowLatest
    $document=New-RealV3ServiceDocument $state.ServiceExport $state.OriginalRevision.imageDigest
    $result=[ordered]@{Commit=$script:ExpectedCommit;AtUtc=[datetime]::UtcNow.ToString('o');Passed=$false;Revision=$script:RealRevision;Tag=$script:RealTag
        EnvNames=@(@($document.spec.template.spec.containers)[0].env | ForEach-Object { $_.name })}
    $result.Secrets=[ordered]@{}
    foreach($s in $script:RealV3Secrets) {
        $exists=(Invoke-Native (Get-GcloudPath) @('secrets','describe',$s,"--project=$script:Project",'--format=value(name)','--quiet') 120).ExitCode -eq 0
        $access=$false
        if($exists){ $policy=Invoke-Gcloud @('secrets','get-iam-policy',$s,'--format=json') | ConvertFrom-Json
            $access=@(@(Get-Prop $policy 'bindings' @()) | Where-Object { $_.role -in @('roles/secretmanager.secretAccessor','roles/owner') -and ("serviceAccount:$script:ServiceAccount" -in $_.members) }).Count -gt 0 }
        $result.Secrets[$s]=[ordered]@{Exists=$exists;ServiceAccountCanAccess=$access}
    }
    try { Invoke-ServiceReplace $document -DryRun | Out-Null; $result.DryRun='OK' } catch { $result.DryRun=[string]$_.Exception.Message }
    $after=Read-CloudState
    Assert-Invariants $state $after -AllowLatest
    Assert-True ($after.ServiceExport.metadata.resourceVersion -ceq $state.ServiceExport.metadata.resourceVersion) 'El dry-run altero el servicio'
    $result.DryRunsPersistedNothing=$true
    # Observado 27/10/2026: dryRun=all acepta referencias a secretos inexistentes o sin
    # acceso de la cuenta de servicio. El dry-run solo valida la forma; los secretos se
    # comprueban aparte y bloquean el resultado.
    $result.Blockers=@(foreach($s in $script:RealV3Secrets){
        if(-not $result.Secrets[$s].Exists){ "secret_missing:$s" } elseif(-not $result.Secrets[$s].ServiceAccountCanAccess){ "secret_access_missing:$s" } })
    if($result.DryRun -cne 'OK'){ $result.Blockers+='dry_run_rejected' }
    $result.Passed=($result.Blockers.Count -eq 0)
    Write-PrivateFile (Join-Path $script:Evidence ('check-real-'+$script:ShortCommit+'.json')) (ConvertTo-Json $result -Depth 6)
    return $result
}
function ConvertTo-TrafficModel($Service) {
    @(foreach($item in @(Get-Prop (Get-Prop $Service 'status') 'traffic' @())) {
        [pscustomobject]@{revisionName=(Get-Prop $item 'revisionName' '');percent=[int](Get-Prop $item 'percent' 0)
            latestRevision=[bool](Get-Prop $item 'latestRevision' $false);tag=(Get-Prop $item 'tag' '')}
    })
}
function ConvertTo-RevisionModel($Revision,$Traffic,[string]$ProvenCommit) {
    $meta=$Revision.metadata; $spec=$Revision.spec; $container=@($spec.containers)[0]
    $annotations=Get-Prop $meta 'annotations'; $labels=Get-Prop $meta 'labels'
    $envList=@(Get-Prop $container 'env' @()); $env=@{}; $mounts=@()
    foreach($item in $envList) { if(Get-Prop $item 'valueFrom'){ $mounts+=$item.name } else { $env[$item.name]=[string](Get-Prop $item 'value' '') } }
    $mounts+=@(Get-Prop $spec 'volumes' @())
    $limits=Get-Prop (Get-Prop $container 'resources') 'limits'
    $memory=[string](Get-Prop $limits 'memory' '')
    $digest=[string](Get-Prop (Get-Prop $Revision 'status') 'imageDigest' '')
    $entry=@($Traffic | Where-Object { $_.revisionName -ceq $meta.name } | Select-Object -First 1)
    [pscustomobject]@{Commit=[string](Get-Prop $labels 'oxkio-commit' '');Name=$meta.name
        Digest=$(if($digest -match '@(sha256:[0-9a-f]{64})$'){$Matches[1]}else{''})
        Percent=$(if($entry.Count){[int]$entry[0].percent}else{0})
        MinInstances=[int](Get-Prop $annotations 'autoscaling.knative.dev/minScale' 0)
        MaxInstances=[int](Get-Prop $annotations 'autoscaling.knative.dev/maxScale' 0)
        Concurrency=[int](Get-Prop $spec 'containerConcurrency' 0);CPU=[int](Get-Prop $limits 'cpu' 0)
        MemoryMi=$(if($memory -match '^(\d+)Mi$'){[int]$Matches[1]}else{0});TimeoutSeconds=[int](Get-Prop $spec 'timeoutSeconds' 0)
        SecretMounts=$mounts;Env=$env;IsolationProvenAtCommit=$ProvenCommit}
}
# Solo las peticiones POST al chat de la revision etiquetada, desde el inicio de la prueba.
function ConvertTo-TestModel($LogEntries,[datetime]$StartUtc,[datetime]$EndUtc,$Attestation) {
    $chat=@($LogEntries | Where-Object {
        $h=Get-Prop $_ 'httpRequest'
        $h -and (Get-Prop $h 'requestMethod') -eq 'POST' -and ([string](Get-Prop $h 'requestUrl' '')) -like "*$script:ChatPath*" -and
        ((ConvertTo-UtcDate $_.timestamp) -ge $StartUtc)
    })
    $statuses=@($chat | ForEach-Object { [int](Get-Prop $_.httpRequest 'status' 0) })
    $bad=@($statuses | Where-Object { $_ -ne 200 })
    $latencies=@($chat | ForEach-Object { [double](([string](Get-Prop $_.httpRequest 'latency' '0s')).TrimEnd('s')) })
    $max=0; foreach($l in $latencies){ if($l -gt $max){$max=$l} }
    [pscustomobject]@{Authenticated=($chat.Count -gt 0 -and $bad.Count -eq 0);ExistingIAM=$true
        SyntheticOnly=[bool]$Attestation.OnlyAllowedQuestions
        HttpStatus=$(if($chat.Count -eq 0){0}elseif($bad.Count){$bad[0]}else{200})
        AssertionsPassed=[bool]($Attestation.SummaryFirst -and $Attestation.RegisteredRevision -and $Attestation.TwoLayers)
        RequestCount=$chat.Count;DurationSeconds=[int][math]::Ceiling([math]::Max($max,0.001))
        TimedOut=(($EndUtc-$StartUtc).TotalSeconds -gt 1800);Attestation='owner (humana)'}
}
function Invoke-Native([string]$File,[string[]]$Arguments,[int]$TimeoutSeconds=180,[string]$WorkingDirectory=$PSScriptRoot,$Environment=$null) {
    $psi=New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName=$File
    $psi.Arguments=(@($Arguments | ForEach-Object { if($_ -match '[\s"=,;]'){ '"'+($_ -replace '"','\"')+'"' } else { $_ } })) -join ' '
    $psi.UseShellExecute=$false; $psi.RedirectStandardOutput=$true; $psi.RedirectStandardError=$true; $psi.CreateNoWindow=$true
    $psi.WorkingDirectory=$WorkingDirectory
    $psi.StandardOutputEncoding=[System.Text.Encoding]::UTF8; $psi.StandardErrorEncoding=[System.Text.Encoding]::UTF8
    if($null -ne $Environment) {
        $keep=@{}; foreach($k in @('PATH','SystemRoot','TEMP','TMP')){ $keep[$k]=[Environment]::GetEnvironmentVariable($k) }
        $psi.EnvironmentVariables.Clear()
        foreach($k in $keep.Keys){ $psi.EnvironmentVariables[$k]=$keep[$k] }
        foreach($e in $Environment.GetEnumerator()){ $psi.EnvironmentVariables[$e.Key]=[string]$e.Value }
    }
    $p=[System.Diagnostics.Process]::Start($psi)
    $out=$p.StandardOutput.ReadToEndAsync(); $err=$p.StandardError.ReadToEndAsync()
    if(-not $p.WaitForExit($TimeoutSeconds*1000)) {
        & taskkill.exe /PID $p.Id /T /F | Out-Null
        return [pscustomobject]@{ExitCode=-1;TimedOut=$true;Value=$null;StdErr=''}
    }
    $p.WaitForExit()
    [pscustomobject]@{ExitCode=$p.ExitCode;TimedOut=$false;Value=$out.Result;StdErr=$err.Result}
}
function Get-GcloudPath { (Get-Command gcloud.cmd -ErrorAction Stop).Source }
function Invoke-Gcloud([string[]]$Arguments,[int]$TimeoutSeconds=180) {
    $r=Invoke-Native (Get-GcloudPath) ($Arguments+@("--project=$script:Project",'--quiet')) $TimeoutSeconds
    if($r.ExitCode -ne 0 -or $r.TimedOut){
        $last=@(([string]$r.StdErr) -split '\r?\n' | Where-Object { $_ }) | Select-Object -Last 1
        throw "gcloud $($Arguments[0]) $($Arguments[1]) fallo (timeout=$($r.TimedOut)): $last"
    }
    return [string]$r.Value
}
function Invoke-Git([string[]]$Arguments) {
    $r=Invoke-Native 'git.exe' (@('-C',$script:RepoLocal)+$Arguments) 120
    Assert-True ($r.ExitCode -eq 0 -and -not $r.TimedOut) ('git fallo: '+$r.StdErr)
    return [string]$r.Value
}
# Cloud Run reconcilia status de forma asincrona: hasta que status.observedGeneration alcanza
# metadata.generation, status.traffic describe la generacion ANTERIOR. Run 41216052594: tras el
# ReplaceService del paso 3 (gen 19, trafico fijado por nombre) la relectura vio aun la gen 18
# (latestRevision=true) y Assert-Traffic dio "Trafico no fijado a revision"; Cloud Run reconcilio
# 18 s despues. Nunca se valida un status sin reconciliar.
function Test-ServiceReconciled($Service,[long]$MinGeneration=0) {
    $generation=[long](Get-Prop (Get-Prop $Service 'metadata') 'generation' 0)
    $status=Get-Prop $Service 'status'
    Assert-True ($generation -gt 0 -and $generation -ge $MinGeneration) 'Generacion del servicio inesperada'
    if([long](Get-Prop $status 'observedGeneration' 0) -ne $generation){ return $false }
    $ready=@(@(Get-Prop $status 'conditions' @()) | Where-Object { [string](Get-Prop $_ 'type' '') -ceq 'Ready' })
    if($ready.Count -ne 1){ return $false }
    $readyStatus=[string](Get-Prop $ready[0] 'status' '')
    Assert-True ($readyStatus -cne 'False') 'Servicio no Ready tras reconciliar'
    return ($readyStatus -ceq 'True')
}
function Wait-ServiceReconciled([scriptblock]$Describe,[long]$MinGeneration=0,[int]$TimeoutSeconds=300,[int]$PollSeconds=5) {
    $deadline=[datetime]::UtcNow.AddSeconds($TimeoutSeconds)
    while($true) {
        $candidate=& $Describe
        if(Test-ServiceReconciled $candidate $MinGeneration){ return $candidate }
        Assert-True ([datetime]::UtcNow -lt $deadline) 'Cloud Run no reconcilio el servicio a tiempo'
        Start-Sleep -Seconds $PollSeconds
    }
}
function Read-CloudState {
    $loc="--region=$script:Region"
    $service=Wait-ServiceReconciled { Invoke-Gcloud @('run','services','describe',$script:Service,"--region=$script:Region",'--format=json') | ConvertFrom-Json }
    $original=Invoke-Gcloud @('run','revisions','describe',$script:ExpectedRevision,$loc,'--format=json') | ConvertFrom-Json
    $bindings={param($Policy) @(@(Get-Prop $Policy 'bindings' @()) | ForEach-Object { [ordered]@{role=$_.role;members=@($_.members | Sort-Object)} } | Sort-Object { $_.role })}
    $serviceIam=Invoke-Gcloud @('run','services','get-iam-policy',$script:Service,$loc,'--format=json') | ConvertFrom-Json
    $projectIam=Invoke-Gcloud @('projects','get-iam-policy',$script:Project,'--format=json') | ConvertFrom-Json
    $versions=[ordered]@{}
    foreach($secret in $script:Secrets) {
        $list=Invoke-Gcloud @('secrets','versions','list',$secret,'--format=json') | ConvertFrom-Json
        $versions[$secret]=@(@($list) | ForEach-Object { [ordered]@{name=$_.name;state=$_.state} } | Sort-Object { $_.name })
    }
    $oauth=[ordered]@{}; foreach($s in $script:OAuthSecrets){ $oauth[$s]=$versions[$s] }
    $state=[ordered]@{Traffic=(ConvertTo-TrafficModel $service)
        IAM=[ordered]@{service=(& $bindings $serviceIam);project=(& $bindings $projectIam)}
        OAuth=$oauth;SecretVersions=$versions
        OriginalRevision=[ordered]@{name=$original.metadata.name;imageDigest=$original.status.imageDigest;spec=$original.spec}
        ServiceExport=$service}
    # Misma forma que la linea base tras su ida y vuelta por JSON (snapshot DPAPI).
    return ((Get-Canonical $state) | ConvertFrom-Json)
}
function ConvertTo-UtcDate($Value) {
    if($Value -is [datetime]){ return $Value.ToUniversalTime() }
    return [datetime]::Parse([string]$Value,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::AdjustToUniversal -bor [Globalization.DateTimeStyles]::AssumeUniversal)
}
function Write-PrivateFile([string]$Path,[string]$Text) { [System.IO.File]::WriteAllText($Path,$Text,(New-Object System.Text.UTF8Encoding $false)) }
# Cloud Run Admin API v1 ReplaceService (lo que usa gcloud por debajo). `gcloud run services
# replace` exige ademas la Cloud Resource Manager API, desactivada en el proyecto; la API
# de Cloud Run no. dryRun=all valida en servidor sin persistir (run_v1_messages.py).
function Invoke-ServiceReplace($Document,[switch]$DryRun) {
    $token=(Invoke-Gcloud @('auth','print-access-token')).Trim()
    $uri="https://$($script:Region)-run.googleapis.com/apis/serving.knative.dev/v1/namespaces/$($script:Project)/services/$($script:Service)"
    if($DryRun){ $uri+='?dryRun=all' }
    $body=[System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $Document -Depth 100 -Compress))
    try {
        $response=Invoke-RestMethod -Method Put -Uri $uri -Body $body -ContentType 'application/json; charset=utf-8' -Headers @{Authorization="Bearer $token"} -TimeoutSec 300
    } catch {
        $detail=Get-Prop $_ 'ErrorDetails'; $message=if($detail){ [string](Get-Prop $detail 'Message' '') } else { '' }
        if($message -match '"message":\s*"([^"]{0,300})'){ $message=$Matches[1] }
        throw "Cloud Run ReplaceService fallo (dryRun=$([bool]$DryRun)): $message"
    } finally { $token=$null }
    Assert-True ($response.metadata.name -ceq $script:Service) 'Respuesta de ReplaceService inesperada'
    if(-not $DryRun){
        # Toda lectura posterior (paso 3, wrapper CI, remove-tag, rollback) ve la generacion escrita.
        $written=[long](Get-Prop $response.metadata 'generation' 0)
        Wait-ServiceReconciled { Invoke-Gcloud @('run','services','describe',$script:Service,"--region=$script:Region",'--format=json') | ConvertFrom-Json } $written | Out-Null
    }
    return $response
}
function New-BuildContext([string]$Destination) {
    $resolved=(Invoke-Git @('rev-parse','--verify',($script:ExpectedCommit+'^{commit}'))).Trim()
    Assert-True ($resolved -ceq $script:ExpectedCommit) 'Commit no disponible en el checkout local'
    Assert-True (-not (Test-Path -LiteralPath $Destination)) 'Contexto de build existente: no reutilizar'
    New-Item -ItemType Directory -Path $Destination | Out-Null
    $tar=$Destination+'.tar'
    Invoke-Git (@('archive','--format=tar','-o',$tar,$script:ExpectedCommit,'--')+$script:BuildContextFiles) | Out-Null
    $r=Invoke-Native 'tar.exe' @('-xf',$tar,'-C',$Destination) 120
    Remove-Item -LiteralPath $tar -Force
    Assert-True ($r.ExitCode -eq 0) 'Extraccion del contexto fallida'
    return $Destination
}
# Build explicito equivalente a `gcloud builds submit --tag` (docker build + push del tag),
# con logs solo en Cloud Logging: una cuenta de build propia exige configurar los logs
# (sin bucket de logs heredado) y gcloud builds submit no tiene opcion para ello.
function New-BuildConfig([string]$ImageTag) {
    Assert-True ($ImageTag -ceq ($script:ImageRepo+':'+$script:ShortCommit)) 'Tag de imagen inesperado'
    [ordered]@{
        steps=@([ordered]@{name='gcr.io/cloud-builders/docker';args=@('build','--network','cloudbuild','--no-cache','-t',$ImageTag,'.')})
        images=@($ImageTag)
        options=[ordered]@{logging='CLOUD_LOGGING_ONLY'}
    }
}
function New-BuildSubmitArguments([string]$Context,[string]$ConfigPath) {
    Assert-True ($script:BuildServiceAccount -cmatch '^oxkio-gha-build@oxkio-runtime-prod\.iam\.gserviceaccount\.com$') 'Cuenta de build no dedicada'
    @('builds','submit',$Context,"--region=$script:Region","--config=$ConfigPath",
      "--service-account=projects/$script:Project/serviceAccounts/$script:BuildServiceAccount",'--timeout=600s','--async','--format=json')
}
function Assert-IsolationProof {
    Assert-True (Test-Path -LiteralPath $script:IsolationProofPath) 'Falta prueba de aislamiento (Mode ProveIsolation)'
    $proof=Get-Content -LiteralPath $script:IsolationProofPath -Raw | ConvertFrom-Json
    Assert-True ($proof.Commit -ceq $script:ExpectedCommit -and $proof.Passed) 'Prueba de aislamiento no valida para el commit'
    return $proof
}
function Assert-RecentCheckReal {
    Assert-True (Test-Path -LiteralPath $script:CheckRealPath) 'Falta Mode CheckReal'
    $check=Get-Content -LiteralPath $script:CheckRealPath -Raw | ConvertFrom-Json
    Assert-True ($check.Commit -ceq $script:ExpectedCommit -and $check.Passed -and @($check.Blockers).Count -eq 0) 'CheckReal no esta en verde'
    Assert-True (([datetime]::UtcNow-(ConvertTo-UtcDate $check.AtUtc)).TotalHours -lt 6) 'CheckReal caducado (>6 h)'
}
function Assert-RecentCheck {
    Assert-True (Test-Path -LiteralPath $script:CheckPath) 'Falta Mode Check'
    $check=Get-Content -LiteralPath $script:CheckPath -Raw | ConvertFrom-Json
    Assert-True ($check.Commit -ceq $script:ExpectedCommit -and $check.Passed) 'Check no valido'
    Assert-True (([datetime]::UtcNow-(ConvertTo-UtcDate $check.AtUtc)).TotalHours -lt 6) 'Check caducado (>6 h)'
}
# Arranca el commit exacto en local con New-SyntheticEnv: /health 200, V3 activo para la
# cohorte, sin proveedor de razonamiento, 401 sin token y sin conexiones salientes.
function Invoke-ProveIsolation {
    New-Item -ItemType Directory -Force -Path $script:Evidence | Out-Null
    $ctx=New-BuildContext (Join-Path $env:TEMP ('oxkio-isolation-'+[guid]::NewGuid().ToString('N')))
    $junction=Join-Path $ctx 'node_modules'
    $memory=Join-Path $ctx 'v3-memory'
    try {
        $lockMain=(Get-FileHash (Join-Path $script:RepoLocal 'package-lock.json')).Hash
        Assert-True ($lockMain -ceq (Get-FileHash (Join-Path $ctx 'package-lock.json')).Hash) 'node_modules local no corresponde al lockfile del commit'
        & cmd.exe /c mklink /J $junction (Join-Path $script:RepoLocal 'node_modules') | Out-Null
        $synthEnv=New-SyntheticEnv (New-IntegrityKey); $synthEnv['OXKIO_V3_MEMORY_ROOT']=$memory; $synthEnv['PORT']='8099'
        $psi=New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName=(Get-Command node.exe).Source; $psi.Arguments='backend/api/server.js'; $psi.WorkingDirectory=$ctx
        $psi.UseShellExecute=$false; $psi.RedirectStandardOutput=$true; $psi.RedirectStandardError=$true; $psi.CreateNoWindow=$true
        $keep=@{}; foreach($k in @('PATH','SystemRoot','TEMP','TMP')){ $keep[$k]=[Environment]::GetEnvironmentVariable($k) }
        $psi.EnvironmentVariables.Clear(); foreach($k in $keep.Keys){ $psi.EnvironmentVariables[$k]=$keep[$k] }
        foreach($e in $synthEnv.GetEnumerator()){ $psi.EnvironmentVariables[$e.Key]=[string]$e.Value }
        $p=[System.Diagnostics.Process]::Start($psi); $out=$p.StandardOutput.ReadToEndAsync(); $null=$p.StandardError.ReadToEndAsync()
        $checks=[ordered]@{}
        try {
            $health=$null
            foreach($i in 1..60){ try { $health=Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8099/health' -TimeoutSec 3; break } catch { Start-Sleep -Seconds 2 } }
            $checks.Health200=($null -ne $health -and $health.StatusCode -eq 200)
            $code={param($Method,$Url)
                $request=@{UseBasicParsing=$true;Method=$Method;Uri=$Url;TimeoutSec=15}
                if($Method -eq 'POST'){ $request.Body='{}'; $request.ContentType='application/json' }
                try { (Invoke-WebRequest @request).StatusCode }
                catch { $response=Get-Prop $_.Exception 'Response'; if($response){ [int]$response.StatusCode } else { -1 } } }
            $checks.ChatWithoutToken401=((& $code 'POST' ('http://127.0.0.1:8099'+$script:ChatPath)) -eq 401)
            $checks.OAuthWithoutToken401=((& $code 'GET' 'http://127.0.0.1:8099/oauth/google') -eq 401)
            # Consultar sin filtros y filtrar despues: -OwningProcess/-LocalPort con
            # SilentlyContinue devuelve vacio cuando la consulta falla (falso "sin conexiones").
            $outbound=@(Get-NetTCPConnection -ErrorAction Stop | Where-Object { $_.OwningProcess -eq $p.Id -and $_.State -eq 'Established' -and $_.RemoteAddress -notin @('127.0.0.1','::1') })
            $checks.NoOutboundConnections=($outbound.Count -eq 0)
        } finally { & taskkill.exe /PID $p.Id /T /F | Out-Null; $p.WaitForExit(10000) | Out-Null }
        $log=[string]$out.Result
        $checks.V3EnabledForCohort=($log -match 'V3: enabled for cohort')
        $checks.V3ReasoningNotConfigured=($log -match 'V3 Reasoning: not configured')
        $checks.ExecutiveReasoningNotConnected=($log -match 'Executive Reasoning: CONNECTION_NEEDED')
        $checks.NoV3Refusal=($log -notmatch 'OXKIO V3\] not enabled')
        $passed=-not ($checks.Values -contains $false)
        $proof=[ordered]@{Commit=$script:ExpectedCommit;AtUtc=[datetime]::UtcNow.ToString('o');Passed=$passed;Checks=$checks;LockfileSha256=$lockMain}
        Write-PrivateFile $script:IsolationProofPath (ConvertTo-Json $proof -Depth 5)
        return $proof
    } finally {
        if(Test-Path -LiteralPath $junction){ & cmd.exe /c rmdir $junction | Out-Null }
        Remove-Item -LiteralPath $ctx -Recurse -Force -ErrorAction SilentlyContinue
    }
}
# Solo lecturas y validaciones en servidor (`replace --dry-run`): no crea ni cambia nada.
function Invoke-Check {
    New-Item -ItemType Directory -Force -Path $script:Evidence | Out-Null
    Assert-OwnerUid
    Assert-CommitOnMain
    $proof=Assert-IsolationProof
    $state=Read-CloudState
    Assert-Traffic $state.Traffic -AllowLatest
    $result=[ordered]@{Commit=$script:ExpectedCommit;AtUtc=[datetime]::UtcNow.ToString('o');Passed=$false}
    $result.Traffic=$state.Traffic
    $result.IsolationProofAtUtc=$proof.AtUtc
    $restore=Invoke-ServiceReplace (New-RestoreServiceDocument $state) -DryRun
    $result.RollbackDryRun=[ordered]@{Status='OK';Traffic=$restore.spec.traffic;Image=@($restore.spec.template.spec.containers)[0].image}
    # Imagen de 00018 solo como sustituto para validar la forma; la clave es un marcador desechable.
    $synthetic=Invoke-ServiceReplace (New-SyntheticServiceDocument $state.ServiceExport $state.OriginalRevision.imageDigest ('dry-run-placeholder-'+('0'*64))) -DryRun
    $result.SyntheticRevisionDryRun=[ordered]@{Status='OK';Traffic=$synthetic.spec.traffic;Revision=$synthetic.spec.template.metadata.name
        EnvNames=@(@($synthetic.spec.template.spec.containers)[0].env | ForEach-Object { $_.name })}
    $after=Read-CloudState
    Assert-Invariants $state $after -AllowLatest
    Assert-True ((Get-Canonical $after.Traffic) -ceq (Get-Canonical $state.Traffic)) 'El dry-run altero el trafico'
    Assert-True ($after.ServiceExport.metadata.resourceVersion -ceq $state.ServiceExport.metadata.resourceVersion) 'El dry-run altero el servicio'
    $result.DryRunsPersistedNothing=$true
    $existing=Invoke-Native (Get-GcloudPath) @('artifacts','docker','images','describe',($script:ImageRepo+':'+$script:ShortCommit),"--project=$script:Project",'--quiet') 120
    Assert-True ($existing.ExitCode -ne 0) 'Ya existe una imagen con el tag del commit: no sobrescribir'
    $result.ImageTagFree=$true
    $quote=New-ConservativeQuote ([datetime]::UtcNow)
    $total=[decimal]0; foreach($v in $quote.Reservations.Values){ $total+=$v }
    Assert-True ($total -le $script:LimitEUR) 'Cota total por encima del limite'
    $result.ReservationsEUR=[ordered]@{}; foreach($k in 1..6){ $result.ReservationsEUR["Paso$k"]=$quote.Reservations[$k] }
    $result.TotalReservedEUR=$total
    $result.Passed=$true
    Write-PrivateFile $script:CheckPath (ConvertTo-Json $result -Depth 6)
    return $result
}
$script:CloudAdapter={param($Operation,$Payload)
    $ok={param($Value) [pscustomobject]@{ExitCode=0;TimedOut=$false;Value=$Value}}
    $loc="--region=$script:Region"
    switch($Operation) {
        'ReadState' { return (& $ok (Read-CloudState)) }
        'PersistPrivateSnapshot' {
            $path=Join-Path $script:Evidence ('baseline-'+[datetime]::UtcNow.ToString('yyyyMMddTHHmmssZ')+'.dpapi')
            $script:CurrentState.SnapshotPath=$path; $script:CurrentState.SnapshotHash=Protect-LocalSnapshot $Payload $path
            Save-Journal $script:CurrentState; return (& $ok $true) }
        'PersistLedger' { Save-Journal $script:CurrentState; return (& $ok $true) }
        'BuildExactCommit' {
            $ctx=New-BuildContext (Join-Path $env:TEMP ('oxkio-build-'+$script:ShortCommit+'-'+[guid]::NewGuid().ToString('N')))
            # La configuracion queda fuera del contexto: no se sube con el codigo.
            $cfg=$ctx+'.cloudbuild.json'
            try {
                Write-PrivateFile $cfg (ConvertTo-Json (New-BuildConfig "$($script:ImageRepo):$($script:ShortCommit)") -Depth 6)
                $submitted=Invoke-Gcloud (New-BuildSubmitArguments $ctx $cfg) 600 | ConvertFrom-Json
            } finally {
                Remove-Item -LiteralPath $ctx -Recurse -Force -ErrorAction SilentlyContinue
                Remove-Item -LiteralPath $cfg -Force -ErrorAction SilentlyContinue
            }
            $Payload.BuildId=$submitted.id; Save-Journal $Payload
            $deadline=[datetime]::UtcNow.AddSeconds(900); $build=$null
            do {
                Start-Sleep -Seconds 15
                $build=Invoke-Gcloud @('builds','describe',$Payload.BuildId,$loc,'--format=json') | ConvertFrom-Json
            } while($build.status -in @('QUEUED','PENDING','WORKING') -and [datetime]::UtcNow -lt $deadline)
            Assert-True ($build.status -ceq 'SUCCESS') "Build no completado: $($build.status)"
            $Payload.BuildId=$build.id; $Payload.Digest=@($build.results.images)[0].digest
            Save-Journal $Payload; return (& $ok $true) }
        'VerifyRegisteredDigest' {
            $image=Invoke-Gcloud @('artifacts','docker','images','describe',"$($script:ImageRepo):$($script:ShortCommit)",'--format=json') | ConvertFrom-Json
            Assert-True ($image.image_summary.digest -ceq $Payload.Digest -and $Payload.Digest -cmatch '^sha256:[0-9a-f]{64}$') 'Digest registrado distinto del construido'
            return (& $ok $true) }
        'CreateZeroTrafficRevision' {
            $proof=Assert-IsolationProof
            $current=Invoke-Gcloud @('run','services','describe',$script:Service,$loc,'--format=json') | ConvertFrom-Json
            $imageRef="$($script:ImageRepo)@$($Payload.Digest)"
            $document=if($script:Variant -ceq 'Real'){ Assert-RecentCheckReal; New-RealV3ServiceDocument $current $imageRef } else { New-SyntheticServiceDocument $current $imageRef (New-IntegrityKey) }
            Invoke-ServiceReplace $document -DryRun | Out-Null
            Invoke-ServiceReplace $document | Out-Null
            $document=$null
            $Payload.RevisionCreatedUtc=[datetime]::UtcNow.ToString('o'); Save-Journal $Payload
            $service=Invoke-Gcloud @('run','services','describe',$script:Service,$loc,'--format=json') | ConvertFrom-Json
            $revision=Invoke-Gcloud @('run','revisions','describe',$script:TestRevision,$loc,'--format=json') | ConvertFrom-Json
            $model=ConvertTo-RevisionModel $revision (ConvertTo-TrafficModel $service) $proof.Commit
            Assert-True ($model.Digest -ceq $Payload.Digest) 'La revision no usa el digest construido'
            return (& $ok ([pscustomobject]@{Revision=$model})) }
        'AuthenticatedSyntheticTest' {
            $start=[datetime]::UtcNow
            $proxy=Start-Process -FilePath (Get-GcloudPath) -ArgumentList @('run','services','proxy',$script:Service,$loc,"--tag=$script:TestTag",'--port=8082',"--project=$script:Project") -WindowStyle Hidden -PassThru
            try {
                Write-Host 'Abre http://localhost:8082, inicia sesion como owner y pregunta SOLO:'
                Write-Host '  1) Cual es el estado de Cliente Cero?'
                Write-Host '  2) Que dice el registro de continuidad sobre CZ-RUNTIME-SYNC?'
                Write-Host 'No preguntes por correo, calendario ni memoria personal. Limite: 30 minutos.'
                $yes={param($Question) (Read-Host "$Question (s/n)") -ceq 's'}
                $attest=[pscustomobject]@{
                    OnlyAllowedQuestions=(& $yes 'Hiciste solo esas dos preguntas, sin datos personales')
                    SummaryFirst=(& $yes 'La respuesta 1 empieza por "En resumen:"')
                    RegisteredRevision=(& $yes 'La respuesta 1 cita la revision del registro y dice que es estado registrado, no comprobacion en vivo')
                    TwoLayers=(& $yes 'La respuesta 2 separa "Estado registrado" y "Evidencia verificada" de CZ-RUNTIME-SYNC')}
            } finally { & taskkill.exe /PID $proxy.Id /T /F | Out-Null }
            $end=[datetime]::UtcNow
            $filter="resource.type=cloud_run_revision AND resource.labels.service_name=$($script:Service) AND resource.labels.revision_name=$($script:TestRevision)"
            $entries=@()
            foreach($i in 1..9){
                $entries=@(Invoke-Gcloud @('logging','read',$filter,'--freshness=2h','--limit=500','--format=json') | ConvertFrom-Json)
                if(@($entries | Where-Object { (Get-Prop $_ 'httpRequest') -and ([string](Get-Prop $_.httpRequest 'requestUrl' '')) -like "*$script:ChatPath*" }).Count){ break }
                Start-Sleep -Seconds 10
            }
            $test=ConvertTo-TestModel $entries $start $end $attest
            $Payload.Test=$test; Save-Journal $Payload
            return (& $ok ([pscustomobject]@{Test=$test})) }
        'VerifyRevisionAndTest' {
            $proof=Assert-IsolationProof
            $service=Invoke-Gcloud @('run','services','describe',$script:Service,$loc,'--format=json') | ConvertFrom-Json
            $revision=Invoke-Gcloud @('run','revisions','describe',$script:TestRevision,$loc,'--format=json') | ConvertFrom-Json
            $model=ConvertTo-RevisionModel $revision (ConvertTo-TrafficModel $service) $proof.Commit
            $filter="resource.type=cloud_run_revision AND resource.labels.service_name=$($script:Service) AND resource.labels.revision_name=$($script:TestRevision)"
            $entries=@(Invoke-Gcloud @('logging','read',$filter,'--freshness=6h','--limit=1000','--format=json') | ConvertFrom-Json)
            $errors=@($entries | Where-Object { ((Get-Prop $_ 'severity' '') -in @('ERROR','CRITICAL','ALERT','EMERGENCY')) -or ((Get-Prop $_ 'httpRequest') -and [int](Get-Prop $_.httpRequest 'status' 0) -ge 500) })
            Assert-True ($errors.Count -eq 0) 'Errores o respuestas 5xx en la revision de prueba'
            Assert-True (@($entries | Where-Object { [string](Get-Prop $_ 'textPayload' '') -match 'V3: enabled for cohort' }).Count -gt 0) 'Sin evidencia de arranque V3 en logs'
            Assert-True (@($entries | Where-Object { [string](Get-Prop $_ 'textPayload' '') -match 'OXKIO V3\] not enabled' }).Count -eq 0) 'V3 rechazado en la revision'
            $Payload.Revision=$model; Save-Journal $Payload
            return (& $ok ([pscustomobject]@{Revision=$model;Test=$Payload.Test})) }
        'RemoveTestTag' {
            $current=Invoke-Gcloud @('run','services','describe',$script:Service,$loc,'--format=json') | ConvertFrom-Json
            $document=New-UntaggedServiceDocument $current
            Invoke-ServiceReplace $document -DryRun | Out-Null
            Invoke-ServiceReplace $document | Out-Null
            return (& $ok $true) }
        default { throw "Operacion desconocida: $Operation" }
    }
}
function Invoke-PreparedStep($State,[int]$Step,[scriptblock]$Adapter) {
    Assert-True ($Step -eq $State.NextStep) 'Paso fuera de secuencia o repetido'
    Assert-True (-not $State.Stopped) 'Ejecucion previamente detenida'
    try {
        $pre=Assert-NativeResult (& $Adapter 'ReadState' $null)
        Assert-Traffic $pre.Traffic -AllowLatest:($Step -le 3)
        if($Step -eq 0) {
            Assert-True ($null -ne $pre.ServiceExport -and $null -ne $pre.OriginalRevision) 'Snapshot incompleto'
            $State.Baseline=$pre
            $State.Rollback=New-RollbackPlan $pre
            # Persistencia privada atomica debe confirmarse ANTES de cualquier mutacion.
            $saved=Assert-NativeResult (& $Adapter 'PersistPrivateSnapshot' $pre)
            Assert-True $saved 'Snapshot no preservado'
        } else {
            Assert-Invariants $State.Baseline $pre -AllowLatest:($Step -le 3)
            Assert-Budget $State.Ledger $State.Quote $State.ElapsedSeconds
            $State.Ledger.ReservedEUR += $State.Quote.NextReservationEUR
            $saved=Assert-NativeResult (& $Adapter 'PersistLedger' $State.Ledger)
            Assert-True $saved 'Reserva no preservada'
            $operation=@{1='BuildExactCommit';2='VerifyRegisteredDigest';3='CreateZeroTrafficRevision';4='AuthenticatedSyntheticTest';5='VerifyRevisionAndTest';6='RemoveTestTag'}[$Step]
            $result=Assert-NativeResult (& $Adapter $operation $State)
            if($Step -in @(3,5)){ if($script:Variant -ceq 'Real'){ Assert-RealRevision $result.Revision } else { Assert-IsolatedRevision $result.Revision } }
            if($Step -in @(4,5)){Assert-TestResult $result.Test}
        }
        $post=Assert-NativeResult (& $Adapter 'ReadState' $null)
        Assert-Invariants $State.Baseline $post -AllowLatest:($Step -le 2)
        $State.NextStep++
    } catch {
        $State.Stopped=$true
        # No reintento ni rollback cloud automatico tras discrepancia: preservar evidencia.
        throw
    }
}
function New-CloudState {
    [pscustomobject]@{NextStep=0;Stopped=$false;Baseline=$null;Rollback=$null
        Ledger=[pscustomobject]@{SpentEUR=[decimal]0;ReservedEUR=[decimal]0};Quote=$null;ElapsedSeconds=0
        StartedUtc=[datetime]::UtcNow.ToString('o');SnapshotPath='';SnapshotHash='';BuildId='';Digest='';RevisionCreatedUtc='';Test=$null;Revision=$null}
}
# El journal no guarda la linea base (va cifrada aparte) ni la clave de integridad.
function Save-Journal($State) {
    $copy=[ordered]@{}
    foreach($p in $State.PSObject.Properties){ if($p.Name -notin @('Baseline','Rollback','Quote')){ $copy[$p.Name]=$p.Value } }
    $temp=$script:JournalPath+'.tmp'
    Write-PrivateFile $temp (ConvertTo-Json $copy -Depth 8)
    Move-Item -LiteralPath $temp -Destination $script:JournalPath -Force
}
function Read-Journal {
    $j=Get-Content -LiteralPath $script:JournalPath -Raw | ConvertFrom-Json
    $state=New-CloudState
    foreach($p in $j.PSObject.Properties){ $state.$($p.Name)=$p.Value }
    $state.Ledger=[pscustomobject]@{SpentEUR=[decimal]$j.Ledger.SpentEUR;ReservedEUR=[decimal]$j.Ledger.ReservedEUR}
    return $state
}
function Invoke-CloudStep([int]$Step) {
    New-Item -ItemType Directory -Force -Path $script:Evidence | Out-Null
    if($Step -eq 0) {
        Assert-True (-not (Test-Path -LiteralPath $script:JournalPath)) 'Ya existe journal: la secuencia no se reinicia'
        Assert-IsolationProof | Out-Null
        Assert-RecentCheck
        if($script:Variant -ceq 'Real'){ Assert-RecentCheckReal }
        $state=New-CloudState
    } else {
        $state=Read-Journal
        Assert-True ((Get-FileHash -LiteralPath $state.SnapshotPath).Hash -ceq $state.SnapshotHash) 'Snapshot alterado'
        $state.Baseline=Read-LocalSnapshot $state.SnapshotPath
        $state.Baseline.Traffic=@($state.Baseline.Traffic)
    }
    $started=ConvertTo-UtcDate $state.StartedUtc
    $state.Quote=New-ConservativeQuote $started
    if($Step -gt 0){ $state.Quote.NextReservationEUR=$state.Quote.Reservations[$Step] }
    $state.ElapsedSeconds=([datetime]::UtcNow-$started).TotalSeconds
    $script:CurrentState=$state
    try { Invoke-PreparedStep $state $Step $script:CloudAdapter }
    finally { Save-Journal $state }
    [ordered]@{Paso=$Step;NextStep=$state.NextStep;ReservedEUR=$state.Ledger.ReservedEUR;Traffic='00018-9xl 100 %'}
}
# Restaura la plantilla y el trafico del export del paso 0 (sin IAM ni secretos).
# Efecto: Cloud Run crea una revision nueva con la configuracion original y 0 % de trafico.
function Invoke-Rollback {
    $state=Read-Journal
    Assert-True ((Get-FileHash -LiteralPath $state.SnapshotPath).Hash -ceq $state.SnapshotHash) 'Snapshot alterado'
    $baseline=Read-LocalSnapshot $state.SnapshotPath
    $document=New-RestoreServiceDocument $baseline
    Invoke-ServiceReplace $document -DryRun | Out-Null
    Invoke-ServiceReplace $document | Out-Null
    $after=Read-CloudState
    Assert-Invariants $baseline $after
    Assert-True (@($after.Traffic | Where-Object { $_.tag }).Count -eq 0) 'Queda una etiqueta de prueba'
    'ROLLBACK OK: 00018-9xl 100 %, plantilla original restaurada, IAM y secretos sin cambios.'
}
if($MyInvocation.InvocationName -ne '.') {
    switch($Mode) {
        'Validate' { 'Sintaxis cargada. Orden: Simulate, ProveIsolation, Check, Cloud -Paso 0..6.' }
        'Simulate' { & (Join-Path $PSScriptRoot 'Invoke-OxkioV3CloudRevision.Tests.ps1') }
        'ProveIsolation' { Assert-OwnerUid; Invoke-ProveIsolation | ConvertTo-Json -Depth 5 }
        'Check' { Invoke-Check | ConvertTo-Json -Depth 6 }
        'CheckReal' { Invoke-CheckReal | ConvertTo-Json -Depth 6 }
        'Cloud' { Invoke-CloudStep $Paso | ConvertTo-Json }
        'Rollback' { Invoke-Rollback }
    }
}
