#!/usr/bin/env bash
# OXKIO V3 — one-time Google Cloud setup for GitHub Actions (Workload Identity
# Federation, no service account keys). Run in Cloud Shell by a project owner.
#
#   bash setup-github-wif.sh plan                 # default: prints every change; only reads
#   bash setup-github-wif.sh apply [--hours N]     # creates/updates; opens a DB window of N hours (default 4, max 24)
#   bash setup-github-wif.sh verify                # only reads; PASS/FAIL per item (Google Cloud and GitHub)
#   bash setup-github-wif.sh open-db-window [--hours N]   # new temporary DB window (Neon admin URL + runtime password)
#   bash setup-github-wif.sh close-db-window       # removes DB access now, before it expires
#   bash setup-github-wif.sh rollback              # reverts only what this script created (asks for REVERTIR)
#
# Ownership: everything this script creates carries the marker below (service
# account, pool and provider descriptions; secret label; the secret versions it
# adds are listed in a secret annotation). A pre-existing resource without the
# marker is never adopted, changed or deleted: apply stops instead.
#
# Never prints, logs or passes in argv any secret value. The Neon admin URL is
# read with a hidden prompt (only if the secret has no enabled version yet) and
# streamed to Secret Manager over stdin. plan and verify never write anything,
# not even the local gcloud configuration: every call names --project.
set -euo pipefail

PROJECT="oxkio-runtime-prod"
REGION="europe-west3"
REPO="xantalal-bit/OXKIO-MASTER-WORKSPACE"
REPO_ID="1239701981"            # immutable: survives renames and transfers
REPO_OWNER_ID="273384467"
GITHUB_REVIEWER="xantalal-bit"
POOL="oxkio-github"
PROVIDER="oxkio-main"
SA_DB="oxkio-gha-db"
SA_DEPLOY="oxkio-gha-deploy"
ENV_DB="oxkio-v3-db"
ENV_DEPLOY="oxkio-v3-deploy"
WF_DB=".github/workflows/oxkio-v3-db.yml"
WF_DEPLOY=".github/workflows/oxkio-v3-deploy.yml"
SERVICE="oxkio-api-staging"
AR_REPO="oxkio-staging"
RUNTIME_SA="oxkio-runtime-prod@${PROJECT}.iam.gserviceaccount.com"
ADMIN_URL_SECRET="OXKIO_V3_PG_ADMIN_URL"
PG_PASSWORD_SECRET="OXKIO_V3_PG_PASSWORD"
MARK="oxkio-setup-github-wif"
VERSIONS_ANNOTATION="oxkio-setup-versions"
# Secrets whose metadata (never payload) the deploy checks read (Read-CloudState / CheckReal).
DEPLOY_METADATA_SECRETS=(OXKIO_APPROVAL_PG_RUNTIME_URL OXKIO_MISSION_PG_RUNTIME_URL OXKIO_REASONING_API_KEY
  OXKIO_V3_INTEGRITY_KEY oxkio-google-client-secret oxkio-google-oauth-tokens OXKIO_V3_PG_PASSWORD)
DEPLOY_PROJECT_ROLES=(roles/cloudbuild.builds.editor roles/serviceusage.serviceUsageConsumer roles/logging.viewer
  roles/iam.securityReviewer roles/run.viewer)
APIS=(iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com)
WINDOW_TITLE_PREFIX="oxkio-db-window"

MODE="${1:-plan}"; shift || true
HOURS=4
while [[ $# -gt 0 ]]; do
  case "$1" in
    --hours) HOURS="${2:-}"; shift 2 ;;
    *) echo "Opción desconocida: $1" >&2; exit 64 ;;
  esac
done
[[ "$HOURS" =~ ^[0-9]+$ ]] && (( HOURS >= 1 && HOURS <= 24 )) || { echo "--hours debe estar entre 1 y 24" >&2; exit 64; }
case "$MODE" in plan|apply|verify|open-db-window|close-db-window|rollback) ;; *) echo "Modo desconocido: $MODE" >&2; exit 64 ;; esac

DB_EMAIL="${SA_DB}@${PROJECT}.iam.gserviceaccount.com"
DEPLOY_EMAIL="${SA_DEPLOY}@${PROJECT}.iam.gserviceaccount.com"
ATTRIBUTE_CONDITION="assertion.repository_id == '${REPO_ID}' && assertion.repository_owner_id == '${REPO_OWNER_ID}' && assertion.ref == 'refs/heads/main' && assertion.event_name == 'workflow_dispatch' && ((assertion.environment == '${ENV_DB}' && assertion.workflow_ref == '${REPO}/${WF_DB}@refs/heads/main') || (assertion.environment == '${ENV_DEPLOY}' && assertion.workflow_ref == '${REPO}/${WF_DEPLOY}@refs/heads/main'))"
ATTRIBUTE_MAPPING="google.subject=assertion.sub,attribute.environment=assertion.environment,attribute.repository_id=assertion.repository_id"

say() { printf '%s\n' "$*"; }
# Every mutation goes through run: in plan mode it is printed, never executed.
run() { if [[ "$MODE" == plan ]]; then printf 'PLAN: gcloud %s\n' "$*"; else gcloud "$@" --quiet >/dev/null; fi; }
exists() { gcloud "$@" --quiet >/dev/null 2>&1; }
refuse() { say "BLOQUEO: $1 ya existe y no lo creó este script (sin marca $MARK). No se adopta ni se modifica." >&2; exit 68; }

description_of() {   # $1: sa|pool|provider  $2: name
  case "$1" in
    sa) gcloud iam service-accounts describe "$2" --project="$PROJECT" --format='value(description)' 2>/dev/null ;;
    pool) gcloud iam workload-identity-pools describe "$POOL" --project="$PROJECT" --location=global --format='value(description)' 2>/dev/null ;;
    provider) gcloud iam workload-identity-pools providers describe "$PROVIDER" --project="$PROJECT" --location=global --workload-identity-pool="$POOL" --format='value(description)' 2>/dev/null ;;
  esac
}
owned() { [[ "$(description_of "$@" || true)" == *"$MARK"* ]]; }

project_number() {
  local n
  n="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)' 2>/dev/null || true)"
  # Cloud Run v1 namespaces are the project number (works if Resource Manager calls are restricted).
  [[ -n "$n" ]] || n="$(gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format='value(metadata.namespace)' 2>/dev/null || true)"
  [[ "$n" =~ ^[0-9]+$ ]] || { echo "No se pudo obtener el número de proyecto de $PROJECT" >&2; exit 65; }
  printf '%s' "$n"
}

principal_set() { printf 'principalSet://iam.googleapis.com/projects/%s/locations/global/workloadIdentityPools/%s/attribute.environment/%s' "$1" "$POOL" "$2"; }

window_condition() {
  local until; until="$(date -u -d "+${HOURS} hours" +%Y-%m-%dT%H:%M:%SZ)"
  printf 'expression=request.time < timestamp("%s"),title=%s-%s,description=Temporary GitHub DB window' "$until" "$WINDOW_TITLE_PREFIX" "$(date -u +%Y%m%dT%H%M%SZ)"
}

# Bindings of the DB identity on a secret policy (stdin), one per line:
#   OWN|FOREIGN <TAB> role <TAB> condition JSON (or -)
# OWN = conditional binding whose title starts with the window prefix (created by open-db-window).
db_grants() {
  python3 -c '
import json, sys
member, prefix = sys.argv[1], sys.argv[2] + "-"
raw = sys.stdin.read().strip()
policy = json.loads(raw) if raw else {}
for b in policy.get("bindings", []):
    if member not in b.get("members", []):
        continue
    c = b.get("condition")
    own = bool(c) and str(c.get("title", "")).startswith(prefix)
    print("OWN" if own else "FOREIGN", b.get("role", ""), json.dumps(c, separators=(",", ":")) if c else "-", sep="\t")
' "serviceAccount:$DB_EMAIL" "$WINDOW_TITLE_PREFIX" | tr -d '\r'
}

# Removes the window grants of the DB identity on the two DB secrets by their EXACT condition
# (`remove-iam-policy-binding --all` is refused by gcloud on conditional policies in
# non-interactive mode). Bindings of other principals and grants not created by a window are
# never touched. Errors are not hidden: returns 70 if a removal fails, a policy cannot be read,
# or ANY binding of the DB identity remains on either secret afterwards.
close_db_window() {
  local secret policy grants kind role cond file failed=0
  for secret in "$ADMIN_URL_SECRET" "$PG_PASSWORD_SECRET"; do
    if [[ "$MODE" == plan ]]; then
      say "PLAN: retirar de $secret las concesiones de $DB_EMAIL con condición ${WINDOW_TITLE_PREFIX}-* (por su condición exacta) y comprobar que no queda ninguna"
      continue
    fi
    if ! policy="$(gcloud secrets get-iam-policy "$secret" --project="$PROJECT" --format=json)" ||
       ! grants="$(printf '%s' "$policy" | db_grants)"; then
      say "FAIL  no se pudo leer la política IAM de $secret" >&2; return 70
    fi
    while IFS=$'\t' read -r kind role cond; do
      [[ "$kind" == OWN ]] || continue
      file="$(mktemp)"; printf '%s' "$cond" > "$file"
      if gcloud secrets remove-iam-policy-binding "$secret" --project="$PROJECT" --member="serviceAccount:$DB_EMAIL" \
           --role="$role" --condition-from-file="$file" --quiet >/dev/null; then
        say "OK  $secret: retirada la concesión de ventana $role"
      else
        say "FAIL  $secret: no se pudo retirar la concesión de ventana $role" >&2; failed=1
      fi
      rm -f "$file"
    done <<< "$grants"
    # Re-read: no binding of the DB identity may remain on this secret.
    if ! policy="$(gcloud secrets get-iam-policy "$secret" --project="$PROJECT" --format=json)" ||
       ! grants="$(printf '%s' "$policy" | db_grants)"; then
      say "FAIL  no se pudo releer la política IAM de $secret" >&2; return 70
    fi
    while IFS=$'\t' read -r kind role cond; do
      [[ -n "$kind" ]] || continue
      if [[ "$kind" == OWN ]]; then say "FAIL  $secret: $DB_EMAIL conserva $role (ventana)" >&2
      else say "FAIL  $secret: $DB_EMAIL conserva $role, concesión no creada por open-db-window (no se toca; revisar)" >&2; fi
      failed=1
    done <<< "$grants"
  done
  (( failed == 0 )) || return 70
}

open_db_window() {
  if [[ "$MODE" != plan ]] && ! owned sa "$DB_EMAIL"; then say "BLOQUEO: $DB_EMAIL no existe o no lo creó este script." >&2; exit 68; fi
  local cond; cond="$(window_condition)"
  # A new window is only opened once the previous one is verifiably gone (no accumulation).
  close_db_window || { say "BLOQUEO: la ventana anterior no se ha podido cerrar; no se abre otra." >&2; exit 70; }
  # Runtime password: read version 1 (--resume) and its metadata (getSecret). Admin URL: read only.
  run secrets add-iam-policy-binding "$PG_PASSWORD_SECRET" --project="$PROJECT" --member="serviceAccount:$DB_EMAIL" --role=roles/secretmanager.secretAccessor --condition="$cond"
  run secrets add-iam-policy-binding "$PG_PASSWORD_SECRET" --project="$PROJECT" --member="serviceAccount:$DB_EMAIL" --role=roles/secretmanager.viewer --condition="$cond"
  run secrets add-iam-policy-binding "$ADMIN_URL_SECRET" --project="$PROJECT" --member="serviceAccount:$DB_EMAIL" --role=roles/secretmanager.secretAccessor --condition="$cond"
  say "Ventana DB: ${HOURS} h (expira sola; close-db-window la cierra antes)."
}

recorded_versions() {
  gcloud secrets describe "$ADMIN_URL_SECRET" --project="$PROJECT" --format="value(annotations.${VERSIONS_ANNOTATION})" 2>/dev/null | tr ',;' '  '
}

store_admin_url() {
  if ! exists secrets describe "$ADMIN_URL_SECRET" --project="$PROJECT"; then
    run secrets create "$ADMIN_URL_SECRET" --project="$PROJECT" --replication-policy=automatic --labels="oxkio-managed-by=${MARK}"
  fi
  if [[ "$MODE" == plan ]]; then say "PLAN: pedir con entrada oculta la URL admin de Neon si $ADMIN_URL_SECRET no tiene versión habilitada; anotar la versión creada en ${VERSIONS_ANNOTATION}"; return; fi
  if [[ -n "$(gcloud secrets versions list "$ADMIN_URL_SECRET" --project="$PROJECT" --filter='state=ENABLED' --format='value(name)' --limit=1 2>/dev/null)" ]]; then
    say "OK  $ADMIN_URL_SECRET ya tiene una versión habilitada (no se sobrescribe ni pasa a ser propia)."; return
  fi
  local url="" created recorded
  read -r -s -p "Pega la URL de conexión admin de Neon (no se mostrará): " url; echo
  # Shape check without printing: neon host, TLS mode allowed by the guard.
  if [[ ! "$url" =~ ^postgres(ql)?://[^@[:space:]]+@[a-z0-9.-]+\.neon\.tech(:[0-9]+)?/[a-z0-9_]+(\?.*)?$ ]] || [[ "$url" =~ sslmode=(disable|allow|prefer|verify-ca|no-verify) ]]; then
    url=""; echo "La URL no tiene la forma esperada (postgresql://...@*.neon.tech/neondb, sslmode require o verify-full). No se ha guardado nada." >&2; exit 66
  fi
  created="$(printf '%s' "$url" | gcloud secrets versions add "$ADMIN_URL_SECRET" --project="$PROJECT" --data-file=- --format='value(name)' --quiet)"
  url=""
  created="${created##*/}"
  [[ "$created" =~ ^[0-9]+$ ]] || { echo "No se pudo registrar la versión creada" >&2; exit 69; }
  recorded="$(recorded_versions | xargs)"
  gcloud secrets update "$ADMIN_URL_SECRET" --project="$PROJECT" --update-annotations="${VERSIONS_ANNOTATION}=$(printf '%s %s' "$recorded" "$created" | xargs | tr ' ' ',')" --quiet >/dev/null
  say "OK  URL admin guardada en $ADMIN_URL_SECRET (versión $created, propia; valor no mostrado)."
}

# All ownership checks run before the first change: a foreign resource stops apply with nothing modified.
assert_ownership() {
  local sa
  if exists iam workload-identity-pools describe "$POOL" --project="$PROJECT" --location=global; then owned pool || refuse "el pool $POOL"; fi
  if exists iam workload-identity-pools providers describe "$PROVIDER" --project="$PROJECT" --location=global --workload-identity-pool="$POOL"; then
    owned provider || refuse "el proveedor $PROVIDER"
  fi
  for sa in "$DB_EMAIL" "$DEPLOY_EMAIL"; do
    if exists iam service-accounts describe "$sa" --project="$PROJECT"; then owned sa "$sa" || refuse "la cuenta $sa"; fi
  done
}

apply_all() {
  local num; num="$(project_number)"
  assert_ownership
  for api in "${APIS[@]}"; do run services enable "$api" --project="$PROJECT"; done

  if exists iam workload-identity-pools describe "$POOL" --project="$PROJECT" --location=global; then
    owned pool || refuse "el pool $POOL"; say "OK  pool $POOL propio, se reutiliza"
  else
    run iam workload-identity-pools create "$POOL" --project="$PROJECT" --location=global --display-name="OXKIO GitHub Actions" --description="$MARK"
  fi
  local verb=create-oidc
  if exists iam workload-identity-pools providers describe "$PROVIDER" --project="$PROJECT" --location=global --workload-identity-pool="$POOL"; then
    owned provider || refuse "el proveedor $PROVIDER"; verb=update-oidc
  fi
  run iam workload-identity-pools providers "$verb" "$PROVIDER" --project="$PROJECT" --location=global --workload-identity-pool="$POOL" \
    --issuer-uri="https://token.actions.githubusercontent.com" --attribute-mapping="$ATTRIBUTE_MAPPING" --attribute-condition="$ATTRIBUTE_CONDITION" --description="$MARK"

  for sa in "$SA_DB" "$SA_DEPLOY"; do
    if exists iam service-accounts describe "${sa}@${PROJECT}.iam.gserviceaccount.com" --project="$PROJECT"; then
      owned sa "${sa}@${PROJECT}.iam.gserviceaccount.com" || refuse "la cuenta ${sa}"
    else
      run iam service-accounts create "$sa" --project="$PROJECT" --display-name="OXKIO GitHub ${sa#oxkio-gha-} (WIF, no keys)" --description="$MARK"
    fi
  done
  # Each service account can only be impersonated from its own protected GitHub environment.
  run iam service-accounts add-iam-policy-binding "$DB_EMAIL" --project="$PROJECT" --role=roles/iam.workloadIdentityUser --member="$(principal_set "$num" "$ENV_DB")"
  run iam service-accounts add-iam-policy-binding "$DEPLOY_EMAIL" --project="$PROJECT" --role=roles/iam.workloadIdentityUser --member="$(principal_set "$num" "$ENV_DEPLOY")"

  # Deploy: private revision only. No setIamPolicy anywhere (cannot open the service to allUsers).
  run run services add-iam-policy-binding "$SERVICE" --project="$PROJECT" --region="$REGION" --member="serviceAccount:$DEPLOY_EMAIL" --role=roles/run.developer
  run run services add-iam-policy-binding "$SERVICE" --project="$PROJECT" --region="$REGION" --member="serviceAccount:$DEPLOY_EMAIL" --role=roles/run.invoker
  run iam service-accounts add-iam-policy-binding "$RUNTIME_SA" --project="$PROJECT" --member="serviceAccount:$DEPLOY_EMAIL" --role=roles/iam.serviceAccountUser
  run artifacts repositories add-iam-policy-binding "$AR_REPO" --project="$PROJECT" --location="$REGION" --member="serviceAccount:$DEPLOY_EMAIL" --role=roles/artifactregistry.reader
  for role in "${DEPLOY_PROJECT_ROLES[@]}"; do
    run projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$DEPLOY_EMAIL" --role="$role" --condition=None
  done
  if exists storage buckets describe "gs://${PROJECT}_cloudbuild" --project="$PROJECT"; then
    run storage buckets add-iam-policy-binding "gs://${PROJECT}_cloudbuild" --project="$PROJECT" --member="serviceAccount:$DEPLOY_EMAIL" --role=roles/storage.objectAdmin
  else
    say "AVISO: gs://${PROJECT}_cloudbuild no existe; el primer build lo necesita (pendiente explícito en el README)."
  fi
  for secret in "${DEPLOY_METADATA_SECRETS[@]}"; do
    run secrets add-iam-policy-binding "$secret" --project="$PROJECT" --member="serviceAccount:$DEPLOY_EMAIL" --role=roles/secretmanager.viewer
  done

  store_admin_url
  open_db_window

  say ""
  say "GitHub (repo $REPO), sin secretos:"
  say "  variables de repositorio: OXKIO_GCP_WIF_PROVIDER=projects/$num/locations/global/workloadIdentityPools/$POOL/providers/$PROVIDER"
  say "                            OXKIO_GCP_DB_SA=$DB_EMAIL   OXKIO_GCP_DEPLOY_SA=$DEPLOY_EMAIL"
  say "  entornos $ENV_DB y $ENV_DEPLOY: revisor obligatorio $GITHUB_REVIEWER, rama de despliegue solo main."
  say "  entorno $ENV_DEPLOY: variable OXKIO_V3_PG_HOST (host Neon) y secreto OXKIO_V3_OWNER_UID."
}

# ---------------------------------------------------------------- verify (read-only)
# Prints "role|expiry" for one member of an IAM policy read from stdin; expiry is
# the timestamp of a `request.time < timestamp(...)` condition, NONE (no condition) or OTHER.
member_roles() {
  python3 -c '
import json, re, sys
member = sys.argv[1]
raw = sys.stdin.read().strip()
policy = json.loads(raw) if raw else {}
for b in policy.get("bindings", []):
    if member in b.get("members", []):
        e = (b.get("condition") or {}).get("expression", "").strip()
        m = re.fullmatch(r"request\.time < timestamp\(\"([0-9T:Z-]+)\"\)", e)
        print(b["role"] + "|" + (m.group(1) if m else ("NONE" if not e else "OTHER")))
' "$1" | sort
}
policy_has_public() { python3 -c 'import json,sys; raw=sys.stdin.read().strip(); p=json.loads(raw) if raw else {}; sys.exit(0 if any(m in ("allUsers","allAuthenticatedUsers") for b in p.get("bindings",[]) for m in b.get("members",[])) else 1)'; }
json_field() { python3 -c 'import json,sys; d=json.load(sys.stdin); v=d
for k in sys.argv[1].split("."):
    v=v[int(k)] if isinstance(v,list) else v.get(k) if isinstance(v,dict) else None
print(json.dumps(v) if not isinstance(v,str) else v)' "$1"; }

pass() { say "PASS  $1"; }
fail() { say "FAIL  $1"; FAILED=1; }
expect() { if [[ "$2" == "$3" ]]; then pass "$1"; else fail "$1 (esperado: ${3:-ninguno}; actual: ${2:-ninguno})"; fi; }

verify_all() {
  FAILED=0
  local num now in24 sm policy lines expected secret
  num="$(project_number)"
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; in24="$(date -u -d '+24 hours +5 minutes' +%Y-%m-%dT%H:%M:%SZ)"

  owned pool && pass "pool $POOL propio" || fail "pool $POOL ausente o no propio"
  owned provider && pass "proveedor $PROVIDER propio" || fail "proveedor $PROVIDER ausente o no propio"
  expect "condición OIDC exacta (repo id, owner id, main, workflow_dispatch, entorno+workflow)" \
    "$(gcloud iam workload-identity-pools providers describe "$PROVIDER" --project="$PROJECT" --location=global --workload-identity-pool="$POOL" --format='value(attributeCondition)' 2>/dev/null)" "$ATTRIBUTE_CONDITION"

  for pair in "$DB_EMAIL:$ENV_DB" "$DEPLOY_EMAIL:$ENV_DEPLOY"; do
    local email="${pair%%:*}" env="${pair##*:}"
    owned sa "$email" && pass "$email propia" || fail "$email ausente o no propia"
    expect "$email sin claves de usuario" "$(gcloud iam service-accounts keys list --iam-account="$email" --project="$PROJECT" --managed-by=user --format='value(name)' 2>/dev/null)" ""
    policy="$(gcloud iam service-accounts get-iam-policy "$email" --project="$PROJECT" --format=json 2>/dev/null || true)"
    expect "$email suplantable solo desde $env" "$(printf '%s' "$policy" | member_roles "$(principal_set "$num" "$env")")" "roles/iam.workloadIdentityUser|NONE"
    expect "$email: ningún otro principal con permisos sobre la cuenta" \
      "$(printf '%s' "$policy" | python3 -c 'import json,sys; raw=sys.stdin.read().strip(); p=json.loads(raw) if raw else {}; print(sum(len(b.get("members",[])) for b in p.get("bindings",[])))')" "1"
  done

  policy="$(gcloud projects get-iam-policy "$PROJECT" --format=json 2>/dev/null || true)"
  expect "$DB_EMAIL sin roles de proyecto" "$(printf '%s' "$policy" | member_roles "serviceAccount:$DB_EMAIL")" ""
  expect "$DEPLOY_EMAIL: roles de proyecto exactos, sin condición" "$(printf '%s' "$policy" | member_roles "serviceAccount:$DEPLOY_EMAIL" | tr '\n' ' ')" \
    "$(printf '%s|NONE\n' "${DEPLOY_PROJECT_ROLES[@]}" | sort | tr '\n' ' ')"

  policy="$(gcloud run services get-iam-policy "$SERVICE" --project="$PROJECT" --region="$REGION" --format=json 2>/dev/null || true)"
  printf '%s' "$policy" | policy_has_public && fail "servicio $SERVICE con allUsers/allAuthenticatedUsers" || pass "servicio $SERVICE sin acceso anónimo"
  expect "$DB_EMAIL sin permisos en $SERVICE" "$(printf '%s' "$policy" | member_roles "serviceAccount:$DB_EMAIL")" ""
  expect "$DEPLOY_EMAIL en $SERVICE: developer + invoker" "$(printf '%s' "$policy" | member_roles "serviceAccount:$DEPLOY_EMAIL" | tr '\n' ' ')" "roles/run.developer|NONE roles/run.invoker|NONE "
  policy="$(gcloud iam service-accounts get-iam-policy "$RUNTIME_SA" --project="$PROJECT" --format=json 2>/dev/null || true)"
  expect "$DB_EMAIL sin permisos sobre la cuenta de runtime" "$(printf '%s' "$policy" | member_roles "serviceAccount:$DB_EMAIL")" ""
  expect "$DEPLOY_EMAIL: serviceAccountUser sobre la cuenta de runtime" "$(printf '%s' "$policy" | member_roles "serviceAccount:$DEPLOY_EMAIL")" "roles/iam.serviceAccountUser|NONE"
  policy="$(gcloud artifacts repositories get-iam-policy "$AR_REPO" --project="$PROJECT" --location="$REGION" --format=json 2>/dev/null || true)"
  expect "$DB_EMAIL sin permisos en Artifact Registry" "$(printf '%s' "$policy" | member_roles "serviceAccount:$DB_EMAIL")" ""

  # Every secret of the project: the DB identity only inside an unexpired window on its two
  # secrets; the deploy identity only metadata (viewer) and never the Neon admin URL.
  local db_secrets="" deploy_secrets="" window_ok=1 expiry
  for secret in $(gcloud secrets list --project="$PROJECT" --format='value(name)' 2>/dev/null | sed 's#.*/##' | sort); do
    policy="$(gcloud secrets get-iam-policy "$secret" --project="$PROJECT" --format=json 2>/dev/null || true)"
    lines="$(printf '%s' "$policy" | member_roles "serviceAccount:$DB_EMAIL")"
    while IFS='|' read -r role expiry; do
      [[ -z "$role" ]] && continue
      db_secrets+="$secret:$role "
      if [[ ! "$expiry" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]+Z$ ]] || [[ "$expiry" < "$now" ]] || [[ "$expiry" > "$in24" ]]; then window_ok=0; fi
    done <<< "$lines"
    lines="$(printf '%s' "$policy" | member_roles "serviceAccount:$DEPLOY_EMAIL")"
    while IFS='|' read -r role expiry; do [[ -n "$role" ]] && deploy_secrets+="$secret:$role:$expiry "; done <<< "$lines"
  done
  expected="$(printf '%s\n' "$ADMIN_URL_SECRET:roles/secretmanager.secretAccessor" "$PG_PASSWORD_SECRET:roles/secretmanager.secretAccessor" "$PG_PASSWORD_SECRET:roles/secretmanager.viewer" | sort | tr '\n' ' ')"
  expect "$DB_EMAIL: exactamente los 3 permisos de la ventana DB, en ningún otro secreto" "$(printf '%s\n' $db_secrets | sort | tr '\n' ' ')" "$expected"
  [[ "$window_ok" == 1 && -n "$db_secrets" ]] && pass "ventana DB vigente: todas las concesiones caducan (≤ 24 h) y ninguna ha caducado" \
    || fail "ventana DB no vigente o con concesiones sin caducidad (open-db-window --hours N)"
  expect "$DEPLOY_EMAIL: solo metadatos (viewer) de los 7 secretos de runtime" "$(printf '%s\n' $deploy_secrets | sort | tr '\n' ' ')" \
    "$(printf '%s:roles/secretmanager.viewer:NONE\n' "${DEPLOY_METADATA_SECRETS[@]}" | sort | tr '\n' ' ')"
  [[ -n "$(gcloud secrets versions list "$ADMIN_URL_SECRET" --project="$PROJECT" --filter='state=ENABLED' --format='value(name)' --limit=1 2>/dev/null)" ]] \
    && pass "$ADMIN_URL_SECRET con versión habilitada" || fail "$ADMIN_URL_SECRET sin versión habilitada"

  verify_github
  say "Pendiente fuera de verify (solo lo demuestra una ejecución real): permisos del primer build, autenticación WIF en Windows, rollback real."
  [[ "$FAILED" == 0 ]] && say "VERIFY: PASS" || { say "VERIFY: FAIL"; exit 1; }
}

verify_github() {
  if ! command -v gh >/dev/null 2>&1 || ! gh auth status >/dev/null 2>&1; then
    fail "GitHub no verificable: ejecuta 'gh auth login' en Cloud Shell (entornos, variables y secreto)"; return
  fi
  local env data
  for env in "$ENV_DB" "$ENV_DEPLOY"; do
    data="$(gh api "repos/$REPO/environments/$env" 2>/dev/null || echo '{}')"
    expect "entorno $env: revisor obligatorio $GITHUB_REVIEWER" \
      "$(printf '%s' "$data" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(" ".join(sorted(r.get("reviewer",{}).get("login","") for p in d.get("protection_rules",[]) if p.get("type")=="required_reviewers" for r in p.get("reviewers",[]))))')" "$GITHUB_REVIEWER"
    expect "entorno $env: política de ramas propia" "$(printf '%s' "$data" | json_field deployment_branch_policy.custom_branch_policies 2>/dev/null)" "true"
    expect "entorno $env: solo la rama main" \
      "$(gh api "repos/$REPO/environments/$env/deployment-branch-policies" 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); print(" ".join(sorted(p.get("type","branch")+":"+p["name"] for p in d.get("branch_policies",[]))))' 2>/dev/null)" "branch:main"
  done
  local num; num="$(project_number)"
  expect "variable OXKIO_GCP_WIF_PROVIDER" "$(gh api "repos/$REPO/actions/variables/OXKIO_GCP_WIF_PROVIDER" --jq .value 2>/dev/null)" \
    "projects/$num/locations/global/workloadIdentityPools/$POOL/providers/$PROVIDER"
  expect "variable OXKIO_GCP_DB_SA" "$(gh api "repos/$REPO/actions/variables/OXKIO_GCP_DB_SA" --jq .value 2>/dev/null)" "$DB_EMAIL"
  expect "variable OXKIO_GCP_DEPLOY_SA" "$(gh api "repos/$REPO/actions/variables/OXKIO_GCP_DEPLOY_SA" --jq .value 2>/dev/null)" "$DEPLOY_EMAIL"
  [[ "$(gh api "repos/$REPO/environments/$ENV_DEPLOY/variables/OXKIO_V3_PG_HOST" --jq .value 2>/dev/null)" =~ ^[a-z0-9.-]+\.neon\.tech$ ]] \
    && pass "entorno $ENV_DEPLOY: OXKIO_V3_PG_HOST (host Neon)" || fail "entorno $ENV_DEPLOY: falta OXKIO_V3_PG_HOST con un host *.neon.tech"
  [[ "$(gh api "repos/$REPO/environments/$ENV_DEPLOY/secrets/OXKIO_V3_OWNER_UID" --jq .name 2>/dev/null)" == "OXKIO_V3_OWNER_UID" ]] \
    && pass "entorno $ENV_DEPLOY: secreto OXKIO_V3_OWNER_UID presente (valor no leído)" || fail "entorno $ENV_DEPLOY: falta el secreto OXKIO_V3_OWNER_UID"
}

# ---------------------------------------------------------------- rollback (only own changes)
rollback_all() {
  local answer=""
  read -r -p "Esto revierte solo lo creado por este script. Escribe REVERTIR: " answer
  [[ "$answer" == "REVERTIR" ]] || { echo "Cancelado." >&2; exit 67; }
  if owned sa "$DB_EMAIL"; then
    close_db_window || { say "BLOQUEO: la ventana DB no se ha podido cerrar; $DB_EMAIL no se elimina." >&2; exit 70; }
    gcloud iam service-accounts delete "$DB_EMAIL" --project="$PROJECT" --quiet >/dev/null 2>&1 || true
    say "OK  $DB_EMAIL: permisos y cuenta eliminados"
  else
    say "--  $DB_EMAIL no es propia o no existe: no se toca"
  fi
  if owned sa "$DEPLOY_EMAIL"; then
    for secret in "${DEPLOY_METADATA_SECRETS[@]}"; do
      gcloud secrets remove-iam-policy-binding "$secret" --project="$PROJECT" --member="serviceAccount:$DEPLOY_EMAIL" --role=roles/secretmanager.viewer --condition=None --quiet >/dev/null 2>&1 || true
    done
    for role in "${DEPLOY_PROJECT_ROLES[@]}"; do
      gcloud projects remove-iam-policy-binding "$PROJECT" --member="serviceAccount:$DEPLOY_EMAIL" --role="$role" --condition=None --quiet >/dev/null 2>&1 || true
    done
    for role in roles/run.developer roles/run.invoker; do
      gcloud run services remove-iam-policy-binding "$SERVICE" --project="$PROJECT" --region="$REGION" --member="serviceAccount:$DEPLOY_EMAIL" --role="$role" --quiet >/dev/null 2>&1 || true
    done
    gcloud iam service-accounts remove-iam-policy-binding "$RUNTIME_SA" --project="$PROJECT" --member="serviceAccount:$DEPLOY_EMAIL" --role=roles/iam.serviceAccountUser --quiet >/dev/null 2>&1 || true
    gcloud artifacts repositories remove-iam-policy-binding "$AR_REPO" --project="$PROJECT" --location="$REGION" --member="serviceAccount:$DEPLOY_EMAIL" --role=roles/artifactregistry.reader --quiet >/dev/null 2>&1 || true
    gcloud storage buckets remove-iam-policy-binding "gs://${PROJECT}_cloudbuild" --project="$PROJECT" --member="serviceAccount:$DEPLOY_EMAIL" --role=roles/storage.objectAdmin --quiet >/dev/null 2>&1 || true
    gcloud iam service-accounts delete "$DEPLOY_EMAIL" --project="$PROJECT" --quiet >/dev/null 2>&1 || true
    say "OK  $DEPLOY_EMAIL: permisos y cuenta eliminados"
  else
    say "--  $DEPLOY_EMAIL no es propia o no existe: no se toca"
  fi
  if owned provider; then
    gcloud iam workload-identity-pools providers delete "$PROVIDER" --project="$PROJECT" --location=global --workload-identity-pool="$POOL" --quiet >/dev/null 2>&1 || true
    say "OK  proveedor $PROVIDER eliminado"
  else say "--  proveedor $PROVIDER no es propio o no existe: no se toca"; fi
  if owned pool; then
    gcloud iam workload-identity-pools delete "$POOL" --project="$PROJECT" --location=global --quiet >/dev/null 2>&1 || true
    say "OK  pool $POOL eliminado (borrado lógico 30 días; el nombre no se reutiliza hasta entonces)"
  else say "--  pool $POOL no es propio o no existe: no se toca"; fi
  # Only the versions this script added (recorded in the annotation); disabled, never destroyed.
  local v
  for v in $(recorded_versions); do
    [[ "$v" =~ ^[0-9]+$ ]] || continue
    gcloud secrets versions disable "$v" --secret="$ADMIN_URL_SECRET" --project="$PROJECT" --quiet >/dev/null 2>&1 || true
    say "OK  $ADMIN_URL_SECRET versión $v (propia) deshabilitada, no destruida"
  done
  say "ROLLBACK: hecho. Las APIs habilitadas y los recursos sin marca $MARK no se han modificado."
}

case "$MODE" in
  plan) say "MODO PLAN: solo lecturas, no se cambia nada."; apply_all ;;
  apply) apply_all; say "APPLY: hecho. Ejecuta 'verify' para comprobarlo." ;;
  verify) verify_all ;;
  open-db-window) open_db_window ;;
  close-db-window) owned sa "$DB_EMAIL" || { say "BLOQUEO: $DB_EMAIL no es propia." >&2; exit 68; }; close_db_window || { say "CIERRE: FAIL (la ventana DB no está cerrada; ver líneas FAIL)." >&2; exit 70; }; say "Ventana DB cerrada (verificado: $DB_EMAIL sin concesiones en $ADMIN_URL_SECRET ni $PG_PASSWORD_SECRET)." ;;
  rollback) rollback_all ;;
esac
