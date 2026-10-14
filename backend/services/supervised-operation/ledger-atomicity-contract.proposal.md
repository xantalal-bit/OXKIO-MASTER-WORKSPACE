# OXKIO V3 — contrato mínimo de ledger transaccional (propuesta, NO activada)
Fecha: 2026-10-14. Estado: DISEÑADO, sin migración ni integración.

## Contexto contrastado
- `backend/services/supervised-operation/cost-ledger.js` hace `reserve` y `settle` síncronos sobre registros sellados. No ofrece atomicidad multiinstancia; la liquidación escribe primero el día y luego la misión.
- `backend/repositories/postgres/postgres-scoped-transaction.js` aporta BEGIN, contexto RLS y COMMIT/ROLLBACK, con `commit_unknown`. **No aporta por sí solo bloqueo de presupuestos**.
- `governed-reasoning.js` invoca al proveedor después de reservar y liquida en `finally`; una liquidación incierta no autoriza repetir la llamada al proveedor.
- Las pruebas SQLite y PostgreSQL simuladas de 14/10 son de aislamiento; no acreditan integración.

## Invariantes para una implementación futura
1. **Cierre por defecto:** el consumo de pago requiere un adaptador que declare y demuestre `reserveAtomic` y `settleIdempotent`; almacenamiento local actual no satisface el contrato multiinstancia.
2. **Un único origen de verdad:** toda reserva, cargo, estado de token y agregado de presupuesto se modifica en una misma transacción de BD; evitar doble contabilidad con los snapshots actuales.
3. **Ámbito:** todas las consultas y claves incluyen `tenant_id`, `user_id`, `client_id`; RLS forzado; ninguna lectura/actualización cruzada.
4. **Reserva:** crear idempotentemente el registro de límites/contador por propietario y periodo, adquirir bloqueo de fila **antes de comprobar** los límites misión/día/mes/proveedor, insertar token único y sumar reservado dentro de la misma transacción. Orden fijo de bloqueos para evitar interbloqueos. No emitir token si COMMIT es incierto hasta conciliarlo.
5. **Liquidación:** token con estado OPEN/SETTLED y cargo fijado; actualizar agregados y estado en la misma transacción. Un reintento del mismo token devuelve el cargo previo, nunca lo suma otra vez. Conflictos de importe o ámbito se rechazan.
6. **Fallos:** ante COMMIT desconocido, consultar el token en transacción nueva antes de continuar; si no se puede conciliar, detener pagos y mantener la reserva conservadoramente. No volver a ejecutar una llamada externa que pudo cobrarse.
7. **Límites:** misión, día, mes, proveedor, llamada, autorización humana y FX revisado deben aplicar a gasto cargado + reservas pendientes. Definir tratamiento de cargo real superior a estimación y bloquear llamadas posteriores.
8. **Unidades:** persistir importes en enteros de micro-USD (o precisión equivalente definida y testeada), no sumar floats para autorizaciones.
9. **Reinicio y concurrencia:** verificar procesos independientes, pérdida de conexión, rollback, idempotencia, cambio de día/mes, segregación y RLS en PostgreSQL de prueba.

## Puertas humanas
Crear rama agent/* y tests está autorizado. Migrar DB real, crear roles, conceder privilegios, cambiar secretos, desplegar o habilitar gasto **requiere aprobación separada de José**.

## Estado de entrega
Documento de diseño; no implica parche funcional, test PostgreSQL real, CI ni autorización de despliegue.
