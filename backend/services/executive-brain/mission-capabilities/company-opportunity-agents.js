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

// Canonical units. Only equivalences strong enough to call two different
// figures a contradiction are merged (workforce, stores, countries,
// offices, customers, warehouses, in Spanish and English). Units whose
// meaning depends on context (establecimientos, centros, sedes,
// delegaciones, locations, profesionales) each stay on their own and are
// never compared with another unit.
const UNIT_CANON = Object.freeze({
  empleados: 'workforce', trabajadores: 'workforce', employees: 'workforce', workers: 'workforce', numberofemployees: 'workforce',
  tiendas: 'stores', stores: 'stores',
  'países': 'countries', paises: 'countries', countries: 'countries',
  oficinas: 'offices', offices: 'offices',
  clientes: 'customers', customers: 'customers',
  almacenes: 'warehouses', warehouses: 'warehouses',
  establecimientos: 'establishments', centros: 'centres', sedes: 'headquarters', delegaciones: 'branches',
  locations: 'locations', profesionales: 'professionals',
});
const UNIT_PATTERN = new RegExp(`(${Object.keys(UNIT_CANON).join('|')})`, 'i');

function canonicalUnit(excerpt) {
  const match = UNIT_PATTERN.exec(String(excerpt).replace(/"/g, ''));
  return match ? UNIT_CANON[match[1].toLowerCase()] : null;
}

// Explicit scopes only: a place after "en"/"in" (with a few prudent country
// aliases so "España" and "Spain" are the same place) and a year after the
// figure. Nothing is inferred: no scope in a quote means "unknown".
const COUNTRY_ALIASES = Object.freeze({
  espana: 'es', spain: 'es', francia: 'fr', france: 'fr', portugal: 'pt', italia: 'it', italy: 'it',
  alemania: 'de', germany: 'de', mexico: 'mx', 'reino unido': 'uk', 'united kingdom': 'uk',
  'estados unidos': 'us', 'united states': 'us', eeuu: 'us', usa: 'us',
});
function plain(text) {
  return String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
function scopeOf(excerpt) {
  const text = String(excerpt);
  const afterFigure = text.replace(/^\D*\d[\d.,]*/, '');
  const place = /\b(?:en|in)\s+(?:(?:el|la|los|las|the)\s+)?([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñü]+(?:\s+(?:de\s+)?[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñü]+)*)/.exec(afterFigure);
  const year = /\b(19\d{2}|20\d{2})\b/.exec(afterFigure);
  const placeKey = place ? plain(place[1]) : null;
  return { place: placeKey ? (COUNTRY_ALIASES[placeKey] || placeKey) : null, year: year ? year[1] : null };
}
function separateScopes(left, right) {
  return Boolean((left.place && right.place && left.place !== right.place) || (left.year && right.year && left.year !== right.year));
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
  // Same canonical unit stated with different figures, unless an explicit
  // place or year in both quotes shows they describe different scopes.
  const contradictions = [];
  const byUnit = new Map();
  for (const fact of usable.filter((item) => item.category === 'size')) {
    const unit = canonicalUnit(fact.excerpt);
    if (!unit) continue;
    const values = byUnit.get(unit) || [];
    values.push({ id: fact.id, value: numbersIn(fact.excerpt)[0], scope: scopeOf(fact.excerpt) });
    byUnit.set(unit, values);
  }
  for (const [unit, all] of byUnit) {
    const values = all.filter((item) => all.some((other) => other.value !== item.value && !separateScopes(item.scope, other.scope)));
    if (values.length > 0) {
      // Every fact quoting one of the conflicting figures is contradicted
      // too (e.g. the full sentence that also contains "40 empleados").
      const conflicting = usable.filter((fact) => values.some((item) => {
        const source = usable.find((candidate) => candidate.id === item.id);
        return source && fact.excerpt.toLowerCase().includes(source.excerpt.toLowerCase());
      }));
      contradictions.push({ unit, factIds: [...new Set([...values.map((item) => item.id), ...conflicting.map((fact) => fact.id)])] });
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
    // Exact copies of verified opportunities (selection only, never new ones).
    opportunities: opportunities.map((item) => ({
      opportunityId: item.id,
      serviceId: item.serviceId,
      level: item.level,
      label: item.level,
      need: item.need,
      text: item.need,
      basisFactIds: [...item.basisFactIds],
      evidenceRefs: [...item.evidenceRefs],
      solution: item.solution,
      expectedBenefit: item.expectedBenefit,
    })),
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

// Without an opportunity backed by facts, no contact material exists: only
// an internal briefing saying why not to contact and what is missing.
function doNotContactBriefing(target, data) {
  return {
    stage: 'communication',
    facts: data.facts || [],
    contactDecision: 'DO_NOT_CONTACT_YET',
    email: null,
    shortMessage: null,
    followUp: null,
    executiveSummary: `Empresa: ${target.company}. No contactar todavía: no hay ninguna oportunidad respaldada por hechos.`,
    internalBriefing: {
      reason: 'No se ha identificado ninguna oportunidad respaldada por hechos verificados.',
      verifiedFacts: (data.situation || []).map((item) => item.text),
      missingInformation: data.openQuestions || [],
      nextResearch: [
        'Confirmar a qué se dedica la empresa y qué procesos podría tener relacionados con nuestros servicios.',
        'Buscar una necesidad declarada por la propia empresa antes de preparar ningún contacto.',
      ],
    },
    sent: false,
  };
}

async function communicationAgent({ dependencies, profile, target }) {
  const proposal = dependencies.find((dependency) => dependency.data && dependency.data.stage === 'proposal');
  const data = proposal ? proposal.data : { situation: [], opportunities: [], solution: [], value: [], openQuestions: [] };
  if (!proposal || data.recommendation !== 'REVIEW_AND_CONTACT' || data.opportunities.length === 0) {
    return doNotContactBriefing(target, data);
  }
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
    contactDecision: 'REVIEW_AND_CONTACT',
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

module.exports = { AGENTS, UNIT_CANON, canonicalUnit, numbersIn, scopeOf, separateScopes };
