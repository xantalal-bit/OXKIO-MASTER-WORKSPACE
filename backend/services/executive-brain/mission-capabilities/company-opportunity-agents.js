'use strict';

const { extractFacts, extractLinks } = require('./company-research-extract');
const { profileSignals } = require('./seller-profile');

// XATAI CORE V2.1: the agents of the company-opportunity circuit, as pure,
// deterministic functions. An agent receives its target, its attempt, the
// verified outputs of its dependencies, the seller profile and a limited
// tool interface. It never receives the Evidence Registry, a registrar or
// the mission state, and its result is checked by the trusted toolbox
// before any evidence is recorded for it.
//
// Every statement is labelled: FACT (quoted from a recorded source),
// INFERENCE (reasoned from facts, never presented as found) or
// RECOMMENDATION. No figure is ever produced that a fact does not contain.

const MAX_SECONDARY_PAGES = 3;
const SOURCE_LABELS = Object.freeze({
  'web-research': 'páginas secundarias de la web', 'context-recall': 'memoria de OXKIO', 'prior-correspondence': 'correo previo en Gmail',
});
const REASON_LABELS = Object.freeze({
  connection_unavailable: 'no está conectada', privacy_provider_not_allowed: 'bloqueada por la política de privacidad',
  no_untried_agent: 'falló tras los reintentos', strategies_exhausted: 'falló tras los reintentos',
  attempt_budget_exhausted: 'falló tras los reintentos', human_authority_required: 'requiere una conexión o permiso humano',
  output_not_bound: 'resultado no verificable', budget_exceeded: 'sin presupuesto',
});

function factsFrom(dependencies) {
  return dependencies.flatMap((dependency) => (dependency.data && Array.isArray(dependency.data.facts) ? dependency.data.facts : []));
}

function uncertaintiesFrom(dependencies) {
  const inherited = dependencies.flatMap((dependency) => (dependency.data && Array.isArray(dependency.data.uncertainties)
    ? dependency.data.uncertainties : []));
  const missing = dependencies.filter((dependency) => dependency.skipped || dependency.withheld)
    .map((dependency) => `Fuente no disponible (${SOURCE_LABELS[dependency.stageKey] || dependency.stageKey}): `
      + `${REASON_LABELS[dependency.skipped || dependency.withheld] || dependency.skipped || dependency.withheld}.`);
  return [...new Set([...inherited, ...missing])];
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
  const url = useVariant ? wwwVariant(target.website) : target.website;
  const page = await tools.fetchPage(url);
  const broad = attempt.hypothesis !== 'h1';
  const facts = extractFacts(page, { prefix: 'cr', signals: profileSignals(profile), broad });
  const uncertainties = [];
  if (facts.length === 0) uncertainties.push('La web oficial no contiene datos estructurados reconocibles.');
  if (facts.some((fact) => fact.suspicious)) uncertainties.push('La web contiene texto que intenta dar instrucciones; se ha ignorado.');
  return {
    stage: 'company-research',
    company: { name: target.company, website: page.url },
    facts,
    links: extractLinks(page),
    uncertainties,
  };
}

// Web research: secondary pages of the same official domain, linked from
// the home page. A page that cannot be read is an uncertainty, not a stop.
async function webResearchAgent({ dependencies, tools, profile }) {
  const research = dependencies.find((dependency) => dependency.data && dependency.data.stage === 'company-research');
  const links = research ? research.data.links || [] : [];
  const facts = [];
  const visited = [];
  const uncertainties = [];
  for (const link of links.slice(0, MAX_SECONDARY_PAGES)) {
    try {
      const page = await tools.fetchPage(link.url);
      visited.push(page.url);
      const found = extractFacts(page, { prefix: `wr${visited.length}`, signals: profileSignals(profile) });
      facts.push(...found);
    } catch (error) {
      uncertainties.push(`No se pudo leer una página secundaria (${error.code || 'error'}).`);
    }
  }
  if (links.length === 0) uncertainties.push('La web oficial no enlaza páginas secundarias reconocibles.');
  return { stage: 'web-research', facts, sourcesVisited: visited, uncertainties };
}

async function contextRecallAgent({ target, tools }) {
  const result = await tools.searchMemory(target.company);
  const facts = result.matches.slice(0, 3).map((excerpt, index) => ({
    id: `mem:${index + 1}`,
    kind: 'FACT',
    category: 'history',
    statement: `Registro previo en la memoria de OXKIO: "${excerpt}"`,
    excerpt,
    sourceRef: result.sourceRef,
    sourceUrl: result.url,
    suspicious: false,
  }));
  return {
    stage: 'context-recall',
    facts,
    uncertainties: facts.length === 0 ? ['No hay contexto previo en la memoria sobre esta empresa.'] : [],
  };
}

async function priorCorrespondenceAgent({ target, tools }) {
  const result = await tools.searchGmail(target.contactEmail);
  const facts = result.subjects.slice(0, 3).map((subject, index) => ({
    id: `gm:${index + 1}`,
    kind: 'FACT',
    category: 'correspondence',
    statement: `Correspondencia previa con asunto: "${subject}"`,
    excerpt: subject,
    sourceRef: result.sourceRef,
    sourceUrl: result.url,
    suspicious: false,
  }));
  return {
    stage: 'prior-correspondence',
    facts,
    uncertainties: facts.length === 0 ? ['No hay correspondencia previa encontrada.'] : [],
  };
}

function numbersIn(text) {
  return (String(text).match(/\d+(?:[.,]\d+)*/g) || []).map((value) => value.replace(/[.,]/g, ''));
}

// Data analysis: merge, deduplicate, classify, count and detect numeric
// contradictions between sources. Suspicious facts are set aside, not used.
async function analysisAgent({ dependencies }) {
  const all = factsFrom(dependencies);
  const unique = [];
  const seen = new Set();
  for (const fact of all) {
    const key = `${fact.category}|${fact.excerpt.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(fact);
  }
  const usable = unique.filter((fact) => !fact.suspicious);
  const flagged = unique.filter((fact) => fact.suspicious).map((fact) => fact.id);
  const categories = {};
  usable.forEach((fact) => { categories[fact.category] = (categories[fact.category] || 0) + 1; });
  // Same unit (e.g. "empleados") stated with different figures.
  const contradictions = [];
  const byUnit = new Map();
  for (const fact of usable.filter((item) => item.category === 'size')) {
    const unit = (/(tiendas|establecimientos|centros|sedes|oficinas|delegaciones|almacenes|empleados|trabajadores|profesionales|clientes|pa[ií]ses|numberOfEmployees|stores|employees|offices|locations|customers|countries)/i
      .exec(fact.excerpt) || [null, null])[1];
    if (!unit) continue;
    const key = /numberOfEmployees|empleados|trabajadores|employees/i.test(unit) ? 'employees' : unit.toLowerCase();
    const values = byUnit.get(key) || [];
    values.push({ id: fact.id, value: numbersIn(fact.excerpt)[0] });
    byUnit.set(key, values);
  }
  for (const [unit, values] of byUnit) {
    if (new Set(values.map((item) => item.value)).size > 1) {
      contradictions.push({ unit, factIds: values.map((item) => item.id) });
    }
  }
  const uncertainties = uncertaintiesFrom(dependencies);
  if (contradictions.length > 0) uncertainties.push('Las fuentes dan cifras distintas para un mismo dato; no se usa ninguna como cierta.');
  if (flagged.length > 0) uncertainties.push('Se ha descartado texto de la web que intentaba dar instrucciones.');
  return {
    stage: 'analysis',
    facts: usable,
    flaggedFactIds: flagged,
    categories,
    contradictions,
    indicators: { facts: usable.length, sources: new Set(usable.map((fact) => fact.sourceRef)).size },
    uncertainties: [...new Set(uncertainties)],
  };
}

// Opportunities: facts x seller capabilities. OBSERVED only when the company
// itself states the need; everything else is an INFERENCE and says so.
async function opportunityAgent({ dependencies, profile }) {
  const analysis = dependencies.find((dependency) => dependency.data && dependency.data.stage === 'analysis');
  const facts = analysis ? analysis.data.facts : [];
  const contradicted = new Set((analysis ? analysis.data.contradictions : []).flatMap((item) => item.factIds));
  const opportunities = [];
  for (const service of profile.services) {
    const lowerOf = (fact) => `${fact.excerpt}`.toLowerCase();
    const explicit = facts.filter((fact) => !contradicted.has(fact.id)
      && service.explicitNeedSignals.some((signal) => lowerOf(fact).includes(signal.toLowerCase())));
    const signals = facts.filter((fact) => !contradicted.has(fact.id)
      && service.signals.some((signal) => lowerOf(fact).includes(signal.toLowerCase())));
    const basis = explicit.length > 0 ? explicit : signals;
    if (basis.length === 0) continue;
    const observed = explicit.length > 0;
    opportunities.push({
      id: `op:${opportunities.length + 1}`,
      serviceId: service.id,
      level: observed ? 'OBSERVED' : 'INFERENCE',
      need: observed
        ? `La empresa lo indica en su web: "${basis[0].excerpt}"`
        : `Posible interés en ${service.needLabel} (inferido de la web, no confirmado por la empresa).`,
      basisFactIds: basis.slice(0, 4).map((fact) => fact.id),
      evidenceRefs: [...new Set(basis.slice(0, 4).map((fact) => fact.sourceRef))],
      solution: service.name,
      expectedBenefit: service.valueStatement,
      uncertainties: observed ? [] : ['No hay evidencia directa de la necesidad: es una inferencia a partir de lo publicado.'],
      missingInformation: [...service.qualifyingQuestions],
    });
  }
  opportunities.sort((left, right) => Number(right.level === 'OBSERVED') - Number(left.level === 'OBSERVED')
    || right.basisFactIds.length - left.basisFactIds.length);
  const uncertainties = analysis ? [...analysis.data.uncertainties] : [];
  if (opportunities.length === 0) uncertainties.push('No se ha encontrado relación entre lo publicado y los servicios del perfil.');
  return { stage: 'opportunities', facts, opportunities, uncertainties: [...new Set(uncertainties)] };
}

function topFacts(facts, limit) {
  const priority = ['activity', 'identity', 'size', 'offering', 'headline', 'signal', 'history', 'correspondence', 'content'];
  return [...facts].sort((l, r) => priority.indexOf(l.category) - priority.indexOf(r.category)).slice(0, limit);
}

async function proposalAgent({ dependencies, profile, target }) {
  const opportunitiesStage = dependencies.find((dependency) => dependency.data && dependency.data.stage === 'opportunities');
  const analysisFacts = (opportunitiesStage && opportunitiesStage.data.facts) || [];
  const opportunities = opportunitiesStage ? opportunitiesStage.data.opportunities.slice(0, 3) : [];
  const services = opportunities.map((item) => profile.services.find((service) => service.id === item.serviceId)).filter(Boolean);
  const uncertainties = opportunitiesStage ? opportunitiesStage.data.uncertainties : [];
  return {
    stage: 'proposal',
    facts: analysisFacts,
    situation: topFacts(analysisFacts, 4).map((fact) => ({ label: 'FACT', text: fact.statement, factId: fact.id })),
    opportunities: opportunities.map((item) => ({ label: item.level, text: item.need, solution: item.solution, opportunityId: item.id })),
    solution: services.map((service) => ({ label: 'RECOMMENDATION', name: service.name, description: service.description })),
    value: services.map((service) => service.valueStatement),
    scope: profile.scope,
    openQuestions: [...new Set([...opportunities.flatMap((item) => item.missingInformation), ...uncertainties])],
    // Without any opportunity grounded in facts, contacting is not advised.
    recommendation: opportunities.length > 0 ? 'REVIEW_AND_CONTACT' : 'DO_NOT_CONTACT_YET',
    nextAction: opportunities.length > 0
      ? profile.nextAction
      : 'No se ha identificado una oportunidad clara: no se recomienda contactar todavía sin más información.',
    company: target.company,
  };
}

async function communicationAgent({ dependencies, profile, target }) {
  const proposal = dependencies.find((dependency) => dependency.data && dependency.data.stage === 'proposal');
  const data = proposal ? proposal.data : { situation: [], opportunities: [], solution: [], value: [], openQuestions: [] };
  const greeting = target.contactName ? `Hola, ${target.contactName}:` : `Hola, equipo de ${target.company}:`;
  // Quote the company's own words (the fact excerpt), never a paraphrase.
  const lead = data.situation[0] && (data.facts || []).find((fact) => fact.id === data.situation[0].factId);
  const factLine = lead && !lead.excerpt.startsWith('"')
    ? `He revisado vuestra web oficial, donde indicáis: «${lead.excerpt.replace(/[.\s]+$/, '')}».`
    : 'He revisado vuestra web oficial.';
  const opportunity = data.opportunities[0];
  const ideaLine = opportunity
    ? `Por lo que publicáis, pensamos que ${opportunity.solution} podría encajar con vosotros. Es una suposición nuestra, no algo que nos hayáis dicho.`
    : `Queríamos presentaros ${profile.name} por si en algún momento os resulta útil.`;
  const valueLine = data.value[0] || profile.offering;
  const body = [greeting, '', factLine, ideaLine, valueLine, '', profile.callToAction, '', profile.signature].join('\n');
  return {
    stage: 'communication',
    facts: proposal ? proposal.data.facts : [],
    email: { subject: `${profile.name}: una idea para ${target.company}`, body },
    shortMessage: `${greeting} ${ideaLine} ${profile.callToAction}`,
    executiveSummary: [
      `Empresa: ${target.company}.`,
      `Hechos verificados: ${data.situation.map((item) => item.text).join(' | ') || 'ninguno'}.`,
      `Oportunidades: ${data.opportunities.map((item) => `[${item.label}] ${item.text.replace(/\.$/, '')}`).join(' | ') || 'ninguna identificada'}.`,
    ].join(' '),
    followUp: `${greeting} Os escribo de nuevo por si os resultó interesante la idea que os compartí. ${profile.callToAction}`,
    salesBriefing: {
      facts: data.situation,
      inferences: data.opportunities.filter((item) => item.label === 'INFERENCE'),
      observed: data.opportunities.filter((item) => item.label === 'OBSERVED'),
      openQuestions: data.openQuestions,
    },
    sent: false,
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

module.exports = { AGENTS, numbersIn };
