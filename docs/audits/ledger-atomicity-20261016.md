# OXKIO V3 — ledger atomicity — 16/10/2026

Dictamen: READY_FOR_AUDIT, exclusivamente para revisión del commit local. No es autorización de activación ni PASS global.

## Recuperación

No se recuperaron bytes de `oxkio-v3-connection-release-hardening-2026-10-16.zip`, `PARTE_TECNICO_2026-10-16_1824.md` ni `TAP_NODE22_2026-10-16_1824.txt` en las rutas accesibles examinadas: .codex, Downloads, Temp, OneDrive/Documentos/XANTALAL y OXKIO-worktrees. La búsqueda tuvo limitaciones iniciales de acceso: no certifica inexistencia en el equipo. No hay SHA256 ni extracción del paquete. No se reutilizó código no recuperado. La rama opcional mission-budget no figura entre las ramas locales del repositorio canónico.

## Rama y base

Rama: `agent/oxkio-v3-ledger-atomicity-fix-20261016`.
Base: `adef97acda33a796a183acfdc77c3a5efe8cd85e`.
Worktree separado dentro del workspace del proyecto. Se creó además un checkout detached de la misma base para contraste; no se modificó main.

## Diseño mínimo

Se amplía el almacén sellado existente; no se crea otro motor. La composición de servidor sigue usando `createMemoryStoreFactory`.

- Reserva, liquidación, claim y registros de coste son async. Todos los escritores del almacén sellado comparten un lock exclusivo por propietario. Cada operación relee el snapshot, verifica sellos, prepara cambios y publica un único snapshot mediante archivo temporal, fsync y rename. No se conservan caches de snapshots entre instancias.
- Día, misión y recibo/token se guardan en la misma transacción. El recibo liquidado se conserva para devolver la misma liquidación sin repetir cargos. Una clave estable identifica misión, tarea/fase y modelo. Decisión y replanificación usan fases distintas, sin alterar sus etiquetas de telemetría.
- Misión/día/mes/proveedor incluyen gasto liquidado y reservas abiertas. Las reservas anteriores siguen contando tras medianoche; la liquidación se registra en el periodo de liquidación y retira la reserva original atómicamente.
- `claimCall` se persiste antes de invocar al proveedor. Un claim existente impide volver a invocar ese token. Fallos de red/resultados ambiguos quedan `call_unknown` y bloquean nuevas llamadas, incluidas las ya reservadas. Sólo rechazos explícitos conocidos permiten otro intento. La prueba de integración del reasoner demuestra una única invocación fake tras fallo y reinicio.
- Un error al publicar el snapshot devuelve `commit_unknown` y conserva el lock, tanto si el rename se aplicó como si no: no hay liberación ni replay automático. Los locks abandonados requieren reconciliación.
- El helper PostgreSQL existente descarta la conexión mediante `release(true)` ante COMMIT incierto o ROLLBACK fallido.
- Las comparaciones monetarias usan unidades enteras de 1e-8 USD con comprobación de rango/precisión. Un sobrecargo real se contabiliza y bloquea llamadas posteriores, incluso reservas previas. No se borra el gasto real.
- Reservas históricas sin recibo requieren reconciliación antes de reservar nuevamente. No se migraron datos del runtime.
- El almacén explícitamente EPHEMERAL conserva su carácter no durable y recibe una transacción síncrona para la composición local y fixtures; no constituye evidencia de persistencia.

## Matriz de aceptación

Archivo: `backend/services/supervised-operation/cost-ledger-atomicity.test.js`.

| Fallo | Prueba | Resultado del parche |
|---|---|---|
| 1. Límite de misión omite reservas | F1 límite con segunda reserva pendiente; identidad estable | PASS |
| 2. Settlement parcial pierde recuperación | F2 fallo inyectado en segunda escritura, rollback, reapertura y liquidación idempotente | PASS |
| 3. Reservas intercaladas pierden updates | F3 dos instancias con barrera determinista y lock compartido | PASS |
| 4. Doble settlement inconsistente | F4 dos liquidaciones concurrentes, un cargo y una llamada | PASS |
| 5. Repetición de llamada incierta | F5 claim durable + prueba reasoner/reinicio, una sola invocación fake | PASS |
| 6. Conexión incierta vuelve al pool | F6 COMMIT y ROLLBACK fallidos, release con descarte | PASS simulado |
| 7. Cambio de periodo oculta gasto | F7 cruce día/mes, límites diarios/proveedor y cargo en periodo coherente | PASS |

Pruebas adicionales: commit aplicado sin acknowledgement, sobrecargo incluyendo reservas previas, precisión insegura y reservas históricas. El contraste de aceptación sobre base falla; algunos casos fallan por ausencia del contrato transaccional/claim nuevo, no son una reproducción idéntica del informe original del auditor, que no se recuperó.

## Verificación y límites

Node local: v24.15.0. No se ejecutó Node 22 ni CI. Se reutilizaron las dependencias locales del repositorio canónico mediante NODE_PATH; no hubo instalación de paquetes.

Las salidas completas se conservan en el paquete local de evidencia del workspace. El temporal de la pasada global final es una carpeta hermana del worktree: los tests de backup rechazan correctamente un destino dentro de su propio repositorio.

No hay URLs aisladas de PostgreSQL de test configuradas en el entorno; no se provisionó DB ni se solicitaron credenciales. Las integraciones PostgreSQL/RLS reales quedan pendientes. Las pruebas de F6 usan un cliente simulado; F3/F4 usan archivos reales y dos instancias con interleaving determinista en un proceso, no concurrencia PostgreSQL ni estrés multiproceso.

## Seguridad, cambios no realizados y riesgos

Privacy Gate, router, configuración de proveedores y executionEnabled no se modificaron. Tests con proveedores fake; ninguna llamada comercial, credencial nueva, gasto, OAuth, IAM, push, PR, merge, deploy, apertura a usuarios, V1-B ni Anthropic. No se activó ni reinició el runtime canónico. Los procesos sintéticos de los tests de Windows son fixtures aislados.

Pendientes antes de activación: auditoría independiente del SHA; PostgreSQL/RLS si corresponde al destino; pruebas en Node/CI de referencia; reconciliación de reservas históricas e incertidumbres. No hay desbloqueo automático ni procedimiento de reconciliación de producción añadido. Un lock abandonado detiene al propietario de forma conservadora. Los recibos crecen hasta el límite existente del almacén; alcanzar capacidad bloquea y requiere política de retención revisada. No se probó pérdida de alimentación ni semántica de almacenamiento sincronizado/compartido. No deben coexistir escritores antiguos que ignoren el lock con la nueva versión.

Siguiente paso: entregar SHA y evidencia a Xatai y al auditor independiente para revisión, sin activar, publicar ni integrar. STOP.

## Resultados finales y archivos

- Foco: 32 tests, 32 PASS, 0 FAIL.
- supervised-operation: 268 tests, 268 PASS, 0 FAIL.
- Global: 1916 tests, 1895 PASS, 5 FAIL, 16 omitidos. No es PASS global. Los cinco fallos se reproducen en el checkout de base: dos hashes congelados de migración 003, un test de terminación mediante Job Object y dos tests del wrapper Windows sobre detección de procesos/puertos. No se tocaron esos archivos.
- Aceptación en base: 16 tests, 0 PASS, 16 FAIL, con la salvedad de contrato descrita arriba.
- `git diff --check`: sin errores.

Archivos de producción cambiados:
1. backend/services/supervised-operation/cost-ledger.js
2. backend/services/supervised-operation/memory-store.js
3. backend/services/supervised-operation/scope-session.js
4. backend/services/supervised-operation/governed-reasoning.js
5. backend/services/supervised-operation/adaptive-planner.js
6. backend/services/supervised-operation/mission-runtime.js
7. backend/repositories/postgres/postgres-scoped-transaction.js

Pruebas nuevas/adaptadas en backend/services/supervised-operation: cost-ledger-atomicity.test.js (nuevo), multiai-runtime.test.js, audit-regressions.test.js, cognitive-continuity.test.js, adaptive-planner.test.js, egress-privacy.test.js, objective-satisfaction.test.js y pending-capability.test.js. Se incluye este informe.

Reproducción local: usar dependencias existentes mediante NODE_PATH, TEMP/TMP en carpeta de pruebas externa al worktree, y `node --test --test-force-exit --test-timeout=60000 --test-concurrency=1` con la lista explícita de archivos `*.test.js`. `--test-force-exit` evita que handles auxiliares mantengan vivo el runner; no convierte aserciones fallidas en aprobadas. Las pruebas de aceptación reinician instancias, no simulan pérdida eléctrica.
