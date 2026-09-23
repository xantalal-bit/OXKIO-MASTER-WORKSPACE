'use strict';

// Deterministic, provider-free metrics for supervised autonomy.
// This module records counts only; it never grants execution permission.
class AgentProductivityMetrics {
  constructor() {
    this.completed = 0;
    this.humanInterventions = 0;
    this.blocked = 0;
    this.failed = 0;
  }

  record(outcome) {
    switch (outcome) {
      case 'completed': this.completed += 1; break;
      case 'human_intervention': this.humanInterventions += 1; break;
      case 'blocked': this.blocked += 1; break;
      case 'failed': this.failed += 1; break;
      default: throw new TypeError('unsupported productivity outcome');
    }
    return this.snapshot();
  }

  snapshot() {
    const resolved = this.completed + this.humanInterventions;
    return Object.freeze({
      completed: this.completed,
      humanInterventions: this.humanInterventions,
      blocked: this.blocked,
      failed: this.failed,
      autonomousWorkPerHumanIntervention: this.humanInterventions === 0
        ? this.completed
        : this.completed / this.humanInterventions,
      autonomousCompletionRate: resolved === 0 ? 0 : this.completed / resolved,
    });
  }
}

module.exports = { AgentProductivityMetrics };
