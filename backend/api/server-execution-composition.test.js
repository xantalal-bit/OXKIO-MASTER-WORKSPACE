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
  assert.match(source, /oauthReadiness:\s*executionConfig\.draftExecutionEnabled\s*\?/);
  assert.match(source, /const gmailDraftProvider = gmailDraftComposition\.provider/);
  assert.match(source, /new ExecutionAdapter\(\{\s*emailProvider:\s*gmailDraftProvider\s*\}\)/);
  assert.doesNotMatch(source, /(?:^|[^A-Za-z])executionEnabled:\s*true/);
  assert.match(source, /const executiveCsrf = createExecutiveCsrf\(\)/);
  assert.match(source, /pathname === ["']\/api\/executive\/security-context["']/);
  assert.match(source, /handleApproveRequest\(req, res, \{[\s\S]*?getIdentity:\s*\(\) => requestPrivateIdentity,[\s\S]*?csrf:\s*executiveCsrf/);
  assert.match(source, /handleExecuteApprovedRequest\(req, res, \{[\s\S]*?getIdentity:\s*\(\) => requestPrivateIdentity,[\s\S]*?csrf:\s*executiveCsrf/);
});
