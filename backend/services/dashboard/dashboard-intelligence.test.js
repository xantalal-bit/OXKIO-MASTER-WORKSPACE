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
  assert.match(html, /Todavía no se ejecutará\. Revisa la información antes de aprobarla\./);
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

test('preparation controls only reveal or dismiss local DOM and never fetch or create approvals', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'app', 'executive-dashboard.html'),
    'utf8',
  );
  const start = html.indexOf('function initializeExecutiveActionPreparation');
  const end = html.indexOf('function applyDashboardState', start);
  const handlers = html.slice(start, end);

  assert.match(handlers, /detail\.hidden = false/);
  assert.match(handlers, /container\.hidden = true/);
  assert.match(handlers, /feedback\.textContent = "[^"]+ descartada\."/);
  assert.match(handlers, /feedback\.hidden = false/);
  assert.doesNotMatch(handlers, /fetch\(|oxkioAuthenticatedFetch|approval|execute|submit/);
  assert.doesNotMatch(handlers, /innerHTML/);
  assert.match(html, /data-executive-action-feedback role="status" aria-live="polite" hidden/);
});

test('preparation renderer uses safe DOM operations and keeps one executive summary card', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'app', 'executive-dashboard.html'),
    'utf8',
  );
  const cards = html.match(/id="morning-briefing-card"/g) || [];
  const start = html.indexOf('function renderPreparationFields');
  const end = html.indexOf('function initializeExecutiveActionPreparation', start);
  const renderer = html.slice(start, end);

  assert.equal(cards.length, 1);
  assert.match(renderer, /document\.createElement\("li"\)/);
  assert.match(renderer, /textContent/);
  assert.match(renderer, /replaceChildren\(\)/);
  assert.doesNotMatch(renderer, /innerHTML|insertAdjacentHTML|fetch\(/);
  assert.match(html, /Revisar preparación/);
  assert.match(html, /Descartar/);
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
