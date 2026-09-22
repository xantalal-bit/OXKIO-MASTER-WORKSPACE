'use strict';

// OXKIO CANONICAL RUNTIME CONSOLIDATION (22/09/2026): server.js starts an
// HTTP server as a side effect of being required (see server.listen() at the
// bottom of the file), so — same convention as
// server-execution-composition.test.js — these are source-level assertions,
// not a live HTTP request against a running instance.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

// TEST A: legacy GET /api/chat is disabled before it can reach
// executiveBrain.think() / SupervisorAgent / proposalEngine / approvalQueue.
test('legacy GET /api/chat returns a disabled response and never reaches executiveBrain.think()', () => {
  const chatGuardIndex = source.indexOf('req.url.startsWith("/api/chat")');
  assert.notEqual(chatGuardIndex, -1, '/api/chat guard must still exist');

  const thinkCallIndex = source.indexOf('executiveBrain.think(message)');
  assert.equal(thinkCallIndex, -1, 'the legacy executiveBrain.think(message) call site must be removed from the /api/chat handler');

  const guardBlock = source.slice(chatGuardIndex, chatGuardIndex + 400);
  assert.match(guardBlock, /legacy_endpoint_disabled/);
  assert.match(guardBlock, /410/);
  assert.match(guardBlock, /\/api\/executive\/chat/);
});

// TEST B: legacy demo endpoint /api/process-email is disabled before it can
// run EmailWorkflow(EmailAgent) over its hardcoded demo email.
test('legacy /api/process-email returns a disabled response and never runs the demo EmailWorkflow', () => {
  const guardIndex = source.indexOf('req.url === "/api/process-email"');
  assert.notEqual(guardIndex, -1, '/api/process-email guard must still exist');

  const workflowCallIndex = source.indexOf('workflow.process(testEmail)');
  assert.equal(workflowCallIndex, -1, 'the legacy workflow.process(testEmail) call site must be removed from the /api/process-email handler');

  const guardBlock = source.slice(guardIndex, guardIndex + 400);
  assert.match(guardBlock, /legacy_endpoint_disabled/);
  assert.match(guardBlock, /410/);
});

// TEST C: the modules themselves are preserved (not deleted), per the
// mission's "no borrar codigo, no borrar agentes" preference — only the
// server.js call sites were disabled.
test('legacy modules (EmailAgent, EmailWorkflow, proposalEngine, approvalQueue) remain importable, not deleted', () => {
  assert.doesNotThrow(() => require('../agents/emailAgent'));
  assert.doesNotThrow(() => require('../workflows/emailWorkflow'));
  assert.doesNotThrow(() => require('../core/proposalEngine'));
  assert.doesNotThrow(() => require('../core/approvalQueue'));
  assert.doesNotThrow(() => require('../core/executiveBrain'));
  assert.doesNotThrow(() => require('../agents/executive/supervisorAgent'));
});

// TEST G (correlation): executionLogger is now wired into the modern
// /api/executive/chat dependencies with safe metadata only.
test('executionLogger is wired into the modern executive chat route dependencies', () => {
  const routeIndex = source.indexOf('isExecutiveChatRoute(pathname, req.method)');
  assert.notEqual(routeIndex, -1);
  const routeBlock = source.slice(routeIndex, routeIndex + 900);
  assert.match(routeBlock, /executionLogger/);
});
