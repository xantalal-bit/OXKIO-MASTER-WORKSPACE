'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_PATH = path.resolve(
  __dirname,
  '../../data/knowledge-supervisor/github-releases-state.json',
);

class KnowledgeChangeDetector {
  constructor(statePath = DEFAULT_STATE_PATH) {
    this.statePath = statePath;
  }

  readState() {
    if (!fs.existsSync(this.statePath)) return { version: '1.0', sources: {} };

    try {
      return JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
    } catch (error) {
      return { version: '1.0', sources: {} };
    }
  }

  detect(candidate) {
    const state = this.readState();
    const sourceState = state.sources[candidate.sourceId] || {};
    const previous = sourceState[candidate.externalId] || null;

    if (!previous) return { changeType: 'new', changed: true, previous: null };
    if (previous.contentHash !== candidate.contentHash) {
      return { changeType: 'updated', changed: true, previous };
    }

    return { changeType: 'unchanged', changed: false, previous };
  }

  record(candidate, status, details = {}) {
    const state = this.readState();
    state.sources[candidate.sourceId] = state.sources[candidate.sourceId] || {};
    state.sources[candidate.sourceId][candidate.externalId] = {
      contentHash: candidate.contentHash,
      sourceUrl: candidate.sourceUrl,
      status,
      observedAt: new Date().toISOString(),
      ...details,
    };

    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    fs.writeFileSync(this.statePath, JSON.stringify(state, null, 2), 'utf8');

    return state.sources[candidate.sourceId][candidate.externalId];
  }
}

module.exports = { KnowledgeChangeDetector, DEFAULT_STATE_PATH };
