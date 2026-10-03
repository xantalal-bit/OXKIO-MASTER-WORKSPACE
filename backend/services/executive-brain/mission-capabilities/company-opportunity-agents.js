'use strict';

const { extractFacts, extractLinks, isSuspicious } = require('./company-research-extract');
const {
  canonicalUnit, containsAnySignal, countOf, detectContradictions, isFailureParam, numbersIn, scopeOf, selectAnalysisFacts, separateScopes, UNIT_CANON,
} = require('./semantic-canon');
const { profileSignals } = require('./seller-profile');

// XATAI CORE V2.1: the agents of the company-opportunity circuit, as pure
// deterministic functions. Agents REASON and SELECT; they never write a
// certifying sentence. Each one returns a closed payload: fact candidates
// as { id, label, excerpt, sourceRef }, selections as ids, uncertainties as
// catalogue codes. The trusted toolbox validates the payload against the
// stage schema and the verified upstream data, and the semantic canon
// (semantic-canon.js) writes every statement, need, proposal and message.
// Agents never receive the Evidence Registry, a registrar or the mission
// state.

const MAX_SECONDARY_PAGES = 3;

function dependency(dependencies, stage) {
  return dependencies.find((item) => item.data && item.data.stage === stage) || null;
}

function wwwVariant(website) {
  const url = new URL(website);
  url.hostname = url.hostname.startsWith('www.') ? url.hostname.slice(4) : `www.${url.hostname}`;
  return url.href;
}

// Research: the official site. A failed fetch is a tool error for the
// Sentinel; after CHANGE_TOOL the agent tries the www/non-www variant. A
// rejected (insufficient) first result makes the next hypothesis broader.
async function companyResearchAgent({ target, attempt, tools, profile }) {
  const useVariant = String(attempt.tool || '').includes('#alt');
  const page = await tools.fetchPage(useVariant ? wwwVariant(target.website) : target.website);
  const facts = extractFacts(page, { prefix: 'cr', signals: profileSignals(profile), broad: attempt.hypothesis !== 'h1' });
  const uncertaintyCodes = [];
  if (facts.length === 0) uncertaintyCodes.push('no_structured_data');
  if (facts.some((fact) => isSuspicious(fact.excerpt))) uncertaintyCodes.push('injection_ignored');
  return {
    stage: 'company-research',
    facts,
    links: extractLinks(page).map((link) => ({ url: link.url })),
    uncertaintyCodes,
  };
}

// Web research: secondary pages of the same official domain, linked from
// the home page. A page that cannot be read is an uncertainty, not a stop.
async function webResearchAgent({ dependencies, tools, profile }) {
  const research = dependency(dependencies, 'company-research');
  const links = research ? research.data.links || [] : [];
  const facts = [];
  const visited = [];
  const uncertaintyCodes = [];
  for (const link of links.slice(0, MAX_SECONDARY_PAGES)) {
    try {
      const page = await tools.fetchPage(link.url);
      visited.push(page.url);
      facts.push(...extractFacts(page, { prefix: `wr${visited.length}`, signals: profileSignals(profile) }));
    } catch (error) {
      uncertaintyCodes.push({ code: 'secondary_page_unreadable', param: isFailureParam(error.code) ? error.code : 'error' });
    }
  }
  if (links.length === 0) uncertaintyCodes.push('no_secondary_links');
  return { stage: 'web-research', facts, sourcesVisited: visited, uncertaintyCodes };
}

async function contextRecallAgent({ target, tools }) {
  const result = await tools.searchMemory(target.company);
  const facts = result.matches.slice(0, 3).map((excerpt, index) => ({
    id: `mem:${index + 1}`, label: 'memory', excerpt, sourceRef: result.sourceRef,
  }));
  return { stage: 'context-recall', facts, uncertaintyCodes: facts.length === 0 ? ['no_memory_context'] : [] };
}

async function priorCorrespondenceAgent({ target, tools }) {
  const result = await tools.searchGmail(target.contactEmail);
  const facts = result.subjects.slice(0, 3).map((subject, index) => ({
    id: `gm:${index + 1}`, label: 'correspondence', excerpt: subject, sourceRef: result.sourceRef,
  }));
  return { stage: 'prior-correspondence', facts, uncertaintyCodes: facts.length === 0 ? ['no_correspondence'] : [] };
}

// Data analysis: keep every usable fact (only exact duplicates and
// suspicious ones are set aside) and report numeric contradictions within
// the same canonical unit, unless explicit scopes separate them. The same
// trusted functions are enforced by the toolbox: omitting is not allowed.
async function analysisAgent({ dependencies }) {
  const all = dependencies.flatMap((item) => (item.data && Array.isArray(item.data.facts) ? item.data.facts : []));
  const { usable, flagged } = selectAnalysisFacts(all);
  const contradictions = detectContradictions(usable);
  const uncertaintyCodes = [];
  if (contradictions.length > 0) uncertaintyCodes.push('contradicting_figures');
  if (flagged.length > 0) uncertaintyCodes.push('flagged_content_discarded');
  return { stage: 'analysis', factIds: usable.map((fact) => fact.id), flaggedFactIds: flagged.map((fact) => fact.id), contradictions, uncertaintyCodes };
}

// Opportunities: select (service, level, basis facts). OBSERVED only when a
// basis fact quotes an explicit need signal; otherwise INFERENCE, and only
// with basis facts that quote one of the service's inference signals.
async function opportunityAgent({ dependencies, profile }) {
  const analysis = dependency(dependencies, 'analysis');
  const facts = analysis ? analysis.data.facts : [];
  const contradicted = new Set((analysis ? analysis.data.contradictions : []).flatMap((item) => item.factIds));
  const candidates = facts.filter((fact) => !contradicted.has(fact.id) && !fact.suspicious);
  const opportunities = [];
  for (const service of profile.services) {
    // An explicit need counts as OBSERVED only when the company states it in
    // public; internal notes can still support an internal inference.
    const explicit = candidates.filter((fact) => fact.provenance === 'PUBLIC_WEB' && containsAnySignal(fact.excerpt, service.explicitNeedSignals));
    const inferred = candidates.filter((fact) => containsAnySignal(fact.excerpt, service.inferenceSignals));
    const basis = explicit.length > 0 ? explicit : inferred;
    if (basis.length === 0) continue;
    opportunities.push({
      id: `op:${opportunities.length + 1}`,
      serviceId: service.id,
      level: explicit.length > 0 ? 'OBSERVED' : 'INFERENCE',
      basisFactIds: basis.slice(0, 4).map((fact) => fact.id),
    });
  }
  opportunities.sort((left, right) => Number(right.level === 'OBSERVED') - Number(left.level === 'OBSERVED')
    || right.basisFactIds.length - left.basisFactIds.length);
  return { stage: 'opportunities', opportunities, uncertaintyCodes: opportunities.length === 0 ? ['no_service_match'] : [] };
}

const SITUATION_PRIORITY = ['activity', 'identity', 'size', 'offering', 'headline', 'signal', 'history', 'correspondence', 'content'];
function topFacts(facts, limit) {
  return [...facts].sort((l, r) => SITUATION_PRIORITY.indexOf(l.category) - SITUATION_PRIORITY.indexOf(r.category)).slice(0, limit);
}

// Proposal: select up to three verified opportunities and up to four facts
// for the situation. The canon composes the proposal from them.
async function proposalAgent({ dependencies }) {
  const stage = dependency(dependencies, 'opportunities');
  const opportunities = stage ? stage.data.opportunities.slice(0, 3) : [];
  return {
    stage: 'proposal',
    selectedOpportunityIds: opportunities.map((item) => item.id),
    situationFactIds: topFacts(stage ? stage.data.facts : [], 4).map((fact) => fact.id),
  };
}

// Communication: choose the greeting, which public facts to quote and
// which opportunities to mention. The canon writes every sentence.
async function communicationAgent({ dependencies, target }) {
  const proposal = dependency(dependencies, 'proposal');
  const data = proposal ? proposal.data : { situation: [], opportunities: [], facts: [] };
  const publicIds = new Set((data.facts || []).filter((fact) => fact.provenance === 'PUBLIC_WEB').map((fact) => fact.id));
  return {
    stage: 'communication',
    greeting: target.contactName ? 'contact' : 'team',
    situationFactIds: data.situation.map((item) => item.factId).filter((id) => publicIds.has(id)).slice(0, 1),
    selectedOpportunityIds: data.opportunities.filter((item) => item.provenance === 'PUBLIC_WEB').map((item) => item.opportunityId).slice(0, 1),
  };
}

const AGENTS = Object.freeze({
  'company-research': companyResearchAgent,
  'web-research': webResearchAgent,
  'context-recall': contextRecallAgent,
  'prior-correspondence': priorCorrespondenceAgent,
  analysis: analysisAgent,
  opportunities: opportunityAgent,
  proposal: proposalAgent,
  communication: communicationAgent,
});

module.exports = { AGENTS, UNIT_CANON, canonicalUnit, countOf, numbersIn, scopeOf, separateScopes };
