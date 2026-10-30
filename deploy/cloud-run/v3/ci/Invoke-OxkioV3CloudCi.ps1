# OXKIO V3 — entrada de GitHub Actions (windows-latest) para la revision privada.
# Reutiliza Invoke-OxkioV3CloudRevision.ps1 sin cambios (dot-source: su bloque
# principal no se ejecuta) y solo adapta lo que un runner efimero y con logs
# PUBLICOS necesita:
#   - imprime solo un resumen saneado (nunca Env, UID del owner, IAM ni el export del servicio);
#   - los pasos 0..3 corren en el mismo job: el snapshot DPAPI del paso 0 solo vive en este runner,
#     asi que si algo falla desde el paso 3 se restaura aqui mismo con Invoke-Rollback;
#   - el paso 4 (prueba humana con attestation) se sustituye por una prueba automatica privada:
#     sin token IAM 403, con token IAM /health 200, sin token Firebase 401, logs sin 5xx.
#     La prueba humana del owner queda para la fase de acceso por Internet.
# Operaciones: CheckReal (solo lecturas y dry-run), PrivateRevision (0 % de trafico,
# etiqueta privada), RemoveTag (quita la etiqueta; trafico 100 % a la revision original),
# SelfTest (sin nube: comprueba la carga y el saneado).
[CmdletBinding()]
param([ValidateSet('CheckReal','PrivateRevision','RemoveTag','SelfTest')][string]$Operation='SelfTest')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'

$ciCommit=if($Operation -ceq 'SelfTest'){ '0'*40 } else { [string]$env:GITHUB_SHA }
if($ciCommit -cnotmatch '^[0-9a-f]{40}$'){ throw 'GITHUB_SHA requerido' }
$ciEvidence=Join-Path ([IO.Path]::GetTempPath()) ('oxkio-v3-ci-'+$ciCommit.Substring(0,7)+'-'+[guid]::NewGuid().ToString('N'))
. (Join-Path $PSScriptRoot '..\Invoke-OxkioV3CloudRevision.ps1') -Mode Validate -Variant Real -Commit $ciCommit `
    -EvidenceRoot $ciEvidence -PgHost ([string]$env:OXKIO_V3_PG_HOST) -OwnerUid ([string]$env:OXKIO_V3_OWNER_UID)

# Lista blanca de campos publicables. Todo lo demas se descarta.
function ConvertTo-PublicSummary($Value) {
    if($null -eq $Value){ return $null }
    if($Value -is [bool] -or $Value -is [int] -or $Value -is [decimal] -or $Value -is [double]){ return $Value }
    if($Value -is [string]){
        # Solo formas cerradas: un UID de Firebase (alfanumerico libre) nunca encaja en ninguna.
        if($Value -cmatch '^(OK|PASS|FAIL|BLOCKED|[a-z]+(_[a-z]+)+(:[A-Za-z0-9_.-]+)?|oxkio-api-staging-[0-9a-z]+(-[0-9a-z]+)*|v3-real-[0-9a-f]{7}|sha256:[0-9a-f]{64}|[0-9a-f]{40}|[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+(Z|[+-][0-9:]+)?)$'){ return $Value }
        return '[omitido]'
    }
    if($Value -is [System.Collections.IDictionary]){
        $out=[ordered]@{}; foreach($k in $Value.Keys){ if($k -cnotin @('Env','ServiceExport','IAM','Baseline','Rollback','EnvNames','Traffic')){ $out[[string]$k]=ConvertTo-PublicSummary $Value[$k] } }; return $out
    }
    if($Value -is [System.Collections.IEnumerable]){ return @($Value | ForEach-Object { ConvertTo-PublicSummary $_ }) }
    $out=[ordered]@{}
    foreach($p in $Value.PSObject.Properties){ if($p.Name -cnotin @('Env','ServiceExport','IAM','Baseline','Rollback','EnvNames','Traffic')){ $out[$p.Name]=ConvertTo-PublicSummary $p.Value } }
    return $out
}
# Presupuesto de conexiones a Neon: por instancia, memoria V3 (max 8) + Approval y
# Mission (pg por defecto, 10 cada uno) = 28. La revision real hereda la plantilla
# del servicio; si esa plantilla escalase, las conexiones se multiplicarian sin aviso.
$script:MaxPgConnectionsPerInstance=28
$script:MaxPgConnectionsTotal=56
function Assert-ConnectionBudget($Revision) {
    Assert-True ($Revision.MaxInstances -ge 1 -and $Revision.Concurrency -eq 1) 'Escalado sin cota: maxScale y containerConcurrency=1 requeridos'
    Assert-True (($Revision.MaxInstances*$script:MaxPgConnectionsPerInstance) -le $script:MaxPgConnectionsTotal) 'maxScale supera el presupuesto de conexiones a Neon'
}
function Write-PublicSummary([string]$Title,$Value) {
    $json=ConvertTo-Json -InputObject (ConvertTo-PublicSummary $Value) -Depth 8
    Write-Output "== $Title"; Write-Output $json
    if($env:GITHUB_STEP_SUMMARY){ Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Value ("### $Title`n``````json`n$json`n``````") }
}
function Get-HttpStatus([string]$Method,[string]$Url,[hashtable]$Headers=@{}) {
    $request=@{Method=$Method;Uri=$Url;Headers=$Headers;TimeoutSec=30;SkipHttpErrorCheck=$true;MaximumRedirection=0;ErrorAction='Stop'}
    if($Method -eq 'POST'){ $request.Body='{}'; $request.ContentType='application/json' }
    try { return [int](Invoke-WebRequest @request).StatusCode } catch { return -1 }
}
# Revision privada: el servicio sigue sin acceso anonimo (403 de IAM sin token).
function Invoke-PrivateSmoke {
    $loc="--region=$script:Region"
    $service=Invoke-Gcloud @('run','services','describe',$script:Service,$loc,'--format=json') | ConvertFrom-Json
    $tagEntry=@(@(Get-Prop $service.status 'traffic' @()) | Where-Object { (Get-Prop $_ 'tag' '') -ceq $script:RealTag }) | Select-Object -First 1
    $tagUrl=[string](Get-Prop $tagEntry 'url' '')
    Assert-True ($tagUrl -cmatch '^https://[a-z0-9-]+\.a\.run\.app$') 'URL de la etiqueta privada no encontrada'
    $checks=[ordered]@{AnonymousDeniedByIAM=((Get-HttpStatus 'GET' "$tagUrl/health") -eq 403)}
    $token=$null
    try {
        foreach($audience in @($tagUrl,[string]$service.status.url)) {
            $token=(Invoke-Gcloud @('auth','print-identity-token',"--audiences=$audience")).Trim()
            if((Get-HttpStatus 'GET' "$tagUrl/health" @{Authorization="Bearer $token"}) -eq 200){ break }
        }
        $iam=@{Authorization="Bearer $token"}
        $checks.Health200=((Get-HttpStatus 'GET' "$tagUrl/health" $iam) -eq 200)
        $checks.Ready200=((Get-HttpStatus 'GET' "$tagUrl/ready" $iam) -eq 200)
        # El token IAM no es un token Firebase: la aplicacion debe rechazarlo.
        $checks.ApiWithoutFirebase401=((Get-HttpStatus 'GET' "$tagUrl/api/status" $iam) -eq 401)
        $checks.ChatWithoutFirebase401=((Get-HttpStatus 'POST' ("$tagUrl"+$script:ChatPath) $iam) -eq 401)
    } finally { $token=$null }
    $filter="resource.type=cloud_run_revision AND resource.labels.service_name=$($script:Service) AND resource.labels.revision_name=$($script:RealRevision)"
    $entries=@()
    foreach($i in 1..9){
        $entries=@(Invoke-Gcloud @('logging','read',$filter,'--freshness=1h','--limit=500','--format=json') | ConvertFrom-Json)
        if(@($entries | Where-Object { [string](Get-Prop $_ 'textPayload' '') -match 'V3: enabled for cohort' }).Count){ break }
        Start-Sleep -Seconds 10
    }
    $checks.V3EnabledForCohort=(@($entries | Where-Object { [string](Get-Prop $_ 'textPayload' '') -match 'V3: enabled for cohort' }).Count -gt 0)
    $checks.NoV3Refusal=(@($entries | Where-Object { [string](Get-Prop $_ 'textPayload' '') -match 'OXKIO V3\] not enabled' }).Count -eq 0)
    $checks.NoErrorsOr5xx=(@($entries | Where-Object { ((Get-Prop $_ 'severity' '') -in @('ERROR','CRITICAL','ALERT','EMERGENCY')) -or ((Get-Prop $_ 'httpRequest') -and [int](Get-Prop $_.httpRequest 'status' 0) -ge 500) }).Count -eq 0)
    $checks.Passed=-not ($checks.Values -contains $false)
    return $checks
}
function Invoke-PrivateRevision {
    Write-PublicSummary 'ProveIsolation' (Invoke-ProveIsolation)
    Write-PublicSummary 'Check' (Invoke-Check)
    $real=Invoke-CheckReal
    Write-PublicSummary 'CheckReal' $real
    Assert-True ([bool]$real.Passed) 'CheckReal no esta en verde'
    $attempted=-1
    try {
        foreach($step in 0..3){ $attempted=$step; Write-PublicSummary "Cloud paso $step" (Invoke-CloudStep $step) }
        $loc="--region=$script:Region"
        $service=Invoke-Gcloud @('run','services','describe',$script:Service,$loc,'--format=json') | ConvertFrom-Json
        $revision=Invoke-Gcloud @('run','revisions','describe',$script:RealRevision,$loc,'--format=json') | ConvertFrom-Json
        $model=ConvertTo-RevisionModel $revision (ConvertTo-TrafficModel $service) $script:ExpectedCommit
        Assert-RealRevision $model
        Assert-ConnectionBudget $model
        $smoke=Invoke-PrivateSmoke
        Write-PublicSummary 'Prueba privada' $smoke
        Assert-True ([bool]$smoke.Passed) 'Prueba privada fallida'
        Write-PublicSummary 'Resultado' ([ordered]@{Revision=$script:RealRevision;Tag=$script:RealTag;TrafficPercent=0;ServingRevision=$script:ExpectedRevision;Status='PASS'})
    } catch {
        $reason=[string]$_.Exception.Message
        if($attempted -ge 3){
            # El snapshot DPAPI solo existe en este runner: restaurar ahora o nunca.
            Write-Output (Invoke-Rollback)
        }
        Write-PublicSummary 'Resultado' ([ordered]@{Status='FAIL';FailedAtStep=$attempted;RolledBack=($attempted -ge 3)})
        throw $reason
    }
}
function Invoke-RemoveTag {
    $loc="--region=$script:Region"
    $current=Invoke-Gcloud @('run','services','describe',$script:Service,$loc,'--format=json') | ConvertFrom-Json
    $document=New-UntaggedServiceDocument $current
    Invoke-ServiceReplace $document -DryRun | Out-Null
    Invoke-ServiceReplace $document | Out-Null
    $after=Invoke-Gcloud @('run','services','describe',$script:Service,$loc,'--format=json') | ConvertFrom-Json
    $traffic=ConvertTo-TrafficModel $after
    Assert-Traffic $traffic
    Assert-True (@($traffic | Where-Object { $_.tag }).Count -eq 0) 'Queda una etiqueta'
    Write-PublicSummary 'RemoveTag' ([ordered]@{ServingRevision=$script:ExpectedRevision;TrafficPercent=100;Tags=0;Status='PASS'})
}
function Invoke-SelfTest {
    foreach($f in @('Invoke-ProveIsolation','Invoke-Check','Invoke-CheckReal','Invoke-CloudStep','Invoke-Rollback','New-UntaggedServiceDocument','Assert-RealRevision','Invoke-ServiceReplace')){
        Assert-True ($null -ne (Get-Command $f -CommandType Function -ErrorAction SilentlyContinue)) "Funcion reutilizada ausente: $f"
    }
    Assert-True ($script:Variant -ceq 'Real' -and $script:TestRevision -ceq $script:RealRevision) 'Variante Real no aplicada'
    Assert-True ($script:Evidence.StartsWith([IO.Path]::GetTempPath())) 'La evidencia debe quedar en el runner, fuera del repositorio'
    Assert-ConnectionBudget ([pscustomobject]@{MaxInstances=1;Concurrency=1})
    Assert-ConnectionBudget ([pscustomobject]@{MaxInstances=2;Concurrency=1})
    foreach($bad in @(@{MaxInstances=3;Concurrency=1},@{MaxInstances=0;Concurrency=1},@{MaxInstances=1;Concurrency=80})){
        $refused=$false; try { Assert-ConnectionBudget ([pscustomobject]$bad) } catch { $refused=$true }
        Assert-True $refused "Presupuesto de conexiones no aplicado: $($bad.MaxInstances)/$($bad.Concurrency)"
    }
    $secretUid='Abcdefghijklmnopqrstu12345'
    $sample=[pscustomobject]@{Passed=$true;Revision='oxkio-api-staging-v3r-abcdef0';Env=@{OXKIO_V3_COHORT_UIDS=$secretUid}
        Note="uid $secretUid";Bare=$secretUid;List=@($secretUid,'PASS');Nested=[ordered]@{ServiceExport=@{x=$secretUid};Ok='OK'};Blockers=@('secret_missing:OXKIO_V3_PG_PASSWORD')}
    $json=ConvertTo-Json -InputObject (ConvertTo-PublicSummary $sample) -Depth 8
    Assert-True (-not $json.Contains($secretUid)) 'El resumen publico contiene el UID'
    Assert-True ($json.Contains('oxkio-api-staging-v3r-abcdef0') -and $json.Contains('secret_missing:OXKIO_V3_PG_PASSWORD')) 'El resumen perdio campos publicos'
    'SELFTEST OK'
}

switch($Operation) {
    'SelfTest' { Invoke-SelfTest }
    'CheckReal' { Assert-OwnerUid; $r=Invoke-CheckReal; Write-PublicSummary 'CheckReal' $r; if(-not $r.Passed){ exit 2 } }
    'PrivateRevision' { Invoke-PrivateRevision }
    'RemoveTag' { Invoke-RemoveTag }
}
