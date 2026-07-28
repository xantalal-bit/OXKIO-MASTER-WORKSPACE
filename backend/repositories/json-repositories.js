'use strict';

const fs = require('node:fs');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class JsonSnapshotRepository {
  constructor({ filePath, emptySnapshot }) {
    if (typeof filePath !== 'string' || !filePath) throw new Error('JSON repository filePath is required.');
    this.filePath = filePath;
    this.emptySnapshot = clone(emptySnapshot);
    this.persistence = 'local_only';
  }

  loadSnapshot() {
    try {
      if (!fs.existsSync(this.filePath)) return clone(this.emptySnapshot);
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch {
      return clone(this.emptySnapshot);
    }
  }

  saveSnapshot(snapshot) {
    fs.writeFileSync(this.filePath, JSON.stringify(snapshot, null, 2));
  }
}

class JsonApprovalRepository extends JsonSnapshotRepository {
  constructor({ filePath }) {
    super({ filePath, emptySnapshot: { pending: [], history: [] } });
  }
}

class JsonMemoryRepository extends JsonSnapshotRepository {
  constructor({ filePath }) {
    super({ filePath, emptySnapshot: { shortTermMemory: [], longTermMemory: [] } });
  }
}

class JsonOperationRepository extends JsonSnapshotRepository {
  constructor({ filePath }) {
    super({ filePath, emptySnapshot: { logs: [] } });
  }
}

class JsonAuditRepository extends JsonSnapshotRepository {
  constructor({ filePath }) {
    super({ filePath, emptySnapshot: { entries: [] } });
  }

  append(entry) {
    const snapshot = this.loadSnapshot();
    snapshot.entries = Array.isArray(snapshot.entries) ? snapshot.entries : [];
    snapshot.entries.push(clone(entry));
    this.saveSnapshot(snapshot);
    return clone(entry);
  }

  list() {
    const snapshot = this.loadSnapshot();
    return clone(Array.isArray(snapshot.entries) ? snapshot.entries : []);
  }
}

class JsonOAuthTokenRepository extends JsonSnapshotRepository {
  constructor({ filePath }) {
    super({ filePath, emptySnapshot: { subjects: {} } });
  }

  loadForSubject(subjectId) {
    const snapshot = this.loadSnapshot();
    return clone(snapshot.subjects?.[subjectId] || null);
  }

  saveForSubject(subjectId, tokens) {
    const snapshot = this.loadSnapshot();
    snapshot.subjects = snapshot.subjects || {};
    snapshot.subjects[subjectId] = clone(tokens);
    this.saveSnapshot(snapshot);
  }

  deleteForSubject(subjectId) {
    const snapshot = this.loadSnapshot();
    snapshot.subjects = snapshot.subjects || {};
    delete snapshot.subjects[subjectId];
    this.saveSnapshot(snapshot);
  }
}

module.exports = {
  JsonApprovalRepository,
  JsonAuditRepository,
  JsonMemoryRepository,
  JsonOAuthTokenRepository,
  JsonOperationRepository,
  JsonSnapshotRepository,
};
