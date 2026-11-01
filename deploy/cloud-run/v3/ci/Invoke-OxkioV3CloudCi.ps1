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
# Razonamiento V3 (Issue #85): entrada del workflow; vacia u 'off' = Off.
$ciReasoning=switch -CaseSensitive ([string]$env:OXKIO_V3_REASONING_MODE){ '' {'Off'} 'off' {'Off'} 'internal-egress' {'InternalEgress'} default { throw 'OXKIO_V3_REASONING_MODE invalido' } }
# Revision servida (variable de repositorio OXKIO_V3_SERVING_REVISION tras una promocion); vacia = valor por defecto del script.
$ciServing=@{}; if([string]$env:OXKIO_V3_SERVING_REVISION){ $ciServing.ServingRevision=[string]$env:OXKIO_V3_SERVING_REVISION }
. (Join-Path $PSScriptRoot '..\Invoke-OxkioV3CloudRevision.ps1') -Mode Validate -Variant Real -Commit $ciCommit `
    -EvidenceRoot $ciEvidence -PgHost ([string]$env:OXKIO_V3_PG_HOST) -OwnerUid ([string]$env:OXKIO_V3_OWNER_UID) -V3Reasoning $ciReasoning @ciServing

# Contrato de conversacion (Issue #85): una revision sin razonamiento V3 nunca puede declararse
# conversacional. Con InternalEgress la prueba exige la linea de arranque 'V3 Reasoning: ready'
# con el modelo y la region revisados; con Off exige 'not configured' y Conversational=false.
function Test-V3ReasoningLog($Entries) {
    $lines=@($Entries | ForEach-Object { [string](Get-Prop $_ 'textPayload' '') })
    $ready=@($lines | Where-Object { $_.Contains($script:V3ReasoningReadyLog) }).Count -gt 0
    $off=@($lines | Where-Object { $_.Contains($script:V3ReasoningOffLog) }).Count -gt 0
    if($script:V3Reasoning -ceq 'InternalEgress'){ return [ordered]@{V3ReasoningReady=($ready -and -not $off);Conversational=($ready -and -not $off)} }
    return [ordered]@{V3ReasoningOffAsDeclared=($off -and -not $ready)}
}

# Lista blanca de campos publicables. Todo lo demas se descarta.
function ConvertTo-PublicSummary($Value) {
    if($null -eq $Value){ return $null }
    if($Value -is [bool] -or $Value -is [int] -or $Value -is [decimal] -or $Value -is [double]){ return $Value }
    # pwsh 7 ConvertFrom-Json turns ISO strings into [datetime]; walking its properties
    # (DateTime.Date is a DateTime) recursed until "call depth overflow" (run 41198177233).
    if($Value -is [datetime]){ return $Value.ToUniversalTime().ToString('o') }
    if($Value -is [datetimeoffset]){ return $Value.UtcDateTime.ToString('o') }
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
# ID token IAM sin claves. Con WIF gcloud tiene una credencial external_account y
# `gcloud auth print-identity-token --audiences` la rechaza ("Invalid account type", run 41219259414).
# Mismo camino que google-github-actions/auth@v2 con token_format=id_token: token OIDC de GitHub ->
# STS (token federado) -> iamcredentials generateIdToken de la cuenta de despliegue. El pool ya tiene
# roles/iam.workloadIdentityUser (incluye iam.serviceAccounts.getOpenIdToken): sin IAM nuevo.
# Se emite en el momento de usarlo (el de la accion caduca a los 10 min y fija una sola audiencia).
$script:DeployServiceAccount='oxkio-gha-deploy@oxkio-runtime-prod.iam.gserviceaccount.com'
function Get-WifCredentialConfig([string]$Path) {
    Assert-True ([string]$env:OXKIO_GCP_DEPLOY_SA -ceq $script:DeployServiceAccount) 'Cuenta de despliegue del workflow inesperada'
    Assert-True ($Path -and (Test-Path -LiteralPath $Path)) 'Falta el fichero de credenciales WIF'
    $c=Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    Assert-True ([string](Get-Prop $c 'type' '') -ceq 'external_account') 'La credencial no es WIF'
    Assert-True ([string](Get-Prop $c 'token_url' '') -ceq 'https://sts.googleapis.com/v1/token') 'Endpoint STS inesperado'
    Assert-True ([string](Get-Prop $c 'subject_token_type' '') -ceq 'urn:ietf:params:oauth:token-type:jwt') 'Tipo de token OIDC inesperado'
    Assert-True ([string](Get-Prop $c 'audience' '') -cmatch '^//iam\.googleapis\.com/projects/[0-9]+/locations/global/workloadIdentityPools/[a-z0-9-]+/providers/[a-z0-9-]+$') 'Audiencia WIF inesperada'
    Assert-True ([string](Get-Prop $c 'service_account_impersonation_url' '') -ceq "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/$($script:DeployServiceAccount):generateAccessToken") 'La credencial no impersona la cuenta de despliegue'
    $source=Get-Prop $c 'credential_source'
    Assert-True ([string](Get-Prop $source 'url' '') -cmatch '^https://\S+$' -and [string](Get-Prop (Get-Prop $source 'format') 'subject_token_field_name' '') -ceq 'value') 'Origen OIDC inesperado'
    return $c
}
function ConvertFrom-JwtPayload([string]$Jwt) {
    $part=$Jwt.Split('.')[1].Replace('-','+').Replace('_','/'); $part+=('='*((4-$part.Length%4)%4))
    return ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($part)) | ConvertFrom-Json)
}
function Invoke-TokenHttp([string]$Method,[string]$Uri,[hashtable]$Headers,[string]$Body) {
    $request=@{Method=$Method;Uri=$Uri;Headers=$Headers;TimeoutSec=30;ErrorAction='Stop'}
    if($Body){ $request.Body=$Body; $request.ContentType='application/json' }
    return (Invoke-RestMethod @request)
}
function New-PrivateIdToken([string]$Audience,$Config,[scriptblock]$Http={ param($m,$u,$h,$b) Invoke-TokenHttp $m $u $h $b }) {
    Assert-True ($Audience -cmatch '^https://[a-z0-9-]+\.a\.run\.app$') 'La audiencia no es una URL de Cloud Run'
    if($null -eq $Config){ $Config=Get-WifCredentialConfig ([string]$env:GOOGLE_APPLICATION_CREDENTIALS) }
    $stage='oidc'; $subject=$null; $federated=$null
    try {
        $headers=@{}; $h=Get-Prop $Config.credential_source 'headers'
        if($h){ foreach($p in $h.PSObject.Properties){ $headers[$p.Name]=[string]$p.Value } }
        $subject=[string](Get-Prop (& $Http 'GET' $Config.credential_source.url $headers '') 'value' '')
        Assert-True ($subject.Length -gt 0) 'Token OIDC de GitHub vacio'
        $stage='sts'
        $exchange=[ordered]@{audience=$Config.audience;grantType='urn:ietf:params:oauth:grant-type:token-exchange'
            requestedTokenType='urn:ietf:params:oauth:token-type:access_token';scope='https://www.googleapis.com/auth/cloud-platform'
            subjectTokenType=$Config.subject_token_type;subjectToken=$subject}
        $federated=[string](Get-Prop (& $Http 'POST' $Config.token_url @{} (ConvertTo-Json -InputObject $exchange -Compress)) 'access_token' '')
        Assert-True ($federated.Length -gt 0) 'STS sin token federado'
        $stage='generateIdToken'
        $uri="https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/$($script:DeployServiceAccount):generateIdToken"
        $token=[string](Get-Prop (& $Http 'POST' $uri @{Authorization="Bearer $federated"} (ConvertTo-Json -InputObject ([ordered]@{audience=$Audience;includeEmail=$true}) -Compress)) 'token' '')
        $stage='claims'
        Assert-True ($token -cmatch '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$') 'ID token con forma invalida'
        $claims=ConvertFrom-JwtPayload $token
        Assert-True ([string](Get-Prop $claims 'aud' '') -ceq $Audience -and [string](Get-Prop $claims 'email' '') -ceq $script:DeployServiceAccount) 'ID token con audiencia o cuenta inesperadas'
        if($env:GITHUB_ACTIONS -ceq 'true'){ Write-Host "::add-mask::$token" }
        return $token
    } catch {
        # Nunca propagar cuerpos ni cabeceras: solo la etapa y el codigo HTTP (o el motivo propio).
        $response=Get-Prop $_.Exception 'Response'
        $code=if($response){ [string][int](Get-Prop $response 'StatusCode' 0) } else { '' }
        $own=[string]$_.Exception.Message
        $reason=if($code){ "HTTP $code" } elseif($own -cmatch '^[A-Za-z ]+$'){ $own } else { 'error' }
        throw "ID token no obtenido ($stage): $reason"
    } finally { $subject=$null; $federated=$null }
}
# Antes de mutar nada: el camino del token funciona y IAM de Cloud Run lo acepta con la
# audiencia documentada (URL generada del servicio, siempre aceptada). Solo un GET /health.
function Test-PrivateIdTokenPath {
    $service=Invoke-Gcloud @('run','services','describe',$script:Service,"--region=$script:Region",'--format=json') | ConvertFrom-Json
    $url=[string]$service.status.url
    $token=$null
    try {
        $token=New-PrivateIdToken $url
        $status=Get-HttpStatus 'GET' "$url/health" @{Authorization="Bearer $token"}
    } finally { $token=$null }
    # Solo 200 prueba token aceptado y servicio sano; 401/403 (IAM), 404/5xx o -1 (red) bloquean.
    $result=[ordered]@{IdTokenIssued=$true;ServiceHealth200=($status -eq 200)}
    $result.Passed=$result.ServiceHealth200
    return $result
}
# Revision privada: el servicio sigue sin acceso anonimo (403 de IAM sin token).
function Invoke-PrivateSmoke {
    $loc="--region=$script:Region"
    $service=Invoke-Gcloud @('run','services','describe',$script:Service,$loc,'--format=json') | ConvertFrom-Json
    $tagEntry=@(@(Get-Prop $service.status 'traffic' @()) | Where-Object { (Get-Prop $_ 'tag' '') -ceq $script:RealTag }) | Select-Object -First 1
    $tagUrl=[string](Get-Prop $tagEntry 'url' '')
    Assert-True ($tagUrl -cmatch '^https://[a-z0-9-]+\.a\.run\.app$') 'URL de la etiqueta privada no encontrada'
    $checks=[ordered]@{AnonymousDeniedByIAM=((Get-HttpStatus 'GET' "$tagUrl/health") -eq 403)
        ForgedTokenDenied=((Get-HttpStatus 'GET' "$tagUrl/health" @{Authorization='Bearer invalid.token.value'}) -in @(401,403))}
    $token=$null
    try {
        # Primero la audiencia documentada (URL generada del servicio); la URL de la etiqueta
        # no esta documentada como audiencia. Un token por audiencia, emitido en el momento.
        $checks.TokenAudience='not_accepted'
        foreach($candidate in @(@{Name='service_url';Url=[string]$service.status.url},@{Name='tag_url';Url=$tagUrl})) {
            $token=New-PrivateIdToken $candidate.Url
            if((Get-HttpStatus 'GET' "$tagUrl/health" @{Authorization="Bearer $token"}) -eq 200){ $checks.TokenAudience=$candidate.Name; break }
        }
        $checks.IamTokenAccepted=($checks.TokenAudience -cne 'not_accepted')
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
    $reasoning=Test-V3ReasoningLog $entries
    foreach($k in $reasoning.Keys){ $checks[$k]=$reasoning[$k] }
    $checks.Passed=-not ($checks.Values -contains $false)
    return $checks
}
function Invoke-PrivateRevision {
    Write-PublicSummary 'ProveIsolation' (Invoke-ProveIsolation)
    Write-PublicSummary 'Check' (Invoke-Check)
    $real=Invoke-CheckReal
    Write-PublicSummary 'CheckReal' $real
    Assert-True ([bool]$real.Passed) 'CheckReal no esta en verde'
    $idToken=Test-PrivateIdTokenPath
    Write-PublicSummary 'IdToken' $idToken
    Assert-True ([bool]$idToken.Passed) 'El ID token IAM no es aceptado: no se crea la revision'
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
        # PASS de infraestructura; solo es conversacional si el razonamiento V3 se pidio y arranco.
        Write-PublicSummary 'Resultado' ([ordered]@{Revision=$script:RealRevision;Tag=$script:RealTag;TrafficPercent=0;ServingRevision=$script:ExpectedRevision;Status='PASS'
            Conversational=($script:V3Reasoning -ceq 'InternalEgress' -and [bool]$smoke['Conversational'])})
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
    # Dates as pwsh 7 reads them back from JSON (Invoke-Check: IsolationProofAtUtc) and as [datetime]/[datetimeoffset].
    $dates=[ordered]@{FromJson=('{"AtUtc":"2026-10-31T11:50:16.9439554Z"}' | ConvertFrom-Json).AtUtc;Now=[datetime]::UtcNow;Offset=[datetimeoffset]::UtcNow}
    $out=ConvertTo-PublicSummary $dates
    foreach($k in $dates.Keys){ Assert-True ([string]$out[$k] -cmatch '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$') "Fecha no publicada como ISO UTC: $k" }
    Invoke-IdTokenSelfTest
    Invoke-ReasoningContractSelfTest
    'SELFTEST OK'
}
# Contrato de conversacion (Issue #85): sin la linea de arranque exacta no hay PASS conversacional.
function Invoke-ReasoningContractSelfTest {
    $saved=$script:V3Reasoning
    $log={ param([string[]]$Lines) @($Lines | ForEach-Object { [pscustomobject]@{textPayload=$_} }) }
    $readyLine=$script:V3ReasoningReadyLog; $offLine=$script:V3ReasoningOffLog
    try {
        $script:V3Reasoning='InternalEgress'
        $r=Test-V3ReasoningLog (& $log @('V3: enabled for cohort',$readyLine))
        Assert-True ($r.V3ReasoningReady -and $r.Conversational) 'Razonamiento listo no reconocido'
        foreach($bad in @(@('V3: enabled for cohort',$offLine),@('V3: enabled for cohort'),@($readyLine,$offLine),
                          @('V3 Reasoning: ready (openai:gpt-5.6-terra, region eu)'),@('V3 Reasoning: ready (openai:gpt-5.6-luna, region global)'))){
            $r=Test-V3ReasoningLog (& $log $bad)
            Assert-True (-not $r.V3ReasoningReady -and -not $r.Conversational) "PASS conversacional sin el proveedor revisado: $($bad -join ' | ')"
        }
        $script:V3Reasoning='Off'
        $r=Test-V3ReasoningLog (& $log @('V3: enabled for cohort',$offLine))
        Assert-True ($r.V3ReasoningOffAsDeclared -and -not $r.Contains('Conversational')) 'Off debe declararse sin conversacion'
        $r=Test-V3ReasoningLog (& $log @('V3: enabled for cohort',$readyLine))
        Assert-True (-not $r.V3ReasoningOffAsDeclared) 'Razonamiento activo en una revision Off'
    } finally { $script:V3Reasoning=$saved }
}
function New-TestJwt($Claims) {
    $enc={ param($s) [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($s)).TrimEnd('=').Replace('+','-').Replace('/','_') }
    (& $enc '{"alg":"RS256"}')+'.'+(& $enc (ConvertTo-Json -InputObject $Claims -Compress))+'.c2lnbmF0dXJl'
}
function Assert-Refused([scriptblock]$Body,[string]$Label,[string[]]$MustNotLeak=@()) {
    $message=$null; try { & $Body | Out-Null } catch { $message=[string]$_.Exception.Message }
    Assert-True ($null -ne $message) "No rechazado: $Label"
    foreach($s in $MustNotLeak){ Assert-True (-not $message.Contains($s)) "El error filtra un token: $Label" }
}
# Regresion run 41219259414: el ID token sale de STS + generateIdToken (nunca de print-identity-token),
# con la audiencia pedida y la cuenta de despliegue; la prueba privada exige 403 sin token.
function Invoke-IdTokenSelfTest {
    $sa=$script:DeployServiceAccount
    $script:StSvc='https://oxkio-api-staging-synthetic0-ey.a.run.app'
    $script:StTag="https://$($script:RealTag)---oxkio-api-staging-synthetic0-ey.a.run.app"
    $secrets=@('gh-request-secret','gh-oidc-secret','federated-secret')
    $cfgJson='{"type":"external_account","audience":"//iam.googleapis.com/projects/1/locations/global/workloadIdentityPools/oxkio-github/providers/github",'+
        '"subject_token_type":"urn:ietf:params:oauth:token-type:jwt","token_url":"https://sts.googleapis.com/v1/token",'+
        '"service_account_impersonation_url":"https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/'+$sa+':generateAccessToken",'+
        '"credential_source":{"url":"https://oidc.example.invalid/token?audience=x","headers":{"Authorization":"Bearer gh-request-secret"},"format":{"type":"json","subject_token_field_name":"value"}}}'
    $cfg=$cfgJson | ConvertFrom-Json
    $script:StCalls=[System.Collections.Generic.List[object]]::new(); $script:StAud=$null; $script:StEmail=$sa
    $http={ param($m,$u,$h,$b) $script:StCalls.Add([pscustomobject]@{M=$m;U=$u;H=$h;B=$b})
        if($u -like 'https://oidc.example.invalid/*'){ return [pscustomobject]@{value='gh-oidc-secret'} }
        if($u -ceq 'https://sts.googleapis.com/v1/token'){ return [pscustomobject]@{access_token='federated-secret'} }
        $aud=if($script:StAud){ $script:StAud } else { ($b | ConvertFrom-Json).audience }
        return [pscustomobject]@{token=(New-TestJwt ([ordered]@{aud=$aud;email=$script:StEmail}))} }
    $token=New-PrivateIdToken $script:StSvc $cfg $http
    Assert-True ([string](ConvertFrom-JwtPayload $token).aud -ceq $script:StSvc) 'ID token: audiencia'
    $c=$script:StCalls
    Assert-True ($c.Count -eq 3 -and $c[0].M -ceq 'GET' -and $c[0].H.Authorization -ceq 'Bearer gh-request-secret') 'ID token: OIDC de GitHub'
    $sts=$c[1].B | ConvertFrom-Json
    Assert-True ($c[1].U -ceq 'https://sts.googleapis.com/v1/token' -and $sts.subjectToken -ceq 'gh-oidc-secret' -and $sts.audience -ceq $cfg.audience -and
        $sts.grantType -ceq 'urn:ietf:params:oauth:grant-type:token-exchange' -and $sts.requestedTokenType -ceq 'urn:ietf:params:oauth:token-type:access_token') 'ID token: intercambio STS'
    $gen=$c[2].B | ConvertFrom-Json
    Assert-True ($c[2].U -ceq "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${sa}:generateIdToken" -and
        $c[2].H.Authorization -ceq 'Bearer federated-secret' -and $gen.audience -ceq $script:StSvc -and $gen.includeEmail -eq $true) 'ID token: generateIdToken'
    $script:StAud=$script:StTag; Assert-Refused { New-PrivateIdToken $script:StSvc $cfg $http } 'token con otra audiencia' $secrets; $script:StAud=$null
    $script:StEmail='other@oxkio-runtime-prod.iam.gserviceaccount.com'; Assert-Refused { New-PrivateIdToken $script:StSvc $cfg $http } 'token de otra cuenta' $secrets; $script:StEmail=$sa
    Assert-Refused { New-PrivateIdToken 'https://example.com' $cfg $http } 'audiencia ajena a Cloud Run'
    Assert-Refused { New-PrivateIdToken $script:StSvc $cfg { param($m,$u,$h,$b) throw "boom federated-secret gh-oidc-secret $u" } } 'error HTTP' $secrets
    $savedSa=$env:OXKIO_GCP_DEPLOY_SA; $file=Join-Path $script:Evidence 'wif-selftest.json'
    New-Item -ItemType Directory -Force -Path $script:Evidence | Out-Null
    try {
        $env:OXKIO_GCP_DEPLOY_SA=$sa; Write-PrivateFile $file $cfgJson
        Assert-True ((Get-WifCredentialConfig $file).type -ceq 'external_account') 'credencial WIF valida rechazada'
        Write-PrivateFile $file ($cfgJson.Replace($sa,'other@oxkio-runtime-prod.iam.gserviceaccount.com')); Assert-Refused { Get-WifCredentialConfig $file } 'impersona otra cuenta'
        Write-PrivateFile $file ($cfgJson.Replace('"external_account"','"service_account"')); Assert-Refused { Get-WifCredentialConfig $file } 'clave de cuenta de servicio'
        Write-PrivateFile $file $cfgJson; $env:OXKIO_GCP_DEPLOY_SA='other@oxkio-runtime-prod.iam.gserviceaccount.com'; Assert-Refused { Get-WifCredentialConfig $file } 'cuenta del workflow distinta'
    } finally { $env:OXKIO_GCP_DEPLOY_SA=$savedSa }
    foreach($f in @('Invoke-PrivateSmoke','Test-PrivateIdTokenPath','New-PrivateIdToken')){
        Assert-True (-not (Get-Command $f -CommandType Function).ScriptBlock.ToString().Contains('identity-token')) "gcloud identity-token sigue en $f"
    }
    # Prueba privada y comprobacion previa con dobles locales (sin red ni gcloud).
    function Invoke-Gcloud([string[]]$Arguments,[int]$TimeoutSeconds=0) {
        if($Arguments[0] -ceq 'auth'){ throw 'gcloud auth no debe usarse para el ID token' }
        if($Arguments[0] -ceq 'run' -and $Arguments[1] -ceq 'services'){
            return ('{"status":{"url":"'+$script:StSvc+'","traffic":[{"revisionName":"oxkio-api-staging-00018-9xl","percent":100},{"revisionName":"'+$script:RealRevision+'","tag":"'+$script:RealTag+'","url":"'+$script:StTag+'"}]}}') }
        # Un solo objeto: PS 5.1 no despliega arrays JSON en la tuberia (el runner usa pwsh 7).
        if($Arguments[0] -ceq 'logging'){ return (ConvertTo-Json -Compress @{textPayload=($script:StReasoningLine+"`n"+'V3: enabled for cohort')}) }
        throw 'gcloud inesperado'
    }
    function New-PrivateIdToken([string]$Audience){ "tok:$Audience" }
    function Get-HttpStatus([string]$Method,[string]$Url,[hashtable]$Headers=@{}) {
        $auth=[string]$Headers['Authorization']
        if($null -ne $script:StPreflight -and $Url -ceq "$($script:StSvc)/health"){ return $script:StPreflight }
        if(-not $auth){ return $script:StAnon }
        if($auth -notlike 'Bearer tok:*' -or $auth.Substring(11) -notin $script:StAccepted){ return 401 }
        if($Url -like '*/health' -or $Url -like '*/ready'){ return 200 }
        return 401
    }
    $script:StAnon=403; $script:StPreflight=$null; $script:StReasoningLine=$script:V3ReasoningOffLog
    $savedReasoning=$script:V3Reasoning; $script:V3Reasoning='Off'
    $script:StAccepted=@($script:StSvc); $r=Invoke-PrivateSmoke
    Assert-True ($r.Passed -and $r.TokenAudience -ceq 'service_url' -and $r.AnonymousDeniedByIAM -and $r.ForgedTokenDenied -and $r.Health200 -and $r.Ready200 -and $r.ApiWithoutFirebase401 -and $r.ChatWithoutFirebase401) 'Prueba privada: audiencia del servicio'
    Assert-True ($r.V3ReasoningOffAsDeclared -and -not $r.Contains('Conversational')) 'Prueba privada: Off nunca es conversacional'
    # Issue #85: con razonamiento pedido, PASS solo si arranco el proveedor revisado.
    $script:V3Reasoning='InternalEgress'
    $r=Invoke-PrivateSmoke
    Assert-True (-not $r.Passed -and -not $r.Conversational) 'Prueba privada: razonamiento pedido pero no configurado debe fallar'
    $script:StReasoningLine=$script:V3ReasoningReadyLog; $r=Invoke-PrivateSmoke
    Assert-True ($r.Passed -and $r.V3ReasoningReady -and $r.Conversational) 'Prueba privada: razonamiento listo'
    $script:V3Reasoning='Off'; $r=Invoke-PrivateSmoke
    Assert-True (-not $r.Passed) 'Prueba privada: razonamiento activo en revision Off debe fallar'
    $script:V3Reasoning='Off'; $script:StReasoningLine=$script:V3ReasoningOffLog
    $script:StAccepted=@($script:StTag); $r=Invoke-PrivateSmoke
    Assert-True ($r.Passed -and $r.TokenAudience -ceq 'tag_url') 'Prueba privada: audiencia de la etiqueta'
    $script:StAccepted=@(); $r=Invoke-PrivateSmoke
    Assert-True (-not $r.Passed -and -not $r.IamTokenAccepted -and $r.TokenAudience -ceq 'not_accepted') 'Prueba privada: token rechazado debe fallar'
    $script:StAccepted=@($script:StSvc); $script:StAnon=200; $r=Invoke-PrivateSmoke
    Assert-True (-not $r.Passed -and -not $r.AnonymousDeniedByIAM) 'Prueba privada: acceso anonimo debe fallar'
    $script:StAnon=403; $p=Test-PrivateIdTokenPath
    Assert-True ($p.Passed -and $p.ServiceHealth200) 'Comprobacion previa del token'
    $script:StAccepted=@(); $p=Test-PrivateIdTokenPath
    Assert-True (-not $p.Passed) 'Comprobacion previa: IAM rechaza el token'
    # /health exige 200 exacto: 401/403 (IAM), 404, 500 y -1 (error de red en Get-HttpStatus) bloquean.
    $script:StAccepted=@($script:StSvc)
    foreach($code in @(200,401,403,404,500,-1)){
        $script:StPreflight=$code; $p=Test-PrivateIdTokenPath
        Assert-True ([bool]$p.Passed -eq ($code -eq 200)) "Comprobacion previa con HTTP $code"
    }
    $script:StPreflight=$null
    $json=ConvertTo-Json -InputObject (ConvertTo-PublicSummary $r) -Depth 4
    Assert-True ($json.Contains('service_url') -and -not $json.Contains('tok:')) 'Resumen publico de la prueba privada'
    $script:V3Reasoning=$savedReasoning
}

switch($Operation) {
    'SelfTest' { Invoke-SelfTest }
    'CheckReal' { Assert-OwnerUid; $r=Invoke-CheckReal; Write-PublicSummary 'CheckReal' $r; if(-not $r.Passed){ exit 2 } }
    'PrivateRevision' { Invoke-PrivateRevision }
    'RemoveTag' { Invoke-RemoveTag }
}
