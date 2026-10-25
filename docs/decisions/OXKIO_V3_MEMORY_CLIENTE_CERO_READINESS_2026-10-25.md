# OXKIO V3 — Puerta de activación de memoria PostgreSQL / Cliente Cero
Fecha de auditoría: 2026-10-25. Estado: **preparación aislada, SIN activación**.

## Evidencia real

- `main` verificado: `78bb888cfbe24636b205f1ded0fac20f90e7bbba` (PR #62).
- `backend/services/supervised-operation/postgres-memory-store.js`: adaptador existente, con aislamiento por tenant/cliente/usuario y HMAC.
- `backend/services/supervised-operation/v3-memory-runtime-config.js`: selector opt-in existente; `local` por defecto, secreto V3 dedicado, validación de TLS para host remoto.
- `backend/services/supervised-operation/server-composition.js`: acepta `memoryBackend` y `postgresMemoryConnection`.
- **Brecha verificable:** `backend/api/server.js` llama a `createServerComposition` sin trasladar `v3MemoryRuntimeOptions`. Por tanto la selección Postgres aún no llega al arranque HTTP. **NO afirmar memoria PostgreSQL activa**.
- Neon consultado directamente en modo solo lectura, proyecto `soft-firefly-27737112`, rama `production` `br-lucky-feather-b2sm5lex`, base `neondb`. Tablas visibles: `oxkio.approval_items`, `oxkio.mission_confirmations`, `oxkio.missions` y `public.playing_with_neon`. **No aparece** `oxkio_v3.memory_snapshots`: migración `006_v3_memory_snapshots.sql` no desplegada allí.
- Las pruebas del adaptador, incluida `postgres-memory-store.pg.test.js`, usan runner PostgreSQL local aislado: no prueban por sí mismas el servicio en línea.

## Secuencia mínima autorizable

1. **Código aislado:** conectar el selector existente al punto de composición de `backend/api/server.js` mediante cauce de edición autorizado; no buscar vías alternativas para eludir un bloqueo de seguridad del conector. En modo `local` todo permanece exactamente como antes.
2. **Pruebas:** cubrir modo desactivado, local por defecto, Postgres solo opt-in, ausencia de secreto, TLS obligatorio, retorno controlado a local, aislamiento entre usuarios y persistencia tras recomposición/reinicio. CI verde, revisión independiente y sin secretos en logs.
3. **Base aislada:** preparar/ensayar `006_v3_memory_snapshots.sql` en una rama efímera de pruebas, bajo límites de gasto previamente autorizados. Dedicación de rol de runtime con privilegios mínimos `CONNECT`, `USAGE`, `SELECT/INSERT/UPDATE`, sin BYPASSRLS ni privilegios de propietario; política RLS y sello HMAC probados. No reutilizar la cuenta Approval, su privilegio de backup o credenciales de propietario.
4. **Puerta humana antes de efectos reales:** aprobación específica para migración/roles/secretos/IAM, gastos nuevos si los hubiera y despliegue. Nada de esto se desprende de autorizar una rama o PR.
5. **Prueba Cliente Cero real:** con un identificador sintético sin datos personales, escribir y recuperar nota; reiniciar servidor; recuperar la misma nota; demostrar que otra identidad no la ve; auditar permisos y rollback. No declarar éxito sin evidencia HTTP/DB y test independiente.
6. **Acceso remoto:** comprobar dominio privado, autenticación Firebase, HTTPS, cuotas y costes, antes de abrir a otros usuarios o a familia.

## Puertas y estado

| Elemento | Estado al 25-10 |
| --- | --- |
| Adaptador/migración/selector en repositorio | HECHO |
| Integración selector en `backend/api/server.js` | PENDIENTE / edición anteriormente bloqueada |
| PR/cambios de este documento | SOLO PREPARACIÓN |
| Migración 006 en Neon | NO APLICADA |
| Cuenta/secretos dedicados V3 reales | NO VERIFICADOS |
| Servicio Cliente Cero móvil en nube | NO VERIFICADO |
| Despliegue/producción | NO AUTORIZADO EN ESTA FASE |

Este documento es una lista de verificación del trabajo ya creado, **no** una orden para ejecutarlo ni un sistema paralelo. Fuente canónica de decisiones y continuidad: Registro Maestro XANTALAL en Google Drive.
