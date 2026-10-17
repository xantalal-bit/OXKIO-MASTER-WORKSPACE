# OXKIO V3 — ledger: corrección P1 post-reauditoría final (claim `.won` e identidad del titular) — 17/10/2026

Commit local sobre `f39b285` en la misma rama; sin push, PR, merge, deploy ni activación. Corrige solo los dos P1 y el P2 de la reauditoría independiente de `f39b285` (dictamen FAIL). No se rediseña el ledger ni se añaden mecanismos paralelos: cambia `memory-store.js` (lock, guard, claim, `recover`) y sus pruebas.

## P1-1 — un claim `.won` podía bloquear la recuperación para siempre

Causa: el claim era un archivo vacío, de nombre fijo por instancia de guard, y su sola existencia hacía perder a todo recuperador posterior. Si su creador moría antes de mover el guard, nadie podía volver a reclamarlo.

Corrección:

- El claim es `<guard>-<hash de la instancia>.<n>.won` y lleva la identidad de su titular: host, pid, nonce de proceso, hilo, identidad de arranque si el SO la da, y lease.
- Se crea entero: se escribe y sincroniza aparte y se enlaza (`link`, exclusivo). Nunca se ve vacío ni a medias.
- Si el claim `n` está vivo, o su titular puede estarlo, los demás esperan. Si su titular está demostradamente muerto (misma evidencia que un lock), se pasa a la generación `n+1`. Un crash en cualquier frontera converge.
- Con su claim vivo, el titular vuelve a leer el guard exacto (id, o mtime+tamaño si está corrupto) antes de moverlo. Nadie más toca ese guard mientras tanto, así que un guard nuevo nunca se mueve.
- Retención: al terminar, el titular borra los claims de esa instancia. Si mover el guard falló, los claims se conservan y el suyo pasa a ser un claim muerto. Un claim dejado por un crash es inerte (su instancia de guard no se repite) y se barre tras la siguiente recuperación con éxito.
- Un claim ilegible (dañado) nunca se salta automáticamente (`store_recovery_required`). `recover()` lo salta solo si es más antiguo que un lease.
- Un claim de otro host nunca se salta: lo resuelve una revisión externa.
- El `unlink` del guard propio comprueba antes que el guard sigue siendo el propio.

## P1-2 — recuperación por PID reutilizado podía romper un titular vivo

Causa: `recover({decidedBy:'supervisor', lockId, evidenceRef})` liberaba un lock con PID vivo y lease vencido hace más de un lease. Un titular síncrono no renueva el lease, así que el titular real seguía vivo y su snapshot antiguo borraba la escritura del segundo escritor.

Corrección: se elimina esa vía; `lockId` y `evidenceRef` ya no autorizan nada. Un titular se considera muerto solo si se demuestra:

- **PID inexistente** en este host.
- **Mismo PID que este proceso:**
  - si el nonce coincide, ninguna transacción de este proceso tiene ese id;
  - si el nonce es otro y ambos están en el hilo principal, es un proceso anterior que tuvo este PID.

  El nonce es por proceso, compartido entre copias del módulo.
- **PID vivo** con otra identidad de arranque. Solo existe en Linux (`boot_id` + `starttime` de `/proc`), que es exacta e inmune a cambios de reloj.

Todo lo demás se trata como posible titular vivo: PID vivo sin identidad demostrable (Windows), otro hilo, lock heredado sin identidad u otro host. `recover` devuelve `store_lock_live` y nunca recupera automáticamente. Requiere revisión externa: terminar el proceso o, si es ajeno, retirar el lock a mano tras verificarlo.

Un lease vencido no demuestra nada; la transacción síncrona larga no necesita renovar porque nunca caduca falsamente. Un lock de otro host tampoco lo rompe ya un supervisor (antes bastaba con el lease vencido).

## P2 — test de compactación inestable

Diagnóstico A, el test no era determinista; no es un bug:

- con reloj fijo, los 151 recibos tenían el mismo `closedAt`;
- el orden "más antiguo primero" se desempataba por token aleatorio;
- el recibo de la misión quedaba retenido (6 de 151) con una probabilidad de ~4 %.

Corrección: cada recibo cierra 1 ms después (sigue siendo 31/10). La compactación no cambia.

Medición: el test antiguo dio 59/60 y el nuevo 60/60.

## Pruebas (Node v24.15.0, Windows, dependencias vía NODE_PATH, TEMP fuera del worktree)

- Nuevo `ledger-holder-identity.test.js`:
  - sonda A exacta del auditor;
  - 5 fronteras de crash real × 3 continuaciones (escritura automática, recover owner, recover supervisor);
  - claim vivo, muerto, corrupto y de otro host;
  - EPERM, EBUSY y EACCES;
  - movimiento del guard rechazado más allá del reintento;
  - 2, 4 y 8 recuperadores en procesos;
  - sonda exacta P1-2 (hijo vivo con transacción síncrona más larga que el lease);
  - titular async largo, muerto real, PID reutilizado con identidad robusta, y suspend/resume (omitido en Windows: no existe SIGSTOP).
- Control negativo con el `memory-store.js` de `f39b285`: la sonda A y las fronteras de crash fallan (`recovered:false`, escritura bloqueada) y la sonda P1-2 falla. Con el código nuevo pasan.
- Las cifras de focal, stress, supervised-operation y global están en la salida del commit.

## Límites

- No hay identidad de arranque en Windows ni macOS. Ahí, un PID reutilizado por un proceso ajeno deja el lock en `store_lock_live` hasta una revisión externa: es fail-closed, no se recupera solo. Sin superficie operativa para esa revisión.
- Otro host y almacenamiento compartido o sincronizado: nunca se recupera automáticamente. Sin probar.
- Un lock heredado sin identidad, en el PID de este mismo proceso, queda fail-closed.
- Los archivos movidos aparte (`.stale`) y los temporales de un crash no se barren. Son inertes: nunca se leen como lock.
- PostgreSQL real, Node 22 y CI: sin probar.
