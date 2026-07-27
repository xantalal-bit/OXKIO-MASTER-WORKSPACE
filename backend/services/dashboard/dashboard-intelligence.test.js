'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  buildBusinessHunterOperationView,
  buildEcosystemView,
} = require('./dashboard-intelligence');

const NOW = '2026-07-19T12:00:00.000Z';

function inventory(assets, generatedAt = NOW) {
  return {
    version: '1.0',
    generatedAt,
    summary: { totalFolders: assets.length, recognizedAssets: assets.length },
    assets,
    recommendation: { message: 'Internal recommendation' },
  };
}

function asset(name, overrides = {}) {
  return {
    name,
    recognized: true,
    status: 'recognized',
    domain: 'unknown',
    ...overrides,
  };
}

test('detects Business Hunter through supported aliases', () => {
  const aliases = [
    'BUSINESS-HUNTER',
    'Business Hunter',
    'Business',
    'captación',
    'leads',
    'prospección',
    'clientes',
  ];

  aliases.forEach((name) => {
    const view = buildEcosystemView(inventory([asset(name)]), { now: NOW });
    assert.equal(view.businessHunter.name, 'Business Hunter');
    assert.equal(view.businessHunter.items, 1);
    assert.equal(view.businessHunter.status, 'partial');
    assert.equal(view.businessHunter.available, true);
  });
});

test('detects Xose aliases while always exposing Xose as the public name', () => {
  const aliases = [
    'Xose',
    'Xose y OXI',
    'OXI',
    'divulgador IA',
    'comunicador IA',
    'comunicación IA',
    'contenido IA',
    'creador de contenido IA',
    'redes sociales',
  ];

  aliases.forEach((name) => {
    const view = buildEcosystemView(inventory([asset(name)]), { now: NOW });
    assert.equal(view.xose.name, 'Xose');
    assert.equal(view.xose.items, 1);
    assert.equal(view.xose.available, true);
    assert.match(view.xose.summary, /comunicación y divulgación IA/);
  });
});

test('legacy brand labels are excluded from detection and public output', () => {
  const retiredBusinessLabel = ['eco', 'Soft'].join('');
  const retiredXoseLabel = ['Pro', 'fesor IA'].join('');
  const view = buildEcosystemView(inventory([
    asset(retiredBusinessLabel),
    asset(retiredXoseLabel),
    asset('Xose divulgador IA'),
  ]), { now: NOW });
  const serialized = JSON.stringify(view);

  assert.equal(view.businessHunter.items, 0);
  assert.equal(view.xose.name, 'Xose');
  assert.equal(view.xose.items, 1);
  assert.equal(serialized.includes(retiredBusinessLabel), false);
  assert.equal(serialized.includes(retiredXoseLabel), false);
  assert.doesNotMatch(view.xose.summary, /docencia|enseñanza/i);
});

test('aggregates useful ecosystem items without returning inventory objects', () => {
  const view = buildEcosystemView(inventory([
    asset('OXKIO'),
    asset('XANTALAL'),
    asset('Business Hunter'),
    asset('Unclassified', { recognized: false, status: 'unclassified' }),
  ]), { now: NOW });

  assert.equal(view.ecosystem.name, 'XANTALAL');
  assert.equal(view.ecosystem.items, 3);
  assert.equal(typeof view.ecosystem.items, 'number');
  assert.ok(view.ecosystem.items >= 0);
  assert.deepEqual(Object.keys(view.ecosystem).sort(), [
    'available', 'items', 'name', 'source', 'status', 'summary', 'updatedAt',
  ]);
});

test('uses only valid existing dates and classifies recent, incomplete, old, inactive, and unknown data', () => {
  const recent = buildEcosystemView(inventory([
    asset('Business Hunter', { updatedAt: '2026-07-01T00:00:00.000Z' }),
  ]), { now: NOW });
  const old = buildEcosystemView(inventory([
    asset('Business Hunter', { updatedAt: '2020-01-01T00:00:00.000Z' }),
  ]), { now: NOW });
  const invalid = buildEcosystemView(inventory([
    asset('Business Hunter', { updatedAt: 'not-a-date' }),
  ]), { now: NOW });
  const inactive = buildEcosystemView(inventory([
    asset('Business Hunter', { recognized: false, status: 'inactive' }),
  ]), { now: NOW });
  const unknown = buildEcosystemView(inventory([asset('Unrelated')]), { now: NOW });

  assert.equal(recent.businessHunter.status, 'active');
  assert.equal(recent.businessHunter.updatedAt, '2026-07-01T00:00:00.000Z');
  assert.equal(old.businessHunter.status, 'partial');
  assert.equal(invalid.businessHunter.status, 'partial');
  assert.equal(invalid.businessHunter.updatedAt, null);
  assert.equal(inactive.businessHunter.status, 'inactive');
  assert.equal(unknown.businessHunter.status, 'unknown');
});

test('returns unavailable safe entries when knowledgeInventory is absent or invalid', () => {
  [null, undefined, {}, { assets: null }].forEach((value) => {
    const view = buildEcosystemView(value, { now: NOW });
    Object.values(view).forEach((entry) => {
      assert.equal(entry.available, false);
      assert.equal(entry.status, 'unknown');
      assert.equal(entry.summary, 'No disponible');
      assert.equal(entry.items, 0);
      assert.equal(entry.updatedAt, null);
      assert.equal(entry.source, 'unavailable');
    });
  });
});

test('preserves sanitized Business Hunter readonly findings for the Executive Dashboard', () => {
  const opportunity = {
    id: 'document-1',
    title: 'Documento relevante',
    summary: 'Elemento relevante identificado en el inventario local.',
    confidence: 0.75,
    evidenceCount: 2,
    source: 'knowledge-pipeline',
  };
  const view = buildBusinessHunterOperationView({
    activeOperation: null,
    recentOperations: [{
      status: 'completed',
      phase: 'completed',
      sourceStatus: 'real',
      resultSummary: 'Business Hunter ha devuelto evidencia local.',
      result: {
        opportunities: [opportunity],
        recommendations: ['Revisar la evidencia sanitizada.'],
      },
      errors: [],
    }],
  });

  assert.equal(view.sourceStatus, 'real');
  assert.equal(view.opportunitiesCount, 1);
  assert.deepEqual(view.opportunities, [opportunity]);
  assert.deepEqual(view.recommendations, ['Revisar la evidencia sanitizada.']);
});

test('marks missing Business Hunter source data unavailable and explains why', () => {
  const view = buildBusinessHunterOperationView({
    recentOperations: [{
      status: 'completed_with_warnings',
      phase: 'completed',
      sourceStatus: null,
      result: { opportunities: [], recommendations: [] },
    }],
  });

  assert.equal(view.sourceStatus, 'unavailable');
  assert.equal(view.opportunitiesCount, 0);
  assert.deepEqual(view.opportunities, []);
  assert.deepEqual(view.recommendations, []);
  assert.match(view.summary, /no ha proporcionado datos de fuente disponibles/i);
});

test('projects Knowledge results through the same operations view without exposing documents', () => {
  const view = buildBusinessHunterOperationView({
    activeOperation: null,
    recentOperations: [{
      worker: 'knowledge-readonly', status: 'completed', phase: 'completed', sourceStatus: 'real',
      resultSummary: 'Conocimiento revisado.', durationMs: 20,
      result: { summary: 'Conocimiento revisado.', itemsCount: 3, topics: ['Gobernanza'], recommendations: ['Revisar temas.'] },
      errors: [], warnings: [],
    }],
  });
  assert.equal(view.worker, 'knowledge-readonly');
  assert.equal(view.itemsCount, 3);
  assert.deepEqual(view.topics, ['Gobernanza']);
  assert.equal(JSON.stringify(view).includes('document'), false);
});

test('projects Memory results through the common operations view without exposing private records', () => {
  const view = buildBusinessHunterOperationView({
    recentOperations: [{
      worker: 'memory-readonly', status: 'completed', phase: 'completed', sourceStatus: 'real',
      resultSummary: 'Memoria revisada.', durationMs: 20,
      result: { summary: 'Memoria revisada.', itemsCount: 2, topics: ['Decisiones'], recommendations: ['Revisar temas.'] },
      errors: [], warnings: [],
    }],
  });
  assert.equal(view.worker, 'memory-readonly');
  assert.equal(view.itemsCount, 2);
  assert.deepEqual(view.topics, ['Decisiones']);
  assert.equal(JSON.stringify(view).includes('content'), false);
});

test('projects Gmail results through the common operations view without exposing provider metadata', () => {
  const view = buildBusinessHunterOperationView({
    recentOperations: [{
      worker: 'gmail-readonly', status: 'completed', phase: 'completed', sourceStatus: 'real',
      resultSummary: 'Correo revisado.', durationMs: 20,
      result: {
        summary: 'Correo revisado.', emailsCount: 2,
        relevantItems: [{ sender: 'Equipo', subject: 'Revisión', summary: 'Requiere atención.' }],
        recommendations: ['Revisar asunto.'],
      },
      errors: [], warnings: [],
    }],
  });
  assert.equal(view.worker, 'gmail-readonly');
  assert.equal(view.emailsCount, 2);
  assert.deepEqual(view.relevantItems, [{
    sender: 'Equipo', subject: 'Revisión', summary: 'Requiere atención.',
  }]);
  ['id', 'token', 'headers', 'body', 'attachment'].forEach(
    (forbidden) => assert.equal(JSON.stringify(view).includes(forbidden), false),
  );
});

test('projects Calendar results through the common operations view without exposing provider metadata', () => {
  const view = buildBusinessHunterOperationView({
    recentOperations: [{
      worker: 'calendar-readonly', status: 'completed', phase: 'completed', sourceStatus: 'real',
      resultSummary: 'Agenda revisada.', durationMs: 20,
      result: {
        summary: 'Agenda revisada.', eventsCount: 2,
        relevantItems: [{
          title: 'Reunión', date: '23 jul 2026', time: '10:00',
          location: 'Sala', conflict: true,
        }],
        recommendations: ['Revisar solapamiento.'],
      },
      errors: [], warnings: [],
    }],
  });
  assert.equal(view.worker, 'calendar-readonly');
  assert.equal(view.eventsCount, 2);
  assert.deepEqual(view.relevantItems, [{
    title: 'Reunión', date: '23 jul 2026', time: '10:00',
    location: 'Sala', conflict: true,
  }]);
  ['id', 'token', 'link', 'description', 'attendees'].forEach(
    (forbidden) => assert.equal(JSON.stringify(view).includes(forbidden), false),
  );
});

test('never exposes paths, filenames, private content, or complete inventory assets', () => {
  const view = buildEcosystemView(inventory([asset('Business Hunter', {
    path: 'C:\\private\\Business Hunter\\secret.md',
    fileName: 'secret.md',
    content: 'private-content',
    updatedAt: '2026-07-01T00:00:00.000Z',
  })]), { now: NOW });
  const serialized = JSON.stringify(view);

  ['C:\\private', 'secret.md', 'private-content', 'path', 'fileName', 'content']
    .forEach((forbidden) => assert.equal(serialized.includes(forbidden), false));
});

test('dashboard reuses the existing inventory once and preserves its surrounding contract', () => {
  const source = fs.readFileSync(path.join(__dirname, 'dashboard-intelligence.js'), 'utf8');
  const discoveryCalls = source.match(/discoverKnowledge\(\)/g) || [];

  assert.equal(discoveryCalls.length, 1);
  assert.match(source, /const ecosystem = buildEcosystemView\(knowledgeInventory\)/);
  assert.match(source, /knowledgeInventory,\s*ecosystem/);
  ['greeting', 'executiveStatus', 'agenda', 'gmail', 'memory', 'automations', 'executiveBriefing', 'executiveFusion', 'executiveActionProposal', 'executiveActionPreparation', 'ecosystemObserver', 'morningBriefing']
    .forEach((field) => assert.match(source, new RegExp(`\\b${field}\\b`)));
});

test('builds executive fusion only from already composed sanitized dashboard data', () => {
  const source = fs.readFileSync(path.join(__dirname, 'dashboard-intelligence.js'), 'utf8');
  const fusionCalls = source.match(/buildExecutiveFusion\(\{/g) || [];

  assert.equal(fusionCalls.length, 1);
  assert.match(source, /generatedAt:\s*timestamp,\s*agenda,\s*gmail,\s*memory,\s*ecosystem,/);
  assert.match(source, /recentOperations:\s*businessHunterOperation\.recentOperations/);
  assert.doesNotMatch(source, /await\s+buildExecutiveFusion|executiveFusionReader|fusionProvider/);
});

test('builds one action proposal directly from executive fusion without operational dependencies', () => {
  const source = fs.readFileSync(path.join(__dirname, 'dashboard-intelligence.js'), 'utf8');
  const calls = source.match(/buildExecutiveActionProposal\(executiveFusion\)/g) || [];

  assert.equal(calls.length, 1);
  assert.doesNotMatch(source, /executiveActionProposalReader|actionProposalProvider|await\s+buildExecutiveActionProposal/);
});

test('prepares the proposed action from sanitized dashboard views after proposal construction', () => {
  const source = fs.readFileSync(path.join(__dirname, 'dashboard-intelligence.js'), 'utf8');
  const calls = source.match(/buildExecutiveActionPreparation\(\{/g) || [];

  assert.equal(calls.length, 1);
  assert.match(source, /proposal:\s*executiveActionProposal/);
  assert.match(source, /executiveSummary:\s*executiveFusion/);
  assert.match(source, /dashboard:\s*\{\s*agenda,\s*gmail,\s*ecosystem,/);
  assert.doesNotMatch(source, /await\s+buildExecutiveActionPreparation/);
});

test('builds the ecosystem observer after Executive Brain outputs from sanitized public state', () => {
  const source = fs.readFileSync(path.join(__dirname, 'dashboard-intelligence.js'), 'utf8');
  const calls = source.match(/buildEcosystemObserver\(\{/g) || [];

  assert.equal(calls.length, 1);
  assert.match(source, /systemStateView,\s*projectStateView,\s*governanceStateView,/);
  assert.doesNotMatch(source, /await\s+buildEcosystemObserver|ecosystemObserverProvider/);
  assert.doesNotMatch(source, /currentPhase:\s*"5C\.6E|currentBlock:\s*"Sistema Nervioso|moduleStatus:\s*\{/);
  assert.doesNotMatch(source, /strategicObjective:\s*"Gobernar|nextRecommendedStep:\s*"Validar el observador/);
});

test('server injects closed owner views into every Dashboard Intelligence composition', () => {
  const server = fs.readFileSync(
    path.join(__dirname, '..', '..', 'api', 'server.js'),
    'utf8',
  );
  const dashboardCalls = server.match(/DashboardIntelligence\.getDashboardState\(\{/g) || [];
  const injectedViews = server.match(/\.\.\.getEcosystemObserverViews\(\)/g) || [];

  assert.ok(dashboardCalls.length > 0);
  assert.equal(injectedViews.length, dashboardCalls.length);
  assert.match(server, /systemStateManager\.getPublicView\(\)/);
  assert.match(server, /ProjectManagerService\.getProjectStateView\("OXKIO"\)/);
  assert.match(server, /readGovernanceStateView\(\)/);
});

test('existing Dashboard keeps one mobile-first executive summary card with only unified output', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'app', 'executive-dashboard.html'),
    'utf8',
  );
  const cards = html.match(/id="morning-briefing-card"/g) || [];

  assert.equal(cards.length, 1);
  assert.match(html, /class="panel span-12 dashboard-briefing"/);
  assert.match(html, /updateMorningBriefing\(state\.executiveFusion\)/);
  assert.match(html, /briefing\.headline/);
  assert.match(html, /briefing\.priorities/);
  assert.match(html, /briefing\.recommendation/);
  assert.doesNotMatch(html, /data-morning-briefing-(alerts|sources|title)/);
  assert.match(html, /data-morning-briefing-date/);
  assert.match(html, /data-morning-briefing-time/);
  assert.match(html, /formatBriefingGeneratedAt\(briefing\.generatedAt\)/);
  assert.match(html, /new Intl\.DateTimeFormat\("es-ES"/);
  assert.doesNotMatch(html, /timeZone:\s*["']UTC["']/);
  assert.match(html, /data-executive-action-preparation/);
  assert.match(html, /Se creará únicamente un borrador en Gmail\. No se enviará ningún correo\./);
  assert.match(html, /@media \(max-width: 600px\)/);
});

test('Dashboard back navigation returns to Control Center without ending the persistent Firebase session', () => {
  const dashboard = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'app', 'executive-dashboard.html'),
    'utf8',
  );
  const login = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'app', 'index.html'),
    'utf8',
  );

  assert.match(login, /initializeAuth\(app,\s*\{\s*persistence:\s*browserLocalPersistence\s*\}\)/);
  assert.match(dashboard, /initializeAuth\(firebaseApp,\s*\{\s*persistence:\s*browserLocalPersistence\s*\}\)/);
  assert.doesNotMatch(login, /\bgetAuth\(/);
  assert.doesNotMatch(dashboard, /\bgetAuth\(/);
  assert.match(dashboard, /onAuthStateChanged\(firebaseAuth/);
  assert.match(dashboard, /user\.getIdToken\(!retry\)/);
  assert.match(dashboard, /response\.status === 401/);
  assert.match(login, /href="executive-dashboard\.html">Executive Dashboard/);
  assert.match(dashboard, /data-back-link href="\/">Atrás<\/a>/);
  assert.doesNotMatch(dashboard, /signOut\(|oxkioLogout|data-logout-button/);
  assert.doesNotMatch(dashboard, /sessionStorage|localStorage/);
});

test('Dashboard requests a fresh state and renders the real fusion generation time', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'app', 'executive-dashboard.html'),
    'utf8',
  );

  assert.match(html, /oxkioAuthenticatedFetch\("\/api\/dashboard",\s*\{\s*cache:\s*"no-store"\s*\}\)/);
  assert.match(html, /formatBriefingGeneratedAt\(briefing\.generatedAt\)/);
  assert.doesNotMatch(html, /new Date\(\)(?:\.toISOString\(\))?/);
});

test('preparation controls keep approval and execution as separate authenticated acts', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'app', 'executive-dashboard.html'),
    'utf8',
  );
  const start = html.indexOf('function initializeExecutiveActionPreparation');
  const end = html.indexOf('function applyDashboardState', start);
  const handlers = html.slice(start, end);

  assert.match(
    handlers,
    /reviewButton\.addEventListener\("click", toggleExecutivePreparationDetail\)/,
  );
  assert.match(handlers, /container\.hidden = true/);
  assert.match(handlers, /Preparación rechazada\. No se realizó ninguna acción\./);
  assert.match(handlers, /postExecutiveApproval\("\/api\/approve", "approve"\)/);
  assert.match(handlers, /postExecutiveApproval\("\/api\/approve", "reject"\)/);
  assert.match(handlers, /postExecutiveApproval\("\/api\/execute-approved"\)/);
  assert.match(handlers, /currentDraftApprovalStatus !== "pending"/);
  assert.match(
    handlers,
    /\["approved", "execution_failed"\]\.includes\(currentDraftApprovalStatus\)/,
  );
  assert.doesNotMatch(handlers, /innerHTML/);
  assert.match(html, /data-executive-action-feedback role="status" aria-live="polite" hidden/);
});

test('preparation renderer uses safe DOM operations and keeps one executive summary card', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'app', 'executive-dashboard.html'),
    'utf8',
  );
  const cards = html.match(/id="morning-briefing-card"/g) || [];
  const start = html.indexOf('function isValidDraftRecipient');
  const end = html.indexOf('function initializeExecutiveActionPreparation', start);
  const renderer = html.slice(start, end);

  assert.equal(cards.length, 1);
  assert.match(renderer, /isValidDraftRecipient/);
  assert.match(renderer, /DIRECCIÓN_COMPLETA/);
  assert.match(renderer, /Falta una dirección de correo válida\./);
  assert.match(renderer, /textContent/);
  assert.doesNotMatch(renderer, /innerHTML|insertAdjacentHTML|fetch\(/);
  assert.match(html, /Revisar preparación/);
  assert.doesNotMatch(html, /data-executive-action-dismiss/);
  assert.match(html, /data-executive-action-recipient/);
  assert.match(html, /data-executive-action-subject/);
  assert.match(html, /data-executive-action-body/);
  assert.match(html, /data-executive-action-risk/);
  assert.match(html, /Estado: Pendiente de aprobación humana/);
  assert.match(html, /@media \(max-width: 600px\)[\s\S]*?\.draft-preparation \.operations-actions button/);
});

test('email draft visual states match approval lifecycle and supervisor guidance', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'app', 'executive-dashboard.html'),
    'utf8',
  );
  const start = html.indexOf('function renderPreparation');
  const end = html.indexOf('async function loadExecutiveDraftApproval', start);
  const renderer = html.slice(start, end);

  assert.match(renderer, /Pendiente de aprobación\./);
  assert.match(renderer, /Expira a las/);
  assert.match(renderer, /Aprobado\. Pendiente de creación\./);
  assert.match(renderer, /Borrador creado, no enviado\./);
  assert.match(renderer, /Preparación expirada\./);
  assert.match(renderer, /La preparación ha expirado\. Genera una nueva para continuar\./);
  assert.match(renderer, /approvalItem\.status !== "pending" \|\| !validRecipient/);
  assert.match(renderer, /approvalItem\.status !== "approved"/);
  assert.match(renderer, /Borrador preparado\. Pendiente de aprobación humana\./);
  assert.match(renderer, /Borrador aprobado\. Pendiente de creación en Gmail\./);
  assert.match(renderer, /Borrador creado en Gmail\. No enviado\./);
  assert.doesNotMatch(renderer, /innerHTML|insertAdjacentHTML|fetch\(/);
});

test('prepare-email-draft renders every field and pending controls again after refresh', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'app', 'executive-dashboard.html'),
    'utf8',
  );
  const start = html.indexOf('function isValidDraftRecipient');
  const end = html.indexOf('function isCompleteDraftPreparation', start);
  const source = html.slice(start, end);
  const elements = new Map();
  [
    '[data-executive-action-detail]',
    '[data-executive-action-title]',
    '[data-executive-action-status]',
    '[data-executive-action-recipient]',
    '[data-executive-action-subject]',
    '[data-executive-action-body]',
    '[data-executive-action-missing-block]',
    '[data-executive-action-validation]',
    '[data-executive-action-risk]',
    '[data-executive-action-review]',
    '[data-executive-action-approve]',
    '[data-executive-action-reject]',
    '[data-executive-action-execute]',
  ].forEach((selector) => elements.set(selector, {
    hidden: true,
    textContent: '',
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
  }));
  const container = {
    hidden: true,
    scrollCalls: 0,
    querySelector(selector) { return elements.get(selector) || null; },
    scrollIntoView() { this.scrollCalls += 1; },
  };
  const feedbackElement = { hidden: true, textContent: '' };
  const card = {
    querySelector(selector) {
      if (selector === '[data-executive-action-preparation]') return container;
      if (selector === '[data-executive-action-feedback]') return feedbackElement;
      return null;
    },
  };
  const document = {
    getElementById(id) { return id === 'morning-briefing-card' ? card : null; },
    querySelector() { return null; },
  };
  const setText = (element, value, fallback) => {
    if (element) element.textContent = value || fallback;
  };
  const render = Function(
    'document',
    'setText',
    `"use strict"; ${source}; return renderPreparation;`,
  )(document, setText);
  const preparation = {
    preparationId: 'preparation-render',
    actionType: 'prepare-email-draft',
    type: 'email_draft',
    status: 'prepared',
    recipient: 'pilot@example.com',
    subject: 'Prueba OXKIO',
    body: 'Vista previa completa.',
    risk: 'low',
    requiresApproval: true,
  };
  const approval = {
    id: 'approval-render',
    status: 'pending',
    createdAt: '2026-07-26T17:00:00.000Z',
    publicProposal: preparation,
  };
  const assertRendered = () => {
    assert.equal(container.hidden, false);
    assert.equal(elements.get('[data-executive-action-recipient]').textContent, preparation.recipient);
    assert.equal(elements.get('[data-executive-action-subject]').textContent, preparation.subject);
    assert.equal(elements.get('[data-executive-action-body]').textContent, preparation.body);
    assert.equal(elements.get('[data-executive-action-risk]').textContent, 'Bajo');
    assert.equal(elements.get('[data-executive-action-status]').textContent, 'Pendiente de aprobación.');
    assert.equal(elements.get('[data-executive-action-detail]').hidden, false);
    assert.equal(elements.get('[data-executive-action-review]').hidden, false);
    assert.equal(elements.get('[data-executive-action-review]').attributes['aria-expanded'], 'true');
    assert.equal(elements.get('[data-executive-action-approve]').hidden, false);
    assert.equal(elements.get('[data-executive-action-reject]').hidden, false);
    assert.equal(elements.get('[data-executive-action-execute]').hidden, true);
  };

  render(approval, { focus: true });
  assertRendered();
  assert.equal(container.scrollCalls, 1);

  elements.forEach((element) => { element.textContent = ''; });
  render(approval);
  assertRendered();
  assert.equal(container.scrollCalls, 1);
  assert.match(html, /loadExecutiveDraftApproval\(\{ focus: true \}\)/);
});

test('Dashboard rehydrates one complete pending draft after refresh without terminal shadowing', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'app', 'executive-dashboard.html'),
    'utf8',
  );
  const start = html.indexOf('function isCompleteDraftPreparation');
  const end = html.indexOf('async function loadExecutiveDraftApproval', start);
  const source = html.slice(start, end);
  const selectApproval = Function(
    `"use strict"; ${source}; return selectExecutiveDraftApproval;`,
  )();
  const pending = {
    id: 'approval-pending',
    status: 'pending',
    createdAt: '2026-07-25T08:00:00.000Z',
    publicProposal: {
      preparationId: 'preparation-pending',
      actionType: 'prepare-email-draft',
      type: 'email_draft',
      status: 'prepared',
      recipient: 'xantalal@gmail.com',
      subject: 'Prueba OXKIO 5C.6D.1',
      body: 'Este correo es un borrador de prueba. No debe enviarse.',
      risk: 'low',
      requiresApproval: true,
    },
  };
  const newerExpired = {
    id: 'approval-expired',
    status: 'expired',
    createdAt: '2026-07-25T09:00:00.000Z',
    publicProposal: {
      preparationId: 'preparation-expired',
      actionType: 'prepare-email-draft',
      type: 'email_draft',
      status: 'prepared',
      risk: 'low',
      requiresApproval: true,
    },
  };

  assert.deepEqual(selectApproval([pending], [newerExpired]), pending);
  assert.deepEqual(selectApproval([], [newerExpired]), newerExpired);
  assert.match(source, /\["pending", "approved"\]\.includes\(item\.status\)/);
  assert.match(html, /currentDraftPreparationId = preparation\.preparationId/);
  assert.match(html, /approvalItem\.status !== "pending" \|\| !validRecipient/);
});

test('expired preparation exposes only safe recovery and a new preparation can continue', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'app', 'executive-dashboard.html'),
    'utf8',
  );
  const renderStart = html.indexOf('function isValidDraftRecipient');
  const renderEnd = html.indexOf('function isCompleteDraftPreparation', renderStart);
  const renderSource = html.slice(renderStart, renderEnd);
  const selectors = [
    '.draft-fields',
    '.draft-notice',
    '[data-executive-action-detail]',
    '[data-executive-action-title]',
    '[data-executive-action-status]',
    '[data-executive-action-recipient]',
    '[data-executive-action-subject]',
    '[data-executive-action-body]',
    '[data-executive-action-missing-block]',
    '[data-executive-action-validation]',
    '[data-executive-action-risk]',
    '[data-executive-action-review]',
    '[data-executive-action-approve]',
    '[data-executive-action-reject]',
    '[data-executive-action-execute]',
    '[data-executive-action-regenerate]',
  ];
  const elements = new Map(selectors.map((selector) => [selector, {
    hidden: true,
    textContent: '',
    setAttribute() {},
  }]));
  const container = {
    hidden: true,
    querySelector(selector) { return elements.get(selector) || null; },
  };
  const feedbackElement = { hidden: true, textContent: '' };
  const input = {
    value: 'datos anteriores',
    focused: false,
    focus() { this.focused = true; },
    scrollIntoView() {},
  };
  const card = {
    querySelector(selector) {
      if (selector === '[data-executive-action-preparation]') return container;
      if (selector === '[data-executive-action-feedback]') return feedbackElement;
      return null;
    },
  };
  const document = {
    getElementById(id) { return id === 'morning-briefing-card' ? card : null; },
    querySelector(selector) {
      return selector === '[data-executive-chat-input]' ? input : null;
    },
  };
  const feedback = [];
  const supervisor = [];
  const setText = (element, value, fallback) => {
    if (element) element.textContent = value || fallback;
  };
  const render = Function(
    'document',
    'setText',
    'setDraftFeedback',
    'setDraftSupervisorState',
    `"use strict"; ${renderSource}; return renderPreparation;`,
  )(document, setText, (value) => feedback.push(value), (value) => supervisor.push(value));

  render({
    id: 'expired-approval',
    status: 'expired',
    createdAt: '2026-07-26T10:00:00.000Z',
    publicProposal: {
      preparationId: 'expired-preparation',
      actionType: 'prepare-email-draft',
      type: 'email_draft',
      status: 'prepared',
      risk: 'low',
      requiresApproval: true,
    },
  });

  assert.equal(elements.get('[data-executive-action-status]').textContent, 'La preparación ha expirado.');
  assert.equal(elements.get('.draft-fields').hidden, true);
  assert.equal(elements.get('.draft-notice').hidden, true);
  assert.equal(elements.get('[data-executive-action-missing-block]').hidden, true);
  assert.equal(elements.get('[data-executive-action-review]').hidden, true);
  assert.equal(elements.get('[data-executive-action-approve]').hidden, true);
  assert.equal(elements.get('[data-executive-action-reject]').hidden, true);
  assert.equal(elements.get('[data-executive-action-execute]').hidden, true);
  assert.equal(elements.get('[data-executive-action-regenerate]').hidden, false);
  assert.match(feedbackElement.textContent, /Genera una nueva para continuar/);

  const recoverStart = html.indexOf('function recoverExpiredPreparation');
  const recoverEnd = html.indexOf('function initializeExecutiveActionPreparation', recoverStart);
  const recoverSource = html.slice(recoverStart, recoverEnd);
  const recover = Function(
    'document',
    'setDraftFeedback',
    'setDraftSupervisorState',
    `"use strict";
      let currentDraftApprovalId = "expired-approval";
      let currentDraftPreparationId = "expired-preparation";
      let currentDraftApprovalStatus = "expired";
      let lastEmailPreparationQuery = "Prepara un borrador original";
      ${recoverSource}
      return {
        run: recoverExpiredPreparation,
        state: () => [currentDraftApprovalId, currentDraftPreparationId, currentDraftApprovalStatus]
      };`,
  )(document, (value) => feedback.push(value), (value) => supervisor.push(value));

  recover.run();
  assert.equal(container.hidden, true);
  assert.equal(input.value, 'Prepara un borrador original');
  assert.equal(input.focused, true);
  assert.deepEqual(recover.state(), ['', '', '']);
  assert.match(feedback.at(-1), /Genera una nueva preparación para continuar/);
  assert.match(html, /data-executive-action-regenerate hidden>Generar nueva preparación</);
});

test('conversational recovery remains session-only and never submits automatically', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'app', 'executive-dashboard.html'),
    'utf8',
  );
  const submitStart = html.indexOf('async function submitExecutiveChat');
  const submitEnd = html.indexOf('function initializeExecutiveChat', submitStart);
  const recoverStart = html.indexOf('function recoverExpiredPreparation');
  const recoverEnd = html.indexOf('function initializeExecutiveActionPreparation', recoverStart);
  const submit = html.slice(submitStart, submitEnd);
  const recover = html.slice(recoverStart, recoverEnd);

  assert.match(html, /let lastEmailPreparationQuery = ""/);
  assert.match(submit, /lastEmailPreparationQuery = query/);
  assert.match(recover, /input\.value = lastEmailPreparationQuery/);
  assert.doesNotMatch(recover, /submitExecutiveChat|postExecutiveApproval|fetch\(/);
  assert.match(html, /pagehide", clearLastEmailPreparationQuery/);
  assert.match(html, /oxkio-identity-change", clearLastEmailPreparationQuery/);
  assert.match(html, /clearLastEmailPreparationQuery\(\)[\s\S]*Preparación rechazada/);
  assert.match(html, /if \(response\.ok\) \{\s*clearLastEmailPreparationQuery\(\);\s*await loadExecutiveDraftApproval/);
  assert.doesNotMatch(html, /localStorage|sessionStorage/);
});

test('Dashboard distinguishes failed execution from verified draft completion', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'app', 'executive-dashboard.html'),
    'utf8',
  );
  const renderStart = html.indexOf('function renderPreparation');
  const renderEnd = html.indexOf('function isCompleteDraftPreparation', renderStart);
  const executeStart = html.indexOf('if (executeButton) executeButton.addEventListener');
  const executeEnd = html.indexOf('if (regenerateButton)', executeStart);
  const renderer = html.slice(renderStart, renderEnd);
  const executionHandler = html.slice(executeStart, executeEnd);

  assert.match(renderer, /execution_failed/);
  assert.match(renderer, /No se pudo crear el borrador\. Puedes volver a intentarlo\./);
  assert.match(renderer, /No se pudo crear el borrador\. Genera una nueva preparación\./);
  assert.match(renderer, /executed:\s*"Borrador creado, no enviado\."/);
  assert.match(executionHandler, /result\.error\.retryable === true/);
  assert.doesNotMatch(executionHandler, /Acción ya ejecutada/);
  assert.doesNotMatch(html, /setDraftFeedback\("Acción ya ejecutada\."\)/);
});

test('review preparation toggles only its detail and preserves every rendered value', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'app', 'executive-dashboard.html'),
    'utf8',
  );
  const start = html.indexOf('function toggleExecutivePreparationDetail');
  const end = html.indexOf('function recoverExpiredPreparation', start);
  const source = html.slice(start, end);
  const toggle = Function(
    `"use strict"; ${source}; return toggleExecutivePreparationDetail;`,
  )();
  const preparation = Object.freeze({
    preparationId: 'preparation-1',
    recipient: 'xantalal@gmail.com',
    subject: 'Prueba OXKIO 5C.6D.1',
    body: 'Este correo es un borrador de prueba. No debe enviarse.',
    risk: 'low',
  });
  const rendered = {
    recipient: preparation.recipient,
    subject: preparation.subject,
    body: preparation.body,
    risk: preparation.risk,
  };
  const detail = { hidden: true };
  const container = {
    querySelector(selector) {
      assert.equal(selector, '[data-executive-action-detail]');
      return detail;
    },
  };
  const attributes = {};
  const reviewButton = {
    closest(selector) {
      assert.equal(selector, '[data-executive-action-preparation]');
      return container;
    },
    setAttribute(name, value) {
      attributes[name] = value;
    },
  };

  toggle({ currentTarget: reviewButton });
  assert.equal(detail.hidden, false);
  assert.equal(attributes['aria-expanded'], 'true');
  assert.deepEqual(rendered, {
    recipient: 'xantalal@gmail.com',
    subject: 'Prueba OXKIO 5C.6D.1',
    body: 'Este correo es un borrador de prueba. No debe enviarse.',
    risk: 'low',
  });
  assert.equal(preparation.preparationId, 'preparation-1');

  toggle({ currentTarget: reviewButton });
  assert.equal(detail.hidden, true);
  assert.equal(attributes['aria-expanded'], 'false');
  toggle({ currentTarget: reviewButton });
  assert.equal(detail.hidden, false);
  assert.deepEqual(rendered, {
    recipient: preparation.recipient,
    subject: preparation.subject,
    body: preparation.body,
    risk: preparation.risk,
  });
  assert.match(html, /\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
  assert.doesNotMatch(source, /fetch\(|textContent|replaceChildren|currentDraft|renderExecutive|updateExecutive/);
});

test('ecosystem observer is folded inside the existing top card and renders through safe DOM APIs', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'app', 'executive-dashboard.html'),
    'utf8',
  );
  const cards = html.match(/id="morning-briefing-card"/g) || [];
  const observerBlocks = html.match(/<details class="operations-details" data-ecosystem-observer>/g) || [];
  const start = html.indexOf('function renderObserverList');
  const end = html.indexOf('function fieldLabel', start);
  const renderer = html.slice(start, end);

  assert.equal(cards.length, 1);
  assert.equal(observerBlocks.length, 1);
  assert.doesNotMatch(observerBlocks[0], /\sopen(?:\s|>)/);
  assert.match(html, /Estado del Ecosistema/);
  assert.match(renderer, /document\.createElement\("li"\)/);
  assert.match(renderer, /textContent/);
  assert.match(renderer, /replaceChildren\(\)/);
  assert.doesNotMatch(renderer, /innerHTML|insertAdjacentHTML|fetch\(/);
  [
    'data-ecosystem-observer-project',
    'data-ecosystem-observer-strategic-objective',
    'data-ecosystem-observer-alignment',
    'data-ecosystem-observer-milestone',
  ].forEach((attribute) => assert.match(html, new RegExp(attribute)));
  assert.match(renderer, /container\.hidden = !text/);
  assert.match(renderer, /target\.textContent = text/);
  assert.match(html, /data-ecosystem-observer-project-block hidden/);
  assert.match(html, /data-ecosystem-observer-strategic-objective-block hidden/);
  assert.match(html, /data-ecosystem-observer-alignment-block hidden/);
  assert.match(html, /data-ecosystem-observer-milestone-block hidden/);
  assert.match(html, /data-ecosystem-observer-progress-block hidden/);
  assert.match(html, /data-ecosystem-observer-scope-status-block hidden/);
  assert.match(html, /data-ecosystem-observer-consolidated-block hidden/);
  assert.match(html, /data-ecosystem-observer-phase-summary/);
  assert.match(html, /data-ecosystem-observer-closure-status/);
  assert.match(html, /data-ecosystem-observer-next-action-summary/);
  assert.match(html, /data-ecosystem-observer-warning-summary hidden/);
  assert.match(html, /data-ecosystem-observer-remaining-block hidden/);
  assert.match(html, /data-ecosystem-observer-drift-block hidden/);
  assert.match(html, /data-ecosystem-observer-reuse-block hidden/);
  assert.match(html, /data-ecosystem-observer-lessons-block hidden/);
  assert.match(html, /data-ecosystem-observer-strategic-recommendations-block hidden/);
  assert.match(html, /data-ecosystem-observer-confidence-block hidden/);
  assert.match(html, /data-ecosystem-observer-audit-block hidden/);
  assert.match(html, /data-ecosystem-observer-session-block hidden/);
  assert.match(html, /data-ecosystem-observer-session-achievements/);
  assert.match(html, /data-ecosystem-observer-session-next/);
  assert.match(renderer, /supervisorRecommendation\.action \|\| guidance\.nextBestAction/);
  assert.doesNotMatch(
    html.slice(
      html.indexOf('<summary>', html.indexOf('data-ecosystem-observer')),
      html.indexOf('</summary>', html.indexOf('data-ecosystem-observer')),
    ),
    /strategic-recommendations/,
  );
  assert.match(renderer, /phaseClosureLabel/);
  assert.match(renderer, /renderOptionalObserverList/);
  assert.match(html, /@media \(max-width: 600px\)/);
});

test('future ecosystem command adds no endpoint or conversational processing', () => {
  const server = fs.readFileSync(
    path.join(__dirname, '..', '..', 'api', 'server.js'),
    'utf8',
  );
  assert.doesNotMatch(server, /req\.url\s*===\s*["']\/ecosistema["']/);
  assert.doesNotMatch(server, /pathname\s*===\s*["']\/ecosistema["']/);
});

test('Executive Dashboard keeps email preparation primary over readonly recommendations', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'app', 'executive-dashboard.html'),
    'utf8',
  );
  const start = html.indexOf('function renderExecutiveChatResult');
  const end = html.indexOf('function dismissDecisionRecommendation', start);
  const renderer = html.slice(start, end);

  assert.match(renderer, /primaryCapability === "prepare-email-draft"/);
  assert.match(renderer, /isEmailPreparation\s*\?\s*null/);
  assert.match(renderer, /isEmailPreparation\s*\?\s*"Borrador preparado"/);
  assert.match(renderer, /Se ha usado información disponible como contexto\./);
  assert.match(renderer, /El borrador está pendiente de tu aprobación\./);
  assert.doesNotMatch(renderer, /innerHTML/);
});

test('frontend renders only the three ecosystem widgets with safe DOM operations', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'app', 'executive-dashboard.html'),
    'utf8',
  );
  const start = html.indexOf('function formatEcosystemStatus');
  const end = html.indexOf('function formatAgendaSourceBadge', start);
  const renderer = html.slice(start, end);

  assert.match(renderer, /active:\s*["']Activo["']/);
  assert.match(renderer, /partial:\s*["']Parcial["']/);
  assert.match(renderer, /inactive:\s*["']Inactivo["']/);
  assert.match(renderer, /unknown:\s*["']No disponible["']/);
  assert.match(renderer, /textContent/);
  assert.doesNotMatch(renderer, /innerHTML/);
  assert.match(html, /data-ecosystem-widget="businessHunter"[\s\S]*?<h2>Business Hunter<\/h2>/);
  assert.match(html, /data-ecosystem-widget="xose"[\s\S]*?<h2>Xose<\/h2>/);
  assert.match(html, /data-ecosystem-widget="ecosystem"[\s\S]*?<h2>Estado del Ecosistema<\/h2>/);
  assert.doesNotMatch(html, /data-ecosystem-widget="businessHunter"[\s\S]{0,200}<h2>Gmail<\/h2>/);
  assert.match(html, /<h2>Xose<\/h2>/);
  ['Gmail', 'Agenda', 'Memoria ejecutiva', 'Compromisos Ejecutivos']
    .forEach((heading) => assert.match(html, new RegExp(`<h2>${heading}<\\/h2>`)));
});
