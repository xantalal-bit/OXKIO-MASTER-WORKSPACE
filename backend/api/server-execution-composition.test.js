'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('production execution composition remains disabled and lazy', () => {
  const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

  assert.match(source, /Object\.freeze\(\{\s*executionEnabled:\s*false\s*\}\)/);
  assert.match(source, /createAuthorizedGmailDraftProvider\(\{[\s\S]*?executionEnabled:\s*executionConfig\.executionEnabled/);
  assert.match(source, /oauthReadiness:\s*executionConfig\.executionEnabled\s*\?[\s\S]*?:\s*null/);
  assert.match(source, /const gmailDraftProvider = gmailDraftComposition\.provider/);
  assert.match(source, /new ExecutionAdapter\(\{\s*emailProvider:\s*gmailDraftProvider\s*\}\)/);
  assert.equal(/executionEnabled:\s*true/.test(source), false);
});
