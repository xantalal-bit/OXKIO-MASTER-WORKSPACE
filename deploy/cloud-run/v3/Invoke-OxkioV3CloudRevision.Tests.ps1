[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$target=Join-Path $PSScriptRoot 'Invoke-OxkioV3CloudRevision.ps1'
$tokens=$null; $parseErrors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile($target,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw ($parseErrors | Out-String)}
# Commit, owner y host fijos y sinteticos; evidencia en TEMP, nunca en el repositorio.
. $target -Commit '9e598e1c590f11d0bf1a6acbdc4aa85e28dc56c5' -OwnerUid 'SyntheticOwnerUid0000000000' -PgHost 'ep-synthetic-000000.eu-central-1.aws.neon.tech' -EvidenceRoot (Join-Path $env:TEMP ('oxkio-cloud-tests-'+[guid]::NewGuid().ToString('N')))
$script:Results=[System.Collections.Generic.List[object]]::new()
function Check([string]$Name,[scriptblock]$Body,[bool]$MustThrow=$false) {
    $threw=$false
    try { & $Body | Out-Null } catch { $threw=$true }
    $ok=($threw -eq $MustThrow)
    $script:Results.Add([pscustomobject]@{Name=$Name;Passed=$ok})
    if(-not $ok){throw "Fallo prueba: $Name"}
}
function New-Fixture {
    [pscustomobject]@{
        Traffic=@([pscustomobject]@{revisionName=$script:ExpectedRevision;percent=100;latestRevision=$false})
        IAM=@{etag='synthetic-etag';bindings=@('synthetic-existing-binding')}
        OAuth=@{clientId='synthetic-client';redirect='http://127.0.0.1/callback'}
        SecretVersions=@(@{name='synthetic/version/1';state='ENABLED'})
        OriginalRevision=@{name=$script:ExpectedRevision;digest=('sha256:'+('a'*64));env=@{fixture='synthetic'};resources=@{cpu=1}}
        ServiceExport=@{metadata=@{name='synthetic-service'};spec=@{template=@{fixture='full-synthetic-template'}}}
    }
}
function New-Quote {
    [pscustomobject]@{Currency='EUR';Verified=$true;Source='LOCAL FIXTURE NOT A PRICE';FXSource='LOCAL FIXTURE NOT FX';ValidUntilUTC=[datetime]::UtcNow.AddHours(1);BuildSeconds=60;TestSeconds=60;StorageByteDays=1024;MaxOperationSeconds=600;NextReservationEUR=[decimal]0.2}
}
function New-State {
    [pscustomobject]@{NextStep=0;Stopped=$false;Baseline=$null;Rollback=$null;Ledger=[pscustomobject]@{SpentEUR=[decimal]0;ReservedEUR=[decimal]0};Quote=(New-Quote);ElapsedSeconds=0}
}
function New-Revision {
    [pscustomobject]@{Commit=$script:ExpectedCommit;Name='synthetic-revision';Digest=('sha256:'+('b'*64));Percent=0;MinInstances=0;MaxInstances=1;Concurrency=1;CPU=1;MemoryMi=512;TimeoutSeconds=60;SecretMounts=@();Env=@{OXKIO_APPROVAL_REPOSITORY_BACKEND='json';OXKIO_V3_MEMORY_ROOT='/tmp/oxkio-v3';GOOGLE_CLIENT_SECRET='disabled-synthetic-test'};IsolationProvenAtCommit=$script:ExpectedCommit}
}
function New-Test {
    [pscustomobject]@{Authenticated=$true;ExistingIAM=$true;SyntheticOnly=$true;HttpStatus=200;AssertionsPassed=$true;RequestCount=3;DurationSeconds=10;TimedOut=$false}
}
$mock={param($Operation,$Payload)
    $value=$true
    switch($Operation) {
        'ReadState' {$value=New-Fixture}
        'PersistPrivateSnapshot' {$value=$true}
        'PersistLedger' {$value=$true}
        default {$value=[pscustomobject]@{Revision=(New-Revision);Test=(New-Test)}}
    }
    [pscustomobject]@{ExitCode=0;TimedOut=$false;Value=$value}
}
Check 'AST syntax' {if($parseErrors.Count){throw 'syntax'}}
Check 'No IAM, secret or deletion verbs in script' {
    $text=Get-Content -LiteralPath $target -Raw
    foreach($verb in @('add-iam-policy-binding','remove-iam-policy-binding','set-iam-policy','allow-unauthenticated','to-latest','secrets[''",\s]+(create|delete|update)','versions[''",\s]+(add|destroy|disable|enable)','services[''",\s]+delete','revisions[''",\s]+delete','images[''",\s]+delete','docker[''",\s]+push')) {
        if($text -match $verb){throw "verbo prohibido: $verb"}
    }
}
Check 'Script loads without running any mode' {Assert-True ($null -ne (Get-Command Invoke-CloudStep -ErrorAction SilentlyContinue)) 'no cargado'}
Check 'Cloud refuses without isolation proof' {$saved=$script:IsolationProofPath;$script:IsolationProofPath=Join-Path $env:TEMP ([guid]::NewGuid().ToString('N'));try{Assert-IsolationProof}finally{$script:IsolationProofPath=$saved}} $true
Check 'Cloud refuses without recent check' {$saved=$script:CheckPath;$script:CheckPath=Join-Path $env:TEMP ([guid]::NewGuid().ToString('N'));try{Assert-RecentCheck}finally{$script:CheckPath=$saved}} $true
Check 'Native nonzero exit' {Assert-NativeResult ([pscustomobject]@{ExitCode=7;TimedOut=$false;Value=$null})} $true
Check 'Native timeout' {Assert-NativeResult ([pscustomobject]@{ExitCode=0;TimedOut=$true;Value=$null})} $true
Check 'Traffic 100 accepted' {Assert-Traffic (New-Fixture).Traffic}
Check 'Traffic 99 rejected' {$x=New-Fixture;$x.Traffic[0].percent=99;Assert-Traffic $x.Traffic} $true
Check 'Wrong revision rejected' {$x=New-Fixture;$x.Traffic[0].revisionName='wrong';Assert-Traffic $x.Traffic} $true
Check 'Latest revision rejected' {$x=New-Fixture;$x.Traffic[0].latestRevision=$true;Assert-Traffic $x.Traffic} $true
Check 'Split traffic rejected' {$x=New-Fixture;$x.Traffic+=([pscustomobject]@{revisionName='other';percent=1;latestRevision=$false});Assert-Traffic $x.Traffic} $true
foreach($field in @('IAM','OAuth','SecretVersions','OriginalRevision')) {
    Check "Altered $field rejected" {$a=New-Fixture;$b=New-Fixture;$b.$field=@{altered='synthetic'};Assert-Invariants $a $b} $true
}
Check 'Same count different version rejected' {$a=New-Fixture;$b=New-Fixture;$b.SecretVersions[0].name='synthetic/version/2';Assert-Invariants $a $b} $true
Check 'Secret state alteration rejected' {$a=New-Fixture;$b=New-Fixture;$b.SecretVersions[0].state='DISABLED';Assert-Invariants $a $b} $true
Check 'Missing snapshot rejected' {$a=New-Fixture;$a.ServiceExport=$null;New-RollbackPlan $a} $true
Check 'Rollback plan carries snapshot and invariants' {$a=New-Fixture;$p=New-RollbackPlan $a;Assert-True ((Get-Canonical $p.ServiceExport) -ceq (Get-Canonical $a.ServiceExport)) 'export';Assert-True (-not $p.AllowIAMWrite -and -not $p.AllowSecretWrite) 'writes'}
Check 'Cumulative budget above 2 EUR rejected' {$s=New-State;$s.Ledger.SpentEUR=1;$s.Ledger.ReservedEUR=1;Assert-Budget $s.Ledger $s.Quote 0} $true
Check 'Unknown pricing rejected' {$s=New-State;$s.Quote.Verified=$false;Assert-Budget $s.Ledger $s.Quote 0} $true
Check 'Expired pricing rejected' {$s=New-State;$s.Quote.ValidUntilUTC=[datetime]::UtcNow.AddHours(-1);Assert-Budget $s.Ledger $s.Quote 0} $true
Check 'Operation deadline rejected' {$s=New-State;Assert-Budget $s.Ledger $s.Quote 600} $true
Check 'Wrong commit rejected' {$r=New-Revision;$r.Commit='other';Assert-IsolatedRevision $r} $true
Check 'Mounted secret rejected' {$r=New-Revision;$r.SecretMounts=@('synthetic');Assert-IsolatedRevision $r} $true
Check 'Reasoning provider rejected' {$r=New-Revision;$r.Env['OXKIO_REASONING_PROVIDER']='synthetic';Assert-IsolatedRevision $r} $true
Check 'Missing isolation proof rejected' {$r=New-Revision;$r.IsolationProvenAtCommit='';Assert-IsolatedRevision $r} $true
Check 'HTTP test failure rejected' {$t=New-Test;$t.HttpStatus=500;Assert-TestResult $t} $true
Check 'Unauthenticated test rejected' {$t=New-Test;$t.Authenticated=$false;Assert-TestResult $t} $true
Check 'Test timeout rejected' {$t=New-Test;$t.TimedOut=$true;Assert-TestResult $t} $true
Check 'Mock steps 0 to 6 ordered with reservations' {$s=New-State;0..6 | ForEach-Object {Invoke-PreparedStep $s $_ $mock};Assert-True ($s.NextStep -eq 7 -and $s.Ledger.ReservedEUR -eq [decimal]1.2) 'sequence/ledger'}
Check 'Out of order rejected' {Invoke-PreparedStep (New-State) 1 $mock} $true
Check 'Snapshot failure stops sequence' {$s=New-State;$bad={param($op,$p) if($op -eq 'ReadState'){& $mock $op $p}else{[pscustomobject]@{ExitCode=1;TimedOut=$false;Value=$false}}};try{Invoke-PreparedStep $s 0 $bad}catch{};Assert-True ($s.Stopped -and $s.NextStep -eq 0) 'not stopped'}
Check 'Post-state drift aborts and preserves reservation' {
    $s=New-State;Invoke-PreparedStep $s 0 $mock
    $script:reads=0
    $drift={param($op,$p) if($op -eq 'ReadState'){$script:reads++;$v=New-Fixture;if($script:reads -eq 2){$v.Traffic[0].percent=99};[pscustomobject]@{ExitCode=0;TimedOut=$false;Value=$v}}else{& $mock $op $p}}
    try{Invoke-PreparedStep $s 1 $drift}catch{}
    Assert-True ($s.Stopped -and $s.NextStep -eq 1 -and $s.Ledger.ReservedEUR -eq [decimal]0.2) 'post drift or reservation lost'
}
Check 'Private snapshot encrypted roundtrip and overwrite refused' {
    $path=Join-Path $PSScriptRoot ('local-test-'+[guid]::NewGuid().ToString('N')+'.dpapi')
    try {
        $fixture=New-Fixture
        $hash=Protect-LocalSnapshot $fixture $path
        Assert-True ($hash -match '^[A-F0-9]{64}$') 'hash'
        $loaded=Read-LocalSnapshot $path
        Assert-True ($loaded.OriginalRevision.name -ceq $fixture.OriginalRevision.name) 'roundtrip'
        Assert-True ($loaded.ServiceExport.spec.template.fixture -ceq 'full-synthetic-template') 'template'
        $refused=$false
        try{Protect-LocalSnapshot $fixture $path | Out-Null}catch{$refused=$true}
        Assert-True $refused 'overwrite permitted'
    } finally {if(Test-Path -LiteralPath $path){Remove-Item -LiteralPath $path}}
}
# Misma forma que `gcloud run services describe --format=json` (valores sinteticos).
function New-ServiceJson {
    ('{"apiVersion":"serving.knative.dev/v1","kind":"Service",'+
     '"metadata":{"name":"oxkio-api-staging","namespace":"000000000000","uid":"out","resourceVersion":"rv-1","generation":18,"creationTimestamp":"2026-09-01T00:00:00Z",'+
       '"annotations":{"run.googleapis.com/ingress":"all","serving.knative.dev/creator":"out","run.googleapis.com/operation-id":"out"}},'+
     '"spec":{"template":{"metadata":{"name":"oxkio-api-staging-00018-9xl","annotations":{"autoscaling.knative.dev/maxScale":"1"}},'+
       '"spec":{"containerConcurrency":1,"timeoutSeconds":300,"serviceAccountName":"synthetic@example.invalid","containers":[{"image":"synthetic/image:tag",'+
       '"env":[{"name":"SYNTHETIC","value":"fixture"},{"name":"SECRET_REF","valueFrom":{"secretKeyRef":{"name":"synthetic-reference","key":"1"}}}],'+
       '"resources":{"limits":{"cpu":"1","memory":"512Mi"}}}]}},'+
       '"traffic":[{"latestRevision":true,"percent":100}]},'+
     '"status":{"traffic":[{"revisionName":"oxkio-api-staging-00018-9xl","percent":100,"latestRevision":true}]}}') | ConvertFrom-Json
}
Check 'Restore document keeps template spec, drops output fields, pins traffic' {
    $svc=New-ServiceJson;$base=[pscustomobject]@{Traffic=(ConvertTo-TrafficModel $svc);ServiceExport=$svc}
    $d=New-RestoreServiceDocument $base
    Assert-True ((Get-Canonical $d.spec.template.spec) -ceq (Get-Canonical $svc.spec.template.spec)) 'spec drift'
    Assert-True ($null -eq $d.PSObject.Properties['status'] -and $null -eq $d.metadata.PSObject.Properties['uid'] -and $null -eq $d.metadata.PSObject.Properties['resourceVersion']) 'output fields'
    Assert-True ($null -eq $d.metadata.annotations.PSObject.Properties['serving.knative.dev/creator'] -and $d.metadata.annotations.'run.googleapis.com/ingress' -ceq 'all') 'annotations'
    Assert-True ($null -eq $d.spec.template.metadata.PSObject.Properties['name']) 'revision name'
    Assert-True ((Get-Canonical $d.spec.traffic) -ceq '[{"revisionName":"oxkio-api-staging-00018-9xl","percent":100}]') 'traffic'
}
Check 'Restore document rejects a non Cloud Run object' {$s=New-ServiceJson;$s.kind='Job';New-RestoreServiceDocument ([pscustomobject]@{Traffic=(ConvertTo-TrafficModel $s);ServiceExport=$s})} $true
Check 'Synthetic document: digest, no secret refs, pinned traffic, tag at 0, resourceVersion kept' {
    $d=New-SyntheticServiceDocument (New-ServiceJson) ('repo/image@sha256:'+('c'*64)) ('k'*64);$j=Get-Canonical $d
    Assert-True ($j -notmatch 'secretKeyRef|valueFrom|volumes') 'secret reference'
    Assert-True ($j -notmatch 'OXKIO_REASONING_|OXKIO_GOOGLE_OAUTH_TOKEN|_PG_') 'real access variable'
    Assert-True ((Get-Canonical $d.spec.traffic) -ceq '[{"revisionName":"oxkio-api-staging-00018-9xl","percent":100},{"revisionName":"oxkio-api-staging-v3s-9e598e1","percent":0,"tag":"v3-synth-9e598e1"}]') 'traffic'
    Assert-True ($d.spec.template.metadata.labels.'oxkio-commit' -ceq $script:ExpectedCommit -and $d.spec.template.spec.timeoutSeconds -eq 60) 'label/timeout'
    Assert-True ($d.metadata.resourceVersion -ceq 'rv-1' -and $null -eq $d.PSObject.Properties['status']) 'concurrency guard'
}
Check 'Synthetic document refuses a tag instead of a digest' {New-SyntheticServiceDocument (New-ServiceJson) 'repo/image:9e598e1' ('k'*64)} $true
Check 'Untag document keeps template and pins 100 % to 00018' {
    $s=New-ServiceJson;$d=New-UntaggedServiceDocument $s
    Assert-True ((Get-Canonical $d.spec.template) -ceq (Get-Canonical $s.spec.template)) 'template changed'
    Assert-True ((Get-Canonical $d.spec.traffic) -ceq '[{"revisionName":"oxkio-api-staging-00018-9xl","percent":100}]') 'traffic'
}
Check 'Synthetic env refuses a short integrity key' {New-SyntheticEnv 'short'} $true
Check 'Integrity key is 64 hex chars and random' {$a=New-IntegrityKey;$b=New-IntegrityKey;Assert-True ($a -cmatch '^[0-9a-f]{64}$' -and $a -cne $b) 'key'}
# Revision tal como la devuelve `gcloud run revisions describe --format=json`, construida desde el entorno sintetico real.
function New-RevisionJson([hashtable]$Extra=@{}) {
    $envList=@((New-SyntheticEnv ('k'*64)).GetEnumerator() | ForEach-Object { @{name=$_.Key;value=$_.Value} })
    foreach($k in $Extra.Keys){ $envList+=@{name=$k;value=$Extra[$k]} }
    (@{metadata=@{name='oxkio-api-staging-v3s-9e598e1';labels=@{'oxkio-commit'=$script:ExpectedCommit};annotations=@{'autoscaling.knative.dev/maxScale'='1';'autoscaling.knative.dev/minScale'='0'}}
       spec=@{containerConcurrency=1;timeoutSeconds=60;containers=@(@{env=$envList;resources=@{limits=@{cpu='1';memory='512Mi'}}})}
       status=@{imageDigest=('repo/image@sha256:'+('d'*64))}} | ConvertTo-Json -Depth 10) | ConvertFrom-Json
}
$zeroTraffic=@([pscustomobject]@{revisionName='oxkio-api-staging-00018-9xl';percent=100;latestRevision=$false;tag=''},[pscustomobject]@{revisionName='oxkio-api-staging-v3s-9e598e1';percent=0;latestRevision=$false;tag='v3-synth-9e598e1'})
Check 'Real-shaped synthetic revision passes isolation guard' {Assert-IsolatedRevision (ConvertTo-RevisionModel (New-RevisionJson) $zeroTraffic $script:ExpectedCommit)}
Check 'Real-shaped revision with reasoning key rejected' {Assert-IsolatedRevision (ConvertTo-RevisionModel (New-RevisionJson @{OXKIO_REASONING_API_KEY='x'}) $zeroTraffic $script:ExpectedCommit)} $true
Check 'Real-shaped revision with V3 reasoning rejected' {Assert-IsolatedRevision (ConvertTo-RevisionModel (New-RevisionJson @{OXKIO_V3_REASONING_PROVIDER='x'}) $zeroTraffic $script:ExpectedCommit)} $true
Check 'Real-shaped revision with traffic rejected' {$t=@($zeroTraffic|ForEach-Object{$_.psobject.Copy()});$t[1].percent=1;Assert-IsolatedRevision (ConvertTo-RevisionModel (New-RevisionJson) $t $script:ExpectedCommit)} $true
Check 'Real-shaped revision with secret reference rejected' {$r=New-RevisionJson;$r.spec.containers[0].env+=([pscustomobject]@{name='X';valueFrom=[pscustomobject]@{secretKeyRef=[pscustomobject]@{name='s';key='1'}}});Assert-IsolatedRevision (ConvertTo-RevisionModel $r $zeroTraffic $script:ExpectedCommit)} $true
Check 'Latest revision accepted only when explicitly allowed' {Assert-Traffic @([pscustomobject]@{revisionName='oxkio-api-staging-00018-9xl';percent=100;latestRevision=$true}) -AllowLatest}
Check 'Latest on another revision rejected even when allowed' {Assert-Traffic @([pscustomobject]@{revisionName='oxkio-api-staging-00018-9xl';percent=100;latestRevision=$false},[pscustomobject]@{revisionName='other';percent=0;latestRevision=$true}) -AllowLatest} $true
Check 'Status traffic with missing fields is normalized' {$m=ConvertTo-TrafficModel ('{"status":{"traffic":[{"revisionName":"oxkio-api-staging-00018-9xl","percent":100,"latestRevision":true},{"revisionName":"x","tag":"t"}]}}'|ConvertFrom-Json);Assert-True ($m.Count -eq 2 -and $m[1].percent -eq 0 -and -not $m[1].latestRevision) 'normalize';Assert-Traffic $m -AllowLatest}
function New-LogEntry([int]$Status,[string]$Url='https://x.run.app/api/executive/chat',[string]$Method='POST',[string]$Latency='1.2s') {
    [pscustomobject]@{timestamp=[datetime]::UtcNow.ToString('o');httpRequest=[pscustomobject]@{requestMethod=$Method;requestUrl=$Url;status=$Status;latency=$Latency}}
}
$attestOk=[pscustomobject]@{OnlyAllowedQuestions=$true;SummaryFirst=$true;RegisteredRevision=$true;TwoLayers=$true}
$t0=[datetime]::UtcNow.AddMinutes(-1)
Check 'Two authenticated chat POSTs pass the test guard' {Assert-TestResult (ConvertTo-TestModel @((New-LogEntry 200),(New-LogEntry 200),(New-LogEntry 200 'https://x/app.js' 'GET')) $t0 ([datetime]::UtcNow) $attestOk)}
Check 'Chat 401 (Firebase token not passed) fails' {Assert-TestResult (ConvertTo-TestModel @((New-LogEntry 401),(New-LogEntry 200)) $t0 ([datetime]::UtcNow) $attestOk)} $true
Check 'No chat request fails' {Assert-TestResult (ConvertTo-TestModel @((New-LogEntry 200 'https://x/health' 'GET')) $t0 ([datetime]::UtcNow) $attestOk)} $true
Check 'Four chat requests fail' {Assert-TestResult (ConvertTo-TestModel @((1..4)|ForEach-Object{New-LogEntry 200}) $t0 ([datetime]::UtcNow) $attestOk)} $true
Check 'Negative owner attestation fails' {$a=$attestOk.psobject.Copy();$a.TwoLayers=$false;Assert-TestResult (ConvertTo-TestModel @((New-LogEntry 200)) $t0 ([datetime]::UtcNow) $a)} $true
Check 'Test window over 30 minutes fails' {Assert-TestResult (ConvertTo-TestModel @((New-LogEntry 200)) $t0 $t0.AddMinutes(31) $attestOk)} $true
Check 'Chat latency over 60 s fails' {Assert-TestResult (ConvertTo-TestModel @((New-LogEntry 200 -Latency '61.5s')) $t0 ([datetime]::UtcNow) $attestOk)} $true
Check 'Conservative quote stays under 2 EUR with every reservation positive' {
    $q=New-ConservativeQuote ([datetime]::UtcNow);$total=[decimal]0
    foreach($k in 1..6){Assert-True ($q.Reservations[$k] -gt 0) "step $k";$total+=$q.Reservations[$k]}
    Assert-True ($total -le [decimal]2 -and $total -ge [decimal]0.2) "total $total"
    $s=New-State;$s.Quote=$q;$s.Quote.NextReservationEUR=$q.Reservations[1];Assert-Budget $s.Ledger $s.Quote 0
}
Check 'Real quote expires 6 h after start' {$q=New-ConservativeQuote ([datetime]::UtcNow.AddHours(-7));$q.NextReservationEUR=[decimal]0.01;Assert-Budget ([pscustomobject]@{SpentEUR=[decimal]0;ReservedEUR=[decimal]0}) $q 0} $true
Check 'Journal never stores baseline nor quote' {
    $saved=$script:JournalPath;$script:JournalPath=Join-Path $env:TEMP ('journal-'+[guid]::NewGuid().ToString('N')+'.json')
    try{$s=New-CloudState;$s.Baseline=New-Fixture;$s.Quote=New-ConservativeQuote ([datetime]::UtcNow);Save-Journal $s;$j=Get-Content -LiteralPath $script:JournalPath -Raw
        Assert-True ($j -notmatch 'ServiceExport|OriginalRevision|Reservations') 'leak';$r=Read-Journal;Assert-True ($r.NextStep -eq 0 -and $r.Ledger.ReservedEUR -eq 0) 'roundtrip'}
    finally{Remove-Item -LiteralPath $script:JournalPath -ErrorAction SilentlyContinue;$script:JournalPath=$saved}
}
Check 'UTC parsing accepts strings and DateTime' {$d=ConvertTo-UtcDate '2026-10-22T18:00:00Z';Assert-True ($d.Hour -eq 18 -and (ConvertTo-UtcDate $d).Hour -eq 18) 'utc'}
function New-RealServiceJson {
    $svc=New-ServiceJson; $c=@($svc.spec.template.spec.containers)[0]
    $c.env=@($c.env)+@([pscustomobject]@{name='OXKIO_APPROVAL_REPOSITORY_BACKEND';value='postgres'},
        [pscustomobject]@{name='OXKIO_APPROVAL_PG_RUNTIME_URL';valueFrom=[pscustomobject]@{secretKeyRef=[pscustomobject]@{name='OXKIO_APPROVAL_PG_RUNTIME_URL';key='1'}}},
        [pscustomobject]@{name='OXKIO_V3_ENABLED';value='false'})
    return $svc
}
$realDigest='repo/image@sha256:'+('b'*64)
Check 'Real V3 document keeps existing env/secret refs, adds V3 by reference only, pins 0 % tagged traffic' {
    $d=New-RealV3ServiceDocument (New-RealServiceJson) $realDigest
    $c=@($d.spec.template.spec.containers)[0]; $env=@{}; foreach($e in $c.env){ $env[$e.name]=$e }
    Assert-True ($env['SYNTHETIC'].value -ceq 'fixture' -and $env['SECRET_REF'].valueFrom.secretKeyRef.name -ceq 'synthetic-reference') 'existing env kept'
    Assert-True (@($c.env | Where-Object { $_.name -ceq 'OXKIO_V3_ENABLED' }).Count -eq 1 -and $env['OXKIO_V3_ENABLED'].value -ceq 'true') 'single overridden V3 flag'
    foreach($n in 'OXKIO_V3_INTEGRITY_KEY','OXKIO_V3_PG_PASSWORD'){ Assert-True ($null -eq (Get-Prop $env[$n] 'value') -and $env[$n].valueFrom.secretKeyRef.name -ceq $n) "$n by reference" }
    Assert-True ($env['OXKIO_V3_PG_PASSWORD'].valueFrom.secretKeyRef.key -ceq '1') 'pinned PG password version'
    Assert-True ($env['OXKIO_V3_MEMORY_BACKEND'].value -ceq 'postgres' -and $env['OXKIO_V3_APPROVAL_BACKEND'].value -ceq 'postgres' -and $env['OXKIO_V3_PG_USER'].value -ceq 'oxkio_v3_runtime') 'durable V3'
    Assert-True ($env['OXKIO_V3_COHORT_UIDS'].value -ceq 'SyntheticOwnerUid0000000000') 'cohort is the owner only'
    Assert-True (@($c.env | Where-Object { $_.name -match '^OXKIO_V3_REASONING_' }).Count -eq 0) 'V3 reasoning not enabled here'
    Assert-True ($c.image -ceq $realDigest -and $d.spec.template.spec.serviceAccountName -ceq 'synthetic@example.invalid') 'image and service account'
    Assert-True ((Get-Canonical $d.spec.traffic) -ceq ('[{"revisionName":"oxkio-api-staging-00018-9xl","percent":100},{"revisionName":"oxkio-api-staging-v3r-9e598e1","percent":0,"tag":"v3-real-9e598e1"}]')) 'traffic'
    Assert-True ($d.metadata.resourceVersion -ceq 'rv-1' -and $null -eq (Get-Prop $d 'status')) 'optimistic concurrency, no output fields'
}
Check 'Real V3 document refuses ephemeral Approval backend' {New-RealV3ServiceDocument (New-ServiceJson) $realDigest} $true
Check 'Real V3 document refuses a tag instead of a digest' {New-RealV3ServiceDocument (New-RealServiceJson) 'repo/image:9e598e1'} $true
Check 'Real V3 document refuses a missing Neon host' {$saved=$script:PgHost;$script:PgHost='';try{New-RealV3ServiceDocument (New-RealServiceJson) $realDigest}finally{$script:PgHost=$saved}} $true
Check 'Operational modes refuse a missing or malformed owner UID' {$saved=$script:OwnerUid;$script:OwnerUid='';try{Assert-OwnerUid}finally{$script:OwnerUid=$saved}} $true
Check 'Synthetic env never carries the real OAuth client id' {$e=New-SyntheticEnv ('k'*64);Assert-True ($e.GOOGLE_CLIENT_ID -like 'disabled-synthetic-*' -and $e.GOOGLE_CLIENT_SECRET -ceq 'disabled-synthetic-test') 'oauth'}
function New-RealRevisionModel([scriptblock]$Mutate={param($d)}) {
    $d=New-RealV3ServiceDocument (New-RealServiceJson) $realDigest; & $Mutate $d
    $rev=[pscustomobject]@{metadata=$d.spec.template.metadata;spec=$d.spec.template.spec;status=[pscustomobject]@{imageDigest=$realDigest}}
    $traffic=@($d.spec.traffic | ForEach-Object { [pscustomobject]@{revisionName=$_.revisionName;percent=[int]$_.percent;latestRevision=$false;tag=(Get-Prop $_ 'tag' '')} })
    ConvertTo-RevisionModel $rev $traffic $script:ExpectedCommit
}
Check 'Real revision model passes the real-variant guard' {Assert-RealRevision (New-RealRevisionModel)}
Check 'Real-variant guard refuses traffic on the new revision' {Assert-RealRevision (New-RealRevisionModel {param($d) $d.spec.traffic[1].percent=10})} $true
Check 'Real-variant guard refuses a missing secret reference' {Assert-RealRevision (New-RealRevisionModel {param($d) $c=@($d.spec.template.spec.containers)[0]; $c.env=@($c.env | Where-Object { $_.name -cne 'OXKIO_V3_PG_PASSWORD' })})} $true
Check 'Real-variant guard refuses a plaintext V3 secret' {Assert-RealRevision (New-RealRevisionModel {param($d) $c=@($d.spec.template.spec.containers)[0]; $c.env=@($c.env | Where-Object { $_.name -cne 'OXKIO_V3_INTEGRITY_KEY' })+@([pscustomobject]@{name='OXKIO_V3_INTEGRITY_KEY';value=('k'*64)})})} $true
Check 'Real-variant guard refuses a cohort other than the owner' {Assert-RealRevision (New-RealRevisionModel {param($d) $c=@($d.spec.template.spec.containers)[0]; ($c.env | Where-Object { $_.name -ceq 'OXKIO_V3_COHORT_UIDS' }).value='SomeoneElse000000000000'})} $true
# Issue #85: V3 reasoning only by explicit InternalEgress, reviewed values, key by existing reference.
function New-ReasoningServiceJson { $svc=New-RealServiceJson; $c=@($svc.spec.template.spec.containers)[0]
    $c.env=@($c.env)+@([pscustomobject]@{name='OXKIO_REASONING_API_KEY';valueFrom=[pscustomobject]@{secretKeyRef=[pscustomobject]@{name='OXKIO_REASONING_API_KEY';key='latest'}}}); return $svc }
function Use-Reasoning([string]$Mode,[scriptblock]$Body){ $saved=$script:V3Reasoning; $script:V3Reasoning=$Mode; try { & $Body } finally { $script:V3Reasoning=$saved } }
function New-ReasoningRevisionModel([scriptblock]$Mutate={param($d)}) {
    $d=New-RealV3ServiceDocument (New-ReasoningServiceJson) $realDigest; & $Mutate $d
    $rev=[pscustomobject]@{metadata=$d.spec.template.metadata;spec=$d.spec.template.spec;status=[pscustomobject]@{imageDigest=$realDigest}}
    $traffic=@($d.spec.traffic | ForEach-Object { [pscustomobject]@{revisionName=$_.revisionName;percent=[int]$_.percent;latestRevision=$false;tag=(Get-Prop $_ 'tag' '')} })
    ConvertTo-RevisionModel $rev $traffic $script:ExpectedCommit
}
Check 'Default reasoning mode is Off' {Assert-True ($script:V3Reasoning -ceq 'Off') 'default'}
Check 'InternalEgress document adds only the reviewed reasoning values and reuses the key reference' {Use-Reasoning 'InternalEgress' {
    $d=New-RealV3ServiceDocument (New-ReasoningServiceJson) $realDigest
    $c=@($d.spec.template.spec.containers)[0]; $env=@{}; foreach($e in $c.env){ $env[$e.name]=$e }
    foreach($e in $script:V3ReasoningEnv.GetEnumerator()){ Assert-True ($env[$e.Key].value -ceq $e.Value) "value $($e.Key)" }
    Assert-True ($env['OXKIO_V3_REASONING_BASE_URL'].value -ceq 'https://eu.api.openai.com/v1') 'EU residency'
    Assert-True ($env['OXKIO_REASONING_API_KEY'].valueFrom.secretKeyRef.name -ceq 'OXKIO_REASONING_API_KEY' -and $null -eq (Get-Prop $env['OXKIO_REASONING_API_KEY'] 'value')) 'key by reference only'
    Assert-True (@($c.env | Where-Object { $_.name -match 'API_KEY' -and -not (Get-Prop $_ 'valueFrom') }).Count -eq 0) 'no plaintext key'
    Assert-True (@($c.env | Where-Object { $_.name -match '^OXKIO_V3_REASONING_' }).Count -eq 7) 'exactly the reviewed fields'
    Assert-RealRevision (New-ReasoningRevisionModel) }}
Check 'InternalEgress refuses a template without the existing key reference (no new secret)' {Use-Reasoning 'InternalEgress' {New-RealV3ServiceDocument (New-RealServiceJson) $realDigest}} $true
Check 'Off document drops inherited V3 reasoning variables' {Use-Reasoning 'Off' {
    $svc=New-ReasoningServiceJson; $c=@($svc.spec.template.spec.containers)[0]
    $c.env=@($c.env)+@([pscustomobject]@{name='OXKIO_V3_REASONING_PROVIDER';value='openai'},[pscustomobject]@{name='OXKIO_V3_PLANNER_DAILY_BUDGET_USD';value='9'})
    $d=New-RealV3ServiceDocument $svc $realDigest
    Assert-True (@(@($d.spec.template.spec.containers)[0].env | Where-Object { $_.name -match '^OXKIO_V3_REASONING_|^OXKIO_V3_PLANNER_' }).Count -eq 0) 'inherited reasoning removed' }}
Check 'Off guard refuses a revision carrying V3 reasoning' {$m=Use-Reasoning 'InternalEgress' {New-ReasoningRevisionModel}; Use-Reasoning 'Off' {Assert-RealRevision $m}} $true
Check 'InternalEgress guard refuses another model' {Use-Reasoning 'InternalEgress' {Assert-RealRevision (New-ReasoningRevisionModel {param($d) $c=@($d.spec.template.spec.containers)[0]; ($c.env | Where-Object { $_.name -ceq 'OXKIO_V3_REASONING_MODEL' }).value='gpt-5.6-terra'})}} $true
Check 'InternalEgress guard refuses the global endpoint' {Use-Reasoning 'InternalEgress' {Assert-RealRevision (New-ReasoningRevisionModel {param($d) $c=@($d.spec.template.spec.containers)[0]; ($c.env | Where-Object { $_.name -ceq 'OXKIO_V3_REASONING_BASE_URL' }).value='https://api.openai.com/v1'})}} $true
Check 'InternalEgress guard refuses egress switched off' {Use-Reasoning 'InternalEgress' {Assert-RealRevision (New-ReasoningRevisionModel {param($d) $c=@($d.spec.template.spec.containers)[0]; $c.env=@($c.env | Where-Object { $_.name -cne 'OXKIO_V3_REASONING_INTERNAL_EGRESS' })})}} $true
Check 'InternalEgress guard refuses an unreviewed reasoning variable' {Use-Reasoning 'InternalEgress' {Assert-RealRevision (New-ReasoningRevisionModel {param($d) $c=@($d.spec.template.spec.containers)[0]; $c.env=@($c.env)+@([pscustomobject]@{name='OXKIO_V3_REASONING_CONFIDENTIAL_EGRESS';value='true'})})}} $true
Check 'InternalEgress guard refuses a plaintext provider key' {Use-Reasoning 'InternalEgress' {Assert-RealRevision (New-ReasoningRevisionModel {param($d) $c=@($d.spec.template.spec.containers)[0]; $c.env=@($c.env | Where-Object { $_.name -cne 'OXKIO_REASONING_API_KEY' })+@([pscustomobject]@{name='OXKIO_REASONING_API_KEY';value='sk-fixture'})})}} $true
Check 'InternalEgress guard refuses a plaintext V3 key alias' {Use-Reasoning 'InternalEgress' {Assert-RealRevision (New-ReasoningRevisionModel {param($d) $c=@($d.spec.template.spec.containers)[0]; $c.env=@($c.env)+@([pscustomobject]@{name='OXKIO_V3_REASONING_API_KEY';value='sk-fixture'})})}} $true
# Issue #86: the serving revision is a parameter (default 00018-9xl), validated, and used by the traffic guard.
Check 'Serving revision defaults to 00018-9xl' {Assert-True ($script:ExpectedRevision -ceq 'oxkio-api-staging-00018-9xl') 'default serving'}
Check 'Traffic guard follows a promoted serving revision' {$saved=$script:ExpectedRevision;$script:ExpectedRevision='oxkio-api-staging-v3r-abcdef0';try{Assert-Traffic @([pscustomobject]@{revisionName='oxkio-api-staging-v3r-abcdef0';percent=100;latestRevision=$false;tag=''})}finally{$script:ExpectedRevision=$saved}}
Check 'Traffic guard refuses the old revision once another one is declared serving' {$saved=$script:ExpectedRevision;$script:ExpectedRevision='oxkio-api-staging-v3r-abcdef0';try{Assert-Traffic @([pscustomobject]@{revisionName='oxkio-api-staging-00018-9xl';percent=100;latestRevision=$false;tag=''})}finally{$script:ExpectedRevision=$saved}} $true
Check 'Real deployment refuses a CheckReal that still lists blockers' {
    $saved=$script:CheckRealPath;$script:CheckRealPath=Join-Path $env:TEMP ('check-real-'+[guid]::NewGuid().ToString('N')+'.json')
    try{Write-PrivateFile $script:CheckRealPath (ConvertTo-Json @{Commit=$script:ExpectedCommit;AtUtc=[datetime]::UtcNow.ToString('o');Passed=$false;Blockers=@('secret_missing:OXKIO_V3_PG_PASSWORD')});Assert-RecentCheckReal}
    finally{Remove-Item -LiteralPath $script:CheckRealPath -ErrorAction SilentlyContinue;$script:CheckRealPath=$saved}
} $true
Check 'Real deployment accepts a fresh green CheckReal for this commit' {
    $saved=$script:CheckRealPath;$script:CheckRealPath=Join-Path $env:TEMP ('check-real-'+[guid]::NewGuid().ToString('N')+'.json')
    try{Write-PrivateFile $script:CheckRealPath (ConvertTo-Json @{Commit=$script:ExpectedCommit;AtUtc=[datetime]::UtcNow.ToString('o');Passed=$true;Blockers=@()});Assert-RecentCheckReal}
    finally{Remove-Item -LiteralPath $script:CheckRealPath -ErrorAction SilentlyContinue;$script:CheckRealPath=$saved}
}
Check 'Build runs as the dedicated build account with explicit config, never --tag nor the Compute default' {
    $a=New-BuildSubmitArguments 'C:\ctx' 'C:\ctx.cloudbuild.json'
    Assert-True ($a[0] -ceq 'builds' -and $a[1] -ceq 'submit' -and $a[2] -ceq 'C:\ctx') 'submit ctx'
    Assert-True (@($a | Where-Object { $_ -ceq '--service-account=projects/oxkio-runtime-prod/serviceAccounts/oxkio-gha-build@oxkio-runtime-prod.iam.gserviceaccount.com' }).Count -eq 1) 'service account'
    Assert-True (@($a | Where-Object { $_ -ceq '--config=C:\ctx.cloudbuild.json' }).Count -eq 1) 'config'
    Assert-True (@($a | Where-Object { $_ -ceq '--region=europe-west3' }).Count -eq 1 -and ($a -contains '--async')) 'region/async'
    Assert-True (@($a | Where-Object { $_ -like '--tag*' -or $_ -like '*-compute@*' -or $_ -like '*developer.gserviceaccount.com*' }).Count -eq 0) 'no --tag / compute default'
}
Check 'Build config: docker build of the exact commit tag, image pushed, logs only in Cloud Logging' {
    $tag=$script:ImageRepo+':'+$script:ShortCommit
    $c=ConvertTo-Json (New-BuildConfig $tag) -Depth 6 | ConvertFrom-Json
    Assert-True ($c.options.logging -ceq 'CLOUD_LOGGING_ONLY') 'logging'
    Assert-True (@($c.images).Count -eq 1 -and @($c.images)[0] -ceq $tag) 'images'
    Assert-True (@($c.steps).Count -eq 1 -and $c.steps[0].name -ceq 'gcr.io/cloud-builders/docker') 'one docker step'
    Assert-True ((@($c.steps[0].args) -join ' ') -ceq "build --network cloudbuild --no-cache -t $tag .") 'docker build args'
    Assert-True (-not ($c.PSObject.Properties.Name -contains 'serviceAccount') -and -not ($c.PSObject.Properties.Name -contains 'logsBucket')) 'no SA/logs bucket override in config'
}
Check 'Build config refuses any other image tag' {New-BuildConfig ($script:ImageRepo+':latest')} $true
Check 'Build arguments refuse a non-dedicated build account' {
    $saved=$script:BuildServiceAccount;$script:BuildServiceAccount='123456789012-compute@developer.gserviceaccount.com'
    try{New-BuildSubmitArguments 'C:\ctx' 'C:\cfg.json'}finally{$script:BuildServiceAccount=$saved}
} $true
# Regresion run 41216052594: status de la gen 18 (latestRevision=true) leido justo despues de
# escribir la gen 19 con el trafico fijado por nombre. Documentos con la forma real de Cloud Run.
function New-ServiceStatus([long]$Generation,[long]$Observed,[string]$Ready,[switch]$Stale) {
    $traffic=if($Stale){ '[{"revisionName":"oxkio-api-staging-00018-9xl","percent":100,"latestRevision":true}]' }
             else { '[{"revisionName":"oxkio-api-staging-00018-9xl","percent":100},{"revisionName":"oxkio-api-staging-v3r-9e598e1","tag":"v3-real-9e598e1"}]' }
    ('{"metadata":{"name":"oxkio-api-staging","generation":'+$Generation+'},"status":{"observedGeneration":'+$Observed+
     ',"conditions":[{"type":"Ready","status":"'+$Ready+'"}],"traffic":'+$traffic+'}}') | ConvertFrom-Json
}
function New-DescribeQueue([object[]]$Items) {
    $script:DescribeQueue=[System.Collections.Generic.Queue[object]]::new(); foreach($i in $Items){ $script:DescribeQueue.Enqueue($i) }
    { $script:DescribeQueue.Dequeue() }
}
Check 'Regression 41216052594: unreconciled status trips the post-step-3 traffic check' {Assert-Traffic (ConvertTo-TrafficModel (New-ServiceStatus 19 18 'True' -Stale))} $true
Check 'Unreconciled status (observedGeneration behind) is not accepted' {Assert-True (-not (Test-ServiceReconciled (New-ServiceStatus 19 18 'True' -Stale) 19)) 'stale accepted'}
Check 'Wait returns only the reconciled generation, which passes without AllowLatest' {
    $d=New-DescribeQueue @((New-ServiceStatus 19 18 'True' -Stale),(New-ServiceStatus 19 19 'Unknown'),(New-ServiceStatus 19 19 'True'))
    $s=Wait-ServiceReconciled $d 19 -TimeoutSeconds 30 -PollSeconds 0
    Assert-True ($script:DescribeQueue.Count -eq 0 -and $s.status.observedGeneration -eq 19) 'not reconciled'
    $t=ConvertTo-TrafficModel $s; Assert-Traffic $t
    Assert-True (@($t | Where-Object { $_.latestRevision }).Count -eq 0 -and @($t | Where-Object { $_.tag -ceq 'v3-real-9e598e1' -and $_.percent -eq 0 }).Count -eq 1) 'traffic'
}
Check 'Wait times out fail-closed on a status that never reconciles' {$d={New-ServiceStatus 19 18 'True' -Stale};Wait-ServiceReconciled $d 19 -TimeoutSeconds 0 -PollSeconds 0} $true
Check 'Reconciled but not Ready is refused' {$d=New-DescribeQueue @((New-ServiceStatus 19 19 'False'));Wait-ServiceReconciled $d 19 -TimeoutSeconds 30 -PollSeconds 0} $true
Check 'Generation older than the written one is refused' {Test-ServiceReconciled (New-ServiceStatus 18 18 'True') 19} $true
Check 'Real ReplaceService and every state read wait for reconciliation; dry-run does not' {
    $replace=(Get-Command Invoke-ServiceReplace).ScriptBlock.ToString(); $read=(Get-Command Read-CloudState).ScriptBlock.ToString()
    Assert-True ($replace -match '(?s)if\(-not \$DryRun\)\{.*Wait-ServiceReconciled') 'replace does not wait'
    Assert-True ($read -match 'Wait-ServiceReconciled') 'Read-CloudState does not wait'
}
Check 'Evidence lives outside the repository' {Assert-True (-not $script:Evidence.StartsWith($script:RepoLocal,[StringComparison]::OrdinalIgnoreCase)) 'evidence in repo'}
[pscustomobject]@{Kind='LOCAL_SYNTHETIC_ONLY';Passed=$script:Results.Count;Failed=0;CloudCommandsExecuted=0;Tests=$script:Results} | ConvertTo-Json -Depth 8
