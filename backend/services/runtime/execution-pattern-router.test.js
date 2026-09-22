'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { PATTERNS, selectExecutionPattern } = require('./execution-pattern-router');

test('prefers deterministic execution when available', () => {
  assert.equal(selectExecutionPattern({ deterministicAvailable: true, requiresPlanning: true }).pattern, PATTERNS.DETERMINISTIC);
});

test('uses verifier-gated architecture for sensitive actions', () => {
  const result = selectExecutionPattern({ sensitiveAction: true, requiresIterativeTools: true });
  assert.equal(result.pattern, PATTERNS.VERIFIER_GATED);
  assert.equal(result.reason, 'verification_required');
});

test('uses planner-executor only when decomposition is required', () => {
  assert.equal(selectExecutionPattern({ parallelSubtasks: 2 }).pattern, PATTERNS.PLANNER_EXECUTOR);
  assert.equal(selectExecutionPattern({ specialistHandoffs: 2 }).pattern, PATTERNS.PLANNER_EXECUTOR);
});

test('uses ReAct for iterative or unknown tool steps', () => {
  assert.equal(selectExecutionPattern({ requiresIterativeTools: true }).pattern, PATTERNS.REACT);
});

test('uses reflexive pattern for explicit quality refinement', () => {
  assert.equal(selectExecutionPattern({ qualityRefinementPasses: 1 }).pattern, PATTERNS.REFLEXIVE);
});

test('defaults to single-shot rather than decorative multi-agent execution', () => {
  const result = selectExecutionPattern({});
  assert.equal(result.pattern, PATTERNS.SINGLE_SHOT);
  assert.equal(result.reason, 'simplest_sufficient_pattern');
});
