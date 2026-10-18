# OXKIO V3 — lock del store: PID en Windows y residuos `.tmp`/`.stale` — 17/10/2026

Commit local sobre `628d908` en la misma rama, sin push, PR, merge ni deploy. Cierra los dos gaps locales que quedaron tras la auditoría `PASS_CON_GAP`. Solo cambia `memory-store.js` y añade `ledger-pid-residues.test.js`.

## Gap 1 — PID: fail-closed

Fallo encontrado (reproducido en Windows, Node 24.15.0):

- `gone()` solo exigía `Number.isInteger(pid)`.
- Ante un pid fuera de int32, `process.kill(pid, 0)` lanza `ERR_INVALID_ARG_TYPE`; ante un pid negativo, Windows responde `ESRCH`.
- `alive()` daba por muerto todo lo que no fuera `EPERM`.
- Consecuencia: un lock, guard o claim con pid `2^31`, `2^40` o `-5` y lease vencido se reclamaba **automáticamente**. Cualquier otro error inesperado de `kill` también contaba como prueba de muerte.

Corrección:

- `validPid`: solo un int32 positivo identifica a un titular. Otro valor (0, negativo, fracción, texto, ausente, fuera de rango) nunca prueba nada.
- `alive()`: solo `ESRCH` prueba que el pid no existe. `EPERM`, `EACCES`, `EINVAL`, un código desconocido o ningún código cuentan como posible titular vivo.

PID reutilizado por otro proceso vivo en Windows: no hay identidad de arranque, así que lock, guard y claim no se tocan (`store_busy` / `store_lock_live`). Se recuperan por evidencia en cuanto ese pid desaparece. Comportamiento ya correcto; ahora queda fijado por test en la ruta automática y en la explícita.

## Gap 2 — residuos `.tmp` / `.stale`

Antes: nunca se barrían, aunque eran inertes.

Ahora se eliminan solo con evidencia de que nada vivo los usa:

| Residuo | Quién lo crea | Se elimina cuando |
|---|---|---|
| `<data>.json.<uuid>.tmp` (snapshot) y `<lock>.<uuid>.tmp` (renovación) | solo el titular del lock del owner | lo tiene este proceso (tras reclamar un lock abandonado, o en `recover()`): ninguno está en vuelo |
| `<claim>.won.<uuid>.tmp` | quien crea un claim | bajo el guard, si su contenido es un titular abandonado (lease vencido y titular demostradamente muerto) |
| `<lock>.<uuid>.stale` | solo bajo el guard | bajo el guard, si su contenido es un titular abandonado |
| `<guard>.<uuid>.stale` | bajo un claim vivo de esa instancia | bajo el guard, si su contenido es un titular abandonado **y** ningún claim de esa instancia está vivo o es ilegible |

Se conserva siempre todo residuo de un titular posiblemente vivo, de otro host, ilegible o vacío, y todo nombre que no encaje exactamente.

`recover()` (owner/supervisor) también ordena: tras recuperar, o cuando no hay lock (`no_lock`), barre bajo el lock del owner y bajo el guard. Si alguno está ocupado, lo deja para más tarde. El resultado de `recover()` no cambia de forma.

## Tests

`ledger-pid-residues.test.js`: 10 tests, con procesos hijos reales y crashes reales (`process.exit`).

Contra el código anterior fallan 7 de 10. Los otros 3 caracterizan comportamiento que ya era fail-closed: PID reutilizado vivo, retención de residuos en duda y temporales de un titular vivo.

## Límites

- Windows y macOS siguen sin identidad de arranque. Un PID reutilizado deja el lock en `store_lock_live` hasta que ese proceso termine o haya revisión externa. Es fail-closed, sin superficie operativa.
- Los residuos en duda (vacíos, ilegibles, de otro host) se conservan indefinidamente.
- Si un lock ilegible se recupera vía `recover()` mientras su escritor sigue vivo pero congelado más de un lease (riesgo previo), el barrido puede borrar el temp de ese escritor. Su commit falla entonces de forma determinada.
- El marcador `.publish` de un crash no se barre: es solo una pista y uno antiguo se ignora.
