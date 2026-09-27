'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const dashboardPath = path.join(__dirname, '..', '..', '..', 'app', 'executive-dashboard.html');

function readDashboard() {
  return fs.readFileSync(dashboardPath, 'utf8');
}

function getChatScript(html) {
  const start = html.indexOf('let executiveChatSending');
  const end = html.indexOf('function findPanelByTitle', start);
  assert.ok(start >= 0 && end > start);
  return html.slice(start, end);
}

test('uses only the official executive chat POST contract', () => {
  const source = getChatScript(readDashboard());

  assert.match(source, /oxkioAuthenticatedFetch\(["']\/api\/executive\/chat["']/);
  assert.match(source, /method:\s*["']POST["']/);
  assert.match(source, /["']Content-Type["']:\s*["']application\/json["']/);
  assert.match(source, /body:\s*JSON\.stringify\(\{ query \}\)/);
  assert.doesNotMatch(source, /["']\/api\/chat["']/);
  ['dependencies', 'diagnostics', 'executionEnabled', 'privatePayload', 'payloadHash']
    .forEach((field) => assert.doesNotMatch(source, new RegExp(`JSON\\.stringify\\([^)]*${field}`)));
});

test('registers chat, supervised confirmation and operation listeners and supports Enter without Shift', () => {
  const source = getChatScript(readDashboard());
  const clickListeners = source.match(/addEventListener\(["']click["']/g) || [];

  assert.equal(clickListeners.length, 8);
  assert.match(source, /addEventListener\(["']keydown["']/);
  assert.match(source, /event\.key\s*===\s*["']Enter["']\s*&&\s*!event\.shiftKey/);
  assert.match(source, /event\.preventDefault\(\)/);
});

test('blocks empty and duplicate submissions before fetch and restores the button', () => {
  const source = getChatScript(readDashboard());
  const emptyGuard = source.indexOf('if (!query)');
  const duplicateGuard = source.indexOf('if (executiveChatSending) return');
  const fetchCall = source.indexOf('await window.oxkioAuthenticatedFetch');

  assert.ok(emptyGuard >= 0 && emptyGuard < fetchCall);
  assert.ok(duplicateGuard >= 0 && duplicateGuard < fetchCall);
  assert.match(source, /executiveChatSending\s*=\s*true/);
  assert.match(source, /button\.disabled\s*=\s*true/);
  assert.match(source, /Consultando…/);
  assert.match(source, /finally\s*\{[\s\S]*executiveChatSending\s*=\s*false[\s\S]*button\.disabled\s*=\s*false/);
});

function loadChatSubmit({ fetchImpl }) {
  const html = readDashboard();
  const start = html.indexOf('async function submitExecutiveChat');
  const end = html.indexOf('function initializeExecutiveChat', start);
  const states = [];
  const input = { value: 'Prepara una respuesta al correo de contacto@example.com' };
  const button = { disabled: false };
  const document = {
    querySelector(selector) {
      if (selector === '[data-executive-chat-input]') return input;
      if (selector === '[data-executive-chat-submit]') return button;
      return null;
    },
  };
  const submit = Function(
    'document',
    'window',
    'setExecutiveChatState',
    'renderExecutiveChatResult',
    'loadExecutiveDraftApproval',
    'reportNoNewPreparation',
    `"use strict";
      const EXECUTIVE_CHAT_FAILED = "No se pudo completar la consulta.";
      let executiveChatSending = false;
      let lastEmailPreparationQuery = "";
      ${html.slice(start, end)}
      return submitExecutiveChat;`,
  )(
    document,
    { oxkioAuthenticatedFetch: fetchImpl },
    (message, state) => states.push({ message, state, disabled: button.disabled }),
    () => {},
    async () => {},
    () => {},
  );
  return { submit, states, button };
}

test('E-F chat shows "Consultando…" with Send locked, then a final state, and one click is one POST', async () => {
  let posts = 0;
  let release;
  const { submit, states, button } = loadChatSubmit({
    fetchImpl: () => {
      posts += 1;
      return new Promise((resolve) => {
        release = () => resolve({ ok: true, status: 200, json: async () => ({ response: 'ok' }) });
      });
    },
  });

  const first = submit();
  const second = submit();
  await second;
  assert.equal(posts, 1);
  assert.deepEqual(states, [{ message: 'Consultando…', state: 'sending', disabled: true }]);
  assert.equal(button.disabled, true);

  release();
  await first;
  assert.deepEqual(states.at(-1), { message: 'Consulta completada.', state: 'success', disabled: true });
  assert.equal(button.disabled, false);
  assert.equal(posts, 1);
});

test('E-F chat failures end in "No se pudo completar la consulta." and unlock Send', async () => {
  for (const fetchImpl of [
    async () => ({ ok: false, status: 503, json: async () => ({}) }),
    async () => { throw new Error('network'); },
  ]) {
    const { submit, states, button } = loadChatSubmit({ fetchImpl });
    await submit();
    assert.deepEqual(states.map((entry) => entry.message), ['Consultando…', 'No se pudo completar la consulta.']);
    assert.equal(button.disabled, false);
  }
});

test('renders a clean executive response and keeps technical metadata out of the conversation', () => {
  const source = getChatScript(readDashboard());
  const html = readDashboard();

  assert.match(source, /typeof data\.response === ["']string["']/);
  assert.match(source, /const proposal = data && data\.proposal \? data\.proposal : null/);
  assert.match(source, /const approval = data && data\.approval \? data\.approval : null/);
  assert.match(source, /textContent/);
  assert.match(source, /data\.decisionRecommendation/);
  assert.match(source, /He revisado tu petición/);
  assert.match(source, /siguiente paso más útil es realizar un análisis comercial preparatorio/);
  assert.match(source, /siguiente paso más útil es revisar el conocimiento disponible/);
  assert.match(source, /siguiente paso más útil es revisar la memoria disponible/);
  assert.match(source, /no realizará acciones reales ni contactará con terceros/);
  assert.match(source, /será únicamente de consulta/);
  assert.match(html, /data-chat-followup hidden/);
  assert.doesNotMatch(html, /data-chat-(intent|priority|confidence|interaction)/);
  assert.doesNotMatch(source, /Interaction ID:|Intención:|Prioridad:|Confianza:/);
  assert.doesNotMatch(source, /innerHTML/);
  ['sources', 'limitations', 'memory', 'privateContext', 'executionPayload', 'payloadHash', 'diagnostics']
    .forEach((field) => assert.doesNotMatch(source, new RegExp(`data\\.${field}\\b`)));
});

test('confirms only closed operations and dismisses without a fetch', () => {
  const source = getChatScript(readDashboard());
  const dismissStart = source.indexOf('function dismissDecisionRecommendation');
  const confirmStart = source.indexOf('function confirmDecisionRecommendation');
  const submitStart = source.indexOf('async function submitExecutiveChat', confirmStart);
  const dismissSource = source.slice(dismissStart, confirmStart);
  const confirmSource = source.slice(confirmStart, submitStart);

  assert.ok(dismissStart >= 0 && confirmStart > dismissStart);
  assert.doesNotMatch(dismissSource, /fetch|submitBusinessHunterOperation|submitKnowledgeOperation|submitMemoryOperation|submitGmailOperation/);
  assert.match(confirmSource, /decision === ["']business-analysis-readonly["']/);
  assert.match(confirmSource, /decision === ["']knowledge-review-readonly["']/);
  assert.match(confirmSource, /decision === ["']memory-review-readonly["']/);
  assert.match(confirmSource, /decision === ["']gmail-review-readonly["']/);
  assert.match(confirmSource, /decision === ["']calendar-review-readonly["']/);
  assert.match(confirmSource, /submitBusinessHunterOperation\(\)/);
  assert.match(confirmSource, /submitKnowledgeOperation\(\)/);
  assert.match(confirmSource, /submitMemoryOperation\(\)/);
  assert.match(confirmSource, /submitGmailOperation\(\)/);
  assert.match(confirmSource, /submitCalendarOperation\(\)/);
  assert.match(confirmSource, /if \(completed\)\s*\{\s*completeDecisionRecommendation\(hadFollowingSteps\)/);
  assert.match(confirmSource, /decisionBox\.hidden = false/);
  assert.doesNotMatch(source, /<select|data-(worker|operation)-select|name=["'](worker|type)["']/i);
});

test('renders at most three supervised plan steps and exposes only the first action', () => {
  const source = getChatScript(readDashboard());

  assert.match(source, /data\.operationPlan && Array\.isArray\(data\.operationPlan\.steps\)/);
  assert.match(source, /\.slice\(0, 3\)/);
  assert.match(source, /He preparado un plan de trabajo/);
  assert.match(source, /Paso \$\{index \+ 1\}/);
  assert.match(source, /pendingPlanSteps = plan\.slice\(1\)/);
  assert.match(source, /Solo se ejecutará el primer paso cuando lo confirmes/);
  assert.match(source, /Este paso solo se iniciará cuando lo confirmes/);
  assert.doesNotMatch(source, /Promise\.all|forEach\([^)]*submit|map\([^)]*submit/);
});

test('clears the completed recommendation and pending plan only after operation success', () => {
  const source = getChatScript(readDashboard());
  const completionStart = source.indexOf('function completeDecisionRecommendation');
  const confirmStart = source.indexOf('async function confirmDecisionRecommendation');
  const completionSource = source.slice(completionStart, confirmStart);

  assert.ok(completionStart >= 0 && confirmStart > completionStart);
  assert.match(completionSource, /pendingPlanSteps = \[\]/);
  assert.match(completionSource, /decisionBox\.hidden = true/);
  assert.match(completionSource, /decisionBox\.dataset\.decision = ""/);
  assert.match(completionSource, /plan\.replaceChildren\(\)/);
  assert.match(completionSource, /actions\.hidden = true/);
  assert.match(completionSource, /Revisión completada correctamente\./);
  assert.match(completionSource, /He completado el primer paso\. Si lo deseas, puedo continuar con el siguiente\./);
  assert.match(source, /completed = await submitBusinessHunterOperation\(\)/);
  assert.match(source, /completed = await submitKnowledgeOperation\(\)/);
  assert.match(source, /completed = await submitMemoryOperation\(\)/);
  assert.match(source, /completed = await submitGmailOperation\(\)/);
  assert.match(source, /completed = await submitCalendarOperation\(\)/);
  assert.match(source, /return true/);
  assert.match(source, /return false/);
});

test('shows no empty recommendation and removes inactive future controls', () => {
  const html = readDashboard();
  const source = getChatScript(html);

  assert.match(source, /decisionBox\.hidden = !actionDecision/);
  assert.match(source, /querySelector\("\.operations-actions"\)\.hidden = !actionDecision/);
  assert.match(source, /\[data-chat-followup\]["']\)\.hidden = !proposal && !approval/);
  assert.doesNotMatch(html, /Capacidades futuras|Subir documentos|Analizar archivos/);
  assert.match(html, /placeholder="¿En qué necesitas ayuda\?"/);
});

test('handles HTTP, network, invalid JSON, and absent optional fields safely', () => {
  const source = getChatScript(readDashboard());

  assert.match(source, /if \(!response\.ok\)/);
  assert.match(source, /await response\.json\(\)/);
  assert.match(source, /catch \(error\)/);
  assert.match(source, /const EXECUTIVE_CHAT_FAILED = "No se pudo completar la consulta\."/);
  assert.equal(source.match(/setExecutiveChatState\(EXECUTIVE_CHAT_FAILED, "error"\)/g).length, 2);
  assert.doesNotMatch(source, /error\.message|error\.stack|JSON\.stringify\(data\)/);
});

test('keeps chat state in memory and leaves existing widgets present', () => {
  const html = readDashboard();
  const source = getChatScript(html);

  assert.doesNotMatch(source, /localStorage|sessionStorage|X-OXKIO-CSRF/);
  ['Estado general', 'Agenda', 'Compromisos Ejecutivos', 'Gmail', 'Memoria ejecutiva', 'Business Hunter', 'Xose', 'Estado del Ecosistema']
    .forEach((heading) => assert.match(html, new RegExp(`<h2>${heading}<\\/h2>`)));
});
