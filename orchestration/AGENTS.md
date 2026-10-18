# OXKIO AGENTS

## Agentes previstos

1. Supervisor Agent
- Rol: coordinar tareas y exigir aprobación humana.

2. Codex Agent
- Rol: programar, revisar código, crear módulos, preparar commits.
- Restricción: no hacer push ni borrar código sin aprobación.

3. Gmail Agent
- Rol: leer correos autorizados y preparar borradores.
- Restricción: no enviar emails sin aprobación.

4. Calendar Agent
- Rol: leer agenda y proponer eventos.
- Restricción: no crear/modificar eventos críticos sin aprobación.

5. GitHub Agent
- Rol: revisar estado, commits, issues y ramas.
- Restricción: no fusionar ni borrar ramas sin aprobación.

6. Drive Agent
- Rol: inventariar documentos autorizados.
- Restricción: solo lectura inicial.

7. OneDrive Agent
- Rol: inventariar documentos autorizados.
- Restricción: solo lectura inicial.

8. Business Hunter Agent
- Rol: leads, seguimiento, campañas y clientes.
- Restricción: no enviar campañas masivas sin aprobación.

9. GIU Agent
- Rol: informes, datos, tablas, exportaciones.
- Restricción: no acceder a BBDD reales sin permiso explícito.

10. Learning Agent / Bibliotecario
- Rol: clasificar conocimiento de Learning Heroes y formación antigua.
- Restricción: no borrar ni mover archivos sin aprobación.

## Regla futura del orquestador

Todos los agentes quedan sujetos a `XANTALAL/00_GOVERNANCE/MODEL-GOVERNANCE-GPT-5-6.md`. El futuro enrutamiento preferirá Terra solo cuando esté disponible y autorizado, registrará cualquier fallback, permitirá `Luna → Terra → Sol` y escalará por baja confianza o alto riesgo. Las métricas distinguirán modelo solicitado, modelo realmente utilizado y motivo del fallback. Esta regla no modifica todavía llamadas reales a APIs ni presupone IDs habilitados.

## Regla obligatoria de continuidad — Cliente Cero (Issue #49)

Antes de planificar cualquier misión (Xatai, Claude, Codex o cualquier agente):

```
node scripts/client-zero/continuity.js preflight --mission "<texto de la misión>" --work-on "<frente>" --action <accion> --record
```

- Salida `3` (`REFUSE_REOPEN`): el frente está `CLOSED` y no se aporta evidencia material nueva. No se reabre.
- `authorizations.granted`: autorizaciones ya consolidadas; no se vuelven a pedir.
- `authorizations.humanGate`: puertas humanas (merge, deploy, producción, Neon, secretos, IAM, gasto, push...); se piden siempre.
- `UNKNOWN_TOPIC`: OXKIO no conoce el frente; se declara, se usa la mejor evidencia disponible y se registra.

Al cerrar la misión se registran evidencia, SHA/PR/tests y siguiente acción con `continuity.js apply`, y el Parte Diario se genera con `continuity.js daily --write`. Contrato: `KNOWLEDGE-CURATOR/CLIENT-ZERO/XATAI-CLIENT-ZERO-CANON.md`; fuente única: `orchestration/CONTINUITY-REGISTRY.json`.
