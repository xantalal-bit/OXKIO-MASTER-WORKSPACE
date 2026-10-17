# OXKIO V3 — ledger: corrección final P1 post-reauditoría — 17/10/2026

Commit local sobre `4c544e7` en la misma rama; sin push, PR, merge, deploy ni activación. Corrige solo los bloqueantes de la reauditoría independiente de `4c544e7` (dictamen FAIL). No se rediseña el ledger: se amplían `memory-store`, `cost-ledger`, `governed-reasoning`, `mission-runtime` y `chat-gateway`.

## P1-1 — guard `.reclaim` huérfano

- El guard sigue la misma regla de evidencia que el lock:
  - abandonado (lease vencido y titular inexistente en este host): se limpia automáticamente;
  - ilegible y más antiguo que un lease: solo con `recover()` (owner o supervisor);
  - de otro host: solo un supervisor, con su lease vencido;
  - vivo: nunca.
- Una instancia de guard obsoleto la limpia un único proceso: el que crea en exclusiva su archivo de reclamación `<guard>-<hash>.won`, con el hash de su id o, si está corrupto, de su mtime y tamaño. Los perdedores no tocan el guard, así que nunca mueven el guard nuevo del ganador. Los `.won` se conservan (uno por incidente) para que un perdedor tardío no pueda reclamar la misma instancia.
- Con el guard ya tomado, el lock se vuelve a evaluar: un lock abandonado no puede cambiar mientras se tiene el guard, y el lock nuevo de un escritor vivo nunca se toca.
- Toda eliminación mueve primero el archivo aparte con un rename atómico y solo lo borra si sigue siendo exactamente lo evaluado; si no, lo devuelve intacto (`wx`). Es una red de seguridad: con las dos reglas anteriores ya no hace falta devolverlo.
- Con 4 procesos recuperando a la vez se reprodujeron dos carreras: el robo del guard entre recuperadores y la re-evaluación del lock antes de tomar el guard. Las dos están corregidas: 40/40 repeticiones tras la corrección (antes, 4 fallos de cada 12).
- En Windows, crear un nombre pendiente de borrado da EPERM: `create()` lo trata como ocupado y reintenta, no como error.
- Un `unlink` del guard rechazado (EPERM/EBUSY) ya no propaga ni bloquea: el guard queda abandonado y se limpia por evidencia al vencer su lease.
- `recover()` ya no elimina un lock ilegible reciente (puede estar escribiéndose).

## P2 — PID reutilizado

- Un titular que espera dentro de una transacción async renueva su lease cada lease/3. Un lease vencido de este host es, por tanto, evidencia de que quien tiene ese PID no es el titular.
- `recover({decidedBy:'supervisor', lockId, evidenceRef})` libera un lock con PID vivo solo si se cumplen todas estas condiciones:
  - el lock nombrado es exactamente el inspeccionado;
  - hay código de evidencia;
  - el lease venció hace más de un lease completo;
  - no es un lock que este proceso mantiene.
- Nunca es automático y nunca lo puede hacer el owner.

## P1-2 — ACCEPTED_FINAL (doble pago tras settled)

- El verificador determinista se ejecuta antes del settle. `settle(..., { accepted: true })` escribe, en la misma transacción, el cargo y la marca `ACCEPTED_FINAL` del paso (mission + task/fase) en el registro `cost-mission` de la misión.
  - No hay ningún estado intermedio en que exista uno sin el otro.
  - El registro no se compacta, no depende de día ni de mes y es compartido por todos los modelos del paso.
- `reserve` y `claimCall` sobre un paso aceptado responden `step_already_accepted` (no transitorio, ni presupuesto ni reconciliación). El reasoner lo propaga como `STEP_ALREADY_ACCEPTED` sin failover.
- `step(handle, {missionId, scopeKey})` distingue `ACCEPTED_FINAL`, `CALL_UNKNOWN`, `SETTLED_BUT_NOT_ACCEPTED`, `NOT_EXECUTED` y `NONE`.
- Reintentos que se mantienen: INVALID_OUTPUT, rate limit y rechazo definitivo quedan como `SETTLED_BUT_NOT_ACCEPTED` y permiten un intento nuevo.
- `reopenStep` (owner/supervisor, con evidencia) permite un intento nuevo explícito. No está en la vista de gasto del reasoner.
- El `responseId` no es la clave: la clave es el paso.

## P1-3 — checkpoint inmediato post-aceptación

- `synthesize` guarda el análisis aceptado como `step-result` en el store sellado del owner justo después del settle aceptado, sin esperar al final del run. Se guarda junto con el digest exacto de la petición.
- Una reejecución del mismo paso con la misma petición lo reutiliza (`COGNITION_REUSED`) y no llama a ningún modelo.
- Si no hay checkpoint coincidente para un paso aceptado, el ledger lo rechaza. La misión queda `BLOCKED` / `step_already_accepted` / `HUMAN_REVIEW`, con un mensaje propio. Falla cerrado.
- Los checkpoints de una misión terminal se borran.
- Fronteras de crash, probadas con un proceso real que muere (`process.exit`) y se reanuda tras reiniciar:

| Frontera | Resultado tras reanudar | Llamadas nuevas | Cargos nuevos |
|---|---|---|---|
| antes del settle | `BLOCKED` / `call_reconciliation_required` | 0 | — |
| tras settle no aceptado | reintento legítimo, `COMPLETED` | 1 | 1 |
| tras settle + aceptación | `BLOCKED` / `step_already_accepted` | 0 | 0 |
| tras checkpoint | `COMPLETED` (resultado reutilizado) | 0 | 0 |

  La frontera "tras settle antes del veredicto" no existe: son una sola transacción.

## Sin cambios en este commit (documentado)

- **Sobrecargo:** sigue siendo `ledger_reconciliation_required`, que no es un error de presupuesto. Bloquea a todo el owner hasta `clearOvercharge`, para el que no hay superficie operativa (ni HTTP ni herramienta).
- **`cost-mission`:** crece una fila por misión pagada, más las marcas de sus pasos. Compactarlo exige saber qué misiones no volverán a ejecutarse, y las marcas `ACCEPTED_FINAL` de misiones reanudables deben seguir. Queda para la siguiente fase.
- **Pasos de planificación** (`planning`, `decision`): su scope es por turno (un `missionId` nuevo en cada turno). `objective-replan` de una misión reanudada recibe `step_already_accepted` y no amplía el plan: no hay llamada repetida.

## Límites

- PostgreSQL real/RLS, Node 22/CI y almacenamiento compartido/sincronizado: sin probar.
- Los archivos `.won` no se limpian (uno por incidente de guard obsoleto, bytes vacíos).
- La evidencia de "titular inexistente" depende de que el PID sea local (mismo host). En almacenamiento compartido entre hosts solo actúa el supervisor.
- Un envoltorio de `spend` que no reenvíe el tercer argumento de `settle` pierde la marca. Las rutas de producción (`spendFor` y el planner) lo reenvían, y las pruebas de crash usan la composición real.
