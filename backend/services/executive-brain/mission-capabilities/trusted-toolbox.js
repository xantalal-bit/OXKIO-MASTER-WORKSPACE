'use strict';

const { digestOutput } = require('../evidence-registry');
const { containsSecretMarker } = require('../privacy-gate');
const { AGENTS, numbersIn } = require('./company-opportunity-agents');
const { isSuspicious } = require('./company-research-extract');
const { sameSite } = require('./public-web-fetcher');

// XATAI CORE V2.1: Trusted Toolbox — the composition-root trust boundary.
//
//   TOOL  -> real result -> trusted wrapper records the source (digest) ->
//            agent receives { sourceRef, text }
//   AGENT -> pure function -> result
//   WRAPPER -> checks every fact against the recorded source, every figure
//            against the facts, every claim against the seller profile ->
//            records the output evidence bound to the exact output text.
//
// The registrar is obtained once here and never leaves this closure: agents
// and executors only ever see `tools` (bounded functions) and plain data.
// Recorded sources live in a store private to this toolbox, keyed by the
// evidence reference and the mission that produced them.

const TRUSTED_REGISTRAR = 'tool:xatai-mission';
const STAGE_BY_AGENT = Object.freeze({
  'research-agent': 'company-research',
  'web-research-agent': 'web-research',
  'memory-agent': 'context-recall',
  'email-agent': 'prior-correspondence',
  'data-analysis-agent': 'analysis',
  'opportunity-agent': 'opportunities',
  'proposal-agent': 'proposal',
  'communication-agent': 'communication',
});
const MAX_TOOL_CALLS_PER_ATTEMPT = 6;
const MAX_SOURCE_CHARS = 1024 * 1024;
const URL_PATTERN = /https?:\/\/[^\s"'<>)]+/gi;
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const NON_PROSE_KEYS = new Set([
  'facts', 'indicators', 'categories', 'sourcesVisited', 'links', 'company', 'flaggedFactIds', 'basisFactIds', 'factIds',
  'factId', 'id', 'opportunityId', 'evidenceRefs', 'serviceId', 'stage',
]);

function toolError(code, failureKind) {
  const error = new Error(code);
  error.code = code;
  error.failureKind = failureKind;
  return error;
}

function invalid(code) {
  return toolError(`invalid_output:${code}`, 'invalid_output');
}

// "key: value" lines of the mission's known context (built by the
// composition root from the human's target).
function parseTarget(knownContext) {
  const target = {};
  for (const line of knownContext || []) {
    const match = /^(company|website|contact_name|contact_email):\s*(.+)$/.exec(line);
    if (match) target[{ company: 'company', website: 'website', contact_name: 'contactName', contact_email: 'contactEmail' }[match[1]]] = match[2].trim();
  }
  return Object.freeze(target);
}

function parseDependencies(dependencies) {
  return Object.freeze((dependencies || []).map((dependency) => {
    let data = null;
    if (typeof dependency.output === 'string') {
      try { data = JSON.parse(dependency.output); } catch (error) { data = null; }
    }
    return Object.freeze({
      taskId: dependency.taskId,
      stageKey: dependency.taskId.slice(dependency.taskId.lastIndexOf(':') + 1),
      data,
      skipped: dependency.skipped || null,
      withheld: dependency.withheld || null,
    });
  }));
}

function collectStrings(value, out = [], skipKeys = new Set(['facts'])) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, out, skipKeys));
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) if (!skipKeys.has(key)) collectStrings(item, out, skipKeys);
  }
  return out;
}

const SATISFIED = Object.freeze({
  'company-research': (result) => result.facts.filter((fact) => !fact.suspicious).length >= 2,
  analysis: (result) => result.facts.length >= 1,
  proposal: (result) => result.situation.length >= 1,
  communication: (result) => (result.contactDecision === 'DO_NOT_CONTACT_YET'
    ? Boolean(result.internalBriefing && result.internalBriefing.reason)
    : Boolean(result.email && result.email.subject && result.email.body)),
});

function createTrustedToolbox({
  evidenceRegistry,
  sellerProfile,
  fetcher = null,
  sourceOrigin = 'live',
  memorySearch = null,
  gmailSearch = null,
  // Test seam for red-team scenarios (a lying agent). Overrides replace the
  // agent function only: every check below still applies to its result.
  agentOverrides = {},
}) {
  if (!['live', 'fixture'].includes(sourceOrigin)) throw new TypeError('sourceOrigin must be live or fixture');
  const registrar = evidenceRegistry.registrar(TRUSTED_REGISTRAR);
  const sources = new Map();
  let sequence = 0;

  function recordSource(contract, kind, url, text, fetchedAt) {
    sequence += 1;
    const ref = `src:${contract.taskId}:${sequence}`;
    const bounded = String(text).slice(0, MAX_SOURCE_CHARS);
    registrar.record({
      ref, missionId: contract.missionId, taskId: contract.taskId, supports: ['source'],
      kind: sourceOrigin === 'fixture' ? `${kind}_fixture` : kind, outputDigest: digestOutput(bounded),
    });
    sources.set(ref, Object.freeze({
      missionId: contract.missionId, taskId: contract.taskId, url, fetchedAt, kind, origin: sourceOrigin, text: bounded,
    }));
    return ref;
  }

  function toolsFor(contract, context, target) {
    let calls = 0;
    const guard = () => {
      calls += 1;
      if (calls > MAX_TOOL_CALLS_PER_ATTEMPT) throw toolError('tool_call_limit', 'tool_error');
    };
    return Object.freeze({
      async fetchPage(url) {
        guard();
        if (!fetcher) throw toolError('web_not_connected', 'connection');
        // Nothing leaves OXKIO from a SECRET context, and research stays on
        // the official site: links in a page can never redirect the agent.
        if (context.privacyClass === 'SECRET') throw toolError('secret_context', 'permission');
        let host;
        try { host = new URL(url).hostname; } catch (error) { throw toolError('url_not_allowed', 'permission'); }
        if (!target.website) throw toolError('off_site_url', 'permission');
        const allowedSite = new URL(target.website).hostname;
        if (!sameSite(host, allowedSite)) throw toolError('off_site_url', 'permission');
        // The fetcher enforces the site on every redirect hop; the final
        // destination is checked again here before anything is recorded.
        const page = await fetcher.fetchPage(url, { allowedSite });
        let finalHost = null;
        try { finalHost = new URL(page.url).hostname; } catch (error) { finalHost = null; }
        if (!finalHost || !sameSite(finalHost, allowedSite)) throw toolError('off_site_redirect', 'permission');
        const sourceRef = recordSource(contract, 'web_page', page.url, page.text, page.fetchedAt);
        return Object.freeze({ sourceRef, url: page.url, fetchedAt: page.fetchedAt, text: page.text });
      },
      async searchMemory(query) {
        guard();
        if (typeof memorySearch !== 'function') throw toolError('memory_not_connected', 'connection');
        const entries = await memorySearch(String(query || ''));
        const lines = (Array.isArray(entries) ? entries : []).slice(0, 20).map((entry) => JSON.stringify(entry).replace(/\s+/g, ' '));
        const text = lines.join('\n');
        const sourceRef = recordSource(contract, 'memory', 'memory://oxkio', text, null);
        const needle = String(query || '').toLowerCase();
        const matches = lines.filter((line) => !containsSecretMarker(line)).map((line) => {
          const index = Math.max(0, line.toLowerCase().indexOf(needle) - 60);
          return line.slice(index, index + 200).trim();
        }).filter((excerpt) => excerpt.length >= 2 && text.includes(excerpt));
        return Object.freeze({ sourceRef, url: 'memory://oxkio', matches: Object.freeze(matches) });
      },
      async searchGmail(senderAddress) {
        guard();
        if (typeof gmailSearch !== 'function' || !senderAddress) throw toolError('gmail_not_connected', 'connection');
        const messages = await gmailSearch({ senderAddress });
        const subjects = (Array.isArray(messages) ? messages : []).map((message) => String(message.subject || '').trim())
          .filter((subject) => subject.length >= 2 && !containsSecretMarker(subject)).slice(0, 10);
        const text = subjects.join('\n');
        const sourceRef = recordSource(contract, 'gmail_metadata', 'gmail://readonly', text, null);
        return Object.freeze({ sourceRef, url: 'gmail://readonly', subjects: Object.freeze(subjects) });
      },
    });
  }

  // Everything an agent returns is checked here before any evidence exists.
  function validate(stage, result, { contract, dependencies, target }) {
    if (!result || typeof result !== 'object' || result.stage !== stage) throw invalid('stage');
    const inherited = new Map(dependencies.flatMap((dependency) => (dependency.data && Array.isArray(dependency.data.facts)
      ? dependency.data.facts : [])).map((fact) => [fact.id, fact]));
    const facts = Array.isArray(result.facts) ? result.facts : [];
    const ids = new Set();
    for (const fact of facts) {
      const source = sources.get(fact.sourceRef);
      if (!fact || fact.kind !== 'FACT' || typeof fact.id !== 'string' || ids.has(fact.id)) throw invalid('fact_shape');
      ids.add(fact.id);
      if (!source || source.missionId !== contract.missionId) throw invalid('fact_source');
      if (typeof fact.excerpt !== 'string' || fact.excerpt.length < 2 || fact.excerpt.length > 300
        || !source.text.includes(fact.excerpt)) throw invalid('fact_not_in_source');
      if (containsSecretMarker(fact.excerpt) || containsSecretMarker(fact.statement)) throw invalid('fact_secret');
      if (numbersIn(fact.statement).some((number) => !numbersIn(fact.excerpt).includes(number))) throw invalid('fact_figure');
      if (fact.suspicious !== isSuspicious(fact.excerpt)) throw invalid('fact_flag');
      if (fact.sourceUrl !== source.url) throw invalid('fact_url');
      const previous = inherited.get(fact.id);
      if (previous && (previous.excerpt !== fact.excerpt || previous.sourceRef !== fact.sourceRef)) throw invalid('fact_altered');
    }
    const allFacts = new Map([...inherited, ...facts.map((fact) => [fact.id, fact])]);
    const flaggedExcerpts = [...allFacts.values()].filter((fact) => fact.suspicious).map((fact) => fact.excerpt);
    const profileText = JSON.stringify(sellerProfile);
    const allowedNumbers = new Set([
      ...[...allFacts.values()].flatMap((fact) => numbersIn(fact.excerpt)),
      ...numbersIn(profileText), ...numbersIn(target.company || ''), ...numbersIn(target.contactName || ''),
    ]);
    // Identifiers, references and computed counts are not prose claims.
    const strings = collectStrings(result, [], NON_PROSE_KEYS);
    for (const text of strings) {
      if (numbersIn(text).some((number) => !allowedNumbers.has(number))) throw invalid('invented_figure');
      if (containsSecretMarker(text)) throw invalid('secret');
      const lower = text.toLowerCase();
      if (sellerProfile.prohibitedClaims.some((claim) => lower.includes(claim.toLowerCase()))) throw invalid('prohibited_claim');
      if (['proposal', 'communication'].includes(stage) && flaggedExcerpts.some((excerpt) => text.includes(excerpt))) {
        throw invalid('suspicious_content_used');
      }
    }
    if (stage === 'opportunities') {
      // No opportunity may rest on a fact the analysis found contradicted.
      const analysis = dependencies.find((dependency) => dependency.data && dependency.data.stage === 'analysis');
      const contradicted = new Set((analysis && analysis.data.contradictions || []).flatMap((entry) => entry.factIds || []));
      for (const item of result.opportunities || []) {
        if ((item.basisFactIds || []).some((id) => contradicted.has(id))) throw invalid('contradicted_basis');
        const service = sellerProfile.services.find((candidate) => candidate.id === item.serviceId);
        const basis = (item.basisFactIds || []).map((id) => allFacts.get(id));
        if (!service || basis.length === 0 || basis.some((fact) => !fact || fact.suspicious)) throw invalid('opportunity_basis');
        if (item.solution !== service.name || item.expectedBenefit !== service.valueStatement) throw invalid('opportunity_solution');
        if (!['OBSERVED', 'INFERENCE'].includes(item.level)) throw invalid('opportunity_level');
        // An inference may never be presented as an observed need.
        const explicit = basis.some((fact) => service.explicitNeedSignals
          .some((signal) => fact.excerpt.toLowerCase().includes(signal.toLowerCase())));
        if (item.level === 'OBSERVED' && !explicit) throw invalid('inference_as_fact');
        if ((item.evidenceRefs || []).some((ref) => !basis.some((fact) => fact.sourceRef === ref))) throw invalid('opportunity_evidence');
      }
    }
    if (stage === 'proposal') {
      // The recommendation follows from the opportunities, never the reverse.
      const expected = (result.opportunities || []).length > 0 ? 'REVIEW_AND_CONTACT' : 'DO_NOT_CONTACT_YET';
      if (result.recommendation !== expected) throw invalid('recommendation_mismatch');
      const names = new Set(sellerProfile.services.map((service) => service.name));
      if ((result.solution || []).some((item) => !names.has(item.name))) throw invalid('unknown_solution');
      if ((result.situation || []).some((item) => !allFacts.has(item.factId) || item.label !== 'FACT')) throw invalid('situation_fact');
    }
    if (stage === 'communication') {
      if (result.sent !== false) throw invalid('sent_flag');
      // DO_NOT_CONTACT_YET means no contact material at all.
      const proposal = dependencies.find((dependency) => dependency.data && dependency.data.stage === 'proposal');
      const decision = proposal && proposal.data.recommendation === 'REVIEW_AND_CONTACT'
        && proposal.data.opportunities.length > 0 ? 'REVIEW_AND_CONTACT' : 'DO_NOT_CONTACT_YET';
      if (result.contactDecision !== decision) throw invalid('contact_decision_mismatch');
      if (decision === 'DO_NOT_CONTACT_YET' && (result.email !== null || result.shortMessage !== null || result.followUp !== null)) {
        throw invalid('contact_material_without_opportunity');
      }
      const allowedHosts = [target.website, ...profileText.match(URL_PATTERN) || []]
        .filter(Boolean).map((url) => { try { return new URL(url).hostname; } catch (error) { return null; } });
      const allowedEmails = profileText.match(EMAIL_PATTERN) || [];
      for (const text of strings) {
        for (const url of text.match(URL_PATTERN) || []) {
          let host = null;
          try { host = new URL(url).hostname; } catch (error) { host = null; }
          if (!host || !allowedHosts.some((allowed) => allowed && sameSite(allowed, host))) throw invalid('foreign_url');
        }
        if ((text.match(EMAIL_PATTERN) || []).some((email) => !allowedEmails.includes(email))) throw invalid('invented_email');
      }
    }
  }

  function executorFor(agentId) {
    const stage = STAGE_BY_AGENT[agentId];
    const agent = agentOverrides[stage] || AGENTS[stage];
    return async (contract, context) => {
      const target = parseTarget(context.knownContext);
      const dependencies = parseDependencies(context.dependencies);
      const result = await agent(Object.freeze({
        target, attempt: contract.attempt, dependencies, profile: sellerProfile, tools: toolsFor(contract, context, target),
      }));
      validate(stage, result, { contract, dependencies, target });
      const summary = JSON.stringify(result);
      const satisfied = SATISFIED[stage] ? SATISFIED[stage](result) : true;
      sequence += 1;
      const ref = `out:${contract.taskId}:${sequence}`;
      // An insufficient result still gets honest evidence, which supports
      // no pass criterion: the independent verifier rejects it and the
      // Sentinel replans (e.g. a broader extraction hypothesis).
      registrar.record({
        ref, missionId: contract.missionId, taskId: contract.taskId,
        supports: satisfied ? contract.passCriteria.map((criterion) => criterion.criterionId) : ['insufficient'],
        kind: 'agent_output', outputDigest: digestOutput(summary),
      });
      return { summary, evidenceRefs: [ref] };
    };
  }

  const executors = Object.freeze(Object.fromEntries(Object.keys(STAGE_BY_AGENT).map((agentId) => [agentId, executorFor(agentId)])));

  return Object.freeze({
    executors,
    // Read-only view of a recorded source, for the human review package.
    describeSource: (ref) => {
      const source = sources.get(ref);
      return source ? Object.freeze({ url: source.url, fetchedAt: source.fetchedAt, kind: source.kind, origin: source.origin }) : null;
    },
  });
}

module.exports = { STAGE_BY_AGENT, TRUSTED_REGISTRAR, createTrustedToolbox, parseTarget };
