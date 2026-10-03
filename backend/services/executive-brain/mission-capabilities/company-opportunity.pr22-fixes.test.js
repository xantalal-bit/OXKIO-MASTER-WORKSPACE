'use strict';

// Regressions for the two blockers of the independent review of PR #22
// (HEAD 3a21149): redirects escaping the authorized site, and contact
// material produced under DO_NOT_CONTACT_YET. No network: the real
// fetcher runs on a fake HTTPS transport and a fake resolver.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPublicWebFetcher, normalizePageText } = require('./public-web-fetcher');
const { AGENTS } = require('./company-opportunity-agents');
const { runCompanyOpportunity } = require('./company-opportunity');
const { submitCommercialReview } = require('./approval-review-adapter');
const ApprovalQueue = require('../../../core/approvalQueue');

const NOW = '2026-10-03T10:00:00.000Z';
const WEBSITE = 'https://www.empresa.es/';
const PROFILE = Object.freeze({
  id: 'test-seller', name: 'Vendedor de prueba', offering: 'Software de gestión.',
  services: [{
    id: 'stock', name: 'Gestión de stock multitienda', description: 'Control de stock.', needLabel: 'centralizar el stock',
    signals: ['stock', 'almacén', 'empleados'], explicitNeedSignals: ['buscamos un erp'], valueStatement: 'Visibilidad del stock.',
  }],
  prohibitedClaims: ['ahorro garantizado'], scope: 'Diagnóstico.', callToAction: '¿Hablamos?', nextAction: 'Revisar.', signature: 'Equipo',
});
const NO_MATCH_PROFILE = Object.freeze({ ...PROFILE, services: [{ ...PROFILE.services[0], signals: ['palabra-inexistente'] }] });

function realFetcher(routes) {
  const requests = [];
  const transport = {
    async request(url) {
      requests.push(url.href);
      const response = routes[url.href] || { status: 404, headers: {}, body: '' };
      return { status: response.status, header: (name) => (response.headers || {})[name.toLowerCase()] || null, body: response.body || '' };
    },
  };
  return { requests, fetcher: createPublicWebFetcher({ transport, resolve: async () => [{ address: '93.184.216.34', family: 4 }], now: () => NOW }) };
}

const html = (body) => ({ status: 200, headers: { 'content-type': 'text/html' }, body });
const redirect = (location) => ({ status: 302, headers: { location }, body: '' });

function fixtureFetcher(pages) {
  return {
    async fetchPage(url) {
      if (!pages[url]) throw Object.assign(new Error('http_404'), { code: 'http_404', failureKind: 'tool_error' });
      return { url, fetchedAt: NOW, text: normalizePageText(pages[url]) };
    },
  };
}

async function mission({ fetcher, sellerProfile = PROFILE, agentOverrides } = {}) {
  const result = await runCompanyOpportunity({
    target: { company: 'Empresa', website: WEBSITE }, sellerProfile, fetcher, sourceOrigin: 'fixture',
    memorySearch: async () => [], agentOverrides, now: () => NOW,
  });
  return { ...result, byKey: Object.fromEntries(result.state.tasks.map((task) => [task.key, task])) };
}

function recordedSourceRefs(result) {
  const research = result.byKey['company-research'];
  const refs = [];
  for (let sequence = 1; sequence <= 40; sequence += 1) {
    for (const key of ['company-research', 'web-research']) {
      const entry = result.resolveEvidence(`src:${result.state.missionId}:${key}:${sequence}`);
      if (entry) refs.push(entry);
    }
  }
  return { research, refs };
}

// ------------------------------------------------------------ blocker 1

test('blocker 1 (regression 7): an off-site redirect is refused end to end and nothing from it becomes evidence', async () => {
  const { fetcher, requests } = realFetcher({
    'https://www.empresa.es/robots.txt': { status: 404 },
    'https://www.empresa.es/': redirect('https://otro-dominio.com/landing'),
    'https://otro-dominio.com/landing': html('<title>Otro Dominio SA</title><meta name="description" content="Stock y almacén.">'),
  });
  const result = await mission({ fetcher });
  assert.ok(!requests.some((url) => url.startsWith('https://otro-dominio.com')));
  assert.notEqual(result.byKey['company-research'].status, 'COMPLETED');
  assert.equal(result.state.attempts[result.byKey['company-research'].taskId][0].failureCode, 'off_site_redirect');
  assert.deepEqual(recordedSourceRefs(result).refs, []);
  assert.equal(result.review.dossier.length, 0);
  assert.ok(!JSON.stringify(result.review).includes('Otro Dominio'));
  assert.match(result.review.questionForHuman, /off_site_redirect/);
});

test('blocker 1: same-site redirects (www twin, other path) still work through the real fetcher', async () => {
  const { fetcher } = realFetcher({
    'https://www.empresa.es/robots.txt': { status: 404 },
    'https://empresa.es/robots.txt': { status: 404 },
    'https://www.empresa.es/': redirect('https://empresa.es/es/'),
    'https://empresa.es/es/': html('<title>Empresa SL</title><meta name="description" content="Gestionamos el stock de nuestro almacén.">'),
  });
  const result = await mission({ fetcher });
  assert.equal(result.byKey['company-research'].status, 'COMPLETED');
  assert.ok(result.review.evidence.every((item) => item.url.startsWith('https://empresa.es/')));
});

test('blocker 1: defence in depth — a fetcher that ignores the policy still cannot record an off-site page', async () => {
  const careless = {
    async fetchPage() {
      return { url: 'https://otro-dominio.com/landing', fetchedAt: NOW, text: '<title>Otro Dominio SA</title><meta name="description" content="Stock.">' };
    },
  };
  const result = await mission({ fetcher: careless });
  assert.notEqual(result.byKey['company-research'].status, 'COMPLETED');
  assert.equal(result.state.attempts[result.byKey['company-research'].taskId][0].failureCode, 'off_site_redirect');
  assert.deepEqual(recordedSourceRefs(result).refs, []);
});

// ------------------------------------------------------------ blocker 2

const STOCK_SITE = { [WEBSITE]: '<title>Empresa SL</title><meta name="description" content="Distribución industrial."><p>Gestionamos el stock de nuestro almacén.</p>' };
const NEUTRAL_SITE = { [WEBSITE]: '<title>Empresa SL</title><meta name="description" content="Restaurante familiar con cocina tradicional."><h1>Bienvenidos</h1>' };

test('blocker 2 (1, 4): a backed inference produces a draft, unsent, that keeps its INFERENCE character', async () => {
  const { review } = await mission({ fetcher: fixtureFetcher(STOCK_SITE) });
  assert.equal(review.contact.decision, 'CONTACTO PROPUESTO PARA REVISIÓN');
  assert.equal(review.recommendation, 'REVIEW_AND_CONTACT');
  assert.equal(review.draft.sent, false);
  assert.equal(review.opportunities.inferred.length, 1);
  assert.match(review.draft.body, /Es una suposición nuestra/);
  assert.ok(review.otherDrafts.salesBriefing.inferences.length === 1);
});

test('blocker 2 (2): no opportunity -> DO_NOT_CONTACT_YET, no draft, no message, no follow-up; an internal briefing says why', async () => {
  const { review, byKey } = await mission({ fetcher: fixtureFetcher(NEUTRAL_SITE), sellerProfile: NO_MATCH_PROFILE });
  assert.equal(review.status, 'LISTO PARA REVISIÓN');
  assert.equal(review.recommendation, 'DO_NOT_CONTACT_YET');
  assert.equal(review.contact.decision, 'NO CONTACTAR TODAVÍA');
  assert.match(review.contact.reason, /ninguna oportunidad/);
  assert.equal(review.draft, null);
  assert.equal(review.otherDrafts, null);
  const output = JSON.parse(byKey.communication.output);
  assert.deepEqual([output.email, output.shortMessage, output.followUp], [null, null, null]);
  assert.ok(output.internalBriefing.nextResearch.length > 0);
  assert.ok(output.internalBriefing.verifiedFacts.length > 0);
});

test('blocker 2 (3): no opportunity -> the Approval Queue receives nothing, even with a recipient', async () => {
  const { review, state } = await mission({ fetcher: fixtureFetcher(NEUTRAL_SITE), sellerProfile: NO_MATCH_PROFILE });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xatai-aq-'));
  try {
    const queue = new ApprovalQueue({ dataFile: path.join(dir, 'approvals.json') });
    const result = await submitCommercialReview({ approvalQueue: queue, review, recipient: 'compras@empresa.es', missionId: state.missionId });
    assert.deepEqual(result, { submitted: false, reason: 'do_not_contact' });
    assert.deepEqual(await queue.listPending(), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('blocker 2 (5): an opportunity resting only on contradicted figures is invalidated -> no draft', async () => {
  const pages = {
    [WEBSITE]: '<title>Empresa SL</title><meta name="description" content="Servicios profesionales."><p>Somos 40 empleados.</p><a href="/empresa">Empresa</a>',
    'https://www.empresa.es/empresa': '<p>Un equipo de 55 empleados.</p>',
  };
  const contradictionOnly = { ...PROFILE, services: [{ ...PROFILE.services[0], signals: ['empleados'] }] };
  const { review } = await mission({ fetcher: fixtureFetcher(pages), sellerProfile: contradictionOnly });
  assert.equal(review.contradictions.length, 1);
  assert.equal(review.opportunities.inferred.length + review.opportunities.observed.length, 0);
  assert.equal(review.contact.decision, 'NO CONTACTAR TODAVÍA');
  assert.equal(review.draft, null);
});

test('blocker 2 red team: contact material under DO_NOT_CONTACT_YET, or a contact recommendation without opportunity, is rejected', async () => {
  const sneaky = await mission({
    fetcher: fixtureFetcher(NEUTRAL_SITE),
    sellerProfile: NO_MATCH_PROFILE,
    agentOverrides: {
      communication: async (input) => ({ ...(await AGENTS.communication(input)), email: { subject: 'Hola', body: 'Os escribimos.' } }),
    },
  });
  assert.notEqual(sneaky.byKey.communication.status, 'COMPLETED');
  assert.equal(sneaky.review.draft, null);
  const pushy = await mission({
    fetcher: fixtureFetcher(NEUTRAL_SITE),
    sellerProfile: NO_MATCH_PROFILE,
    agentOverrides: { proposal: async (input) => ({ ...(await AGENTS.proposal(input)), recommendation: 'REVIEW_AND_CONTACT' }) },
  });
  assert.notEqual(pushy.byKey.proposal.status, 'COMPLETED');
  assert.equal(pushy.review.draft, null);
});
