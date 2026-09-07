# OXKIO — Staging Cloud Run (5C.7B.4C)

Este directorio contiene la configuracion declarativa preparada para el
primer staging Cloud Run de OXKIO. **Nada de lo descrito aqui ha sido
aplicado a Google Cloud.** No se ha creado ningun recurso, no se ha invocado
`gcloud`, no se ha leido ni escrito ningun secreto real, y no se ha
desplegado ninguna imagen.

## Artefacto elegido y por que

Se preparo un unico manifiesto declarativo (`service.staging.yaml`, formato
Cloud Run / Knative Service v1) en lugar de un script `gcloud run deploy`
imperativo, porque:

- es versionable y diffable en Git (auditable commit a commit);
- no requiere ejecutar nada para ser revisado — `gcloud run services
  replace` es idempotente sobre su contenido cuando llegue el momento;
- no materializa secretos: el unico valor sensible (`OXKIO_APPROVAL_PG_RUNTIME_URL`)
  se referencia via `secretKeyRef`, nunca como valor literal;
- evita un segundo mecanismo paralelo (no existia ningun `cloudbuild.yaml`,
  workflow de GitHub Actions ni script de deploy previo en el repo).

El formato Knative Service **si representa** la region (etiqueta
`cloud.googleapis.com/location`) — correccion respecto a una version
anterior de este documento que afirmaba lo contrario. El secreto de Approval
se referencia con el mecanismo **same-project**: `secretKeyRef.name` apunta
directamente al nombre del secreto, sin necesidad de la anotacion
`run.googleapis.com/secrets` (esa anotacion sirve para definir alias,
sobre todo cuando el secreto vive en otro proyecto — ver seccion
"Secret Manager" mas abajo). La unica decision del contrato que el formato
**no puede representar dentro del YAML** es la politica IAM de invocacion
publica (`roles/run.invoker`), que se documenta mas abajo como paso futuro
explicitamente NO ejecutado.

## Lo que el YAML representa

| Campo del contrato | Representado como |
|---|---|
| `PROJECT=oxkio-runtime-prod` | comentario de cabecera; se pasa como `--project` en el comando futuro de despliegue (la API Knative no declara el project number dentro del YAML) |
| `REGION=europe-west3` | `metadata.labels["cloud.googleapis.com/location"]` — ver seccion "Region" mas abajo sobre su alcance real |
| `SERVICE_ACCOUNT` | `spec.template.spec.serviceAccountName` |
| `MIN_INSTANCES=0` / `MAX_INSTANCES=1` | anotaciones `autoscaling.knative.dev/minScale` / `maxScale` |
| `CONCURRENCY=1` | `spec.template.spec.containerConcurrency` |
| `CPU=1` / `MEMORY=512Mi` | `resources.limits` del contenedor |
| `HEALTH=/health`, `READY=/ready` | ya publicos en el codigo (`backend/runtime/cloud-ready-contract.js`); no se anadio `startupProbe`/`livenessProbe` en el YAML porque sus parametros (intervalos, umbrales) no son una decision ya tomada — ver Limitaciones |
| `APPROVAL_BACKEND_REAL_STAGING=postgres` | env `OXKIO_APPROVAL_REPOSITORY_BACKEND=postgres` |
| `PLATFORM_INVOCATION=publico` (ingress) | anotacion `run.googleapis.com/ingress: all` |
| `APPLICATION_AUTH=Firebase Bearer /api/*` | ya implementado en `backend/security/firebase-server-auth.js`; sin cambio de codigo |

## Region

`metadata.labels["cloud.googleapis.com/location"] = europe-west3` es la
forma real en que Cloud Run representa la region dentro de un Service YAML
(visible en `gcloud run services describe --format export` de cualquier
servicio ya desplegado). Esta etiqueta **es descriptiva**, no sustituye el
flag de la API: la API Admin de Cloud Run es regional (`REGION-run.googleapis.com`),
y `gcloud run services replace` sigue necesitando `--region` para saber a
que endpoint dirigir la peticion. El paso futuro, **no ejecutado**, sigue
siendo:

```
gcloud run services replace deploy/cloud-run/service.staging.yaml \
  --region=europe-west3 \
  --project=oxkio-runtime-prod
```

## IAM invoker: no representable en el YAML, y no es lo mismo que ingress

`run.googleapis.com/ingress: all` (presente en el YAML) solo controla desde
donde puede *llegar* trafico a nivel de plataforma. **No concede invocacion
no autenticada.** Esa es una politica IAM separada (`roles/run.invoker`)
que Cloud Run gestiona fuera del cuerpo del Knative Service. El paso futuro,
**no ejecutado**, seria:

```
gcloud run services add-iam-policy-binding oxkio-api-staging \
  --region=europe-west3 \
  --project=oxkio-runtime-prod \
  --member="allUsers" \
  --role="roles/run.invoker"
```

Esto haria el servicio invocable sin autenticacion de plataforma — la
autenticacion real de `/api/*` la sigue exigiendo la aplicacion (Firebase
Bearer), no Cloud Run. `/health` y `/ready` quedarian accesibles sin
autenticacion de plataforma ni de aplicacion, tal como exige el contrato.

## Variables de entorno

Derivadas de `backend/config/environment-contract.js` (fuente canonica en
codigo; se detecto una tabla mas antigua en
`XANTALAL/00_GOVERNANCE/5C.7B-ARQUITECTURA-EJECUTABLE-RUNTIME.md` que
clasifica `OXKIO_ADMIN_FIREBASE_UIDS` como `secret` — el codigo actual la
declara `sensitive_config`, no `secret`; se sigue el codigo como fuente de
verdad y se deja constancia de la discrepancia documental).

**NON_SECRET_ENV** (env plano en el YAML):
- `FIREBASE_PROJECT_ID=oxkio-9af40`
- `GOOGLE_CLOUD_PROJECT=oxkio-runtime-prod`
- `OXKIO_APPROVAL_REPOSITORY_BACKEND=postgres`
- `OXKIO_ADMIN_FIREBASE_UIDS=REPLACE_WITH_ADMIN_FIREBASE_UID` (placeholder;
  sensitive_config segun el codigo, no secret — pero es una identidad real
  de persona, por lo que se deja como placeholder explicito en vez de
  inventar un valor)

**SECRET_REFS** (via `secretKeyRef`, nunca literal):
- `OXKIO_APPROVAL_PG_RUNTIME_URL` → secreto ya materializado en Secret
  Manager (`oxkio-runtime-prod`), IAM ya concedido (5C.7B.3A, Puertas A/B).
  Referenciado con el mecanismo same-project (ver seccion "Secret Manager").
  `secretKeyRef.key` se mantiene en `latest` (ver seccion "Version del
  secreto").

## Secret Manager

`SAME_PROJECT_SECRET_MODEL`: el servicio de Cloud Run (`oxkio-runtime-prod`)
y el secreto `OXKIO_APPROVAL_PG_RUNTIME_URL` (Secret Manager, tambien
`oxkio-runtime-prod`) viven en el **mismo proyecto GCP**. Segun la
referencia oficial de `SecretKeySelector` de Cloud Run, cuando el secreto
esta en el mismo proyecto, `secretKeyRef.name` puede contener directamente
el nombre del secreto — no hace falta la anotacion `run.googleapis.com/secrets`.
Esa anotacion existe para definir un alias, sobre todo cuando el secreto
vive en **otro** proyecto, en cuyo caso su forma documentada es
`ALIAS:projects/PROJECT_NUMBER/secrets/SECRET_NAME`. Como PG-APR no esta en
otro proyecto, no se necesita esa anotacion ni, por tanto, resolver o
inventar ningun `PROJECT_NUMBER`.

Si en el futuro el secreto pasara a vivir en un proyecto distinto del
servicio, entonces si haria falta declarar `run.googleapis.com/secrets` con
la forma `ALIAS:projects/PROJECT_NUMBER/secrets/SECRET_NAME` — resolver ese
`PROJECT_NUMBER` real quedaria fuera de 4C.

### Version del secreto

`SECRET_VERSION_CURRENT = latest`. `PINNED_SECRET_VERSION_AVAILABLE_OFFLINE = YES`:
5C.7B.3A documenta que `OXKIO_APPROVAL_PG_RUNTIME_URL` tiene su Version 1
habilitada. Que este staging deba fijar `key: "1"` en vez de `key: "latest"`
es una decision de politica de rotacion (latest sigue automaticamente
futuras versiones; una version fijada no) que corresponde a Direccion, no
a esta correccion tecnica. Queda como punto explicito a resolver antes de
cualquier despliegue real, potencialmente en 4D.

**PLATFORM_INJECTED** (no se declaran en el YAML):
- `PORT` — Cloud Run lo inyecta (por defecto 8080 si no se declara
  `containerPort`; el codigo lee `process.env.PORT` dinamicamente, asi que
  se omite `ports:` deliberadamente para no fijar un valor sin necesidad
  tecnica demostrada)
- `K_SERVICE`, `K_REVISION`, `K_CONFIGURATION` — reservadas de Cloud Run,
  no forman parte del contrato de OXKIO

**NOT_INCLUDED** (deliberadamente fuera de este staging, con motivo):
- `NODE_ENV` — ya fijado en `Dockerfile` (`ENV NODE_ENV=production`); no se
  duplica a nivel de servicio para no tener dos fuentes de verdad
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` —
  `GMAIL_CALENDAR_REMOTE=NO` en este staging; no se ejercitan
- `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `GOOGLE_APPLICATION_CREDENTIALS` —
  se usa ADC (identidad de la Cloud Run service account), sin clave
  descargada, segun decision ya registrada en 5C.7B.3A (fila FB-ADM-KEY)
- `OXKIO_ADMIN_FIREBASE_EMAILS` — optional, no requerida
- `OPENAI_API_KEY` — scope `simulator`, fuera del runtime oficial
- `OXKIO_MISSION_PG_RUNTIME_URL`, `OXKIO_MISSION_PG_ADMIN_URL` — persistencia
  Mission, no Approval; este staging solo ejercita Approval
- `XANTALAL_ROOT`, `KNOWLEDGE_DISCOVERY_ROOT` — `local_only`, sin sentido en
  Cloud Run
- `OXKIO_FILESYSTEM_MODE` — invariante de codigo (`ephemeral` por defecto),
  no requiere fijarse explicitamente

## Firebase Admin: modelo ADC

`createFirebaseAdminVerifier` (`backend/security/firebase-server-auth.js`)
activa el modo ADC cuando `FIREBASE_PROJECT_ID` y (`GOOGLE_APPLICATION_CREDENTIALS`
o `GOOGLE_CLOUD_PROJECT`) estan presentes, sin `FIREBASE_CLIENT_EMAIL` ni
`FIREBASE_PRIVATE_KEY`. Con `GOOGLE_CLOUD_PROJECT=oxkio-runtime-prod`
presente, usa `admin.credential.applicationDefault()` — que en Cloud Run
resuelve a la identidad de la propia service account via el servidor de
metadatos, sin clave descargada — y fija explicitamente
`projectId=oxkio-9af40` (proyecto Firebase) al inicializar la app admin.

**Limitacion no resuelta por este cambio:** no hay evidencia documental
(`5C.7B.3A`, fila FB-ADM-CFG: "modo real no demostrado") de que la service
account `oxkio-runtime-prod@oxkio-runtime-prod.iam.gserviceaccount.com`
tenga concedido un rol de Firebase/Identity Platform sobre el proyecto
`oxkio-9af40` (proyecto distinto del proyecto GCP de la propia cuenta de
servicio). Sin ese binding entre proyectos, la verificacion de tokens
Firebase fallaria en runtime real aunque el arranque del proceso no lo
detecte (el arranque solo exige *presencia* de las variables, no verifica
conectividad real). Esto se traslada como riesgo/limitacion, no se resuelve
en 4C.

## Rollback

`ROLLBACK_SCOPE`: unicamente revision/configuracion de este servicio Cloud
Run (p. ej. `gcloud run services update-traffic` hacia una revision
anterior, o reversion de este YAML). Nunca implica volver el backend de
Approval de `postgres` a `json` — ese cambio esta **PROHIBIDO sin
reconciliacion explicita** de datos entre ambos backends, y requeriria una
decision humana separada, documentada aparte. Ningun comando de rollback se
documenta como automatico; cualquier rollback exige puerta humana explicita.

## Riesgos fuera de alcance de 4C (no tocados)

- CORS `Access-Control-Allow-Origin: "*"` en `backend/api/server.js:234`
  permanece sin modificar.
- La misma service account tiene IAM heredado para leer tambien
  `OXKIO_MISSION_PG_RUNTIME_URL` (PG-RUN), aunque este staging no lo
  consume.
- `npm audit`: 7 moderate / 1 high conocidos, sin cambios.
- Los stores JSON locales (memory, executiveAgenda, projectRegistry, etc.)
  siguen sin migrar; impiden escalado horizontal real aunque
  `MAX_INSTANCES=1` lo hace irrelevante para este staging concreto.
