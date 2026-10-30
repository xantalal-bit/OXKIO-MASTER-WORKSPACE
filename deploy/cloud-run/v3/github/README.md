# OXKIO V3 — ejecución en la nube con GitHub Actions + Workload Identity Federation

Objetivo: que la conexión a Neon, el aprovisionamiento de `oxkio_v3_runtime` y la
revisión privada de Cloud Run se ejecuten sin ningún ordenador encendido, con
aprobación humana en cada operación sensible y sin claves de cuentas de servicio.

**Estado de esta PR: solo preparación.** Nada de esto se ha ejecutado; no se ha
concedido IAM, no se ha activado LOGIN, no se ha desplegado ni cambiado la
exposición de Cloud Run.

## Fases (separadas y con puertas distintas)

| Fase | Dónde | Qué hace | Puerta humana |
|---|---|---|---|
| 0. Configuración única | Cloud Shell (owner) | `setup-github-wif.sh apply`: federación, 2 cuentas sin claves, permisos, URL admin de Neon en Secret Manager, ventana DB temporal | La ejecuta el owner |
| 1. PostgreSQL | `oxkio-v3-db.yml` (ubuntu) | `preflight` (solo lectura) o `provision-resume` (reutiliza `provision-v3-pg-secret.js --execute --resume --plaintext-tls`) | Aprobación del entorno `oxkio-v3-db` + frase `ACTIVAR-LOGIN-oxkio_v3_runtime` + ventana DB abierta |
| 2. Revisión privada | `oxkio-v3-deploy.yml` (windows) | `check-real`, `private-revision` (pasos 0–3 de `Invoke-OxkioV3CloudRevision.ps1 -Variant Real` + prueba privada automática), `remove-tag` | Aprobación del entorno `oxkio-v3-deploy` + frase |
| 3. Acceso por Internet | **No incluido en esta PR** | `allUsers` como invoker y paso de tráfico, tras la prueba del owner | Decisión expresa; la cuenta de despliegue no puede hacerlo (sin `setIamPolicy`) |

## Fase 0 — una sola operación en Cloud Shell

```bash
git clone https://github.com/xantalal-bit/OXKIO-MASTER-WORKSPACE && cd OXKIO-MASTER-WORKSPACE
bash deploy/cloud-run/v3/github/setup-github-wif.sh plan      # muestra cada cambio, no cambia nada
bash deploy/cloud-run/v3/github/setup-github-wif.sh apply     # pide la URL admin de Neon con entrada oculta
bash deploy/cloud-run/v3/github/setup-github-wif.sh verify    # PASS/FAIL por elemento
```

- La URL admin de Neon se pide con `read -s` solo si `OXKIO_V3_PG_ADMIN_URL` no
  tiene versión habilitada, se valida su forma sin mostrarla y viaja a Secret
  Manager por stdin. Nunca está en argumentos, historial ni salida.
- `plan` y `verify` solo leen: no cambian ni la configuración local de `gcloud`
  (cada llamada lleva `--project`).
- **Propiedad.** Todo lo que crea el script lleva la marca `oxkio-setup-github-wif`
  (descripción de cuentas, pool y proveedor; etiqueta del secreto) y las versiones
  de `OXKIO_V3_PG_ADMIN_URL` que añade quedan anotadas en `oxkio-setup-versions`.
  Antes del primer cambio, `apply` comprueba la propiedad de pool, proveedor y
  cuentas: si alguno ya existe sin la marca, se detiene (código 68) sin modificar
  nada. Una versión de la URL admin que ya existía no se sobrescribe ni pasa a ser propia.
- `apply` es idempotente sobre sus propios recursos. `rollback` (pide escribir
  `REVERTIR`) revierte solo lo propio: permisos y cuentas marcadas, proveedor y
  pool marcados, y deshabilita (sin destruir) solo las versiones anotadas. Las
  APIs habilitadas se dejan como están.
- `verify` falla si no hay una ventana DB vigente (≤ 24 h y sin caducar), si la
  cuenta DB tiene cualquier permiso fuera de sus 3 concesiones condicionadas, si
  la cuenta de despliegue puede leer el valor de algún secreto o tiene roles de
  más, si el servicio tiene `allUsers`, o si en GitHub faltan los entornos con
  revisor obligatorio y solo `main`, las variables o el secreto del UID (lo lee
  con `gh`; sin `gh auth login` el apartado GitHub falla).

Después, en GitHub (Settings), sin secretos salvo el UID:

1. Entornos `oxkio-v3-db` y `oxkio-v3-deploy`: *Required reviewers* = `xantalal-bit`
   (sin "prevent self-review", para que José pueda aprobar sus propias ejecuciones),
   *Deployment branches* = solo `main`. Los workflows comprueban ambas cosas y
   se niegan a ejecutar si faltan.
2. Variables de repositorio (las imprime `apply`): `OXKIO_GCP_WIF_PROVIDER`,
   `OXKIO_GCP_DB_SA`, `OXKIO_GCP_DEPLOY_SA`.
3. Entorno `oxkio-v3-deploy`: variable `OXKIO_V3_PG_HOST` (host del endpoint Neon)
   y secreto `OXKIO_V3_OWNER_UID`.

## Federación: quién puede obtener credenciales

Condición del proveedor OIDC (comprobada literalmente por `verify`):

- `repository_id == 1239701981` y `repository_owner_id == 273384467` (inmutables:
  un repositorio renombrado o recreado con el mismo nombre no entra);
- `ref == refs/heads/main` y `event_name == workflow_dispatch`;
- par exacto entorno + fichero de workflow: `oxkio-v3-db` solo desde
  `oxkio-v3-db.yml@refs/heads/main`, `oxkio-v3-deploy` solo desde `oxkio-v3-deploy.yml@refs/heads/main`.

Cada cuenta de servicio solo es suplantable desde su entorno
(`principalSet://…/attribute.environment/<entorno>`). Ninguna tiene claves.

## Permisos mínimos

**`oxkio-gha-db`** — ningún rol de proyecto. Solo durante la ventana DB (condición
`request.time < timestamp(...)`, 4 h por defecto, máximo 24 h):

| Recurso | Rol | Por qué |
|---|---|---|
| `OXKIO_V3_PG_ADMIN_URL` | `secretAccessor` | Conexión admin del preflight y del aprovisionamiento |
| `OXKIO_V3_PG_PASSWORD` | `secretAccessor` + `viewer` | `--resume` lee la versión 1 y comprueba que el secreto existe |

`open-db-window --hours N` abre una ventana nueva (elimina antes las anteriores);
`close-db-window` la cierra en el acto. Fuera de la ventana, la federación sigue
existiendo pero la cuenta no puede leer ningún secreto.

**`oxkio-gha-deploy`** — nunca accede al valor de ningún secreto ni a la URL admin:

| Recurso | Rol | Por qué |
|---|---|---|
| Servicio `oxkio-api-staging` | `run.developer` | ReplaceService de la revisión con 0 % de tráfico (sin `setIamPolicy`) |
| Servicio `oxkio-api-staging` | `run.invoker` | Prueba privada automática sobre la URL etiquetada |
| SA `oxkio-runtime-prod` | `iam.serviceAccountUser` | La revisión se ejecuta con la cuenta de runtime existente |
| Artifact Registry `oxkio-staging` | `artifactregistry.reader` | Verificar el digest construido |
| Bucket `oxkio-runtime-prod_cloudbuild` | `storage.objectAdmin` | Subida del contexto de `gcloud builds submit` |
| Proyecto | `cloudbuild.builds.editor`, `serviceusage.serviceUsageConsumer` | Build del commit exacto |
| Proyecto | `run.viewer`, `iam.securityReviewer`, `logging.viewer` | Lecturas de estado, IAM e invariantes que ya hace el script; logs de la revisión |
| 7 secretos usados por el runtime | `secretmanager.viewer` | Metadatos y versiones (no el valor), como exige `Read-CloudState`/`CheckReal` |

## Logs públicos: medidas que no dependen del enmascaramiento

- La URL admin solo existe en memoria del proceso Node que la lee de Secret
  Manager (`scripts/client-zero/run-v3-db-operation.js`) y en el entorno del
  proceso hijo; nunca en argumentos, shell, `$GITHUB_ENV` ni salida.
- La salida de los hijos se reemite solo si encaja en la forma saneada esperada;
  stderr nunca se reenvía.
- El wrapper de Cloud Run publica solo un resumen con formas cerradas (estados,
  nombres de revisión, digests, booleanos); `Env`, el UID del owner, IAM y el
  export del servicio se descartan siempre. La evidencia completa se queda en el
  directorio temporal del runner, que se destruye al terminar.
- Ningún `run:` interpola `${{ }}`: entradas y secretos llegan solo por `env`
  (sin inyección de scripts). Sin artefactos, sin `set -x`, sin modo debug.

## Diferencias del camino CI frente al procedimiento manual de la PR #71

- Los pasos 0–3 se ejecutan en el mismo job: el snapshot DPAPI del paso 0 solo
  existe en ese runner. Si algo falla desde el paso 3, `Invoke-Rollback` restaura
  la plantilla y el tráfico originales antes de terminar.
- El paso 4 (prueba humana con attestation vía proxy local) se sustituye por una
  prueba automática: sin token IAM → 403; con token IAM `/health` y `/ready` → 200;
  `/api/status` y el chat sin token Firebase → 401; logs con
  `V3: enabled for cohort` y sin 5xx. La prueba funcional del owner con su sesión
  Firebase se hace en la fase 3 sobre la URL etiquetada, antes de mover tráfico.
- Reversión de la fase 2 en cualquier momento: `remove-tag` (tráfico 100 % a
  `00018-9xl`, sin etiquetas). La revisión real queda sin tráfico.

## Auditoría Firebase previa a cualquier `allUsers` (fase 3)

`backend/api/server-anonymous-exposure.test.js` arranca el servidor real y,
leyendo las rutas del código en cada ejecución:

- toda ruta `/api/*` y `/oauth/google` pasa por `authenticateFirebaseRequest`
  (puerta única en `server.js`): GET/POST anónimos, con `Bearer` falso o con
  `Basic` → 401/403/503 sin datos (405 previo solo en `/api/approve` y
  `/api/execute-approved`); se cubren barra final y query string;
- variantes de ruta (`//api`, mayúsculas, `%61pi`, `..`, rutas codificadas) no dan 200 con datos;
- cualquier ruta nueva fuera de `/api/` hace fallar la prueba hasta que se
  revise y se añada a `PUBLIC_ROUTES` con su motivo;
- las rutas públicas (interfaz estática, PWA, módulos de cliente en lista
  blanca, `/app/release.json`, `/health`, `/ready`) no sirven claves, URLs de
  conexión ni tokens; `/oauth/google/callback` sin un `state` emitido a Cliente
  Cero responde 403.

La autorización es por lista blanca (`OXKIO_ADMIN_FIREBASE_UIDS/EMAILS`, familia
aparte, vacía por defecto): un token Firebase válido de otra persona recibe 403
(`backend/security/executive-authorization.test.js`).

Riesgos residuales que la fase 3 debe asumir o mitigar expresamente:

- con `allUsers`, cualquiera puede generar peticiones y coste: conviene fijar
  `maxScale` y presupuesto antes;
- `Access-Control-Allow-Origin: *` en respuestas JSON (sin cookies, el token va en
  cabecera: no habilita CSRF, pero permite leer respuestas desde cualquier origen
  a quien ya tenga un token);
- una política de organización (*domain restricted sharing*) puede impedir `allUsers`.

## Pendientes explícitos (CI verde no demuestra despliegue)

Las pruebas de esta PR usan `gcloud`/`gh` simulados y procesos locales. Solo una
ejecución real puede demostrar lo siguiente, y hasta entonces sigue **pendiente**:

1. **Permisos reales del primer build.** Si `gcloud builds submit` exige además
   `iam.serviceAccountUser` sobre la cuenta con la que corre Cloud Build, o si el
   bucket `oxkio-runtime-prod_cloudbuild` no existe todavía. `verify` no puede
   saberlo sin lanzar un build.
2. **Autenticación WIF en Windows.** Que `google-github-actions/auth` + `gcloud.cmd`
   funcionen con credenciales federadas en `windows-latest`, incluido
   `gcloud auth print-identity-token --audiences` para la prueba privada (si falla,
   la prueba falla y el job restaura el servicio).
3. **Rollback real.** Ni el `rollback` del script de Cloud Shell ni la
   restauración en el mismo job ni `remove-tag` se han ejecutado contra el proyecto.
4. Las acciones van fijadas por versión mayor (`@v4`, `@v2`), como el CI actual;
   fijarlas por SHA es una mejora posible.
