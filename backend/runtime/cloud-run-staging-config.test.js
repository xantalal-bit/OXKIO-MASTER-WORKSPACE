'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const manifestPath = path.join(root, 'deploy', 'cloud-run', 'service.staging.yaml');
const manifest = fs.readFileSync(manifestPath, 'utf8');

test('staging manifest selects the postgres Approval backend, never json', () => {
  assert.match(manifest, /OXKIO_APPROVAL_REPOSITORY_BACKEND\s*\n?\s*value:\s*"postgres"/);
  assert.doesNotMatch(manifest, /OXKIO_APPROVAL_REPOSITORY_BACKEND\s*\n?\s*value:\s*"json"/);
});

test('staging manifest never materializes real credentials or connection strings', () => {
  assert.doesNotMatch(manifest, /postgresql:\/\//);
  assert.doesNotMatch(manifest, /postgres:\/\//);
  assert.doesNotMatch(manifest, /BEGIN (RSA )?PRIVATE KEY/);
  assert.doesNotMatch(manifest, /private_key/i);
  assert.doesNotMatch(manifest, /\.env\b/);
});

test('staging manifest references the Approval secret same-project, pinned to no version, and excludes PG-RUN', () => {
  assert.match(manifest, /secretKeyRef:/);
  assert.match(manifest, /name:\s*OXKIO_APPROVAL_PG_RUNTIME_URL/);
  assert.match(manifest, /key:\s*latest/);
  assert.doesNotMatch(manifest, /OXKIO_MISSION_PG_RUNTIME_URL/);
  assert.doesNotMatch(manifest, /OXKIO_MISSION_PG_ADMIN_URL/);
});

test('staging manifest does not declare run.googleapis.com/secrets or an invented project number', () => {
  // This manifest uses the same-project secretKeyRef.name mechanism: the
  // Cloud Run service and the Secret Manager secret share one GCP project
  // (oxkio-runtime-prod), so the alias annotation is not needed here.
  assert.doesNotMatch(manifest, /run\.googleapis\.com\/secrets/);
  assert.doesNotMatch(manifest, /projects\/\d+\/secrets/);
});

test('staging manifest keeps this first service at minScale 0 / maxScale 1 / concurrency 1', () => {
  const minScaleMatch = manifest.match(/autoscaling\.knative\.dev\/minScale:\s*"(\d+)"/);
  const maxScaleMatch = manifest.match(/autoscaling\.knative\.dev\/maxScale:\s*"(\d+)"/);
  assert.ok(minScaleMatch, 'minScale annotation must be present');
  assert.ok(maxScaleMatch, 'maxScale annotation must be present');
  assert.equal(Number(minScaleMatch[1]), 0);
  assert.equal(Number(maxScaleMatch[1]), 1);
  assert.match(manifest, /containerConcurrency:\s*1\b/);
});

test('staging manifest fixes CPU 1 / memory 512Mi', () => {
  assert.match(manifest, /cpu:\s*"1"/);
  assert.match(manifest, /memory:\s*"512Mi"/);
});

test('staging manifest uses the decided runtime service account, no other identity', () => {
  const saMatches = manifest.match(/serviceAccountName:\s*(\S+)/g) || [];
  assert.equal(saMatches.length, 1);
  assert.match(
    manifest,
    /serviceAccountName:\s*oxkio-runtime-prod@oxkio-runtime-prod\.iam\.gserviceaccount\.com/
  );
});

test('staging manifest declares region and ingress in the real Cloud Run schema', () => {
  assert.match(manifest, /cloud\.googleapis\.com\/location:\s*europe-west3/);
  assert.match(manifest, /run\.googleapis\.com\/ingress:\s*all/);
});

test('staging manifest keeps fail-closed placeholders and no public IAM binding', () => {
  assert.match(manifest, /image:\s*PLACEHOLDER_IMAGE_REFERENCE_NOT_YET_PUBLISHED/);
  assert.match(
    manifest,
    /OXKIO_ADMIN_FIREBASE_UIDS[\s\S]*?value:\s*"REPLACE_WITH_ADMIN_FIREBASE_UID"/
  );
  assert.doesNotMatch(manifest, /run\.invoker/i);
  assert.doesNotMatch(manifest, /allUsers/);
});

test('staging manifest and its docs do not introduce Hosting/Blaze or an alternate region', () => {
  assert.doesNotMatch(manifest, /firebase\.json|firebase hosting|hosting:/i);
  assert.doesNotMatch(manifest, /blaze/i);

  const readme = fs.readFileSync(path.join(root, 'deploy', 'cloud-run', 'README.md'), 'utf8');
  const regionMatches = readme.match(/--region=([a-z0-9-]+)/g) || [];
  assert.ok(regionMatches.length > 0, 'README must document the future --region step');
  regionMatches.forEach((match) => assert.equal(match, '--region=europe-west3'));
});
