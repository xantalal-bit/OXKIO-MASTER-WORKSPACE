#!/usr/bin/env bash
# OXKIO V3 — one-time Google Cloud setup for GitHub Actions (Workload Identity
# Federation, no service account keys). Run in Cloud Shell by a project owner.
#
#   bash setup-github-wif.sh plan                 # default: prints every change, changes nothing
#   bash setup-github-wif.sh apply [--hours N]     # creates/updates; opens a DB window of N hours (default 4, max 24)
#   bash setup-github-wif.sh verify                # read-only checks, PASS/FAIL per item
#   bash setup-github-wif.sh open-db-window [--hours N]   # new temporary DB window (Neon admin URL + runtime password)
#   bash setup-github-wif.sh close-db-window       # removes DB access now, before it expires
#   bash setup-github-wif.sh rollback              # removes everything this script created (asks for REVERTIR)
#
# Never prints, logs or passes in argv any secret value. The Neon admin URL is
# read with a hidden prompt (only if the secret has no enabled version yet) and
# streamed to Secret Manager over stdin.
set -euo pipefail

PROJECT="oxkio-runtime-prod"
REGION="europe-west3"
REPO="xantalal-bit/OXKIO-MASTER-WORKSPACE"
REPO_ID="1239701981"            # immutable: survives renames and transfers
REPO_OWNER_ID="273384467"
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

close_db_window() {
  local secret role
  for secret in "$ADMIN_URL_SECRET" "$PG_PASSWORD_SECRET"; do
    for role in roles/secretmanager.secretAccessor roles/secretmanager.viewer; do
      if [[ "$MODE" == plan ]]; then say "PLAN: gcloud secrets remove-iam-policy-binding $secret --member=serviceAccount:$DB_EMAIL --role=$role --all"
      else gcloud secrets remove-iam-policy-binding "$secret" --project="$PROJECT" --member="serviceAccount:$DB_EMAIL" --role="$role" --all --quiet >/dev/null 2>&1 || true; fi
    done
  done
}

open_db_window() {
  local cond; cond="$(window_condition)"
  close_db_window
  # Runtime password: read version 1 (--resume) and its metadata (getSecret). Admin URL: read only.
  run secrets add-iam-policy-binding "$PG_PASSWORD_SECRET" --project="$PROJECT" --member="serviceAccount:$DB_EMAIL" --role=roles/secretmanager.secretAccessor --condition="$cond"
  run secrets add-iam-policy-binding "$PG_PASSWORD_SECRET" --project="$PROJECT" --member="serviceAccount:$DB_EMAIL" --role=roles/secretmanager.viewer --condition="$cond"
  run secrets add-iam-policy-binding "$ADMIN_URL_SECRET" --project="$PROJECT" --member="serviceAccount:$DB_EMAIL" --role=roles/secretmanager.secretAccessor --condition="$cond"
  say "Ventana DB: ${HOURS} h (expira sola; close-db-window la cierra antes)."
}

store_admin_url() {
  if ! exists secrets describe "$ADMIN_URL_SECRET" --project="$PROJECT"; then
    run secrets create "$ADMIN_URL_SECRET" --project="$PROJECT" --replication-policy=automatic
  fi
  if [[ "$MODE" == plan ]]; then say "PLAN: pedir con entrada oculta la URL admin de Neon si $ADMIN_URL_SECRET no tiene versión habilitada"; return; fi
  if [[ -n "$(gcloud secrets versions list "$ADMIN_URL_SECRET" --project="$PROJECT" --filter='state=ENABLED' --format='value(name)' --limit=1 2>/dev/null)" ]]; then
    say "OK  $ADMIN_URL_SECRET ya tiene una versión habilitada (no se sobrescribe)."; return
  fi
  local url=""
  read -r -s -p "Pega la URL de conexión admin de Neon (no se mostrará): " url; echo
  # Shape check without printing: neon host, TLS mode allowed by the guard.
  if [[ ! "$url" =~ ^postgres(ql)?://[^@[:space:]]+@[a-z0-9.-]+\.neon\.tech(:[0-9]+)?/[a-z0-9_]+(\?.*)?$ ]] || [[ "$url" =~ sslmode=(disable|allow|prefer|verify-ca|no-verify) ]]; then
    url=""; echo "La URL no tiene la forma esperada (postgresql://...@*.neon.tech/neondb, sslmode require o verify-full). No se ha guardado nada." >&2; exit 66
  fi
  printf '%s' "$url" | gcloud secrets versions add "$ADMIN_URL_SECRET" --project="$PROJECT" --data-file=- --quiet >/dev/null
  url=""
  say "OK  URL admin guardada en $ADMIN_URL_SECRET (valor no mostrado)."
}

apply_all() {
  local num; num="$(project_number)"
  for api in "${APIS[@]}"; do run services enable "$api" --project="$PROJECT"; done

  if exists iam workload-identity-pools describe "$POOL" --project="$PROJECT" --location=global; then
    say "OK  pool $POOL ya existe"
  else
    run iam workload-identity-pools create "$POOL" --project="$PROJECT" --location=global --display-name="OXKIO GitHub Actions"
  fi
  local verb=create-oidc
  exists iam workload-identity-pools providers describe "$PROVIDER" --project="$PROJECT" --location=global --workload-identity-pool="$POOL" && verb=update-oidc
  run iam workload-identity-pools providers "$verb" "$PROVIDER" --project="$PROJECT" --location=global --workload-identity-pool="$POOL" \
    --issuer-uri="https://token.actions.githubusercontent.com" --attribute-mapping="$ATTRIBUTE_MAPPING" --attribute-condition="$ATTRIBUTE_CONDITION"

  for sa in "$SA_DB" "$SA_DEPLOY"; do
    exists iam service-accounts describe "${sa}@${PROJECT}.iam.gserviceaccount.com" --project="$PROJECT" ||
      run iam service-accounts create "$sa" --project="$PROJECT" --display-name="OXKIO GitHub ${sa#oxkio-gha-} (WIF, no keys)"
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
    run storage buckets add-iam-policy-binding "gs://${PROJECT}_cloudbuild" --member="serviceAccount:$DEPLOY_EMAIL" --role=roles/storage.objectAdmin
  else
    say "AVISO: gs://${PROJECT}_cloudbuild no existe; el primer build lo necesita (ver README, permisos de Cloud Build)."
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
  say "  entornos $ENV_DB y $ENV_DEPLOY: revisor obligatorio xantalal-bit, rama de despliegue solo main."
  say "  entorno $ENV_DEPLOY: variable OXKIO_V3_PG_HOST (host Neon) y secreto OXKIO_V3_OWNER_UID."
}

check() { if eval "$2" >/dev/null 2>&1; then say "PASS  $1"; else say "FAIL  $1"; FAILED=1; fi; }

verify_all() {
  FAILED=0
  local num; num="$(project_number)"
  check "proveedor OIDC con condición exacta (repo id, owner id, main, workflow_dispatch, entorno+workflow)" \
    "[[ \"\$(gcloud iam workload-identity-pools providers describe $PROVIDER --project=$PROJECT --location=global --workload-identity-pool=$POOL --format='value(attributeCondition)')\" == \"\$ATTRIBUTE_CONDITION\" ]]"
  for sa in "$DB_EMAIL" "$DEPLOY_EMAIL"; do
    check "$sa sin claves gestionadas por usuario" "[[ -z \"\$(gcloud iam service-accounts keys list --iam-account=$sa --project=$PROJECT --managed-by=user --format='value(name)')\" ]]"
  done
  check "$DB_EMAIL suplantable solo desde $ENV_DB" \
    "[[ \"\$(gcloud iam service-accounts get-iam-policy $DB_EMAIL --project=$PROJECT --format=json | tr -d ' \n')\" == *'$(principal_set "$num" "$ENV_DB")'* ]] && [[ \"\$(gcloud iam service-accounts get-iam-policy $DB_EMAIL --project=$PROJECT --format=json)\" != *'$ENV_DEPLOY'* ]]"
  check "$DEPLOY_EMAIL suplantable solo desde $ENV_DEPLOY" \
    "[[ \"\$(gcloud iam service-accounts get-iam-policy $DEPLOY_EMAIL --project=$PROJECT --format=json)\" == *'$(principal_set "$num" "$ENV_DEPLOY")'* ]] && [[ \"\$(gcloud iam service-accounts get-iam-policy $DEPLOY_EMAIL --project=$PROJECT --format=json)\" != *'$ENV_DB'* ]]"
  check "$DEPLOY_EMAIL sin roles de proyecto fuera de la lista" \
    "[[ \"\$(gcloud projects get-iam-policy $PROJECT --flatten=bindings[].members --filter='bindings.members:serviceAccount:$DEPLOY_EMAIL' --format='value(bindings.role)' | sort | tr '\n' ' ')\" == \"$(printf '%s\n' "${DEPLOY_PROJECT_ROLES[@]}" | sort | tr '\n' ' ')\" ]]"
  check "$DB_EMAIL sin roles de proyecto" \
    "[[ -z \"\$(gcloud projects get-iam-policy $PROJECT --flatten=bindings[].members --filter='bindings.members:serviceAccount:$DB_EMAIL' --format='value(bindings.role)')\" ]]"
  check "servicio $SERVICE sin allUsers/allAuthenticatedUsers" \
    "[[ \"\$(gcloud run services get-iam-policy $SERVICE --project=$PROJECT --region=$REGION --format=json)\" != *allUsers* && \"\$(gcloud run services get-iam-policy $SERVICE --project=$PROJECT --region=$REGION --format=json)\" != *allAuthenticatedUsers* ]]"
  check "acceso DB solo con condición de caducidad" \
    "gcloud secrets get-iam-policy $ADMIN_URL_SECRET --project=$PROJECT --format=json | python3 -c 'import json,sys; p=json.load(sys.stdin); sys.exit(any(\"$DB_EMAIL\" in \"\".join(b.get(\"members\",[])) and \"request.time <\" not in b.get(\"condition\",{}).get(\"expression\",\"\") for b in p.get(\"bindings\",[])))'"
  check "$ADMIN_URL_SECRET con versión habilitada" \
    "[[ -n \"\$(gcloud secrets versions list $ADMIN_URL_SECRET --project=$PROJECT --filter=state=ENABLED --format='value(name)' --limit=1)\" ]]"
  say "Ventanas DB (caducidad UTC):"
  gcloud secrets get-iam-policy "$ADMIN_URL_SECRET" --project="$PROJECT" --format=json 2>/dev/null |
    python3 -c 'import json,sys; [print("  ", b["condition"]["expression"]) for b in json.load(sys.stdin).get("bindings",[]) if "condition" in b]' || true
  [[ "$FAILED" == 0 ]] && say "VERIFY: PASS" || { say "VERIFY: FAIL"; exit 1; }
}

rollback_all() {
  local answer=""
  read -r -p "Esto elimina la federación, las dos cuentas y sus permisos. Escribe REVERTIR: " answer
  [[ "$answer" == "REVERTIR" ]] || { echo "Cancelado." >&2; exit 67; }
  close_db_window
  for secret in "${DEPLOY_METADATA_SECRETS[@]}"; do
    gcloud secrets remove-iam-policy-binding "$secret" --project="$PROJECT" --member="serviceAccount:$DEPLOY_EMAIL" --role=roles/secretmanager.viewer --quiet >/dev/null 2>&1 || true
  done
  for role in "${DEPLOY_PROJECT_ROLES[@]}"; do
    gcloud projects remove-iam-policy-binding "$PROJECT" --member="serviceAccount:$DEPLOY_EMAIL" --role="$role" --all --quiet >/dev/null 2>&1 || true
  done
  for role in roles/run.developer roles/run.invoker; do
    gcloud run services remove-iam-policy-binding "$SERVICE" --project="$PROJECT" --region="$REGION" --member="serviceAccount:$DEPLOY_EMAIL" --role="$role" --quiet >/dev/null 2>&1 || true
  done
  gcloud iam service-accounts remove-iam-policy-binding "$RUNTIME_SA" --project="$PROJECT" --member="serviceAccount:$DEPLOY_EMAIL" --role=roles/iam.serviceAccountUser --quiet >/dev/null 2>&1 || true
  gcloud artifacts repositories remove-iam-policy-binding "$AR_REPO" --project="$PROJECT" --location="$REGION" --member="serviceAccount:$DEPLOY_EMAIL" --role=roles/artifactregistry.reader --quiet >/dev/null 2>&1 || true
  gcloud storage buckets remove-iam-policy-binding "gs://${PROJECT}_cloudbuild" --member="serviceAccount:$DEPLOY_EMAIL" --role=roles/storage.objectAdmin --quiet >/dev/null 2>&1 || true
  gcloud iam workload-identity-pools providers delete "$PROVIDER" --project="$PROJECT" --location=global --workload-identity-pool="$POOL" --quiet >/dev/null 2>&1 || true
  gcloud iam workload-identity-pools delete "$POOL" --project="$PROJECT" --location=global --quiet >/dev/null 2>&1 || true
  gcloud iam service-accounts delete "$DB_EMAIL" --project="$PROJECT" --quiet >/dev/null 2>&1 || true
  gcloud iam service-accounts delete "$DEPLOY_EMAIL" --project="$PROJECT" --quiet >/dev/null 2>&1 || true
  # Reversible: versions are disabled, never destroyed.
  for v in $(gcloud secrets versions list "$ADMIN_URL_SECRET" --project="$PROJECT" --filter='state=ENABLED' --format='value(name)' 2>/dev/null); do
    gcloud secrets versions disable "$v" --secret="$ADMIN_URL_SECRET" --project="$PROJECT" --quiet >/dev/null 2>&1 || true
  done
  say "ROLLBACK: federación, cuentas y permisos eliminados; versiones de $ADMIN_URL_SECRET deshabilitadas (no destruidas)."
  say "Nota: el pool queda en borrado lógico 30 días; el nombre $POOL no se reutiliza hasta entonces."
}

gcloud config set project "$PROJECT" >/dev/null 2>&1 || true
case "$MODE" in
  plan) say "MODO PLAN: no se cambia nada."; apply_all ;;
  apply) apply_all; say "APPLY: hecho. Ejecuta 'verify' para comprobarlo." ;;
  verify) verify_all ;;
  open-db-window) open_db_window ;;
  close-db-window) close_db_window; say "Ventana DB cerrada." ;;
  rollback) rollback_all ;;
esac
