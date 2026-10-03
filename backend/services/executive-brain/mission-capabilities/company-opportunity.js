'use strict';

const { createEvidenceRegistry } = require('../evidence-registry');
const { createMissionEngine } = require('../mission-engine');
const { BLUEPRINTS } = require('../mission-blueprints');
const { buildCommercialReview } = require('./review-package');
const { validateSellerProfile } = require('./seller-profile');
const { TRUSTED_REGISTRAR, createTrustedToolbox } = require('./trusted-toolbox');

// XATAI CORE V2.1: composition root of the company-opportunity circuit,
// company-opportunity(target, sellerProfile). It wires the existing Mission
// Engine with a fresh Evidence Registry per mission, the trusted toolbox and
// only the connections that really exist (a fetcher, a memory search, a
// Gmail metadata search). Each mission gets its own registry and toolbox,
// so data from one company can never be evidence in another mission.
//
// Nothing here sends, publishes, writes to Gmail or approves: the mission
// ends at the human review gate. executionEnabled stays false.

const BLUEPRINT = BLUEPRINTS.COMPANY_OPPORTUNITY;
const TARGET_TEXT = /^[^\r\n<>]{2,200}$/;

function fail(code) {
  const error = new TypeError(code);
  error.code = code;
  throw error;
}

function normalizeTarget(target = {}) {
  if (!target || typeof target.company !== 'string' || !TARGET_TEXT.test(target.company.trim())) fail('TARGET_COMPANY_REQUIRED');
  const clean = (value) => (typeof value === 'string' && TARGET_TEXT.test(value.trim()) ? value.trim() : null);
  return Object.freeze({
    company: target.company.trim(),
    website: clean(target.website),
    contactName: clean(target.contactName),
    contactEmail: clean(target.contactEmail),
    objective: clean(target.objective),
  });
}

async function runCompanyOpportunity({
  target: rawTarget,
  sellerProfile: rawProfile,
  fetcher = null,
  sourceOrigin = 'live',
  memorySearch = null,
  gmailSearch = null,
  agentOverrides,
  qualityRegistry = null,
  now = () => new Date().toISOString(),
  idFactory,
  limits,
  costPolicy,
} = {}) {
  const target = normalizeTarget(rawTarget);
  const sellerProfile = validateSellerProfile(rawProfile);
  const evidenceRegistry = createEvidenceRegistry({ trustedRegistrars: [TRUSTED_REGISTRAR], now });
  const toolbox = createTrustedToolbox({
    evidenceRegistry, sellerProfile, fetcher, sourceOrigin, memorySearch, gmailSearch, agentOverrides,
  });
  const engine = createMissionEngine({
    evidenceRegistry,
    connections: {
      'research.company': Boolean(fetcher),
      'research.web': Boolean(fetcher),
      'gmail.read': typeof gmailSearch === 'function' && Boolean(target.contactEmail),
    },
    qualityRegistry,
    now,
    ...(idFactory ? { idFactory } : {}),
    ...(limits ? { limits } : {}),
    ...(costPolicy ? { costPolicy } : {}),
  });

  const missingInformation = target.website ? [] : [BLUEPRINT.requiredContext.find((item) => item.key === 'website').question];
  const created = engine.createMission({
    blueprintId: BLUEPRINT.id,
    objective: `Analizar ${target.company} y preparar una propuesta de ${sellerProfile.name} para revisión humana.`.slice(0, 500),
    constraints: [...BLUEPRINT.constraints],
    knownContext: [
      `company: ${target.company}`,
      ...(target.website ? [`website: ${target.website}`] : []),
      ...(target.contactName ? [`contact_name: ${target.contactName}`] : []),
      ...(target.contactEmail ? [`contact_email: ${target.contactEmail}`] : []),
      ...(target.objective ? [`objective: ${target.objective}`] : []),
    ],
    missingInformation,
    autonomyLevel: 'A1',
    authorizedCapabilities: [...new Set(BLUEPRINT.tasks.flatMap((task) => task.requiredCapabilities))],
    prohibitedActions: ['publish', 'purchase', 'contract_service', 'external_message'],
    passCriteria: BLUEPRINT.passCriteria.map((criterion) => ({ ...criterion })),
    stopCriteria: [...BLUEPRINT.stopCriteria],
    requiredEvidence: [...BLUEPRINT.requiredEvidence],
    privacyClass: 'INTERNAL',
  });
  const planned = engine.planMission(created);
  const state = await engine.runMission(planned, { executors: toolbox.executors });
  const review = buildCommercialReview(state, { describeSource: toolbox.describeSource });
  // Only the read side of the registry leaves this function.
  return Object.freeze({ state, review, engine, resolveEvidence: evidenceRegistry.resolve });
}

module.exports = { normalizeTarget, runCompanyOpportunity };
