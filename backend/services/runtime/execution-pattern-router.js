'use strict';

const PATTERNS = Object.freeze({
  DETERMINISTIC: 'deterministic',
  SINGLE_SHOT: 'single_shot',
  REACT: 'react',
  PLANNER_EXECUTOR: 'planner_executor',
  REFLEXIVE: 'reflexive',
  VERIFIER_GATED: 'verifier_gated',
});

function selectExecutionPattern(mission = {}) {
  if (mission.deterministicAvailable === true) {
    return { pattern: PATTERNS.DETERMINISTIC, reason: 'deterministic_available' };
  }

  // Sensitive or materially consequential actions must not rely on an
  // unverified model output. This selects the architecture only; it does not
  // grant execution permission or bypass the existing human approval gates.
  if (mission.requiresIndependentVerification === true || mission.sensitiveAction === true) {
    return { pattern: PATTERNS.VERIFIER_GATED, reason: 'verification_required' };
  }

  if (mission.requiresPlanning === true || mission.specialistHandoffs > 1 || mission.parallelSubtasks > 1) {
    return { pattern: PATTERNS.PLANNER_EXECUTOR, reason: 'decomposition_required' };
  }

  if (mission.requiresIterativeTools === true || mission.unknownToolSteps === true) {
    return { pattern: PATTERNS.REACT, reason: 'iterative_tool_use_required' };
  }

  if (mission.requiresSelfCritique === true || mission.qualityRefinementPasses > 0) {
    return { pattern: PATTERNS.REFLEXIVE, reason: 'quality_refinement_required' };
  }

  return { pattern: PATTERNS.SINGLE_SHOT, reason: 'simplest_sufficient_pattern' };
}

module.exports = { PATTERNS, selectExecutionPattern };
