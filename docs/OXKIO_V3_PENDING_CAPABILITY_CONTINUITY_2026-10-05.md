# OXKIO V3 — continuidad ejecutiva tras una capacidad pendiente — evidencia 2026-10-05

## Causa raíz

La continuidad ya existía. Si el decisor devuelve un plan, el runtime crea la misión, la sella en el store del propietario, detecta la conexión que falta (`gaps`) y la deja en el estado canónico NEEDS_CONNECTION. Después, «continúa» o «ya lo he conectado» reanudan la misma misión (`start` → `resume`), el gateway instala la conexión nueva y los pasos ya verificados no se repiten.

El que no llegaba a planificar era Luna. El contrato le decía:

- «NEEDS_CONNECTION: la persona debe conectarla o validarla primero» (PR #32);
- «si el objetivo necesita una capacidad no disponible, dilo» (PR #33).

Así que respondía con una aclaración y la orden se perdía. Además repetía los nombres de estado que recibe en la vista («Gmail figura como NEEDS_CONNECTION»), y el mensaje determinista de conexión mostraba «Enviar, publicar o ejecutar cambios externos» sin indicar que es lo que NO podrá hacer.

## Cambio mínimo

- `adaptive-planner.js`:
  - si el objetivo está claro y necesita una capacidad NEEDS_CONNECTION, hay que planificarla; aclarar solo si el objetivo no está claro;
  - NEEDS_CONNECTION: «planifícala; OXKIO pide la conexión y continúa la misma tarea»;
  - la regla de «no disponible» se limita a UNAVAILABLE y BLOCKED;
  - el mensaje nunca incluye ids ni nombres de estado, y un mensaje que los contenga se rechaza con el código fijo `planning_message_internal_terms`.
- `chat-gateway.js`:
  - «Con él podré… / Nunca podré…»;
  - la continuación se promete solo si la cuenta puede conectar («di «continúa» y seguiré desde este punto sin que tengas que repetir la petición»); si no puede, se dice que no podrá continuar mientras esa conexión no exista.

No hay sistema de tareas, cola, gestor de conexiones, motor de reanudación ni registro nuevos.

## Evidencia determinista

`pending-capability.test.js` (7 tests):

- contrato y validador de términos internos;
- A/B/C con paráfrasis: plan → misión esperando conexión → mensaje natural sin códigos, sin lecturas;
- D/E/F/H: ideas y explicaciones sin espera, «Revisa aquello» aclara sin crear misión, y una capacidad disponible se ejecuta en el momento;
- G: lo que no existe para la cuenta no se presenta como conectable ni promete continuar;
- **ciclo completo sin OAuth:**
  - la petición se da una vez y la misión espera;
  - un «continúa» antes de conectar mantiene la misma misión, sin duplicados ni nueva interpretación;
  - la conexión simulada pasa a ser válida;
  - «Ya lo he conectado» reanuda la misma misión: el decisor se ha llamado 1 sola vez, se hace 1 lectura y la traza muestra NEEDS_CONNECTION → CONSULT → VERIFY → TERMINATE, con `executionEnabled=false`;
- misión con dos fuentes: espera hasta tener ambas conexiones y completa la misma misión.

Suites: V3 184/184. Completa secuencial: 1812 tests, 1796 PASS, 0 FAIL, 16 SKIP. En las baterías Cliente Cero (20 y 28 casos) solo cambia el texto del mensaje de conexión; el enrutado y los resultados son idénticos.

## Validación real (3 llamadas, rama 0d434f9, 0,000804 USD)

| Petición | Luna | Resultado |
|---|---|---|
| Busca en mi correo el último mensaje de la gestoría | `plan` con `gmail.read` | Misión guardada esperando conexión; mensaje natural sin códigos |
| Organiza mis prioridades usando mi agenda y mi correo | `clarify`: «¿qué quieres lograr exactamente…?» | Sin códigos ni petición de conexión, pero no planifica |
| Dame tres ideas para cerrar la semana | `answer` | Sin capacidades ni espera |

## Riesgos

- Luna aún puede considerar ambiguo un objetivo razonablemente claro (caso 2). Es una sola muestra.
- El mensaje que acompaña a un `plan` se descarta y la persona ve el texto determinista de conexión. Es intencionado: es coherente y no tiene códigos.
- Reanudar requiere decir «continúa» o «ya lo he conectado». No hay aviso proactivo cuando la conexión queda lista, porque no existen recordatorios ni tareas programadas.
