'use strict';

const { isSuspicious } = require('./company-research-extract');

// XATAI CORE V2.1: Semantic Canon — the trusted layer that writes every
// material sentence a human (or, later, a company) can read.
//
// Agents reason and SELECT: which quote, which fact ids, which
// opportunities, which service, in which order. They never write the
// sentence that certifies anything. This module turns those selections
// into text deterministically, from:
//   - literal excerpts of recorded sources (facts),
//   - the seller profile (services, value statements, CTA, signature),
//   - a closed catalogue of uncertainty wordings.
// So a statement, a need, a proposal or an email can only say what a
// verified excerpt or the trusted profile says. No list of forbidden words
// is the defence: there is simply no free-text field to abuse.

// ------------------------------------------------------------ facts

const SCHEMA_LABELS = Object.freeze({
  legalName: ['identity', 'Razón social declarada'],
  addressLocality: ['identity', 'Localidad declarada'],
  addressRegion: ['identity', 'Región declarada'],
  addressCountry: ['identity', 'País declarado'],
  foundingDate: ['identity', 'Fecha de fundación declarada'],
  numberOfEmployees: ['size', 'Número de empleados declarado'],
});

function schemaValue(excerpt, key) {
  const match = new RegExp(`^"${key}"\\s*:\\s*("([^"]{1,120})"|\\{[^{}]{0,200}\\}|(\\d{1,7}))$`).exec(excerpt);
  if (!match) return null;
  if (match[2] !== undefined) return /^[^<>]{1,120}$/.test(match[2]) ? match[2] : null;
  if (match[3] !== undefined) return match[3];
  const inner = /"value"\s*:\s*"?(\d{1,7})/.exec(match[1]);
  return inner ? inner[1] : null;
}

const WEB = 'web_page';
const FACT_LABELS = Object.freeze({
  title: { category: 'identity', source: WEB, render: (e) => `Título de la web: "${e}"` },
  site_name: { category: 'identity', source: WEB, render: (e) => `Nombre declarado en la web: "${e}"` },
  description: { category: 'activity', source: WEB, render: (e) => `Descripción publicada: "${e}"` },
  heading_main: { category: 'headline', source: WEB, render: (e) => `Encabezado en la web: "${e}"` },
  heading: { category: 'offering', source: WEB, render: (e) => `Encabezado en la web: "${e}"` },
  size: { category: 'size', source: WEB, render: (e) => `La web indica: "${e}"` },
  signal: { category: 'signal', source: WEB, render: (e) => `La web menciona: "${e}"` },
  content: { category: 'content', source: WEB, render: (e) => `Texto publicado: "${e}"` },
  memory: { category: 'history', source: 'memory', render: (e) => `Registro previo en la memoria de OXKIO: "${e}"` },
  correspondence: { category: 'correspondence', source: 'gmail_metadata', render: (e) => `Correspondencia previa con asunto: "${e}"` },
  ...Object.fromEntries(Object.entries(SCHEMA_LABELS).map(([key, [category, prefix]]) => [`schema_${key}`, {
    category, source: WEB, schemaKey: key, render: (e) => `${prefix}: ${schemaValue(e, key)}`,
  }])),
});
// Provenance is a canonical, immutable property of every FACT, assigned
// here from the kind of source the trusted toolbox recorded (never from
// anything an agent says). Only PUBLIC_WEB facts may ever be attributed to
// the company in an external message; internal facts can inform reasoning
// and internal briefings but are never presented as public evidence.
const PROVENANCE = Object.freeze({ PUBLIC_WEB: 'PUBLIC_WEB', INTERNAL_MEMORY: 'INTERNAL_MEMORY', GMAIL: 'GMAIL' });
const PROVENANCE_BY_SOURCE = Object.freeze({
  [WEB]: PROVENANCE.PUBLIC_WEB, memory: PROVENANCE.INTERNAL_MEMORY, gmail_metadata: PROVENANCE.GMAIL,
});

// The one way a FACT comes to exist: an id, a closed label, a literal
// excerpt and the recorded source it was quoted from. Everything else
// (category, statement, URL, suspicion flag) is derived here.
function canonicalFact(input, source) {
  const spec = FACT_LABELS[input.label];
  if (!spec) return { error: 'fact_label' };
  if (!source || source.kind !== spec.source) return { error: 'fact_source_kind' };
  if (spec.schemaKey && schemaValue(input.excerpt, spec.schemaKey) === null) return { error: 'fact_schema_value' };
  return {
    fact: Object.freeze({
      id: input.id,
      kind: 'FACT',
      label: input.label,
      category: spec.category,
      statement: spec.render(input.excerpt),
      excerpt: input.excerpt,
      sourceRef: input.sourceRef,
      sourceUrl: source.url,
      provenance: PROVENANCE_BY_SOURCE[source.kind],
      suspicious: isSuspicious(input.excerpt),
    }),
  };
}

// Both the canonical provenance and the label's source must say public web.
function isPublicFact(fact) {
  const spec = FACT_LABELS[fact.label];
  return Boolean(spec && spec.source === WEB && fact.provenance === PROVENANCE.PUBLIC_WEB);
}

function expectedProvenance(label) {
  const spec = FACT_LABELS[label];
  return spec ? PROVENANCE_BY_SOURCE[spec.source] : null;
}

// ------------------------------------------------------------ uncertainties

const SOURCE_LABELS = Object.freeze({
  'web-research': 'páginas secundarias de la web', 'context-recall': 'memoria de OXKIO', 'prior-correspondence': 'correo previo en Gmail',
});
const REASON_LABELS = Object.freeze({
  connection_unavailable: 'no está conectada', privacy_provider_not_allowed: 'bloqueada por la política de privacidad',
  no_untried_agent: 'falló tras los reintentos', strategies_exhausted: 'falló tras los reintentos',
  attempt_budget_exhausted: 'falló tras los reintentos', human_authority_required: 'requiere una conexión o permiso humano',
  output_not_bound: 'resultado no verificable', budget_exceeded: 'sin presupuesto',
});
const UNCERTAINTIES = Object.freeze({
  no_structured_data: () => 'La web oficial no contiene datos estructurados reconocibles.',
  injection_ignored: () => 'La web contiene texto que intenta dar instrucciones; se ha ignorado.',
  secondary_page_unreadable: (param) => `No se pudo leer una página secundaria (${param}).`,
  no_secondary_links: () => 'La web oficial no enlaza páginas secundarias reconocibles.',
  no_memory_context: () => 'No hay contexto previo en la memoria sobre esta empresa.',
  no_correspondence: () => 'No hay correspondencia previa encontrada.',
  contradicting_figures: () => 'Las fuentes dan cifras distintas para un mismo dato; no se usa ninguna como cierta.',
  flagged_content_discarded: () => 'Se ha descartado texto de la web que intentaba dar instrucciones.',
  no_service_match: () => 'No se ha encontrado relación entre lo publicado y los servicios del perfil.',
});
// The only parameter an uncertainty takes is a known fetch failure code,
// never free text.
const FAILURE_PARAMS = new Set([
  'timeout', 'network_error', 'dns_failed', 'robots_unavailable', 'robots_disallowed', 'off_site_url', 'off_site_redirect',
  'private_address', 'url_not_allowed', 'unsupported_content_type', 'too_large', 'too_many_redirects', 'bad_redirect',
  'tool_call_limit', 'web_not_connected', 'secret_context', 'error',
]);
const isFailureParam = (param) => typeof param === 'string' && (FAILURE_PARAMS.has(param) || /^http_[1-5]\d{2}$/.test(param));

function renderUncertainty(item) {
  const code = typeof item === 'string' ? item : item && item.code;
  const param = item && typeof item === 'object' ? item.param : undefined;
  if (!Object.hasOwn(UNCERTAINTIES, code)) return null;
  if (code === 'secondary_page_unreadable' && !isFailureParam(param)) return null;
  if (code !== 'secondary_page_unreadable' && param !== undefined) return null;
  return UNCERTAINTIES[code](param);
}

function sourceUnavailable(stageKey, reason) {
  return `Fuente no disponible (${SOURCE_LABELS[stageKey] || stageKey}): ${REASON_LABELS[reason] || reason}.`;
}

// ------------------------------------------------------------ opportunities

function signalPattern(signal) {
  const escaped = String(signal).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u');
}

function containsAnySignal(text, signals) {
  const lower = String(text).toLowerCase();
  return signals.some((signal) => signalPattern(signal).test(lower));
}

const INFERENCE_UNCERTAINTY = 'No hay evidencia directa de la necesidad: es una inferencia a partir de lo publicado.';

// OBSERVED: every basis fact quotes an explicit need signal of the service.
// INFERENCE: every basis fact quotes an inference signal of the service.
// Signals come only from the trusted seller profile.
function canonicalOpportunity(input, { service, factsById, contradicted }) {
  if (!service) return { error: 'opportunity_service' };
  if (!['OBSERVED', 'INFERENCE'].includes(input.level)) return { error: 'opportunity_level' };
  const basis = input.basisFactIds.map((id) => factsById.get(id));
  if (basis.length === 0 || basis.some((fact) => !fact)) return { error: 'opportunity_basis' };
  if (basis.some((fact) => fact.suspicious)) return { error: 'opportunity_basis' };
  if (basis.some((fact) => contradicted.has(fact.id))) return { error: 'contradicted_basis' };
  // OBSERVED means "stated by the company in public": every basis fact
  // must be PUBLIC_WEB. An explicit need found in memory or Gmail is not a
  // public observation.
  const allPublic = basis.every(isPublicFact);
  if (input.level === 'OBSERVED' && !allPublic) return { error: 'observed_requires_public_web' };
  const signals = input.level === 'OBSERVED' ? service.explicitNeedSignals : service.inferenceSignals;
  if (!basis.every((fact) => containsAnySignal(fact.excerpt, signals))) {
    return { error: input.level === 'OBSERVED' ? 'inference_as_fact' : 'unsupported_inference' };
  }
  return {
    opportunity: Object.freeze({
      id: input.id,
      serviceId: service.id,
      level: input.level,
      // PUBLIC_WEB only when every basis fact is public; such an opportunity
      // may reach an external message. INTERNAL ones stay internal.
      provenance: allPublic ? PROVENANCE.PUBLIC_WEB : 'INTERNAL',
      need: input.level === 'OBSERVED'
        ? `La empresa lo indica en su web: "${basis[0].excerpt}"`
        : `Posible interés en ${service.needLabel} (inferido de la web, no confirmado por la empresa).`,
      basisFactIds: Object.freeze([...input.basisFactIds]),
      evidenceRefs: Object.freeze([...new Set(basis.map((fact) => fact.sourceRef))]),
      solution: service.name,
      expectedBenefit: service.valueStatement,
      uncertainties: Object.freeze(input.level === 'OBSERVED' ? [] : [INFERENCE_UNCERTAINTY]),
      missingInformation: Object.freeze([...service.qualifyingQuestions]),
    }),
  };
}

// Exact-copy check used wherever an opportunity is carried downstream: every
// traced field MUST be present AND equal (arrays: same items, same order,
// no duplicates). Absence is a failure, not a pass.
const TRACED_FIELDS = Object.freeze(['serviceId', 'level', 'provenance', 'need', 'basisFactIds', 'evidenceRefs', 'solution', 'expectedBenefit']);

function exactCopyError(item, origin) {
  if (!origin) return 'invented_opportunity';
  for (const field of TRACED_FIELDS) {
    if (!Object.hasOwn(item, field)) return `missing_opportunity_${field}`;
    const value = item[field];
    if (Array.isArray(origin[field])) {
      if (!Array.isArray(value) || new Set(value).size !== value.length
        || JSON.stringify(value) !== JSON.stringify(origin[field])) return `altered_opportunity_${field}`;
    } else if (value !== origin[field]) {
      return `altered_opportunity_${field}`;
    }
  }
  return null;
}

// ------------------------------------------------------------ proposal

function proposalOpportunityCopy(opportunity) {
  return Object.freeze({
    opportunityId: opportunity.id,
    serviceId: opportunity.serviceId,
    level: opportunity.level,
    provenance: opportunity.provenance,
    label: opportunity.level,
    need: opportunity.need,
    text: opportunity.need,
    basisFactIds: [...opportunity.basisFactIds],
    evidenceRefs: [...opportunity.evidenceRefs],
    solution: opportunity.solution,
    expectedBenefit: opportunity.expectedBenefit,
  });
}

function composeProposal({ selected, situationFacts, facts, profile, upstreamUncertainties, company }) {
  const services = selected.map((item) => profile.services.find((service) => service.id === item.serviceId));
  // Contact can only rest on an opportunity backed by public evidence.
  const contact = selected.some((item) => item.provenance === PROVENANCE.PUBLIC_WEB);
  return {
    stage: 'proposal',
    facts,
    situation: situationFacts.map((fact) => ({ label: 'FACT', text: fact.statement, factId: fact.id })),
    opportunities: selected.map(proposalOpportunityCopy),
    solution: services.map((service) => ({ label: 'RECOMMENDATION', name: service.name, description: service.description })),
    value: services.map((service) => service.valueStatement),
    scope: profile.scope,
    openQuestions: [...new Set([...selected.flatMap((item) => item.missingInformation), ...upstreamUncertainties])],
    recommendation: contact ? 'REVIEW_AND_CONTACT' : 'DO_NOT_CONTACT_YET',
    nextAction: contact ? profile.nextAction
      : 'No se ha identificado una oportunidad clara: no se recomienda contactar todavía sin más información.',
    company,
  };
}

// ------------------------------------------------------------ communication

// Every sentence comes from a fixed template filled with: the target name
// (given by a human), a literal PUBLIC excerpt (never memory or Gmail), a
// selected opportunity's service name and value statement, and the
// profile's call to action and signature.
function composeCommunication({ proposal, situationFacts: requestedFacts, selected: requested, greeting, target, profile }) {
  const hello = greeting === 'contact' && target.contactName ? `Hola, ${target.contactName}:` : `Hola, equipo de ${target.company}:`;
  // Defence in depth: whatever was requested, only PUBLIC_WEB opportunities
  // and facts can be put in front of the company.
  const selected = requested.filter((item) => item.provenance === PROVENANCE.PUBLIC_WEB);
  const situationFacts = requestedFacts.filter(isPublicFact);
  if (proposal.recommendation !== 'REVIEW_AND_CONTACT' || selected.length === 0) {
    return {
      stage: 'communication',
      facts: proposal.facts,
      contactDecision: 'DO_NOT_CONTACT_YET',
      email: null,
      shortMessage: null,
      followUp: null,
      executiveSummary: `Empresa: ${target.company}. No contactar todavía: no hay ninguna oportunidad respaldada por hechos.`,
      salesBriefing: null,
      internalBriefing: {
        reason: 'No se ha identificado ninguna oportunidad respaldada por hechos verificados.',
        verifiedFacts: proposal.situation.map((item) => item.text),
        missingInformation: proposal.openQuestions,
        nextResearch: [
          'Confirmar a qué se dedica la empresa y qué procesos podría tener relacionados con nuestros servicios.',
          'Buscar una necesidad declarada por la propia empresa antes de preparar ningún contacto.',
        ],
      },
      sent: false,
    };
  }
  const lead = situationFacts[0];
  const factLine = lead && !lead.excerpt.startsWith('"')
    ? `He revisado vuestra web oficial, donde indicáis: «${lead.excerpt.replace(/[.\s]+$/, '')}».`
    : 'He revisado vuestra web oficial.';
  const first = selected[0];
  const ideaLine = first.level === 'OBSERVED'
    ? `Por lo que indicáis en vuestra web, pensamos que ${first.solution} podría encajar con vosotros.`
    : `Por lo que publicáis, pensamos que ${first.solution} podría encajar con vosotros. Es una suposición nuestra, no algo que nos hayáis dicho.`;
  const valueLine = first.expectedBenefit;
  const body = [hello, '', factLine, ideaLine, valueLine, '', profile.callToAction, '', profile.signature].join('\n');
  return {
    stage: 'communication',
    facts: proposal.facts,
    contactDecision: 'REVIEW_AND_CONTACT',
    email: { subject: `${profile.name}: una idea para ${target.company}`, body },
    shortMessage: `${hello} ${ideaLine} ${profile.callToAction}`,
    followUp: `${hello} Os escribo de nuevo por si os resultó interesante la idea que os compartí. ${profile.callToAction}`,
    executiveSummary: [
      `Empresa: ${target.company}.`,
      `Hechos verificados: ${proposal.situation.map((item) => item.text).join(' | ') || 'ninguno'}.`,
      `Oportunidades: ${selected.map((item) => `[${item.label}] ${item.text.replace(/\.$/, '')}`).join(' | ')}.`,
    ].join(' '),
    salesBriefing: {
      facts: proposal.situation,
      inferences: selected.filter((item) => item.level === 'INFERENCE'),
      observed: selected.filter((item) => item.level === 'OBSERVED'),
      openQuestions: proposal.openQuestions,
    },
    internalBriefing: null,
    sent: false,
  };
}


// ------------------------------------------------------------ units, scope, contradictions

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
const UNIT_WORDS = Object.keys(UNIT_CANON).join('|');
const COUNT_PATTERN = new RegExp(`(\\d{1,3}(?:[.,]\\d{3})+|\\d{1,7})\\s+(${UNIT_WORDS})`, 'i');
const SCHEMA_EMPLOYEES = /"numberOfEmployees"[^\d]*(\d{1,7})/i;

function numbersIn(text) {
  return (String(text).match(/\d+(?:[.,]\d+)*/g) || []).map((value) => value.replace(/[.,]/g, ''));
}

// The count is the number right before the unit word (never a year that
// precedes it in the same sentence).
function countOf(excerpt) {
  const schema = SCHEMA_EMPLOYEES.exec(excerpt);
  if (schema) return { value: schema[1], unit: 'workforce', match: schema[0] };
  const match = COUNT_PATTERN.exec(excerpt);
  return match ? { value: match[1].replace(/[.,]/g, ''), unit: UNIT_CANON[match[2].toLowerCase()], match: match[0] } : null;
}

function canonicalUnit(excerpt) {
  const count = countOf(String(excerpt));
  return count ? count.unit : null;
}

// Explicit scopes only: a place after "en"/"in" (with a few prudent country
// aliases so "España" and "Spain" are the same place) and a year, before
// or after the figure within the quoted sentence. Nothing is inferred: no
// scope in a quote means "unknown".
const COUNTRY_ALIASES = Object.freeze({
  espana: 'es', spain: 'es', francia: 'fr', france: 'fr', portugal: 'pt', italia: 'it', italy: 'it',
  alemania: 'de', germany: 'de', mexico: 'mx', 'reino unido': 'uk', 'united kingdom': 'uk',
  'estados unidos': 'us', 'united states': 'us', eeuu: 'us', usa: 'us',
});
function plain(text) {
  return String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
function scopeOf(excerpt) {
  const count = countOf(excerpt);
  const rest = count ? String(excerpt).replace(count.match, ' ') : String(excerpt);
  const place = /(?:^|[^\p{L}])(?:[Ee]n|[Ii]n)\s+(?:(?:el|la|los|las|the)\s+)?([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñü]+(?:\s+(?:de\s+)?[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñü]+)*)/u.exec(rest);
  const year = /\b(19\d{2}|20\d{2})\b/.exec(rest);
  const placeKey = place ? plain(place[1]) : null;
  return { place: placeKey ? (COUNTRY_ALIASES[placeKey] || placeKey) : null, year: year ? year[1] : null };
}
function separateScopes(left, right) {
  return Boolean((left.place && right.place && left.place !== right.place) || (left.year && right.year && left.year !== right.year));
}


// The analysis selection rule: every non-suspicious fact is kept, except an
// exact duplicate (same category and excerpt) of one already kept.
function selectAnalysisFacts(all) {
  const unique = [];
  const seen = new Set();
  for (const fact of all) {
    const key = `${fact.category}|${fact.excerpt.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(fact);
  }
  return { usable: unique.filter((fact) => !fact.suspicious), flagged: unique.filter((fact) => fact.suspicious) };
}

function detectContradictions(usable) {
  const contradictions = [];
  const byUnit = new Map();
  for (const fact of usable.filter((item) => item.category === 'size')) {
    const count = countOf(fact.excerpt);
    if (!count) continue;
    const values = byUnit.get(count.unit) || [];
    values.push({ id: fact.id, value: count.value, scope: scopeOf(fact.excerpt), excerpt: fact.excerpt });
    byUnit.set(count.unit, values);
  }
  for (const [unit, all] of byUnit) {
    const values = all.filter((item) => all.some((other) => other.value !== item.value && !separateScopes(item.scope, other.scope)));
    if (values.length > 0) {
      // Every fact quoting one of the conflicting figures is contradicted
      // too (e.g. the full sentence that also contains "40 empleados").
      const conflicting = usable.filter((fact) => values.some((item) => fact.excerpt.toLowerCase().includes(item.excerpt.toLowerCase())));
      contradictions.push({ unit, factIds: [...new Set([...values.map((item) => item.id), ...conflicting.map((fact) => fact.id)])] });
    }
  }
  return contradictions;
}

const CANONICAL_UNITS = Object.freeze([...new Set(Object.values(UNIT_CANON))]);

module.exports = {
  PROVENANCE,
  expectedProvenance,
  CANONICAL_UNITS,
  isFailureParam,
  UNIT_CANON,
  canonicalUnit,
  countOf,
  detectContradictions,
  numbersIn,
  scopeOf,
  selectAnalysisFacts,
  separateScopes,
  FACT_LABELS,
  TRACED_FIELDS,
  canonicalFact,
  canonicalOpportunity,
  composeCommunication,
  composeProposal,
  containsAnySignal,
  exactCopyError,
  isPublicFact,
  renderUncertainty,
  schemaValue,
  sourceUnavailable,
};
