'use strict';

// Provenance regressions (final audit of PR #22 @ 71d5f2c, 2 blockers):
// (A) internal memory attributed to the public website, and (B) mutation of
// dependency objects shared between the agent and the trusted validation.
// Root principle: a fact's provenance is canonical and immutable end to
// end, and agents only ever touch isolated copies. No network.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizePageText } = require('./public-web-fetcher');
const { AGENTS } = require('./company-opportunity-agents');
const { runCompanyOpportunity } = require('./company-opportunity');
const { submitCommercialReview } = require('./approval-review-adapter');
const { buildCommercialReview } = require('./review-package');
const { PROVENANCE, isPublicFact } = require('./semantic-canon');
const ApprovalQueue = require('../../../core/approvalQueue');

const NOW = '2026-10-03T10:00:00.000Z';
const WEBSITE = 'https://www.empresa.es/';
const PROFILE = Object.freeze({
  id: 'test-seller', name: 'Vendedor de prueba', offering: 'Software de gestión.',
  services: [{
    id: 'erp', name: 'ERP para pymes', description: 'Gestión integrada.', needLabel: 'un sistema de gestión',
    inferenceSignals: ['facturación', 'stock'], explicitNeedSignals: ['buscamos un erp'], valueStatement: 'Gestión integrada.',
  }],
  prohibitedClaims: [], scope: 'Diagnóstico.', callToAction: '¿Hablamos?', nextAction: 'Revisar.', signature: 'Equipo',
});
const RESTAURANT = { [WEBSITE]: '<title>Empresa SL</title><meta name="description" content="Restaurante familiar">' };
const PUBLIC_NEED = { [WEBSITE]: '<title>Empresa SL</title><meta name="description" content="Distribución."><p>Buscamos un ERP para crecer.</p>' };

function fetcherFor(pages) {
  return { async fetchPage(url) { return { url, fetchedAt: NOW, text: normalizePageText(pages[url] || '<title>x</title>') }; } };
}

async function mission({ pages = RESTAURANT, memory = [], gmail = null, contactEmail, agentOverrides } = {}) {
  const result = await runCompanyOpportunity({
    target: { company: 'Empresa', website: WEBSITE, contactEmail }, sellerProfile: PROFILE, fetcher: fetcherFor(pages),
    sourceOrigin: 'fixture', memorySearch: async () => memory, gmailSearch: gmail, agentOverrides, now: () => NOW,
  });
  return { ...result, byKey: Object.fromEntries(result.state.tasks.map((task) => [task.key, task])) };
}

const out = (result, key) => JSON.parse(result.byKey[key].output);
const failureOf = (result, key) => {
  const attempts = result.state.attempts[result.byKey[key].taskId] || [];
  return attempts.length ? attempts[0].failureCode : null;
};

async function queueResult(review) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xatai-prov-'));
  try {
    const queue = new ApprovalQueue({ dataFile: path.join(dir, 'approvals.json') });
    const result = await submitCommercialReview({ approvalQueue: queue, review, recipient: 'compras@empresa.es', missionId: 'm' });
    return { result, pending: await queue.listPending() };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ============================================================== A

test('A (exact attack): web "Restaurante familiar" + memory "Buscamos un ERP" — no public OBSERVED, no web attribution, nothing queued', async () => {
  const result = await mission({ memory: [{ note: 'Empresa: Buscamos un ERP' }] });
  const memoryFact = out(result, 'context-recall').facts[0];
  // Reasoning still knows the note, with its true provenance.
  assert.equal(memoryFact.provenance, PROVENANCE.INTERNAL_MEMORY);
  assert.ok(out(result, 'analysis').facts.some((fact) => fact.id === memoryFact.id));
  assert.equal(result.review.opportunities.observed.length, 0);
  assert.equal(result.review.contact.decision, 'NO CONTACTAR TODAVÍA');
  assert.equal(result.review.draft, null);
  assert.ok(!/vuestra web|publicáis/.test(JSON.stringify(result.review.otherDrafts || {})));
  const { result: submitted, pending } = await queueResult(result.review);
  assert.equal(submitted.submitted, false);
  assert.deepEqual(pending, []);
  // The internal briefing may know it; nothing external quotes it.
  assert.ok(result.review.internalBriefing);
});

test('A: an agent forcing OBSERVED on a memory fact is rejected (observed_requires_public_web)', async () => {
  const result = await mission({
    memory: [{ note: 'Empresa: Buscamos un ERP' }],
    agentOverrides: { opportunities: async () => ({ stage: 'opportunities', opportunities: [{ id: 'op:1', serviceId: 'erp', level: 'OBSERVED', basisFactIds: ['mem:1'] }], uncertaintyCodes: [] }) },
  });
  assert.equal(failureOf(result, 'opportunities'), 'invalid_output:observed_requires_public_web');
  assert.equal(result.review.draft, null);
  assert.equal((await queueResult(result.review)).result.submitted, false);
});

test('A: an internal inference stays internal — it never reaches a message, even if communication selects it', async () => {
  const result = await mission({ memory: [{ note: 'Empresa: problemas de facturación' }] });
  const [opportunity] = out(result, 'opportunities').opportunities;
  assert.deepEqual([opportunity.level, opportunity.provenance], ['INFERENCE', 'INTERNAL']);
  assert.equal(out(result, 'proposal').recommendation, 'DO_NOT_CONTACT_YET');
  assert.equal(result.review.draft, null);
  const forced = await mission({
    memory: [{ note: 'Empresa: problemas de facturación' }],
    agentOverrides: { proposal: async (input) => ({ ...(await AGENTS.proposal(input)) }), communication: async () => ({ stage: 'communication', greeting: 'team', situationFactIds: [], selectedOpportunityIds: ['op:1'] }) },
  });
  assert.ok(['invalid_output:unselected_opportunity', 'invalid_output:internal_opportunity'].includes(failureOf(forced, 'communication')));
  assert.equal(forced.review.draft, null);
});

test('A (legitimate path still works): a need stated on the public website -> OBSERVED PUBLIC_WEB -> draft -> queued for human review', async () => {
  const result = await mission({ pages: PUBLIC_NEED });
  const [opportunity] = out(result, 'opportunities').opportunities;
  assert.deepEqual([opportunity.level, opportunity.provenance], ['OBSERVED', PROVENANCE.PUBLIC_WEB]);
  assert.match(result.review.draft.body, /Por lo que indicáis en vuestra web/);
  const { result: submitted, pending } = await queueResult(result.review);
  assert.equal(submitted.submitted, true);
  assert.equal(pending.length, 1);
});

// ============================================================== B

test('B (exact attack): mutating the received memory fact into a web description changes nothing trusted', async () => {
  let attempts = 0;
  const result = await mission({
    memory: [{ note: 'Empresa cliente antiguo' }],
    agentOverrides: {
      analysis: async (input) => {
        attempts += 1;
        for (const dependency of input.dependencies) {
          for (const fact of (dependency.data && dependency.data.facts) || []) {
            if (fact.label === 'memory') {
              assert.throws(() => Object.assign(fact, { label: 'description', excerpt: 'Buscamos un ERP', provenance: 'PUBLIC_WEB' }), TypeError);
            }
          }
        }
        return AGENTS.analysis(input);
      },
    },
  });
  assert.ok(attempts >= 1);
  assert.equal(result.byKey.analysis.status, 'COMPLETED');
  const memoryFact = out(result, 'analysis').facts.find((fact) => fact.id === 'mem:1');
  assert.deepEqual([memoryFact.label, memoryFact.provenance], ['memory', PROVENANCE.INTERNAL_MEMORY]);
  assert.ok(!JSON.stringify(result.review).includes('Buscamos un ERP'));
  assert.equal((await queueResult(result.review)).result.submitted, false);
});

test('B: the guarantee is separation, not freezing — an agent mutating its own clone cannot affect validation', async () => {
  const seen = [];
  const result = await mission({
    memory: [{ note: 'Empresa cliente antiguo' }],
    agentOverrides: {
      analysis: async (input) => {
        const { tools, ...data } = input;
        const copy = { ...structuredClone(data), tools };
        for (const dependency of copy.dependencies) {
          for (const fact of (dependency.data && dependency.data.facts) || []) {
            fact.label = 'description'; fact.provenance = 'PUBLIC_WEB'; fact.excerpt = 'Buscamos un ERP';
            fact.sourceRef = 'src:other'; delete fact.statement; fact.extra = { nested: true };
          }
          if (dependency.data && dependency.data.facts) dependency.data.facts.push({ id: 'cr:99', label: 'description', excerpt: 'x' });
        }
        seen.push(copy);
        return AGENTS.analysis(copy);
      },
    },
  });
  // Ids are what the agent returns; the toolbox rebuilds from its own state.
  assert.equal(failureOf(result, 'analysis'), 'invalid_output:unknown_fact');
  assert.ok(seen.length > 0);
  assert.ok(!JSON.stringify(result.review).includes('Buscamos un ERP'));
  assert.equal((await queueResult(result.review)).result.submitted, false);
});

test('B variants: direct, nested, array, delete and add mutations all fail on the isolated copy; trusted outputs unchanged', async () => {
  const before = await mission({ memory: [{ note: 'Empresa cliente antiguo' }] });
  const semantic = (output) => output.facts.map(({ id, label, category, statement, excerpt, provenance }) => ({ id, label, category, statement, excerpt, provenance }));
  const reference = semantic(out(before, 'context-recall'));
  const attacks = {
    direct: (fact) => { fact.excerpt = 'Buscamos un ERP'; },
    nested: (fact, dependency) => { dependency.data.extra = { opportunityId: 'op:fake' }; },
    array: (fact, dependency) => { dependency.data.facts.push({ ...fact, id: 'cr:7' }); },
    delete: (fact) => { delete fact.provenance; },
    add: (fact) => { fact.publicQuote = true; },
    provenance: (fact) => { fact.provenance = 'PUBLIC_WEB'; },
    sourceRef: (fact) => { fact.sourceRef = 'src:mission-x:company-research:1'; },
  };
  for (const [name, mutate] of Object.entries(attacks)) {
    let threw = 0;
    const result = await mission({
      memory: [{ note: 'Empresa cliente antiguo' }],
      agentOverrides: {
        analysis: async (input) => {
          for (const dependency of input.dependencies) {
            for (const fact of (dependency.data && dependency.data.facts) || []) {
              if (fact.provenance === PROVENANCE.INTERNAL_MEMORY) {
                try { mutate(fact, dependency); } catch (error) { threw += 1; }
              }
            }
          }
          return AGENTS.analysis(input);
        },
      },
    });
    assert.ok(threw >= 1, name);
    assert.deepEqual(semantic(out(result, 'context-recall')), reference, name);
    assert.equal(result.byKey.analysis.status, 'COMPLETED', name);
    assert.ok(out(result, 'analysis').facts.every((fact) => fact.id !== 'mem:1' || fact.provenance === PROVENANCE.INTERNAL_MEMORY), name);
  }
});

// ============================================================== provenance confusion variants

test('provenance confusion: INTERNAL->PUBLIC and Gmail->WEB relabelling at origin are rejected', async () => {
  const memoryAsWeb = await mission({
    memory: [{ note: 'Empresa: Buscamos un ERP' }],
    agentOverrides: { 'context-recall': async (input) => {
      const real = await AGENTS['context-recall'](input);
      return { ...real, facts: real.facts.map((fact) => ({ ...fact, label: 'description' })) };
    } },
  });
  assert.equal(memoryAsWeb.byKey['context-recall'].status, 'SKIPPED');
  assert.equal(failureOf(memoryAsWeb, 'context-recall'), 'invalid_output:fact_source_kind');
  const gmailAsWeb = await mission({
    contactEmail: 'compras@empresa.es',
    gmail: async () => [{ subject: 'Buscamos un ERP' }],
    agentOverrides: { 'prior-correspondence': async (input) => {
      const real = await AGENTS['prior-correspondence'](input);
      return { ...real, facts: real.facts.map((fact) => ({ ...fact, label: 'signal' })) };
    } },
  });
  assert.equal(failureOf(gmailAsWeb, 'prior-correspondence'), 'invalid_output:fact_source_kind');
  for (const result of [memoryAsWeb, gmailAsWeb]) {
    assert.equal(result.review.draft, null);
    assert.equal((await queueResult(result.review)).result.submitted, false);
  }
});

test('provenance confusion: a memory fact cannot take a public id, nor be quoted through a public-looking selection', async () => {
  const publicId = await mission({
    memory: [{ note: 'Empresa: Buscamos un ERP' }],
    agentOverrides: { 'context-recall': async (input) => {
      const real = await AGENTS['context-recall'](input);
      return { ...real, facts: real.facts.map((fact) => ({ ...fact, id: 'cr:1' })) };
    } },
  });
  assert.equal(failureOf(publicId, 'context-recall'), 'invalid_output:fact_id');
  const quoted = await mission({
    pages: PUBLIC_NEED,
    memory: [{ note: 'Empresa: dato interno confidencial' }],
    agentOverrides: { communication: async (input) => ({ ...(await AGENTS.communication(input)), situationFactIds: ['mem:1'] }) },
  });
  assert.equal(failureOf(quoted, 'communication'), 'invalid_output:unquotable_fact');
  assert.ok(!JSON.stringify(quoted.review).includes('dato interno confidencial') || !quoted.review.draft);
});

test('provenance confusion: the same excerpt in memory and on the web keeps two facts with unambiguous provenance', async () => {
  const result = await mission({ pages: PUBLIC_NEED, memory: [{ note: 'Buscamos un ERP para crecer.' }] });
  const facts = out(result, 'analysis').facts.filter((fact) => fact.excerpt.includes('Buscamos un ERP para crecer'));
  const byProvenance = Object.fromEntries(facts.map((fact) => [fact.provenance, fact.id]));
  assert.ok(byProvenance.PUBLIC_WEB && byProvenance.INTERNAL_MEMORY);
  assert.notEqual(byProvenance.PUBLIC_WEB, byProvenance.INTERNAL_MEMORY);
  const [opportunity] = out(result, 'opportunities').opportunities;
  assert.equal(opportunity.provenance, PROVENANCE.PUBLIC_WEB);
  assert.ok(opportunity.basisFactIds.every((id) => id === byProvenance.PUBLIC_WEB || !id.startsWith('mem')));
  assert.ok(result.review.draft);
});

test('provenance in the review: a tampered state that flips provenance or relabels a fact is NO LISTO', async () => {
  const valid = await mission({ pages: PUBLIC_NEED, memory: [{ note: 'Empresa cliente antiguo' }] });
  for (const mutate of [
    (fact) => (fact.id === 'mem:1' ? { ...fact, provenance: PROVENANCE.PUBLIC_WEB } : fact),
    (fact) => (fact.id === 'mem:1' ? { ...fact, label: 'description', category: 'activity', statement: `Descripción publicada: "${fact.excerpt}"` } : fact),
  ]) {
    const tampered = JSON.parse(JSON.stringify(valid.state));
    const analysis = tampered.tasks.find((task) => task.key === 'analysis');
    const output = JSON.parse(analysis.output);
    output.facts = output.facts.map(mutate);
    analysis.output = JSON.stringify(output);
    const review = buildCommercialReview(tampered);
    assert.equal(review.status, 'NO LISTO');
    assert.ok(review.blocking.some((item) => item.reason === 'altered_fact'));
  }
  assert.equal(isPublicFact({ label: 'description', provenance: PROVENANCE.INTERNAL_MEMORY }), false);
  assert.equal(isPublicFact({ label: 'memory', provenance: PROVENANCE.PUBLIC_WEB }), false);
});
