'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { digestOutput } = require('../evidence-registry');
const { BLUEPRINTS } = require('../mission-blueprints');
const { normalizePageText } = require('./public-web-fetcher');
const { runCompanyOpportunity } = require('./company-opportunity');
const { submitCommercialReview } = require('./approval-review-adapter');
const ApprovalQueue = require('../../../core/approvalQueue');

// Fixture sites (clearly fixtures: sourceOrigin 'fixture'); no network.
const NOW = '2026-10-03T10:00:00.000Z';
const HOME = `<html><head><title>Ferretería Ejemplo | Suministros industriales</title>
  <meta name="description" content="Distribuidor de suministros industriales con 5 tiendas en Andalucía y venta online.">
  <script type="application/ld+json">{"@type":"Organization","legalName":"Ferretería Ejemplo SL","address":{"addressLocality":"Sevilla"}}</script>
  </head><body><h1>Suministros para profesionales</h1>
  <p>Gestionamos el stock de nuestro almacén central y repartimos a las tiendas cada día.</p>
  <a href="/empresa">Quiénes somos</a><a href="https://otra-web.com/empresa">Partner</a></body></html>`;
const ABOUT = '<html><head><title>Quiénes somos</title></head><body><p>Somos un equipo de 40 empleados.</p></body></html>';

function site(pages, { failFirst = {} } = {}) {
  const calls = [];
  const failures = { ...failFirst };
  return {
    calls,
    fetcher: {
      async fetchPage(url) {
        calls.push(url);
        if (failures[url] > 0) {
          failures[url] -= 1;
          throw Object.assign(new Error('network_error'), { code: 'network_error', failureKind: 'tool_error' });
        }
        if (!pages[url]) throw Object.assign(new Error('http_404'), { code: 'http_404', failureKind: 'tool_error' });
        return { url, fetchedAt: NOW, text: normalizePageText(pages[url]) };
      },
    },
  };
}

const PROFILE = Object.freeze({
  id: 'test-seller',
  name: 'Vendedor de prueba',
  offering: 'Software de gestión para pymes de distribución.',
  services: [{
    id: 'stock', name: 'Gestión de stock multitienda', description: 'Control de stock entre almacén y tiendas.',
    needLabel: 'centralizar la gestión de stock', signals: ['stock', 'almacén'], explicitNeedSignals: ['buscamos un erp'],
    valueStatement: 'Visibilidad del stock entre almacén y tiendas.', qualifyingQuestions: ['¿Qué sistema usáis hoy?'],
  }],
  prohibitedClaims: ['ahorro garantizado'],
  scope: 'Diagnóstico inicial.', callToAction: '¿Hablamos?', nextAction: 'Revisar y decidir.', signature: 'Equipo de prueba',
});

const MAIN = { 'https://www.ferreteria-ejemplo.es/': HOME, 'https://www.ferreteria-ejemplo.es/empresa': ABOUT };
const TARGET = Object.freeze({ company: 'Ferretería Ejemplo', website: 'https://www.ferreteria-ejemplo.es/' });

async function run(overrides = {}) {
  const fixture = overrides.site || site(MAIN);
  const result = await runCompanyOpportunity({
    target: TARGET, sellerProfile: PROFILE, fetcher: fixture.fetcher, sourceOrigin: 'fixture',
    memorySearch: async () => [], now: () => NOW, ...overrides,
  });
  return { ...result, calls: fixture.calls, byKey: Object.fromEntries(result.state.tasks.map((task) => [task.key, task])) };
}

// 1
test('company-opportunity is planned through the full agent hierarchy, with optional sources', async () => {
  const { byKey } = await run();
  const route = (key) => [byKey[key].assignedCoordinator, byKey[key].assignedAgent];
  assert.deepEqual(route('company-research'), ['RESEARCH_COORDINATOR', 'research-agent']);
  assert.deepEqual(route('web-research'), ['RESEARCH_COORDINATOR', 'web-research-agent']);
  assert.deepEqual(route('analysis'), ['DATA_COORDINATOR', 'data-analysis-agent']);
  assert.deepEqual(route('opportunities'), ['DATA_COORDINATOR', 'opportunity-agent']);
  assert.deepEqual(route('proposal'), ['COMMUNICATION_COORDINATOR', 'proposal-agent']);
  assert.deepEqual(route('communication'), ['COMMUNICATION_COORDINATOR', 'communication-agent']);
  assert.ok(['web-research', 'context-recall', 'prior-correspondence'].every((key) => byKey[key].optional));
  assert.equal(BLUEPRINTS.COMPANY_OPPORTUNITY.match, null);
});

// 2, 7, 25
test('research yields quoted facts with registered, digest-bound evidence', async () => {
  const { state, review, resolveEvidence } = await run();
  assert.equal(review.status, 'LISTO PARA REVISIÓN');
  assert.ok(review.dossier.length >= 5);
  for (const fact of review.dossier) {
    assert.equal(fact.label, 'FACT');
    const page = fact.source.endsWith('/empresa') ? ABOUT : HOME;
    assert.ok(normalizePageText(page).includes(fact.excerpt), fact.excerpt);
  }
  assert.ok(review.evidence.length >= 1 && review.evidence.every((item) => item.origin === 'fixture' && item.kind === 'web_page'));
  for (const task of state.tasks.filter((item) => item.status === 'COMPLETED')) {
    const entry = resolveEvidence(task.evidenceRefs[0]);
    assert.equal(entry.outputDigest, digestOutput(task.output), task.key);
    assert.equal(entry.registrarId, 'tool:xatai-mission');
  }
  assert.ok(review.evidence.every((item) => resolveEvidence(item.ref).kind === 'web_page_fixture'));
});

// 3, 4
test('needs are inferences unless stated; nothing absent is invented', async () => {
  const { review } = await run();
  assert.equal(review.opportunities.observed.length, 0);
  assert.equal(review.opportunities.inferred.length, 1);
  const [opportunity] = review.opportunities.inferred;
  assert.match(opportunity.need, /inferido de la web, no confirmado/);
  assert.ok(opportunity.uncertainties.length > 0);
  // No contact name was given: none is invented.
  assert.match(review.draft.body, /^Hola, equipo de Ferretería Ejemplo:/);
  // Every figure in the draft comes from a quoted fact.
  for (const number of review.draft.body.match(/\d+/g) || []) {
    assert.ok(review.dossier.some((fact) => fact.excerpt.includes(number)), number);
  }
  assert.ok(!/ROI|factura|garantizad/i.test(JSON.stringify(review.proposal)));
});

// 5
test('multi-agent transfer: research -> analysis -> opportunities -> proposal -> communication', async () => {
  const { byKey } = await run();
  const data = (key) => JSON.parse(byKey[key].output);
  const researchIds = data('company-research').facts.map((fact) => fact.id);
  assert.ok(researchIds.every((id) => data('analysis').facts.some((fact) => fact.id === id)));
  assert.ok(data('opportunities').opportunities[0].basisFactIds.every((id) => data('analysis').facts.some((fact) => fact.id === id)));
  assert.equal(data('proposal').opportunities[0].opportunityId, data('opportunities').opportunities[0].id);
  assert.match(data('communication').email.body, /Gestión de stock multitienda/);
});

// 9, 10
test('privacy: optional Gmail stays CONFIDENTIAL and its class propagates; a SECRET context never fetches', async () => {
  const { byKey } = await run();
  assert.equal(byKey['prior-correspondence'].privacyClass, 'CONFIDENTIAL');
  assert.equal(byKey.analysis.privacyClass, 'CONFIDENTIAL');
  const secret = site(MAIN);
  const { byKey: secretKeys, review } = await run({ site: secret, target: { ...TARGET, company: 'Empresa password: hunter2' } });
  assert.equal(secret.calls.length, 0);
  assert.notEqual(secretKeys['company-research'].status, 'COMPLETED');
  assert.equal(review.status, 'NO LISTO');
});

// 11, 12, 13, 14, 27
test('self-correction: a failed fetch is charged, diagnosed and retried with another strategy (www variant)', async () => {
  const flaky = site({ 'https://ferreteria-ejemplo.es/': HOME, 'https://ferreteria-ejemplo.es/empresa': ABOUT },
    { failFirst: {} });
  const { state, byKey, calls } = await run({ site: flaky });
  // The given URL (www) does not exist in this fixture; the Sentinel's
  // CHANGE_TOOL makes the agent try the non-www variant, which works.
  assert.equal(byKey['company-research'].status, 'COMPLETED');
  assert.deepEqual(calls.slice(0, 2), ['https://www.ferreteria-ejemplo.es/', 'https://ferreteria-ejemplo.es/']);
  assert.equal(state.revisions[0].action, 'CHANGE_TOOL');
  const ledger = state.costLedger.filter((entry) => entry.taskId.endsWith(':company-research'));
  assert.deepEqual(ledger.map((entry) => entry.status), ['CONSUMED', 'CONSUMED']);
  // Local deterministic work: catalog price 0 (no paid API), actual cost unknown, never assumed.
  assert.equal(state.estimatedSpentUsd, 0);
  assert.equal(state.actualSpentUsd, null);
});

test('self-correction: an insufficient result is rejected by the verifier and a broader hypothesis passes', async () => {
  // No title, no metadata, no profile signals: the focused first pass finds nothing.
  const sparse = site({ 'https://www.ferreteria-ejemplo.es/': '<html><body><p>Bienvenidos a la web de Ferretería Ejemplo, distribuidor de suministros desde Sevilla.</p><p>Atendemos a profesionales de la construcción y la industria de toda la provincia.</p></body></html>' });
  const { state, byKey } = await run({ site: sparse });
  const research = byKey['company-research'];
  assert.equal(research.status, 'COMPLETED');
  const first = state.attempts[research.taskId][0];
  assert.equal(first.failureKind, 'verification_failed');
  assert.equal(state.revisions[0].action, 'CHANGE_HYPOTHESIS');
  assert.equal(research.contract.attempt.hypothesis, 'h2');
});

// 15, 26
test('retry limit: a site that never answers stops after bounded attempts and asks one concrete question', async () => {
  const down = site({});
  const { review, calls, state } = await run({ site: down });
  assert.ok(calls.length <= 3);
  assert.equal(review.status, 'NO LISTO');
  assert.match(review.questionForHuman, /No he podido leer la web oficial indicada \(http_404\)/);
  assert.notEqual(state.verification.verdict, 'PASS');
});

// 16
test('no web connection: research is NEEDS_CONNECTION and nothing is fetched or invented', async () => {
  const { state, byKey, review } = await run({ fetcher: null });
  assert.equal(byKey['company-research'].gate.decision, 'NEEDS_CONNECTION');
  assert.equal(state.engine.state, 'NEEDS_CONNECTION');
  assert.equal(review.dossier.length, 0);
});

test('no website given: one question, because no search engine is connected', async () => {
  const { state } = await run({ target: { company: 'Ferretería Ejemplo' } });
  assert.equal(state.engine.state, 'NEEDS_INFORMATION');
  assert.match(state.contract.missingInformation[0], /web oficial/);
});

// 17, 18, 19, 20, 21, 29
test('material action needs a human: the hand-off is NEEDS_APPROVAL, nothing is sent, published or deployed', async () => {
  const gmailCalls = [];
  const { byKey, review, state } = await run({ gmailSearch: async (query) => { gmailCalls.push(query); return []; } });
  assert.equal(byKey['human-review'].status, 'NEEDS_APPROVAL');
  assert.equal(byKey['human-review'].gate.reason, 'human_approval_required');
  assert.equal(review.draft.sent, false);
  assert.deepEqual(review.decisions, ['APROBAR', 'MODIFICAR', 'DESCARTAR']);
  assert.equal(state.executionEnabled, false);
  assert.equal(review.executionEnabled, false);
  for (const task of state.tasks) {
    for (const action of ['gmail.send', 'deploy', 'iam_change', 'secret_access', 'enable_execution', 'publish', 'external_message']) {
      assert.ok(task.contract.prohibitedActions.includes(action), `${task.key} ${action}`);
    }
  }
  // Gmail (no contact email given) was never queried.
  assert.equal(gmailCalls.length, 0);
});

test('prior correspondence is read-only metadata, and only with a contact address a human gave', async () => {
  const queries = [];
  const { byKey } = await run({
    target: { ...TARGET, contactEmail: 'compras@ferreteria-ejemplo.es' },
    gmailSearch: async (query) => { queries.push(query); return [{ subject: 'Pedido de suministros' }]; },
  });
  assert.deepEqual(queries, [{ senderAddress: 'compras@ferreteria-ejemplo.es' }]);
  assert.equal(byKey['prior-correspondence'].status, 'COMPLETED');
  assert.match(byKey.analysis.output, /Pedido de suministros/);
});

// 22
test('trust boundary: agents get bounded tools, never the registrar; the result exposes only evidence reads', async () => {
  let seenTools = null;
  const { review, ...result } = await run({
    agentOverrides: {
      'context-recall': async ({ tools }) => { seenTools = tools; return { stage: 'context-recall', facts: [], uncertainties: [] }; },
    },
  });
  assert.deepEqual(Object.keys(seenTools).sort(), ['fetchPage', 'searchGmail', 'searchMemory']);
  assert.ok(Object.isFrozen(seenTools));
  assert.equal(result.evidenceRegistry, undefined);
  assert.equal(typeof result.resolveEvidence, 'function');
  assert.ok(review);
  const agentsSource = fs.readFileSync(path.join(__dirname, 'company-opportunity-agents.js'), 'utf8');
  assert.doesNotMatch(agentsSource, /require\([^)]*evidence-registry|\.registrar\(|\.record\(/);
});

// 23
test('the seller profile is configuration: another profile changes the proposal, the core never names a seller', async () => {
  const other = {
    ...PROFILE, id: 'other-seller', name: 'Otro vendedor',
    services: [{ ...PROFILE.services[0], id: 'logistics', name: 'Optimización logística', signals: ['repartimos'] }],
  };
  const { review } = await run({ sellerProfile: other });
  assert.equal(review.opportunities.inferred[0].solution, 'Optimización logística');
  for (const file of ['../mission-engine.js', '../mission-blueprints.js', 'trusted-toolbox.js', 'company-opportunity-agents.js', 'company-opportunity.js']) {
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, file), 'utf8'), /ecoSoft|ecosoft|XANTALAL|Business Hunter/, file);
  }
  await assert.rejects(run({ sellerProfile: { ...PROFILE, services: [] } }), /SELLER_PROFILE_INVALID_SERVICES/);
});

// 24
test('no contamination: two missions on different companies never share facts or evidence', async () => {
  const shared = site({ ...MAIN, 'https://www.otra-empresa.es/': '<html><head><title>Otra Empresa | Hostelería</title><meta name="description" content="Restaurantes y catering."></head><body><h1>Cocina</h1></body></html>' });
  const first = await run({ site: shared });
  const second = await run({ site: shared, target: { company: 'Otra Empresa', website: 'https://www.otra-empresa.es/' } });
  const secondText = JSON.stringify(second.review);
  assert.ok(!secondText.includes('Ferretería'));
  assert.ok(first.review.evidence.every((item) => second.resolveEvidence(item.ref) === null));
});

// Approval Queue reuse (existing class, temporary file).
test('a ready review is handed to the existing Approval Queue only with a real recipient', async () => {
  const { review, state } = await run();
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'xatai-aq-'));
  const queue = new ApprovalQueue({ dataFile: path.join(dir, 'approvals.json') });
  assert.deepEqual(await submitCommercialReview({ approvalQueue: queue, review, missionId: state.missionId }),
    { submitted: false, reason: 'recipient_unknown' });
  const submitted = await submitCommercialReview({ approvalQueue: queue, review, recipient: 'compras@ferreteria-ejemplo.es', missionId: state.missionId });
  assert.equal(submitted.submitted, true);
  assert.equal(submitted.executionEnabled, false);
  const pending = await queue.listPending();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].proposal.subject, review.draft.subject);
  assert.equal(pending[0].proposal.executionEnabled, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('only the public web fetcher may touch the network; nothing in the circuit can send, deploy or read secrets', () => {
  const forbidden = /require\((['"])(?:node:)?(?:http|https|net|dns|child_process|fs)\1\)|require\([^)]*(?:gmail-draft-provider|actionExecutor|secret-runtime|executive-reasoning-provider|firebase|googleapis|openai)|fetch\(/;
  for (const file of ['company-opportunity-agents.js', 'company-research-extract.js', 'trusted-toolbox.js', 'review-package.js',
    'approval-review-adapter.js', 'company-opportunity.js', 'seller-profile.js']) {
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, file), 'utf8'), forbidden, file);
  }
  const fetcher = fs.readFileSync(path.join(__dirname, 'public-web-fetcher.js'), 'utf8');
  assert.match(fetcher, /method: 'GET'/);
  assert.doesNotMatch(fetcher, /method: '(POST|PUT|PATCH|DELETE)'/);
});
