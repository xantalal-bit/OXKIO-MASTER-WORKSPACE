# OXKIO V3 — contrato del decisor conversacional — evidencia 2026-10-05

## Incidencia

En la validación real de la PR #30, Luna respondió a «organizar mi trabajo de esta semana…» y el decisor rechazó la salida con `planning_invalid_action`. Diagnóstico del 05/10/2026 sobre b9eef25 (1 llamada real, 0,0002134 USD):

- El fallo no es determinista. La misma petición devolvió una salida válida (`clarify`, `plan: []`), que se aceptó.
- El validador es determinista: 14 payloads × 20 repeticiones dan siempre el mismo veredicto.
- **Causa demostrada:** el prompt y el validador usaban contratos distintos.
  - La plantilla `SALIDA` mostraba `action` como el literal `"answer|clarify|plan"` y un `plan` con un paso de ejemplo para cualquier acción.
  - Una restricción común pedía «Return a bounded acyclic dependency plan».
  - El validador solo acepta pasos con `action: "plan"`.
- El rechazo solo podía ser C1 (`answer`/`clarify` con plan no vacío) o C2 (acción fuera del conjunto, o ausente sin plan).

## Cambio (solo `adaptive-planner.js`)

- **Prompt conversacional = contrato validado:**
  - `action` es exactamente «answer», «clarify» o «plan», nunca otro valor ni una combinación;
  - con `answer`/`clarify`, `plan` es `[]`;
  - solo `action: "plan"` lleva pasos (acotados y acíclicos, con las capacidades suministradas);
  - plantilla `{"action": "answer, clarify or plan (exactly one value)", "message": …, "plan": []}`, sin el literal combinado;
  - la petición incondicional de un plan desaparece del modo conversacional.
- **Validador:** sigue fallando cerrado, con la misma política y el mismo orden. Solo se divide el código antiguo en dos códigos fijos, sin contenido del modelo:
  - C1 → `planning_plan_without_plan_action`;
  - C2 → `planning_unknown_action`.
  - Una acción ausente con plan no vacío se sigue tratando como plan y se valida como tal, igual que antes.
- **Sin cambios:**
  - el modo `plan()` (no conversacional);
  - el Privacy Gate, la autoridad, el Mission Engine y `executionEnabled=false`;
  - los códigos de forma, plan y mensaje.

## Evidencia

- `adaptive-planner.test.js`:
  - 11 fixtures rechazados, cada uno con su código exacto y sin texto del modelo en la traza: C1 ×3, C2 ×5, capacidad inventada, campo extra y acción afirmada como hecha;
  - 4 fixtures aceptados, entre ellos la salida real capturada de Luna;
  - un test del prompt: tres acciones exactas, `[]` para answer/clarify, plan reservado a `plan`, sin el literal antiguo y el modo `plan()` intacto.
- `executive-conversation.test.js`, por HTTP: con C1 y C2 no hay misión, `executionEnabled=false`, la respuesta es la aclaración determinista y solo queda el código fijo; el coste se registra.
- Sin llamadas reales: el cambio solo afecta al texto del contrato y a los códigos de rechazo.

## Riesgo residual

El modelo puede seguir incumpliendo el contrato, porque su salida no es determinista. En ese caso el resultado es el mismo fallback seguro de antes, ahora con un código que distingue C1 de C2. Medir la frecuencia real requiere una validación con llamadas, autorizada aparte.
