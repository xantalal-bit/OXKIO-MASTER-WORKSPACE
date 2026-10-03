'use strict';

const { describeCapability, getCapability } = require('./capability-registry');
const { getBlueprint, interpretRequest } = require('./mission-blueprints');
const { ENGINE_STATES } = require('./mission-engine-states');

// XATAI CORE V2 (03/10/2026): prepares Executive Chat to receive "Haz X"
// without redesigning it. It answers with one of: a useful result, a single
// concrete question, what exactly needs approval, or why it is blocked. The
// internal machinery (agents, routes, gates) stays hidden unless the caller
// explicitly asks for details. Not wired to any route yet.

const REASON_TEXT = Object.freeze({
  agent_not_implemented: 'Todavía no puedo hacer una parte de esta misión: esa función aún no está desarrollada.',
  no_agent_for_capability: 'Ninguna de mis capacidades actuales puede hacer una parte de esta misión.',
  agent_blocked: 'Una parte de esta misión depende de algo que aún no está activado.',
  capability_not_authorized: 'La misión no autoriza una de las capacidades necesarias.',
  capability_prohibited: 'Una parte de esta misión es una acción prohibida.',
  privacy_provider_not_allowed: 'La política de privacidad no permite enviar este contexto a un proveedor externo.',
  budget_exceeded: 'Esta misión superaría el presupuesto permitido.',
  budget_or_value_gate_failed: 'El control de coste no permite continuar con esta misión.',
  risk_limit_exceeded: 'Una parte de esta misión supera el nivel de riesgo permitido.',
  no_untried_agent: 'He probado todas las alternativas disponibles y ninguna ha funcionado.',
  strategies_exhausted: 'He probado todas las estrategias de corrección y ninguna ha funcionado.',
  attempt_budget_exhausted: 'He agotado los reintentos permitidos para una tarea.',
  mission_retry_budget_exhausted: 'He agotado los reintentos permitidos para esta misión.',
  agent_cycle_detected: 'La replanificación estaba entrando en un ciclo y la he detenido.',
});
const DEFAULT_BLOCKED_TEXT = 'No puedo continuar sin una decisión tuya.';

function capabilityName(id) {
  const capability = getCapability(id);
  return capability ? capability.name : id;
}

function openTasks(state, statuses) {
  return state.tasks.filter((task) => statuses.includes(task.status));
}

function summarizeMissionForChat(state, { includeDetails = false } = {}) {
  const summary = (fields) => Object.freeze({
    ...fields,
    executionEnabled: false,
    ...(includeDetails ? {
      details: Object.freeze({
        missionId: state.missionId,
        state: state.engine.state,
        tasks: state.tasks.map((task) => Object.freeze({
          taskId: task.taskId, coordinator: task.assignedCoordinator, agent: task.assignedAgent,
          status: task.status, decision: task.gate.decision, reason: task.gate.reason,
        })),
      }),
    } : {}),
  });
  const verdict = state.verification ? state.verification.verdict : null;
  switch (state.engine.state) {
    case ENGINE_STATES.COMPLETED:
      return summary({
        kind: 'RESULT',
        verdict,
        message: verdict === 'PASS' ? 'Misión completada y verificada.' : 'Misión cerrada con un resultado parcial.',
        outputs: state.tasks.filter((task) => task.status === 'COMPLETED' && task.output)
          .map((task) => Object.freeze({ taskId: task.taskId, summary: task.output })),
      });
    case ENGINE_STATES.NEEDS_INFORMATION: {
      const question = state.contract.missingInformation[0] || '¿Qué información me falta para continuar?';
      return summary({ kind: 'QUESTION', question });
    }
    case ENGINE_STATES.NEEDS_APPROVAL:
      return summary({
        kind: 'APPROVAL',
        message: 'Necesito tu aprobación para continuar. No se ha enviado ni ejecutado nada.',
        approvals: openTasks(state, ['NEEDS_APPROVAL']).map((task) => Object.freeze({
          taskId: task.taskId,
          what: task.requiredCapabilities.map(capabilityName).join(', '),
        })),
      });
    case ENGINE_STATES.NEEDS_CONNECTION:
      return summary({
        kind: 'CONNECTION',
        message: 'Necesito que conectes una fuente antes de continuar.',
        connections: [...new Set(openTasks(state, ['NEEDS_CONNECTION'])
          .flatMap((task) => task.requiredCapabilities)
          .filter((id) => {
            const profile = describeCapability(id);
            return profile && profile.requiresExternalConnection;
          }).map(capabilityName))],
      });
    case ENGINE_STATES.BLOCKED: {
      const blocked = openTasks(state, ['BLOCKED'])[0];
      return summary({ kind: 'BLOCKED', message: (blocked && REASON_TEXT[blocked.gate.reason]) || DEFAULT_BLOCKED_TEXT });
    }
    case ENGINE_STATES.FAILED:
      return summary({ kind: 'FAILED', verdict, message: 'La misión ha fallado y no se ha dado por buena. Queda registrada para revisión.' });
    case ENGINE_STATES.CANCELLED:
      return summary({ kind: 'CANCELLED', message: 'Misión cancelada.' });
    default:
      return summary({ kind: 'IN_PROGRESS', message: 'Estoy trabajando en ello.' });
  }
}

// "Haz X": interpret -> contract -> plan -> run what A1 allows -> one answer.
// Capabilities authorized are exactly the blueprint's own; prohibitions,
// the A1 ceiling and executionEnabled=false always apply on top.
async function handleMissionRequest(engine, text, { context = {}, executors = {}, includeDetails = false } = {}) {
  const interpretation = interpretRequest(text, context);
  if (!interpretation.blueprintId) {
    return Object.freeze({ kind: 'QUESTION', question: interpretation.question, executionEnabled: false });
  }
  const blueprint = getBlueprint(interpretation.blueprintId);
  const created = engine.createMission({
    blueprintId: blueprint.id,
    objective: String(text).slice(0, 500),
    constraints: [...blueprint.constraints],
    knownContext: Object.entries(context)
      .filter(([, value]) => typeof value === 'string' && value.trim())
      .map(([key, value]) => `${key}: ${value}`.slice(0, 300)),
    missingInformation: [...interpretation.missingInformation],
    autonomyLevel: 'A1',
    authorizedCapabilities: [...new Set(blueprint.tasks.flatMap((task) => task.requiredCapabilities))],
    passCriteria: blueprint.passCriteria.map((criterion) => ({ ...criterion })),
    stopCriteria: [...blueprint.stopCriteria],
    requiredEvidence: [...blueprint.requiredEvidence],
  });
  const planned = engine.planMission(created);
  const ran = await engine.runMission(planned, { executors });
  const answer = summarizeMissionForChat(ran, { includeDetails });
  return includeDetails ? Object.freeze({ ...answer, state: ran }) : answer;
}

module.exports = { REASON_TEXT, handleMissionRequest, summarizeMissionForChat };
