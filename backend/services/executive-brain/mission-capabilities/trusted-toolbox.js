'use strict';

const { digestOutput } = require('../evidence-registry');
const { containsSecretMarker } = require('../privacy-gate');
const { AGENTS } = require('./company-opportunity-agents');
const { sameSite } = require('./public-web-fetcher');
const {
  CANONICAL_UNITS, canonicalFact, canonicalOpportunity, composeCommunication, composeProposal, detectContradictions,
  exactCopyError, isPublicFact, renderUncertainty, selectAnalysisFacts, sourceUnavailable,
} = require('./semantic-canon');

// XATAI CORE V2.1: Trusted Toolbox — the composition-root trust boundary.
//
//   TOOL    -> real result -> trusted wrapper records the source (digest) ->
//              agent receives { sourceRef, text }
//   AGENT   -> pure function -> a CLOSED payload of selections (ids, closed
//              labels, literal excerpts, catalogue codes)
//   TOOLBOX -> validates the payload against the stage schema and the
//              verified upstream data, BUILDS the canonical stage output
//              with the semantic canon, records evidence bound to exactly
//              that output.
//
// The agent never chooses the text that certifies anything: statements,
// needs, proposals and messages are written by semantic-canon.js from
// verified excerpts and the trusted seller profile. Downstream stages carry
// ids; the toolbox reconstructs the canonical facts and opportunities from
// the verified dependency outputs, so a fact or an opportunity can be
// selected but never rewritten. The registrar is obtained once here and
// never leaves this closure.

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
// Closed schemas (additionalProperties = false) of every agent payload.
const PAYLOAD_KEYS = Object.freeze({
  'company-research': ['stage', 'facts', 'links', 'uncertaintyCodes'],
  'web-research': ['stage', 'facts', 'sourcesVisited', 'uncertaintyCodes'],
  'context-recall': ['stage', 'facts', 'uncertaintyCodes'],
  'prior-correspondence': ['stage', 'facts', 'uncertaintyCodes'],
  analysis: ['stage', 'factIds', 'flaggedFactIds', 'contradictions', 'uncertaintyCodes'],
  opportunities: ['stage', 'opportunities', 'uncertaintyCodes'],
  proposal: ['stage', 'selectedOpportunityIds', 'situationFactIds'],
  communication: ['stage', 'greeting', 'situationFactIds', 'selectedOpportunityIds'],
});
const ORIGIN_STAGES = new Set(['company-research', 'web-research', 'context-recall', 'prior-correspondence']);
const FACT_KEYS = ['id', 'label', 'excerpt', 'sourceRef'];
const OPPORTUNITY_KEYS = ['id', 'serviceId', 'level', 'basisFactIds'];
const CONTRADICTION_KEYS = ['unit', 'factIds'];
const ID_PATTERN = /^[a-z]{1,8}\d{0,3}:\d{1,4}$/;
const MAX_TOOL_CALLS_PER_ATTEMPT = 6;
const MAX_SOURCE_CHARS = 1024 * 1024;

function toolError(code, failureKind) {
  const error = new Error(code);
  error.code = code;
  error.failureKind = failureKind;
  return error;
}

function invalid(code) {
  return toolError(`invalid_output:${code}`, 'invalid_output');
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function closed(value, keys, code, { required = keys } = {}) {
  if (!isPlainObject(value)) throw invalid(code);
  if (Object.keys(value).some((key) => !keys.includes(key))) throw invalid(code);
  if (required.some((key) => !Object.hasOwn(value, key))) throw invalid(code);
}

function idList(value, code) {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !ID_PATTERN.test(id)) || new Set(value).size !== value.length) {
    throw invalid(code);
  }
  return value;
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

function dependencyData(dependencies, stage) {
  const found = dependencies.find((item) => item.data && item.data.stage === stage);
  return found ? found.data : null;
}

const SATISFIED = Object.freeze({
  'company-research': (output) => output.facts.filter((fact) => !fact.suspicious).length >= 2,
  analysis: (output) => output.facts.length >= 1,
  proposal: (output) => output.situation.length >= 1,
  communication: (output) => (output.contactDecision === 'DO_NOT_CONTACT_YET'
    ? Boolean(output.internalBriefing && output.internalBriefing.reason)
    : Boolean(output.email && output.email.subject && output.email.body)),
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

  // ---------------------------------------------------------- canonicalization

  function renderCodes(codes) {
    if (!Array.isArray(codes)) throw invalid('uncertainty_codes');
    return codes.map((code) => {
      const text = renderUncertainty(code);
      if (!text) throw invalid('uncertainty_code');
      return text;
    });
  }

  // Origin stages: the only place a FACT is born. Each candidate must quote
  // a source recorded in this mission; the canon writes the statement.
  function originFacts(payload, contract, inherited) {
    if (!Array.isArray(payload.facts)) throw invalid('facts');
    const ids = new Set();
    return payload.facts.map((candidate) => {
      closed(candidate, FACT_KEYS, 'fact_shape');
      if (typeof candidate.id !== 'string' || !ID_PATTERN.test(candidate.id) || ids.has(candidate.id) || inherited.has(candidate.id)) {
        throw invalid('fact_id');
      }
      ids.add(candidate.id);
      const source = sources.get(candidate.sourceRef);
      if (!source || source.missionId !== contract.missionId) throw invalid('fact_source');
      if (typeof candidate.excerpt !== 'string' || candidate.excerpt.length < 2 || candidate.excerpt.length > 300
        || !source.text.includes(candidate.excerpt)) throw invalid('fact_not_in_source');
      if (containsSecretMarker(candidate.excerpt)) throw invalid('fact_secret');
      const { fact, error } = canonicalFact(candidate, source);
      if (error) throw invalid(error);
      return fact;
    });
  }

  function inheritedFacts(dependencies) {
    const map = new Map();
    for (const dependency of dependencies) {
      for (const fact of (dependency.data && Array.isArray(dependency.data.facts) ? dependency.data.facts : [])) map.set(fact.id, fact);
    }
    return map;
  }

  function inheritedUncertainties(dependencies) {
    const texts = dependencies.flatMap((item) => (item.data && Array.isArray(item.data.uncertainties) ? item.data.uncertainties : []));
    const unavailable = dependencies.filter((item) => item.skipped || item.withheld)
      .map((item) => sourceUnavailable(item.stageKey, item.skipped || item.withheld));
    return [...texts, ...unavailable];
  }

  function select(ids, map, code) {
    return idList(ids, code).map((id) => {
      if (!map.has(id)) throw invalid(code);
      return map.get(id);
    });
  }

  function canonicalOutput(stage, payload, { contract, dependencies, target }) {
    if (!isPlainObject(payload) || payload.stage !== stage) throw invalid('stage');
    closed(payload, PAYLOAD_KEYS[stage], 'unknown_field');
    const inherited = inheritedFacts(dependencies);

    if (ORIGIN_STAGES.has(stage)) {
      const facts = originFacts(payload, contract, inherited);
      const output = { stage, facts, uncertainties: renderCodes(payload.uncertaintyCodes) };
      if (stage === 'company-research') {
        if (!Array.isArray(payload.links)) throw invalid('links');
        output.links = payload.links.map((link) => {
          closed(link, ['url'], 'link_shape');
          let host = null;
          try { host = new URL(link.url).hostname; } catch (error) { host = null; }
          if (!host || !target.website || !sameSite(host, new URL(target.website).hostname) || !link.url.startsWith('https://')) {
            throw invalid('link_off_site');
          }
          return { url: link.url };
        });
        const first = facts[0] ? facts[0].sourceUrl : null;
        output.company = { name: target.company, website: first };
      }
      if (stage === 'web-research') {
        const visited = new Set([...sources.values()].filter((source) => source.taskId === contract.taskId).map((source) => source.url));
        if (!Array.isArray(payload.sourcesVisited) || payload.sourcesVisited.some((url) => !visited.has(url))) throw invalid('sources_visited');
        output.sourcesVisited = [...payload.sourcesVisited];
      }
      return output;
    }

    if (stage === 'analysis') {
      const facts = select(payload.factIds, inherited, 'unknown_fact');
      const flagged = idList(payload.flaggedFactIds, 'flagged_ids');
      // Analysis has no authority to drop a fact: it keeps every usable
      // fact (only exact duplicates and suspicious ones are set aside), and
      // it must declare at least every contradiction the canon detects.
      const expected = selectAnalysisFacts(dependencies.flatMap((item) => (item.data && Array.isArray(item.data.facts) ? item.data.facts : [])));
      const sameSet = (left, right) => left.length === right.length && left.every((id) => right.includes(id));
      if (!sameSet(facts.map((fact) => fact.id), expected.usable.map((fact) => fact.id))) throw invalid('omitted_fact');
      if (!sameSet(flagged, expected.flagged.map((fact) => fact.id))) throw invalid('flagged_facts');
      if (!Array.isArray(payload.contradictions)) throw invalid('contradictions');
      const selected = new Set(facts.map((fact) => fact.id));
      const contradictions = payload.contradictions.map((item) => {
        closed(item, CONTRADICTION_KEYS, 'contradiction_shape');
        if (!CANONICAL_UNITS.includes(item.unit)) throw invalid('contradiction_unit');
        if (idList(item.factIds, 'contradiction_ids').some((id) => !selected.has(id))) throw invalid('contradiction_ids');
        return { unit: item.unit, factIds: [...item.factIds] };
      });
      for (const required of detectContradictions(facts)) {
        const declared = new Set(contradictions.filter((item) => item.unit === required.unit).flatMap((item) => item.factIds));
        if (required.factIds.some((id) => !declared.has(id))) throw invalid('omitted_contradiction');
      }
      const categories = {};
      facts.forEach((fact) => { categories[fact.category] = (categories[fact.category] || 0) + 1; });
      return {
        stage,
        facts,
        flaggedFactIds: [...flagged],
        categories,
        contradictions,
        indicators: { facts: facts.length, sources: new Set(facts.map((fact) => fact.sourceRef)).size },
        uncertainties: [...new Set([...inheritedUncertainties(dependencies), ...renderCodes(payload.uncertaintyCodes)])],
      };
    }

    if (stage === 'opportunities') {
      const analysis = dependencyData(dependencies, 'analysis');
      if (!analysis) throw invalid('missing_analysis');
      const factsById = new Map(analysis.facts.map((fact) => [fact.id, fact]));
      const contradicted = new Set(analysis.contradictions.flatMap((item) => item.factIds));
      if (!Array.isArray(payload.opportunities)) throw invalid('opportunities');
      const ids = new Set();
      const opportunities = payload.opportunities.map((input) => {
        closed(input, OPPORTUNITY_KEYS, 'opportunity_shape');
        if (typeof input.id !== 'string' || !ID_PATTERN.test(input.id) || ids.has(input.id)) throw invalid('opportunity_id');
        ids.add(input.id);
        idList(input.basisFactIds, 'opportunity_basis');
        const service = sellerProfile.services.find((candidate) => candidate.id === input.serviceId);
        const { opportunity, error } = canonicalOpportunity(input, { service, factsById, contradicted });
        if (error) throw invalid(error);
        return opportunity;
      });
      return {
        stage,
        facts: analysis.facts,
        opportunities,
        uncertainties: [...new Set([...analysis.uncertainties, ...renderCodes(payload.uncertaintyCodes)])],
      };
    }

    if (stage === 'proposal') {
      const upstream = dependencyData(dependencies, 'opportunities');
      if (!upstream) throw invalid('missing_opportunities');
      const opportunities = new Map(upstream.opportunities.map((item) => [item.id, item]));
      let selected;
      try {
        selected = select(payload.selectedOpportunityIds, opportunities, 'invented_opportunity');
      } catch (error) {
        throw invalid('invented_opportunity');
      }
      const factsById = new Map(upstream.facts.map((fact) => [fact.id, fact]));
      const situationFacts = select(payload.situationFactIds, factsById, 'unknown_fact');
      return composeProposal({
        selected, situationFacts, facts: upstream.facts, profile: sellerProfile,
        upstreamUncertainties: upstream.uncertainties, company: target.company,
      });
    }

    if (stage === 'communication') {
      const proposal = dependencyData(dependencies, 'proposal');
      if (!proposal) throw invalid('missing_proposal');
      if (!['contact', 'team'].includes(payload.greeting)) throw invalid('greeting');
      const proposed = new Map(proposal.opportunities.map((item) => [item.opportunityId, item]));
      let selected;
      try {
        selected = select(payload.selectedOpportunityIds, proposed, 'unselected_opportunity');
      } catch (error) {
        throw invalid('unselected_opportunity');
      }
      // Messages may only quote facts of the proposal situation that come
      // from the public website (never memory or Gmail).
      const situationIds = new Set(proposal.situation.map((item) => item.factId));
      const quotable = new Map(proposal.facts.filter((fact) => situationIds.has(fact.id) && isPublicFact(fact)).map((fact) => [fact.id, fact]));
      const situationFacts = select(payload.situationFactIds, quotable, 'unquotable_fact');
      return composeCommunication({ proposal, situationFacts, selected, greeting: payload.greeting, target, profile: sellerProfile });
    }
    throw invalid('stage');
  }

  function executorFor(agentId) {
    const stage = STAGE_BY_AGENT[agentId];
    const agent = agentOverrides[stage] || AGENTS[stage];
    return async (contract, context) => {
      const target = parseTarget(context.knownContext);
      const dependencies = parseDependencies(context.dependencies);
      const payload = await agent(Object.freeze({
        target, attempt: contract.attempt, dependencies, profile: sellerProfile, tools: toolsFor(contract, context, target),
      }));
      const output = canonicalOutput(stage, payload, { contract, dependencies, target });
      const summary = JSON.stringify(output);
      const satisfied = SATISFIED[stage] ? SATISFIED[stage](output) : true;
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

module.exports = { PAYLOAD_KEYS, STAGE_BY_AGENT, TRUSTED_REGISTRAR, createTrustedToolbox, exactCopyError, parseTarget };
