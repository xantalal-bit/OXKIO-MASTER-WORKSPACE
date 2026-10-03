'use strict';

// XATAI CORE V2 (03/10/2026): deterministic decomposition of a human request
// into a mission blueprint. No LLM: a request either matches a known
// blueprint, or the answer is one concrete question. A blueprint only
// proposes tasks; the Mission Engine still routes, gates and verifies every
// one of them under the approved contract.
//
// Task keys become part of Mission Queue identifiers, so they only use
// [A-Za-z0-9_-]. missionCriteria links each task to the mission pass
// criteria it helps demonstrate.

const GENERIC_QUESTION = '¿Qué resultado concreto necesitas que consiga?';

function task(key, spec) {
  return Object.freeze({
    key,
    kind: spec.kind || 'work',
    objective: spec.objective,
    agentRole: spec.agentRole,
    requiredCapabilities: Object.freeze(spec.requiredCapabilities),
    dependsOn: Object.freeze(spec.dependsOn || []),
    risk: spec.risk || 'low',
    privacyClass: spec.privacyClass || 'INTERNAL',
    expectedEvidence: Object.freeze(spec.expectedEvidence),
    passCriteria: Object.freeze(spec.passCriteria),
    missionCriteria: Object.freeze(spec.missionCriteria || []),
  });
}

const BLUEPRINTS = Object.freeze({
  COMPANY_PROPOSAL: Object.freeze({
    id: 'COMPANY_PROPOSAL',
    match: /\b(empresa|compa[nñ][ií]a|company|cliente)\b[\s\S]*\b(propuesta|proposal|oferta)\b/i,
    requiredContext: Object.freeze([
      Object.freeze({ key: 'company', question: '¿Qué empresa quieres que analice?' }),
    ]),
    constraints: Object.freeze(['No enviar nada sin aprobación humana.', 'No inventar datos de la empresa.']),
    passCriteria: Object.freeze([
      { criterionId: 'company-profile', description: 'Perfil de la empresa con fuentes verificables.' },
      { criterionId: 'proposal-ready', description: 'Propuesta comercial preparada como borrador para revisión.' },
    ]),
    stopCriteria: Object.freeze(['Falta una decisión humana o una fuente fiable.']),
    requiredEvidence: Object.freeze(['Fuentes del perfil de empresa.', 'Borrador de la propuesta.']),
    tasks: Object.freeze([
      task('company-research', {
        objective: 'Investigar el perfil y la actividad de la empresa.',
        agentRole: 'research', requiredCapabilities: ['research.company'], privacyClass: 'PUBLIC',
        expectedEvidence: ['company_profile_sources'], passCriteria: ['Perfil con fuentes citadas.'],
        missionCriteria: ['company-profile'],
      }),
      task('web-research', {
        objective: 'Contrastar el perfil con fuentes web públicas recientes.',
        agentRole: 'web-research', requiredCapabilities: ['research.web'], privacyClass: 'PUBLIC',
        expectedEvidence: ['web_sources'], passCriteria: ['Fuentes públicas recientes enlazadas.'],
        missionCriteria: ['company-profile'],
      }),
      task('opportunity-analysis', {
        objective: 'Analizar necesidades y oportunidades comerciales de la empresa.',
        agentRole: 'data-analysis', requiredCapabilities: ['data.analyze'],
        dependsOn: ['company-research', 'web-research'],
        expectedEvidence: ['analysis_notes'], passCriteria: ['Oportunidades justificadas con el perfil.'],
      }),
      task('proposal-draft', {
        objective: 'Preparar la propuesta comercial como borrador de correo, sin enviarla.',
        agentRole: 'email', requiredCapabilities: ['gmail.draft'], dependsOn: ['opportunity-analysis'],
        risk: 'medium', privacyClass: 'CONFIDENTIAL',
        expectedEvidence: ['draft_reference'], passCriteria: ['Borrador listo para revisión humana.'],
        missionCriteria: ['proposal-ready'],
      }),
    ]),
  }),
  REPOSITORY_REPAIR: Object.freeze({
    id: 'REPOSITORY_REPAIR',
    match: /\b(repositorio|repo|repository|c[oó]digo|code)\b[\s\S]*\b(fallo|bug|error|repara\w*|fix|arregl\w*)\b/i,
    requiredContext: Object.freeze([
      Object.freeze({ key: 'repository', question: '¿Qué repositorio quieres que analice?' }),
    ]),
    constraints: Object.freeze(['No hacer merge, push ni deploy.', 'No tocar credenciales.']),
    passCriteria: Object.freeze([
      { criterionId: 'fault-located', description: 'Fallo localizado con evidencia del código.' },
      { criterionId: 'fix-validated', description: 'Reparación propuesta validada por tests.' },
    ]),
    stopCriteria: Object.freeze(['La reparación exige permisos que la misión no tiene.']),
    requiredEvidence: Object.freeze(['Referencia del fallo.', 'Resultado de tests.']),
    tasks: Object.freeze([
      task('repository-analysis', {
        objective: 'Analizar el repositorio y localizar el fallo.',
        agentRole: 'repository-analysis', requiredCapabilities: ['repository.analyze'],
        expectedEvidence: ['fault_reference'], passCriteria: ['Fallo localizado con referencia.'],
        missionCriteria: ['fault-located'],
      }),
      task('patch-proposal', {
        objective: 'Proponer una reparación mínima del fallo.',
        agentRole: 'code', requiredCapabilities: ['code.propose_patch'], dependsOn: ['repository-analysis'],
        risk: 'medium', expectedEvidence: ['patch_reference'], passCriteria: ['Parche propuesto y acotado.'],
      }),
      task('test-validation', {
        objective: 'Validar la reparación con la suite de tests.',
        agentRole: 'test', requiredCapabilities: ['tests.run'], dependsOn: ['patch-proposal'],
        risk: 'medium', expectedEvidence: ['test_report'], passCriteria: ['Suite de tests en verde.'],
        missionCriteria: ['fix-validated'],
      }),
    ]),
  }),
});

function getBlueprint(id) {
  return Object.hasOwn(BLUEPRINTS, id) ? BLUEPRINTS[id] : null;
}

// Returns the blueprint and, if something is missing, the single most
// important question to ask (never a list of questions).
function interpretRequest(text, context = {}) {
  const request = typeof text === 'string' ? text : '';
  const blueprint = Object.values(BLUEPRINTS).find((candidate) => candidate.match.test(request)) || null;
  if (!blueprint) {
    return Object.freeze({ blueprintId: null, missingInformation: Object.freeze([GENERIC_QUESTION]), question: GENERIC_QUESTION });
  }
  const missing = blueprint.requiredContext
    .filter((item) => typeof context[item.key] !== 'string' || !context[item.key].trim())
    .map((item) => item.question);
  return Object.freeze({
    blueprintId: blueprint.id,
    missingInformation: Object.freeze(missing),
    question: missing[0] || null,
  });
}

module.exports = { BLUEPRINTS, GENERIC_QUESTION, getBlueprint, interpretRequest };
