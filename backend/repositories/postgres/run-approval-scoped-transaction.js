'use strict';

// Hermano de postgres-scoped-transaction.js (Mission Queue), NO una
// modificacion de ese helper. Mission Queue asume scope de 3 partes
// (tenant_id/user_id/client_id); Approval hoy solo tiene client_id — no se
// inventa tenant_id ni user_id para poder reutilizar el helper existente.
async function runApprovalScopedTransaction({
  pool,
  rawScope,
  normalizeScope,
  operation,
  sanitizeError,
  commitUnknownError,
}) {
  const scope = normalizeScope(rawScope);
  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    throw sanitizeError(error);
  }

  let transactionStarted = false;
  let committing = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;
    await client.query("SELECT set_config('app.client_id', $1, true)", [scope.clientId]);
    const result = await operation(client, scope);
    committing = true;
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (committing) throw commitUnknownError();
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original sanitized failure; the connection is released below.
      }
    }
    throw sanitizeError(error);
  } finally {
    if (client && typeof client.release === 'function') client.release();
  }
}

module.exports = {
  runApprovalScopedTransaction,
};
