\set ON_ERROR_STOP on

BEGIN;

-- oxkio.approval_items ya existe (003, aplicada bajo B4.D). Esta migracion NO
-- la recrea, NO cambia su propietario, NO toca sus columnas ni sus indices:
-- corrige EXCLUSIVAMENTE la policy de RLS y anade UN CHECK constraint nuevo.
--
-- Motivo (hallazgo B4.D.1, 21/08/2026, probe funcional real contra Neon):
-- PostgreSQL documenta que un GUC personalizado (p.ej. app.client_id) no
-- existe hasta que algo lo fija por primera vez en la sesion; a partir de esa
-- primera vez, su "valor de reset" es la cadena vacia ''. Por tanto, tras
-- CUALQUIER SET LOCAL/set_config('app.client_id', ..., true) en una sesion
-- -incluida una transaccion que termine en ROLLBACK-, una transaccion
-- POSTERIOR en la MISMA conexion (habitual bajo pooling) que NO vuelva a
-- fijar el scope observa current_setting('app.client_id', true) = '',
-- no NULL. La policy original de 003:
--
--   USING (client_id = current_setting('app.client_id', true))
--
-- compara '' contra client_id con igualdad normal (no UNKNOWN, a diferencia
-- de comparar contra NULL). Si alguna fila tuviera client_id='', una
-- transaccion SIN scope explicito la veria/mutaria igualmente. 003 solo
-- declara client_id NOT NULL (sin CHECK de no-vacio), asi que la base de
-- datos, por si sola, no impedia esa fila -unicamente la capa de aplicacion
-- (normalizeApprovalScope() en postgres-approval-repository.js) lo hacia,
-- lo cual no protege a un consumidor futuro que no pase por ese repositorio.
--
-- Esta migracion cierra el hueco en DOS capas independientes, ninguna de las
-- cuales depende de que la otra sea correcta (defensa en profundidad, mismo
-- criterio ya aplicado en 001/002/003):
--
--   1. Policy: NULLIF(current_setting('app.client_id', true), '') convierte
--      esa lectura de '' en NULL antes de comparar, de modo que la
--      comparacion sea SIEMPRE UNKNOWN (deniega) salvo que el llamador haya
--      fijado explicitamente un client_id no vacio en la transaccion actual.
--   2. Dato: CHECK (btrim(client_id) <> '') impide que exista NINGUNA fila
--      con client_id vacio o compuesto solo de espacios, aunque la policy
--      anterior volviera a fallar por otra via en el futuro.
--
-- Esta migracion NO reabre B4.D ni reescribe su historia: B4.D demostro
-- correctamente que 003 se aplico tal cual estaba auditado (32/32 PASS
-- estructural). El hallazgo es posterior (B4.D.1, prueba funcional real) y
-- se registra aqui como regularizacion evolutiva, no como correccion de 003.
--
-- 003_approval_items.sql NO se modifica, NO se reejecuta, y su hash
-- congelado (45e1b076947fdf9bea2bd8e54d959b105fdf1b24bfb7487a9cd9cb16678b32c2)
-- permanece intacto.
SET LOCAL ROLE oxkio_approval_owner;

-- ALTER POLICY (no DROP+CREATE): PostgreSQL admite cambiar USING/WITH CHECK
-- de una policy existente in place desde hace muchas versiones (muy anterior
-- a los requisitos de OXKIO); conserva el mismo objeto de policy y su OID,
-- reduciendo superficie frente a un DROP POLICY + CREATE POLICY. La forma es,
-- por lo demas, exactamente la misma columna/funcion/key/segundo argumento
-- que 003 -unicamente envueltos en NULLIF-: sin OR, sin valor centinela, sin
-- ningun camino que conceda acceso con el scope ausente o vacio.
ALTER POLICY approval_items_scope_isolation ON oxkio.approval_items
  USING (client_id = NULLIF(current_setting('app.client_id', true), ''))
  WITH CHECK (client_id = NULLIF(current_setting('app.client_id', true), ''));

-- btrim() (no solo ''=''): bloquea tambien ' ', '   ' y cualquier cadena
-- compuesta unicamente de espacios, sin depender de que la aplicacion Node
-- haga trim() antes de escribir -exactamente el mismo criterio que ya evita
-- confiar unicamente en la validacion de aplicacion para esta garantia.
-- La tabla no tiene filas productivas (creada por B4.D, probada por B4.D.1
-- con residuo cero verificado); ADD CONSTRAINT valida de inmediato, sin
-- necesidad de NOT VALID + VALIDATE CONSTRAINT en dos pasos.
ALTER TABLE oxkio.approval_items
  ADD CONSTRAINT approval_items_client_id_nonempty_ck CHECK (btrim(client_id) <> '');

COMMIT;
