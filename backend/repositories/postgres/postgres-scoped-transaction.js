'use strict';

async function runPostgresScopedTransaction({
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
  let discard = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [scope.tenantId]);
    await client.query("SELECT set_config('app.user_id', $1, true)", [scope.userId]);
    await client.query("SELECT set_config('app.client_id', $1, true)", [scope.clientId]);
    const result = await operation(client, scope);
    committing = true;
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (committing) { discard = true; throw commitUnknownError(); }
    // A failed BEGIN leaves the session state unknown (it may even have
    // opened a transaction): that connection never goes back to the pool.
    if (!transactionStarted) discard = true;
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch {
        discard = true;
        // Preserve the sanitized failure and discard the connection.
      }
    }
    throw sanitizeError(error);
  } finally {
    if (client && typeof client.release === 'function') client.release(discard ? true : undefined);
  }
}

module.exports = {
  runPostgresScopedTransaction,
};
