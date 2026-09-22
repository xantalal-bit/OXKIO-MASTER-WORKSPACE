'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('production keeps global execution disabled and enables only Gmail draft composition', () => {
  const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

  assert.match(source, /executionEnabled:\s*false/);
  assert.match(source, /draftExecutionEnabled:\s*true/);
  assert.match(source, /createAuthorizedGmailDraftProvider\(\{[\s\S]*?draftExecutionEnabled:\s*executionConfig\.draftExecutionEnabled/);
  // Readiness is still gated by the exact same flag as before — only the
  // shape changed (a ternary wrapping the async readiness call, resolved
  // lazily/once via resolveGmailDraftComposition(), instead of an eager
  // synchronous call at module load — inspectGoogleOAuthReadiness() reads
  // the configured OXKIO_GOOGLE_OAUTH_TOKEN_STORE, which is inherently
  // async once Secret Manager is in play).
  assert.match(source, /executionConfig\.draftExecutionEnabled\s*\?\s*inspectGoogleOAuthReadiness\(\)/);
  assert.match(source, /let gmailDraftCompositionPromise = null/);
  assert.match(source, /function resolveGmailDraftComposition\(\)/);
  assert.match(source, /if \(!gmailDraftCompositionPromise\)/);
  assert.match(source, /new ExecutionAdapter\(\{\s*resolveEmailProvider:\s*async \(\) => \(await resolveGmailDraftComposition\(\)\)\.provider/);
  assert.doesNotMatch(source, /(?:^|[^A-Za-z])executionEnabled:\s*true/);
  assert.match(source, /const executiveCsrf = createExecutiveCsrf\(\)/);
  assert.match(source, /pathname === ["']\/api\/executive\/security-context["']/);
  assert.match(source, /handleApproveRequest\(req, res, \{[\s\S]*?getIdentity:\s*\(\) => requestPrivateIdentity,[\s\S]*?csrf:\s*executiveCsrf/);
  assert.match(source, /handleExecuteApprovedRequest\(req, res, \{[\s\S]*?getIdentity:\s*\(\) => requestPrivateIdentity,[\s\S]*?csrf:\s*executiveCsrf/);
});
