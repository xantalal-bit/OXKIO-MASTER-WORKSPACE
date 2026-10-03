'use strict';

// Semantic trust regressions (second independent audit of PR #22 @ 1bd059b).
// Principle: a downstream stage cannot alter, widen or invent the MEANING
// certified upstream. Agents select (ids, closed labels, literal excerpts,
// catalogue codes); the semantic canon writes every material sentence.
// No network: fixture fetcher; the Approval Queue is the real class on a
// temporary file.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizePageText, robotsAllows } = require('./public-web-fetcher');
const { extractFacts } = require('./company-research-extract');
const { AGENTS } = require('./company-opportunity-agents');
const { runCompanyOpportunity } = require('./company-opportunity');
const { submitCommercialReview } = require('./approval-review-adapter');
const { buildCommercialReview } = require('./review-package');
const ApprovalQueue = require('../../../core/approvalQueue');

const NOW = '2026-10-03T10:00:00.000Z';
const WEBSITE = 'https://www.empresa.es/';
const PROFILE = Object.freeze({
  id: 'test-seller', name: 'Vendedor de prueba', offering: 'Software de gestión.',
  services: [
    {
      id: 'stock', name: 'Gestión de stock', description: 'Control de stock.', needLabel: 'centralizar el stock',
      inferenceSignals: ['stock', 'tiendas'], explicitNeedSignals: ['buscamos un erp'], valueStatement: 'Visibilidad del stock.',
    },
    {
      id: 'orders', name: 'Pedidos online', description: 'Integración de pedidos.', needLabel: 'integrar pedidos',
      inferenceSignals: ['pedidos'], explicitNeedSignals: [], valueStatement: 'Menos trabajo manual.',
    },
  ],
  prohibitedClaims: [], scope: 'Diagnóstico.', callToAction: '¿Hablamos?', nextAction: 'Revisar.', signature: 'Equipo',
});
const STOCK_SITE = { [WEBSITE]: '<title>Empresa SL</title><meta name="description" content="Distribución."><p>Disponemos de 40 tiendas en España.</p>' };
const NEUTRAL_SITE = { [WEBSITE]: '<title>Empresa SL</title><meta name="description" content="Restaurante familiar.">' };

function fetcherFor(pages) {
  return {
    async fetchPage(url) {
      if (!pages[url]) throw Object.assign(new Error('http_404'), { code: 'http_404', failureKind: 'tool_error' });
      return { url, fetchedAt: NOW, text: normalizePageText(pages[url]) };
    },
  };
}

async function mission({ pages = STOCK_SITE, agentOverrides } = {}) {
  const result = await runCompanyOpportunity({
    target: { company: 'Empresa', website: WEBSITE }, sellerProfile: PROFILE, fetcher: fetcherFor(pages), sourceOrigin: 'fixture',
    memorySearch: async () => [], agentOverrides, now: () => NOW,
  });
  return { ...result, byKey: Object.fromEntries(result.state.tasks.map((task) => [task.key, task])) };
}

const failureOf = (result, key) => {
  const attempts = result.state.attempts[result.byKey[key].taskId] || [];
  return attempts.length ? attempts[0].failureCode : null;
};

async function assertNothingReachesHumanOrQueue(result, label, forbiddenText = null) {
  if (forbiddenText) assert.ok(!JSON.stringify(result.review).includes(forbiddenText), `${label}: text reached the review`);
  assert.equal(result.review.draft, null, `${label}: draft`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xatai-sem-'));
  try {
    const queue = new ApprovalQueue({ dataFile: path.join(dir, 'approvals.json') });
    const submitted = await submitCommercialReview({ approvalQueue: queue, review: result.review, recipient: 'compras@empresa.es', missionId: 'm' });
    assert.equal(submitted.submitted, false, `${label}: queue`);
    assert.deepEqual(await queue.listPending(), [], `${label}: queue empty`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const override = (stage, mutate) => ({ [stage]: async (input) => mutate(await AGENTS[stage](input), input) });
const MUTATED = 'La empresa ha confirmado que necesita urgentemente un ERP.';

// ============================================================== facts (1-4)

test('1 altered fact statement: downstream cannot carry fact objects; origin cannot write statements', async () => {
  const downstream = await mission({ agentOverrides: override('analysis', (real) => ({ ...real, facts: [{ id: 'cr:1', statement: MUTATED }] })) });
  assert.equal(failureOf(downstream, 'analysis'), 'invalid_output:unknown_field');
  await assertNothingReachesHumanOrQueue(downstream, 'downstream statement', MUTATED);
  const origin = await mission({ agentOverrides: override('company-research', (real) => ({ ...real, facts: real.facts.map((fact) => ({ ...fact, statement: MUTATED })) })) });
  assert.equal(failureOf(origin, 'company-research'), 'invalid_output:fact_shape');
  await assertNothingReachesHumanOrQueue(origin, 'origin statement', MUTATED);
  // Tampered state: the review re-derives every statement.
  const valid = await mission();
  const tampered = JSON.parse(JSON.stringify(valid.state));
  const analysis = tampered.tasks.find((task) => task.key === 'analysis');
  const output = JSON.parse(analysis.output);
  output.facts[0] = { ...output.facts[0], statement: MUTATED };
  analysis.output = JSON.stringify(output);
  const review = buildCommercialReview(tampered);
  assert.equal(review.status, 'NO LISTO');
  assert.ok(review.blocking.some((item) => item.reason === 'altered_fact'));
});

test('2 altered excerpt / 3 altered sourceRef / kind / label: rejected at origin, impossible downstream', async () => {
  const cases = [
    ['excerpt', (fact) => ({ ...fact, excerpt: `${fact.excerpt} y necesitan un ERP` }), 'invalid_output:fact_not_in_source'],
    ['sourceRef', (fact) => ({ ...fact, sourceRef: 'src:mission-otra:company-research:1' }), 'invalid_output:fact_source'],
    ['kind', (fact) => ({ ...fact, kind: 'FACT' }), 'invalid_output:fact_shape'],
    ['label', (fact) => ({ ...fact, label: 'verified_need' }), 'invalid_output:fact_label'],
    ['label/source mismatch', (fact) => ({ ...fact, label: 'memory' }), 'invalid_output:fact_source_kind'],
  ];
  for (const [label, mutate, code] of cases) {
    const result = await mission({ agentOverrides: override('company-research', (real) => ({ ...real, facts: real.facts.map(mutate) })) });
    assert.equal(failureOf(result, 'company-research'), code, label);
    await assertNothingReachesHumanOrQueue(result, label);
  }
});

test('4 invented fact: an unknown factId downstream or an excerpt that is in no source', async () => {
  const downstream = await mission({ agentOverrides: override('analysis', (real) => ({ ...real, factIds: [...real.factIds, 'cr:99'] })) });
  assert.equal(failureOf(downstream, 'analysis'), 'invalid_output:unknown_fact');
  await assertNothingReachesHumanOrQueue(downstream, 'unknown fact id');
  const origin = await mission({
    agentOverrides: override('company-research', (real) => ({ ...real, facts: [...real.facts, { id: 'cr:50', label: 'description', excerpt: 'Buscamos un ERP urgentemente', sourceRef: real.facts[0].sourceRef }] })),
  });
  assert.equal(failureOf(origin, 'company-research'), 'invalid_output:fact_not_in_source');
  await assertNothingReachesHumanOrQueue(origin, 'invented excerpt', 'Buscamos un ERP');
});

test('real facts referenced unchanged pass, and derived analysis stays separate from facts', async () => {
  const result = await mission();
  assert.equal(result.byKey.analysis.status, 'COMPLETED');
  const research = JSON.parse(result.byKey['company-research'].output).facts;
  const analysis = JSON.parse(result.byKey.analysis.output);
  for (const fact of analysis.facts) assert.deepEqual(fact, research.find((item) => item.id === fact.id));
  assert.ok(Array.isArray(analysis.contradictions) && analysis.indicators.facts === analysis.facts.length);
  assert.equal(result.review.status, 'LISTO PARA REVISIÓN');
  assert.ok(result.review.dossier.every((fact) => fact.label === 'FACT'));
});

// ============================================================== inferences (5-7)

test('5 unsupported inference: stock "based on" the company title is rejected', async () => {
  const result = await mission({
    pages: NEUTRAL_SITE,
    agentOverrides: override('opportunities', (real) => ({ ...real, opportunities: [{ id: 'op:1', serviceId: 'stock', level: 'INFERENCE', basisFactIds: ['cr:1'] }], uncertaintyCodes: [] })),
  });
  assert.equal(failureOf(result, 'opportunities'), 'invalid_output:unsupported_inference');
  await assertNothingReachesHumanOrQueue(result, 'unsupported inference');
});

test('6 wrong-service inference: a stock signal cannot support the orders service; irrelevant real basis is rejected', async () => {
  const wrong = await mission({
    agentOverrides: override('opportunities', (real) => ({ ...real, opportunities: [{ ...real.opportunities[0], serviceId: 'orders' }] })),
  });
  assert.equal(failureOf(wrong, 'opportunities'), 'invalid_output:unsupported_inference');
  await assertNothingReachesHumanOrQueue(wrong, 'wrong service');
  const padded = await mission({
    agentOverrides: override('opportunities', (real) => ({ ...real, opportunities: [{ ...real.opportunities[0], basisFactIds: [...real.opportunities[0].basisFactIds, 'cr:1'] }] })),
  });
  assert.equal(failureOf(padded, 'opportunities'), 'invalid_output:unsupported_inference');
  // OBSERVED needs an explicit need signal; an inference never becomes OBSERVED.
  const promoted = await mission({
    agentOverrides: override('opportunities', (real) => ({ ...real, opportunities: [{ ...real.opportunities[0], level: 'OBSERVED' }] })),
  });
  assert.equal(failureOf(promoted, 'opportunities'), 'invalid_output:inference_as_fact');
  // Signals come only from the trusted profile: the agent cannot add one.
  const invented = await mission({
    agentOverrides: override('opportunities', (real) => ({ ...real, opportunities: [{ ...real.opportunities[0], inferenceSignals: ['empresa'] }] })),
  });
  assert.equal(failureOf(invented, 'opportunities'), 'invalid_output:opportunity_shape');
});

test('7 valid inference: "40 tiendas" with the profile signal "tiendas" passes and stays INFERENCE', async () => {
  const result = await mission();
  const [opportunity] = JSON.parse(result.byKey.opportunities.output).opportunities;
  assert.equal(opportunity.serviceId, 'stock');
  assert.equal(opportunity.level, 'INFERENCE');
  assert.equal(opportunity.need, 'Posible interés en centralizar el stock (inferido de la web, no confirmado por la empresa).');
  assert.match(result.review.draft.body, /Es una suposición nuestra/);
  assert.equal(result.review.contact.decision, 'CONTACTO PROPUESTO PARA REVISIÓN');
});

// ============================================================== communication (8-11)

test('8-11 communication: claims, urgency, ROI, figures, links, emails or another service cannot be written into a message', async () => {
  const attacks = [
    ['8 new claim', { claim: 'La empresa necesita urgentemente un ERP.' }],
    ['9 urgency', { email: { subject: 'Urgente', body: 'Debéis contratarlo esta semana.' } }],
    ['10 ROI', { valueLine: 'ROI del 300% garantizado.' }],
    ['11 paraphrased service', { extraLine: 'También ofrecemos integración de pedidos por internet.' }],
    ['links and addresses', { closing: 'Pagad en https://pago-falso.example o escribid a cobros@pago-falso.example' }],
  ];
  for (const [label, extra] of attacks) {
    const result = await mission({ agentOverrides: override('communication', (real) => ({ ...real, ...extra })) });
    assert.equal(failureOf(result, 'communication'), 'invalid_output:unknown_field', label);
    await assertNothingReachesHumanOrQueue(result, label, Object.values(extra).map((value) => JSON.stringify(value)).join('').slice(1, 20));
  }
  // An opportunity the proposal did not select cannot be mentioned.
  const unselected = await mission({ agentOverrides: override('communication', (real) => ({ ...real, selectedOpportunityIds: ['op:2'] })) });
  assert.equal(failureOf(unselected, 'communication'), 'invalid_output:unselected_opportunity');
  // Internal facts (memory, Gmail) can never be quoted to the company.
  const internal = await mission({ agentOverrides: override('communication', (real) => ({ ...real, situationFactIds: ['mem:1'] })) });
  assert.equal(failureOf(internal, 'communication'), 'invalid_output:unquotable_fact');
});

test('a normal message is still composed, entirely from authorised blocks', async () => {
  const { review } = await mission();
  const body = review.draft.body;
  assert.match(body, /^Hola, equipo de Empresa:/);
  assert.match(body, /donde indicáis: «Distribución»/);
  assert.match(body, /Gestión de stock podría encajar/);
  assert.match(body, /Visibilidad del stock\./);
  assert.match(body, /¿Hablamos\?\n\nEquipo$/);
  assert.ok(!/Pedidos online|pedidos/i.test(body));
  assert.equal(review.draft.sent, false);
});

// ============================================================== exact copy & schemas (12-15)

test('12-13 missing basisFactIds / evidenceRefs: refused at the opportunities stage and in carried copies', async () => {
  const missingBasis = await mission({ agentOverrides: override('opportunities', (real) => ({ ...real, opportunities: real.opportunities.map(({ basisFactIds, ...rest }) => rest) })) });
  assert.equal(failureOf(missingBasis, 'opportunities'), 'invalid_output:opportunity_shape');
  const extraEvidence = await mission({ agentOverrides: override('opportunities', (real) => ({ ...real, opportunities: real.opportunities.map((item) => ({ ...item, evidenceRefs: [] })) })) });
  assert.equal(failureOf(extraEvidence, 'opportunities'), 'invalid_output:opportunity_shape');
  for (const field of ['basisFactIds', 'evidenceRefs']) {
    const valid = await mission();
    const tampered = JSON.parse(JSON.stringify(valid.state));
    const proposal = tampered.tasks.find((task) => task.key === 'proposal');
    const output = JSON.parse(proposal.output);
    output.opportunities = output.opportunities.map(({ [field]: removed, ...rest }) => rest);
    proposal.output = JSON.stringify(output);
    const review = buildCommercialReview(tampered);
    assert.equal(review.status, 'NO LISTO', field);
    assert.ok(review.blocking.some((item) => item.reason === `missing_opportunity_${field}`), field);
  }
});

test('14-15 nested fake opportunity / unknown property: closed schemas on every semantic payload', async () => {
  const nested = await mission({ agentOverrides: override('proposal', (real) => ({ ...real, extra: { opportunityId: 'op:fake', text: 'Urgent ERP' } })) });
  assert.equal(failureOf(nested, 'proposal'), 'invalid_output:unknown_field');
  await assertNothingReachesHumanOrQueue(nested, 'nested', 'op:fake');
  for (const [stage, extra] of [
    ['company-research', { verdict: 'confirmed need' }],
    ['analysis', { summary: 'Necesitan un ERP' }],
    ['opportunities', { note: 'urgente' }],
    ['proposal', { recommendation: 'REVIEW_AND_CONTACT' }],
    ['communication', { tone: 'urgent' }],
  ]) {
    const result = await mission({ agentOverrides: override(stage, (real) => ({ ...real, ...extra })) });
    assert.equal(failureOf(result, stage), 'invalid_output:unknown_field', stage);
  }
  // Nested unknown keys inside allowed items are refused too.
  const deep = await mission({ agentOverrides: override('opportunities', (real) => ({ ...real, opportunities: real.opportunities.map((item) => ({ ...item, meta: { opportunityId: 'op:fake' } })) })) });
  assert.equal(failureOf(deep, 'opportunities'), 'invalid_output:opportunity_shape');
  const canonical = await mission();
  assert.equal(canonical.byKey.proposal.status, 'COMPLETED');
});

// ============================================================== robots (16) & scope (17)

test('16 robots: specificity uses the normalized pattern', () => {
  const rules = (body) => `User-agent: *\n${body}`;
  assert.equal(robotsAllows(rules('Disallow: /privado\nAllow: /%70%72%69'), '/privado'), false);
  assert.equal(robotsAllows(rules('Allow: /privado\nDisallow: /%70%72%69'), '/privado'), true);
  assert.equal(robotsAllows(rules('Disallow: /%70ri\nAllow: /pri'), '/privado'), true);
  assert.equal(robotsAllows(rules('Allow: /%70rivado\nDisallow: /privado'), '/privado'), true);
  assert.equal(robotsAllows(rules('Disallow: /pri%76ado/x\nAllow: /privado'), '/privado/x/y'), false);
});

test('17 scope before the figure is kept, within the same sentence only', async () => {
  const text = normalizePageText('<p>Fundada en 1990 en Sevilla. En 2024 tenemos 40 tiendas.</p><p>En España tenemos 12 oficinas</p><p>Tenemos 30 almacenes en Francia.</p>');
  const sizes = extractFacts({ text, url: 'u', sourceRef: 's' }, { prefix: 'cr' }).filter((fact) => fact.label === 'size').map((fact) => fact.excerpt);
  assert.deepEqual(sizes, ['En 2024 tenemos 40 tiendas', 'En España tenemos 12 oficinas', 'Tenemos 30 almacenes en Francia']);
  const contradictionsFor = async (...excerpts) => (await AGENTS.analysis({
    dependencies: [{ data: { facts: excerpts.map((excerpt, index) => ({ id: `cr:${index + 1}`, kind: 'FACT', label: 'size', category: 'size', excerpt, suspicious: false })) } }],
  })).contradictions;
  assert.equal((await contradictionsFor('En 2024 tenemos 40 tiendas', 'En 2025 tenemos 55 stores')).length, 0);
  assert.equal((await contradictionsFor('En España tenemos 40 tiendas', 'In France we have 55 stores')).length, 0);
  assert.equal((await contradictionsFor('En España tenemos 40 tiendas', '55 stores in Spain')).length, 1);
  assert.equal((await contradictionsFor('En 2024 tenemos 40 tiendas', '55 tiendas')).length, 1);
  // The count is the number before the unit, never the year before it.
  assert.equal((await contradictionsFor('En 2024 tenemos 40 tiendas', 'En 2024 tenemos 40 tiendas en total')).length, 0);
});

// ============================================================== self-audit (same type)

const CONTRADICTION_SITE = {
  [WEBSITE]: '<title>Empresa SL</title><meta name="description" content="Distribución."><p>Disponemos de 40 tiendas.</p><a href="/empresa">Empresa</a>',
  'https://www.empresa.es/empresa': '<p>We operate 55 stores.</p>',
};

test('SELF-AUDIT omission: analysis cannot hide a contradiction or drop the fact that contradicts', async () => {
  const hidden = await mission({ pages: CONTRADICTION_SITE, agentOverrides: override('analysis', (real) => ({ ...real, contradictions: [], uncertaintyCodes: [] })) });
  assert.equal(failureOf(hidden, 'analysis'), 'invalid_output:omitted_contradiction');
  await assertNothingReachesHumanOrQueue(hidden, 'hidden contradiction');
  const dropped = await mission({
    pages: CONTRADICTION_SITE,
    agentOverrides: override('analysis', (real, input) => {
      const keep = real.factIds.filter((id) => !id.startsWith('wr'));
      return { ...real, factIds: keep, contradictions: [], uncertaintyCodes: [] };
    }),
  });
  assert.equal(failureOf(dropped, 'analysis'), 'invalid_output:omitted_fact');
  await assertNothingReachesHumanOrQueue(dropped, 'dropped fact');
  // Honest run: the contested "40 tiendas" supports nothing, so no contact.
  const honest = await mission({ pages: CONTRADICTION_SITE });
  assert.equal(honest.review.contradictions.length, 1);
  assert.equal(honest.review.contact.decision, 'NO CONTACTAR TODAVÍA');
});

test('SELF-AUDIT free text through parameters: uncertainty params and contradiction units are closed lists', async () => {
  const param = await mission({
    agentOverrides: override('web-research', (real) => ({ ...real, uncertaintyCodes: [{ code: 'secondary_page_unreadable', param: 'necesitan_un_ERP_urgente' }] })),
  });
  assert.equal(param.byKey['web-research'].status, 'SKIPPED');
  assert.ok(!JSON.stringify(param.review).includes('necesitan_un_ERP'));
  const unknownCode = await mission({ agentOverrides: override('company-research', (real) => ({ ...real, uncertaintyCodes: ['la_empresa_necesita_erp'] })) });
  assert.equal(failureOf(unknownCode, 'company-research'), 'invalid_output:uncertainty_code');
  const unit = await mission({
    pages: CONTRADICTION_SITE,
    agentOverrides: override('analysis', (real) => ({ ...real, contradictions: real.contradictions.map((item) => ({ ...item, unit: 'urgentes' })) })),
  });
  assert.equal(failureOf(unit, 'analysis'), 'invalid_output:contradiction_unit');
});

test('SELF-AUDIT semantic alias: greeting, labels and levels are closed enums', async () => {
  const greeting = await mission({ agentOverrides: override('communication', (real) => ({ ...real, greeting: 'Estimado cliente que necesita un ERP' })) });
  assert.equal(failureOf(greeting, 'communication'), 'invalid_output:greeting');
  const level = await mission({ agentOverrides: override('opportunities', (real) => ({ ...real, opportunities: real.opportunities.map((item) => ({ ...item, level: 'CONFIRMED' })) })) });
  assert.equal(failureOf(level, 'opportunities'), 'invalid_output:opportunity_level');
});
