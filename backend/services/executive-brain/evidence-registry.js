'use strict';

const { createHash } = require('node:crypto');

// XATAI CORE V2 (03/10/2026): Evidence Registry. The verifier never accepts an
// evidence reference because it looks valid: it resolves it here. Evidence is
// written only through registrar handles for trusted sources (tool adapters,
// connectors), created by the composition root; executors and agents never
// receive one, so an executor cannot mint evidence for its own claim.
//
// Each entry is bound to one mission and one task and states which task
// criteria it supports. Entries are immutable and a reference can be recorded
// only once. This implementation is in memory and deterministic; a durable
// store can replace it behind the same contract (registrar/record/resolve).

const REF_PATTERN = /^[A-Za-z0-9:_.#-]{1,128}$/;
const ID_PATTERN = /^[A-Za-z0-9:_-]{3,128}$/;
const CRITERION_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
// Registrars are trusted sources such as "tool:gmail-read". An agent id,
// a coordinator or a subagent can never be a registrar.
const REGISTRAR_PATTERN = /^tool:[a-z0-9][a-z0-9_.-]{0,63}$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const DEFAULT_LIMIT = 5000;

function fail(code) {
  const error = new TypeError(code);
  error.code = code;
  throw error;
}

function createEvidenceRegistry({ trustedRegistrars = [], now = () => new Date().toISOString(), limit = DEFAULT_LIMIT } = {}) {
  const trusted = new Set(trustedRegistrars.filter((id) => REGISTRAR_PATTERN.test(id)));
  if (trusted.size !== trustedRegistrars.length) fail('EVIDENCE_INVALID_REGISTRAR');
  const entries = new Map();

  function registrar(registrarId) {
    if (!trusted.has(registrarId)) fail('EVIDENCE_UNTRUSTED_REGISTRAR');
    return Object.freeze({
      registrarId,
      // outputDigest (optional) binds the evidence to the exact result the
      // tool produced; the verifier then rejects any other result text.
      record({ ref, missionId, taskId, supports = [], kind = 'tool_output', outputDigest = null } = {}) {
        if (typeof ref !== 'string' || !REF_PATTERN.test(ref)) fail('EVIDENCE_INVALID_REF');
        if (typeof missionId !== 'string' || !ID_PATTERN.test(missionId)) fail('EVIDENCE_INVALID_SCOPE');
        if (typeof taskId !== 'string' || !ID_PATTERN.test(taskId)) fail('EVIDENCE_INVALID_SCOPE');
        if (!Array.isArray(supports) || supports.length === 0
          || supports.some((id) => typeof id !== 'string' || !CRITERION_PATTERN.test(id))) {
          fail('EVIDENCE_INVALID_SUPPORTS');
        }
        if (typeof kind !== 'string' || !CRITERION_PATTERN.test(kind)) fail('EVIDENCE_INVALID_KIND');
        if (outputDigest !== null && (typeof outputDigest !== 'string' || !DIGEST_PATTERN.test(outputDigest))) {
          fail('EVIDENCE_INVALID_DIGEST');
        }
        if (entries.has(ref)) fail('EVIDENCE_DUPLICATE_REF');
        if (entries.size >= limit) fail('EVIDENCE_REGISTRY_FULL');
        const entry = Object.freeze({
          ref, missionId, taskId, supports: Object.freeze([...new Set(supports)]), kind, outputDigest, registrarId, recordedAt: now(),
        });
        entries.set(ref, entry);
        return entry;
      },
    });
  }

  return Object.freeze({
    registrar,
    resolve: (ref) => (typeof ref === 'string' && entries.has(ref) ? entries.get(ref) : null),
  });
}

// Without a registry nothing resolves: every claim stays unproven (fail closed).
const EMPTY_EVIDENCE_REGISTRY = Object.freeze({ resolve: () => null });

function digestOutput(text) {
  return `sha256:${createHash('sha256').update(typeof text === 'string' ? text : '').digest('hex')}`;
}

module.exports = { EMPTY_EVIDENCE_REGISTRY, REGISTRAR_PATTERN, createEvidenceRegistry, digestOutput };
